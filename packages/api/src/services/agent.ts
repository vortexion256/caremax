import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage, AIMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { computeCostUsd, extractTokenUsage, recordUsage, type UsageMetadata } from './token-usage.js';
import { getRagContext } from './rag.js';
import { createRecord, createModificationRequest, getRecord, listRecords } from './auto-agent-brain.js';
import { isGoogleConnected, fetchSheetData } from './google-sheets.js';
import { recordDiagnosticLog } from './diagnostic-logs.js';
import { createNote, listNotes as listAgentNotes, updateNoteContent, getNote } from './agent-notes.js';

export type AgentResult = { text: string; requestHandoff?: boolean };

const AGENT_FALLBACK_MODELS = ['gemini-3-flash-preview', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];

function getMessageText(message: BaseMessage): string {
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== 'object') return '';
        const partText = (part as { text?: unknown }).text;
        return typeof partText === 'string' ? partText : '';
      })
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

function getLlmInputSummary(messages: BaseMessage[]): { lastUserText: string | null; promptPreview: string | null } {
  const recent = messages.slice(-6);
  const preview = recent
    .map((msg) => {
      const role = typeof msg._getType === 'function' ? msg._getType() : 'unknown';
      const text = getMessageText(msg).replace(/\s+/g, ' ').trim();
      if (!text) return null;
      return `${role}: ${text.slice(0, 220)}`;
    })
    .filter((line): line is string => !!line)
    .join('\n');

  const lastUser = [...messages]
    .reverse()
    .find((msg) => (typeof msg._getType === 'function' ? msg._getType() === 'human' : false));

  return {
    lastUserText: lastUser ? getMessageText(lastUser).slice(0, 400) : null,
    promptPreview: preview ? preview.slice(0, 1200) : null,
  };
}

/** Format existing Auto Agent Brain records for the system prompt so the agent can decide add vs edit vs delete. */
const CONTENT_SNIPPET_LENGTH = 120;

function formatExistingRecordsForPrompt(records: { recordId: string; title: string; content: string }[]): string {
  if (records.length === 0) return 'No existing records yet.';
  return records
    .map((r) => {
      const snippet = r.content.length <= CONTENT_SNIPPET_LENGTH ? r.content : r.content.slice(0, CONTENT_SNIPPET_LENGTH) + '…';
      return `- recordId: ${r.recordId}\n  title: ${r.title}\n  content: ${snippet}`;
    })
    .join('\n\n');
}

/** When the model includes this at the end of its reply, we escalate to a human. Enables indirect "I want a person" and "couldn't help after repeat" detection. */
const HANDOFF_MARKER = '[HANDOFF]';

const defaultSystemPrompt = `You are a helpful clinical triage assistant. You help users understand possible next steps based on their symptoms.
You may suggest: possible diagnoses (as possibilities, not certainties), tests they could discuss with a doctor, first aid or home care when appropriate, and when to seek emergency or in-person care.
Always be clear that you are not a doctor and cannot diagnose. If the user shares images (e.g. skin, wound), you may comment on what you observe and suggest next steps, but never give a definitive diagnosis from images alone.
If the situation sounds urgent or the user seems to need a human care coordinator, say so and suggest they speak with a care team member.`;

function defaultPromptForName(agentName: string): string {
  return `You are ${agentName}, a clinical triage assistant for this organization. When asked your name or who you are, say you are ${agentName}.
You help users understand possible next steps based on their symptoms. Suggest when to see a doctor or seek care. Be clear you are not a doctor and cannot diagnose. For contact info, hours, or phone numbers, use the knowledge base if provided.`;
}

async function recordActivity(tenantId: string, type: string): Promise<void> {
  try {
    const docRef = await db.collection('agent_activities').add({
      tenantId,
      type,
      createdAt: FieldValue.serverTimestamp(),
    });
    console.log(`[Agent] ✅ Recorded activity: type="${type}", tenantId="${tenantId}", docId="${docRef.id}"`);
  } catch (e) {
    console.error(`[Agent] ❌ Failed to record activity: type="${type}", tenantId="${tenantId}"`, e);
  }
}

export type GoogleSheetEntry = { spreadsheetId: string; range?: string; useWhen: string };

async function getDefaultAgentModel(): Promise<string> {
  const fallbackModel = AGENT_FALLBACK_MODELS[0];

  try {
    const doc = await db.collection('platform_settings').doc('saas_billing').get();
    const availableModels = doc.data()?.availableModels;

    if (Array.isArray(availableModels)) {
      const firstValidModel = availableModels.find((model): model is string => typeof model === 'string' && model.trim().length > 0);
      if (firstValidModel) return firstValidModel;
    }
  } catch (e) {
    console.warn('[Agent] Failed to load SaaS available model list; using fallback model.', e);
  }

  return fallbackModel;
}

function normalizeGoogleSheets(data: Record<string, unknown> | undefined): GoogleSheetEntry[] {
  const arr = data?.googleSheets;
  if (Array.isArray(arr) && arr.length > 0) {
    return arr
      .filter((e) => e && typeof e.spreadsheetId === 'string' && (e.spreadsheetId as string).trim() && typeof e.useWhen === 'string' && (e.useWhen as string).trim())
      .map((e) => ({
        spreadsheetId: (e as { spreadsheetId: string }).spreadsheetId.trim(),
        range: typeof (e as { range?: string }).range === 'string' ? (e as { range: string }).range.trim() || undefined : undefined,
        useWhen: (e as { useWhen: string }).useWhen.trim(),
      }));
  }
  const legacyId = (data?.googleSheetsSpreadsheetId as string)?.trim();
  if (legacyId) {
    const range = (data?.googleSheetsRange as string)?.trim() || undefined;
    return [{ spreadsheetId: legacyId, range, useWhen: 'general' }];
  }
  return [];
}

export async function getAgentConfig(tenantId: string): Promise<{
  agentName: string;
  systemPrompt: string;
  thinkingInstructions: string;
  model: string;
  temperature: number;
  ragEnabled: boolean;
  googleSheets: GoogleSheetEntry[];
  learningOnlyPrompt?: string;
  consolidationPrompt?: string;
}> {
  const defaultModel = await getDefaultAgentModel();
  const configRef = db.collection('agent_config').doc(tenantId);
  const configDoc = await configRef.get();
  const data = configDoc.data();

  if (configDoc.exists && data?.agentName) {
    const prompt = (data.systemPrompt?.trim() ?? '') || defaultPromptForName(data.agentName);
    return {
      agentName: data.agentName,
      systemPrompt: prompt,
      thinkingInstructions: data?.thinkingInstructions ?? 'Be concise, empathetic, and safety-conscious.',
      model: data?.model ?? defaultModel,
      temperature: data?.temperature ?? 0.7,
      ragEnabled: data?.ragEnabled === true,
      googleSheets: normalizeGoogleSheets(data),
      learningOnlyPrompt: data?.learningOnlyPrompt?.trim() || undefined,
      consolidationPrompt: data?.consolidationPrompt?.trim() || undefined,
    };
  }

  const tenantDoc = await db.collection('tenants').doc(tenantId).get();
  const tenantName = tenantDoc.data()?.name as string | undefined;
  const agentName = tenantName ?? data?.agentName ?? 'CareMax Assistant';
  const systemPrompt = (data?.systemPrompt?.trim() ?? '') || (tenantName ? defaultPromptForName(tenantName) : defaultSystemPrompt);

  if (!configDoc.exists && tenantName) {
    configRef.set({
      tenantId,
      agentName,
      systemPrompt,
      thinkingInstructions: 'Be concise, empathetic, and safety-conscious.',
      model: defaultModel,
      temperature: 0.7,
      ragEnabled: false,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => {});
  }

  return {
    agentName,
    systemPrompt,
    thinkingInstructions: data?.thinkingInstructions ?? 'Be concise, empathetic, and safety-conscious.',
    model: data?.model ?? defaultModel,
    temperature: data?.temperature ?? 0.7,
    ragEnabled: data?.ragEnabled === true,
    googleSheets: normalizeGoogleSheets(data),
    learningOnlyPrompt: data?.learningOnlyPrompt?.trim() || undefined,
    consolidationPrompt: data?.consolidationPrompt?.trim() || undefined,
  };
}

/** MIME types Gemini supports (avif, etc. are not). */
const GEMINI_SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/** Fetch image from URL and return as base64 data URL. Converts AVIF/unsupported types to JPEG via sharp. */
async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    let contentType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
    let b64: string;

    if (!GEMINI_SUPPORTED_IMAGE_TYPES.has(contentType.toLowerCase())) {
      try {
        const sharp = (await import('sharp')).default;
        const jpeg = await sharp(buf).jpeg({ quality: 90 }).toBuffer();
        b64 = jpeg.toString('base64');
        contentType = 'image/jpeg';
      } catch (e) {
        console.warn('Image conversion failed (install sharp for AVIF/unsupported types):', e);
        return null;
      }
    } else {
      b64 = buf.toString('base64');
    }
    return `data:${contentType};base64,${b64}`;
  } catch {
    return null;
  }
}

async function toLangChainMessages(
  history: { role: string; content: string; imageUrls?: string[] }[]
): Promise<BaseMessage[]> {
  const out: BaseMessage[] = [];
  for (const m of history) {
    if (m.role === 'user') {
      const imageUrls = m.imageUrls ?? [];
      if (imageUrls.length > 0) {
        const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [];
        if (m.content?.trim()) content.push({ type: 'text', text: m.content });
        for (const url of imageUrls) {
          if (!url?.trim()) continue;
          const dataUrl = await fetchImageAsDataUrl(url.trim());
          if (dataUrl) content.push({ type: 'image_url', image_url: { url: dataUrl } });
        }
        if (content.length === 0) content.push({ type: 'text', text: '(User sent an image with no text)' });
        out.push(new HumanMessage({ content }));
      } else {
        out.push(new HumanMessage({ content: m.content }));
      }
    } else if (m.role === 'assistant') {
      out.push(new AIMessage({ content: m.content }));
    } else if (m.role === 'human_agent') {
      out.push(new AIMessage({ content: `[Care team said to the user]: ${m.content}` }));
    }
  }
  return out;
}

/** True if the last assistant message suggests they couldn't help or were uncertain (so a follow-up may warrant escalation). */
function lastReplyWasUnhelpfulOrUncertain(history: { role: string; content: string }[]): boolean {
  const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant');
  if (!lastAssistant?.content) return false;
  const c = lastAssistant.content.toLowerCase();
  const phrases = [
    "i'm not sure",
    "i am not sure",
    "i can't",
    "i cannot",
    "i don't have",
    "i do not have",
    "rephrase",
    "contact your doctor",
    "speak with a doctor",
    "recommend speaking",
    "recommend talking",
    "cannot diagnose",
    "can't diagnose",
    "beyond my",
    "outside my",
    "outside of my",
    "not able to help",
    "unable to help",
    "don't have enough",
    "don't have that information",
    "couldn't find",
    "could not find",
    "no information",
    "please rephrase",
    "try rephrasing",
  ];
  return phrases.some((p) => c.includes(p));
}

/** True if there are at least two user messages (so we're in a multi-turn exchange and "repeat ask" makes sense). */
function hasMultipleUserTurns(history: { role: string }[]): boolean {
  return history.filter((m) => m.role === 'user').length >= 2;
}

export async function runAgent(
  tenantId: string,
  history: { role: string; content: string; imageUrls?: string[] }[],
  options?: { userId?: string; conversationId?: string }
): Promise<AgentResult> {
  const runStartedAt = Date.now();
  const config = await getAgentConfig(tenantId);
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY not set');

  const model = new ChatGoogleGenerativeAI({
    model: config.model,
    temperature: config.temperature,
    apiKey,
  });

  const avoidGeneric = config.agentName !== 'CareMax Assistant'
    ? ` Never say "CareMax Assistant" or "I don't have a name"—always say you are ${config.agentName}.`
    : '';
  const nameInstruction = `Your name is ${config.agentName}. You must always use this name: when greeting, when asked "what's your name" or "who are you", and in any introduction.${avoidGeneric}`;
  const historyInstruction = `Use the full conversation history. Messages labeled "[Care team said to the user]: ..." are from a human care team member—treat them as what was actually said to the user. When the user asks what was recommended, what the care team said, or "what did you say?" / "what's the best?", answer in one short paragraph using only that history (e.g. "The care team suggested Panado Extra for your pain."). Do not repeat the same sentence or block twice in one reply. Do not repeat long triage unless the user asks for more detail.`;
  const imageInstruction = `When the user attaches images, they are included in the conversation and you can see them. Describe what you observe when relevant (e.g. for symptoms, skin, wounds) and suggest next steps. Do not say you cannot see images or that images are not available—you receive them when the user sends them.`;
  const toneInstruction = `Tone: Be natural and concise. For "hi", "hello", or "how are you?" reply in one short sentence (e.g. "Hi! How can I help?" or "Doing well, thanks—what can I help with?"). Do not repeat "I am [name], a clinical triage assistant" or "How can I assist you with your health concerns today?" in every message—say it only when the user asks who you are or what you do. Vary your wording; avoid the same phrases in every reply.`;

  const escalationInstruction = `
Escalation to a human: When EITHER of the following is true, you MUST end your reply with exactly "${HANDOFF_MARKER}" on a new line (the user will not see this; the system will connect them to a care team member).
1) The user expresses in any way that they want to speak to a human, a real person, the care team, or an agent—including indirect phrasings like "can I talk to someone?", "I want a person", "not a bot", "real human", "actual person", "get me a human", "speak to staff", "connect me with support".
2) You have already tried to help with the same or similar question and could not resolve it, or the user is asking again / rephrasing after you gave an uncertain or unhelpful answer—in that case escalate so a human can take over instead of repeating that you cannot help.`;
  const followUpHint =
    hasMultipleUserTurns(history) && lastReplyWasUnhelpfulOrUncertain(history)
      ? ` The user has sent another message after you previously could not fully help. You MUST end your reply with "${HANDOFF_MARKER}" to escalate to a human.`
      : '';

  // Get existing notes for this conversation to prevent duplicates
  let existingNotesContext = '';
  if (options?.conversationId) {
    try {
      const existingNotes = await listAgentNotes(tenantId, { conversationId: options.conversationId, limit: 10 });
      if (existingNotes.length > 0) {
        existingNotesContext = `\n\n--- Existing notes in this conversation (do NOT create duplicates) ---\n${existingNotes.map((n, i) => `${i + 1}. [${n.category}] ${n.content}${n.patientName ? ` (User: ${n.patientName})` : ''}`).join('\n')}\n--- End of existing notes ---\n\nBefore creating a note, check the list above. If a note about the same topic already exists (same question pattern, same keyword, same insight), do NOT create a duplicate. Only create a note if it's genuinely new information not already covered above.`;
      }
    } catch (e) {
      console.warn('Failed to load existing notes for deduplication:', e);
    }
  }

  let systemContent = `${nameInstruction}\n\n${config.systemPrompt}\n\n${historyInstruction}\n\n${imageInstruction}\n\n${toneInstruction}\n\n${escalationInstruction}${followUpHint}\n\nHow you should think: ${config.thinkingInstructions}\n\nIMPORTANT - Agent Notebook: As you interact with users, observe patterns and create notes for admin review in the Agent Notebook. Use create_note to track analytics and insights such as: most common questions asked by users, frequently asked about topics or items, important keywords or trends, user behavior patterns, or any insights that would help improve the service. You can also use list_notes to see existing notes for this conversation and update_note to refine or add information to an existing note. Create or update notes ONLY when necessary, such as when you notice significant patterns (e.g., multiple users asking about the same thing, trending topics, common confusion points) or important individual insights that require admin attention. Avoid creating redundant or trivial notes. These notes help admins understand user needs and improve the service.${existingNotesContext}`;
  if (config.ragEnabled) {
    const lastUser = history.filter((m) => m.role === 'user').pop();
    // Add timeout for RAG context retrieval (5 seconds)
    let ragContext = '';
    if (lastUser) {
      try {
        ragContext = await Promise.race([
          getRagContext(tenantId, lastUser.content),
          new Promise<string>((_, reject) => {
            setTimeout(() => reject(new Error('RAG context timeout')), 5000);
          }),
        ]).catch((e) => {
          console.warn('[Agent] RAG context retrieval timeout or error:', e);
          return '';
        });
      } catch (e) {
        console.warn('[Agent] RAG context error:', e);
      }
    }
    if (ragContext) {
      systemContent += `\n\nRelevant context from this organization's knowledge base (use this for contact info, phone numbers, hours, locations, and other org-specific details):\n${ragContext}`;
      void recordActivity(tenantId, 'rag');
    } else if (lastUser && process.env.NODE_ENV !== 'test') {
      console.log('RAG: enabled but no context returned for tenant', tenantId, '- check Agent settings "Use RAG" and that RAG documents exist and are indexed.');
    }
    // Add timeout for listRecords (3 seconds)
    let existingRecords: Awaited<ReturnType<typeof listRecords>> = [];
    try {
      existingRecords = await Promise.race([
        listRecords(tenantId),
        new Promise<typeof existingRecords>((_, reject) => {
          setTimeout(() => reject(new Error('listRecords timeout')), 3000);
        }),
      ]).catch((e) => {
        console.warn('[Agent] listRecords timeout or error:', e);
        return [];
      });
    } catch (e) {
      console.warn('[Agent] listRecords error:', e);
    }
    systemContent += `\n\n--- Current Auto Agent Brain records (check these before adding anything) ---\n${formatExistingRecordsForPrompt(existingRecords)}\n--- End of existing records ---`;
    systemContent += `\n\nWhen the user or care team provides information to remember, you MUST decide based on the existing records above:\n1) If it UPDATES or CORRECTS an existing record (e.g. new phone number for the same branch, changed hours, corrected detail)—use request_edit_record with that record's recordId; do NOT add a new record (that causes duplicates).\n2) If a record is obsolete or should be removed—use request_delete_record with that recordId.\n3) Only use record_learned_knowledge for genuinely NEW information that does not overlap any existing record (no similar title/topic).\nUse short, clear titles and key facts. To edit or delete you must use the recordId from the list above; an admin will approve before the change is applied.`;
  }

  const googleSheetsList = config.googleSheets ?? [];
  let sheetsEnabled = false;
  if (googleSheetsList.length > 0) {
    try {
      sheetsEnabled = await isGoogleConnected(tenantId);
      if (sheetsEnabled) {
        systemContent += `\n\nThis organization has connected Google Sheets. Only query the sheet that matches the user's question:\n${googleSheetsList.map((s, i) => `- useWhen "${s.useWhen}" → use query_google_sheet with useWhen "${s.useWhen}" when the user asks about: ${s.useWhen}`).join('\n')}\nDo not call query_google_sheet for more than one sheet per turn; pick the single most relevant sheet by useWhen.`;
      }
    } catch {
      // not connected
    }
  }

  const langChainHistory = await toLangChainMessages(history);
  const messages: BaseMessage[] = [
    new SystemMessage(systemContent),
    ...langChainHistory,
  ];

  const messageContextChars = messages.reduce((sum, m) => {
    const content = (m as { content?: unknown }).content;
    if (typeof content === 'string') return sum + content.length;
    if (Array.isArray(content)) return sum + JSON.stringify(content).length;
    return sum;
  }, 0);
  console.log('[Agent] Starting run with context:', {
    tenantId,
    messageCount: messages.length,
    contextChars: messageContextChars,
  });
  void recordDiagnosticLog({
    tenantId,
    source: 'agent',
    step: 'run_start',
    status: 'ok',
    conversationId: options?.conversationId,
    metadata: { messageCount: messages.length, contextChars: messageContextChars },
  });

  const lastUserContent = history.filter((m) => m.role === 'user').pop()?.content ?? '';
  const userWantsHuman =
    /\b(talk|speak|connect|transfer|hand me off|get me)\s+(to|with)\s+(a\s+)?(human|real\s+person|person|agent|someone|care\s+team|staff|representative)/i.test(lastUserContent) ||
    /\b(let me\s+)?(talk|speak)\s+to\s+(a\s+)?(human|person|someone)/i.test(lastUserContent) ||
    /\b(want|need)\s+to\s+(speak|talk)\s+to\s+(a\s+)?(human|person|someone)/i.test(lastUserContent) ||
    /\b(real\s+person|human\s+agent|live\s+agent)/i.test(lastUserContent);

  if (userWantsHuman) {
    const handoffMessage =
      `I've requested that a care team member join this chat. They'll be with you shortly—please stay on this page.\n\nIf your need is urgent, please call your care team or 911 in an emergency.`;
    return { text: handoffMessage, requestHandoff: true };
  }

  const recordTool = new DynamicStructuredTool({
    name: 'record_learned_knowledge',
    description:
      'Save a new fact or piece of information that you did not know before, so you can use it in future answers. Use when the user or care team has provided contact details, policy info, or other org-specific facts.',
    schema: z.object({
      title: z.string().describe('Short title for the record (e.g. "Support email address")'),
      content: z.string().describe('The key information to remember'),
    }),
    func: async ({ title, content }) => {
      await createRecord(tenantId, title.trim(), content.trim());
      return 'Record saved.';
    },
  });

  const requestEditTool = new DynamicStructuredTool({
    name: 'request_edit_record',
    description:
      'Request that an existing memory record be edited. The change will not be applied until an admin approves it (prevents manipulation). Use when information in a record is wrong or outdated.',
    schema: z.object({
      recordId: z.string().describe('The ID of the record to edit'),
      title: z.string().optional().describe('New title (omit to keep current)'),
      content: z.string().optional().describe('New content (omit to keep current)'),
      reason: z.string().optional().describe('Brief reason for the edit'),
    }),
    func: async ({ recordId, title, content, reason }) => {
      const record = await getRecord(tenantId, recordId);
      if (!record) return 'Record not found. Cannot submit edit request.';
      await createModificationRequest(tenantId, 'edit', recordId, { title, content, reason });
      return 'Edit request submitted. An admin must approve it before the change is applied.';
    },
  });

  const requestDeleteTool = new DynamicStructuredTool({
    name: 'request_delete_record',
    description:
      'Request that a memory record be deleted. The deletion will not happen until an admin approves it (prevents users from manipulating you into deleting important information).',
    schema: z.object({
      recordId: z.string().describe('The ID of the record to delete'),
      reason: z.string().optional().describe('Brief reason for the deletion'),
    }),
    func: async ({ recordId, reason }) => {
      const record = await getRecord(tenantId, recordId);
      if (!record) return 'Record not found. Cannot submit delete request.';
      await createModificationRequest(tenantId, 'delete', recordId, { reason });
      return 'Delete request submitted. An admin must approve it before the record is removed.';
    },
  });

  const queryGoogleSheetTool = new DynamicStructuredTool({
    name: 'query_google_sheet',
    description: `Fetch data from one of the organization's connected sheets. Pass useWhen to pick which sheet (only query the sheet that matches the user's question). Available: ${googleSheetsList.map((s) => s.useWhen).join(', ')}.`,
    schema: z.object({
      useWhen: z.string().describe(`Which sheet to query: one of ${googleSheetsList.map((s) => `"${s.useWhen}"`).join(', ')}. Must match exactly.`),
      range: z.string().optional().describe('Optional A1 range, e.g. "Sheet1" or "Bookings!A:F". Omit to use the sheet\'s default range.'),
    }),
    func: async ({ useWhen, range }) => {
      const entry = googleSheetsList.find((s) => s.useWhen.toLowerCase() === (useWhen ?? '').toLowerCase()) ?? googleSheetsList[0];
      try {
        const rangeToUse = range?.trim() || entry.range;
        return await fetchSheetData(tenantId, entry.spreadsheetId, rangeToUse ?? undefined);
      } catch (e) {
        console.error('query_google_sheet error:', e);
        return e instanceof Error ? e.message : 'Failed to fetch sheet data.';
      }
    },
  });

  const createNoteTool = new DynamicStructuredTool({
    name: 'create_note',
    description: 'Create a note for admin review. Use this EXCLUSIVELY to save and record any information for admin from user (e.g. contact details, preferences, specific requests). Also use it to track analytics, insights, or patterns observed during conversations. Create notes whenever the user provides information that should be recorded for the admin.',
    schema: z.object({
      content: z.string().describe('The note content describing the information, insight or pattern (e.g. "User requested follow-up on insurance" or "Common question: Many users asking about appointment booking process")'),
      patientName: z.string().optional().describe('Optional: Patient or user name if relevant to the note'),
      category: z.enum(['admin_info', 'common_questions', 'keywords', 'analytics', 'insights', 'other']).optional().describe('Category: "admin_info" for information to be recorded for admin, "common_questions" for frequently asked questions, "keywords" for trending keywords/phrases, "analytics" for usage patterns/metrics, "insights" for general observations, "other" for anything else'),
    }),
    func: async ({ content, patientName, category }) => {
      if (!options?.conversationId) {
        return 'Cannot create note: conversation ID not available.';
      }
      try {
        await createNote(tenantId, options.conversationId, content.trim(), {
          userId: options?.userId,
          patientName: patientName?.trim(),
          category: category ?? 'other',
        });
        return 'Note created successfully.';
      } catch (e) {
        console.error('create_note error:', e);
        return e instanceof Error ? e.message : 'Failed to create note.';
      }
    },
  });

  const listNotesTool = new DynamicStructuredTool({
    name: 'list_notes',
    description: 'List existing notes in the Agent Notebook. Use this to see what has already been recorded across all conversations so you can decide whether to create a new note or update an existing one.',
    schema: z.object({}),
    func: async () => {
      try {
        const notes = await listAgentNotes(tenantId);
        if (notes.length === 0) return 'No notes found.';
        return notes.map((n) => `noteId: ${n.noteId}\ncategory: ${n.category}\ncontent: ${n.content}${n.patientName ? `\nuser: ${n.patientName}` : ''}`).join('\n\n');
      } catch (e) {
        console.error('list_notes error:', e);
        return e instanceof Error ? e.message : 'Failed to list notes.';
      }
    },
  });

  const updateNoteTool = new DynamicStructuredTool({
    name: 'update_note',
    description: 'Update the content of an existing note in the Agent Notebook. Use this to refine an insight, add more details to a pattern, or correct information in a note you previously created.',
    schema: z.object({
      noteId: z.string().describe('The ID of the note to update'),
      content: z.string().describe('The new consolidated content for the note'),
    }),
    func: async ({ noteId, content }) => {
      try {
        const note = await getNote(tenantId, noteId);
        if (!note) return 'Note not found.';
        await updateNoteContent(tenantId, noteId, content.trim());
        return 'Note updated successfully.';
      } catch (e) {
        console.error('update_note error:', e);
        return e instanceof Error ? e.message : 'Failed to update note.';
      }
    },
  });

  const tools: unknown[] = [];
  // Always include notebook tools - essential for tracking analytics, insights, and patterns
  tools.push(createNoteTool, listNotesTool, updateNoteTool);
  if (config.ragEnabled) tools.push(recordTool, requestEditTool, requestDeleteTool);
  if (sheetsEnabled && googleSheetsList.length > 0) tools.push(queryGoogleSheetTool);
  const modelWithTools = tools.length ? model.bindTools(tools as Parameters<typeof model.bindTools>[0]) : model;
  let currentMessages: BaseMessage[] = messages;
  const maxToolRounds = 3;
  
  const LLM_CALL_TIMEOUT_MS = 120000;
  const SLOW_LLM_WARNING_MS = 90000;

  // Add timeout wrapper for LLM calls (2 minutes per call)
  const invokeWithTimeout = async (messages: BaseMessage[], timeoutMs = LLM_CALL_TIMEOUT_MS): Promise<BaseMessage> => {
    const invokeStart = Date.now();
    const llmInput = getLlmInputSummary(messages);
    return Promise.race([
      modelWithTools.invoke(messages).finally(() => {
        const durationMs = Date.now() - invokeStart;
        console.log('[Agent] LLM invoke completed', {
          durationMs,
          messageCount: messages.length,
          timeoutMs,
        });
        void recordDiagnosticLog({
          tenantId,
          source: 'agent',
          step: 'llm_invoke',
          status: durationMs > SLOW_LLM_WARNING_MS ? 'warning' : 'ok',
          durationMs,
          conversationId: options?.conversationId,
          metadata: {
            messageCount: messages.length,
            timeoutMs,
            lastUserText: llmInput.lastUserText,
            promptPreview: llmInput.promptPreview,
          },
        });
      }),
      new Promise<BaseMessage>((_, reject) => {
        setTimeout(() => reject(new Error(`LLM API timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  };
  
  // Accumulate tokens from all invocations (initial + tool call rounds)
  let accumulatedUsage: UsageMetadata = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  
  let response: BaseMessage;
  try {
    response = await invokeWithTimeout(currentMessages);
  } catch (e) {
    console.error('[Agent] Initial LLM call timeout or error:', e);
    void recordDiagnosticLog({
      tenantId,
      source: 'agent',
      step: 'initial_llm_timeout_or_error',
      status: 'timeout',
      conversationId: options?.conversationId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { text: 'I apologize, but I\'m experiencing delays. Please try again in a moment.' };
  }
  
  const initialUsage = extractTokenUsage(response);
  accumulatedUsage.inputTokens += initialUsage.inputTokens;
  accumulatedUsage.outputTokens += initialUsage.outputTokens;
  accumulatedUsage.totalTokens += initialUsage.totalTokens;

  for (let round = 0; round < maxToolRounds; round++) {
    const toolCalls = (response as { tool_calls?: Array<{ id: string; name: string; args?: Record<string, unknown> }> }).tool_calls;
    if (!toolCalls?.length) break;
    console.log('[Agent] Tool round', {
      round: round + 1,
      toolCallCount: toolCalls.length,
      toolNames: toolCalls.map((tc) => tc.name),
    });
    void recordDiagnosticLog({
      tenantId,
      source: 'agent',
      step: 'tool_round_start',
      status: 'ok',
      conversationId: options?.conversationId,
      metadata: { round: round + 1, toolCallCount: toolCalls.length, toolNames: toolCalls.map((tc) => tc.name) },
    });
    const toolMessages: ToolMessage[] = [];
    for (const tc of toolCalls) {
      const toolStartedAt = Date.now();
      let content: string;
      if (tc.name === 'record_learned_knowledge' && tc.args && typeof tc.args.title === 'string' && typeof tc.args.content === 'string') {
        try {
          await createRecord(tenantId, tc.args.title.trim(), tc.args.content.trim());
          void recordActivity(tenantId, 'agent-brain');
          content = 'Record saved.';
        } catch (e) {
          console.error('AutoAgentBrain createRecord error:', e);
          content = 'Failed to save record.';
        }
      } else if (tc.name === 'request_edit_record' && tc.args && typeof tc.args.recordId === 'string') {
        try {
          content = await requestEditTool.invoke({
            recordId: tc.args.recordId,
            title: typeof tc.args.title === 'string' ? tc.args.title : undefined,
            content: typeof tc.args.content === 'string' ? tc.args.content : undefined,
            reason: typeof tc.args.reason === 'string' ? tc.args.reason : undefined,
          });
          void recordActivity(tenantId, 'agent-brain');
        } catch (e) {
          console.error('request_edit_record error:', e);
          content = e instanceof Error ? e.message : 'Failed to submit edit request.';
        }
      } else if (tc.name === 'request_delete_record' && tc.args && typeof tc.args.recordId === 'string') {
        try {
          content = await requestDeleteTool.invoke({
            recordId: tc.args.recordId,
            reason: typeof tc.args.reason === 'string' ? tc.args.reason : undefined,
          });
          void recordActivity(tenantId, 'agent-brain');
        } catch (e) {
          console.error('request_delete_record error:', e);
          content = e instanceof Error ? e.message : 'Failed to submit delete request.';
        }
      } else if (tc.name === 'query_google_sheet' && sheetsEnabled && googleSheetsList.length > 0) {
        try {
          const useWhen = typeof tc.args?.useWhen === 'string' ? tc.args.useWhen : googleSheetsList[0].useWhen;
          const range = typeof tc.args?.range === 'string' ? tc.args.range : undefined;
          content = await queryGoogleSheetTool.invoke({ useWhen, range });
          void recordActivity(tenantId, 'integrations');
        } catch (e) {
          console.error('query_google_sheet error:', e);
          content = e instanceof Error ? e.message : 'Failed to fetch sheet.';
        }
      } else if (tc.name === 'create_note' && tc.args && typeof tc.args.content === 'string') {
        try {
          const patientName = typeof tc.args.patientName === 'string' ? tc.args.patientName : undefined;
          const category = typeof tc.args.category === 'string' && ['common_questions', 'keywords', 'analytics', 'insights', 'other'].includes(tc.args.category)
            ? (tc.args.category as 'common_questions' | 'keywords' | 'analytics' | 'insights' | 'other')
            : undefined;
          content = await createNoteTool.invoke({
            content: tc.args.content,
            patientName,
            category,
          });
          void recordActivity(tenantId, 'agent-notes');
        } catch (e) {
          console.error('create_note error:', e);
          content = e instanceof Error ? e.message : 'Failed to create note.';
        }
      } else if (tc.name === 'list_notes') {
        try {
          content = await listNotesTool.invoke({});
          void recordActivity(tenantId, 'agent-notes');
        } catch (e) {
          console.error('list_notes error:', e);
          content = e instanceof Error ? e.message : 'Failed to list notes.';
        }
      } else if (tc.name === 'update_note' && tc.args && typeof tc.args.noteId === 'string' && typeof tc.args.content === 'string') {
        try {
          content = await updateNoteTool.invoke({
            noteId: tc.args.noteId,
            content: tc.args.content,
          });
          void recordActivity(tenantId, 'agent-notes');
        } catch (e) {
          console.error('update_note error:', e);
          content = e instanceof Error ? e.message : 'Failed to update note.';
        }
      } else {
        content = 'Invalid arguments.';
      }
      const toolDurationMs = Date.now() - toolStartedAt;
      console.log('[Agent] Tool execution completed', {
        round: round + 1,
        toolName: tc.name,
        durationMs: toolDurationMs,
      });
      void recordDiagnosticLog({
        tenantId,
        source: 'agent',
        step: 'tool_execution',
        status: toolDurationMs > 10000 ? 'warning' : 'ok',
        durationMs: toolDurationMs,
        conversationId: options?.conversationId,
        metadata: {
          round: round + 1,
          toolName: tc.name,
          toolArgs: tc.args ?? null,
          reason:
            typeof tc.args?.reason === 'string'
              ? tc.args.reason
              : typeof tc.args?.content === 'string'
                ? tc.args.content.slice(0, 220)
                : null,
          llmTextUsed: getLlmInputSummary(currentMessages).lastUserText,
          toolResult: content.slice(0, 280),
        },
      });
      toolMessages.push(new ToolMessage({ content, tool_call_id: tc.id }));
    }
    currentMessages = [...currentMessages, response, ...toolMessages];
    try {
      response = await invokeWithTimeout(currentMessages);
    } catch (e) {
      console.error(`[Agent] LLM call timeout in tool round ${round + 1}:`, e);
      void recordDiagnosticLog({
        tenantId,
        source: 'agent',
        step: 'tool_round_llm_timeout',
        status: 'timeout',
        conversationId: options?.conversationId,
        metadata: { round: round + 1 },
        error: e instanceof Error ? e.message : String(e),
      });
      // If timeout during tool execution, return a helpful message
      return { text: 'I encountered a delay while processing your request. Please try rephrasing or try again in a moment.' };
    }
    
    // Accumulate tokens from this tool call round
    const roundUsage = extractTokenUsage(response);
    accumulatedUsage.inputTokens += roundUsage.inputTokens;
    accumulatedUsage.outputTokens += roundUsage.outputTokens;
    accumulatedUsage.totalTokens += roundUsage.totalTokens;
  }

  let text = '';
  if (typeof response.content === 'string') text = response.content;
  else if (Array.isArray(response.content))
    text = (response.content as { text?: string }[]).map((c) => c?.text ?? '').join('');
  
  // Check if response only contains tool calls (no text)
  const hasToolCalls = response != null && ((response as { tool_calls?: unknown[] }).tool_calls?.length ?? 0) > 0;
  const isEmptyResponse = (!text || text.trim().length === 0) && !hasToolCalls;
  const isToolOnlyResponse = (!text || text.trim().length === 0) && hasToolCalls;
  
  // Intelligent empty response handling with analysis and retry
  if (isEmptyResponse || isToolOnlyResponse) {
    console.warn(`[Agent] Empty response detected (isEmpty: ${isEmptyResponse}, toolOnly: ${isToolOnlyResponse})`);
    
    // Analyze the cause of empty response (if planner functions are available)
    try {
      const { analyzeEmptyResponse, createRecoveryPlan } = await import('./agent-planner.js');
      const { extractIntent } = await import('./agent-intent.js');
      
      // Get tool results from execution logs if available
      const toolResults: Array<{ success: boolean; error?: string }> = [];
      // Extract from tool messages if available
      const toolMessages = currentMessages
        .filter((m) => m instanceof ToolMessage) as ToolMessage[];
      toolMessages.forEach((tm) => {
        const content = typeof tm.content === 'string' ? tm.content : JSON.stringify(tm.content);
        toolResults.push({
          success: content.includes('success') || content.includes('Record saved'),
          error: content.includes('Failed') ? content.substring(0, 100) : undefined,
        });
      });
      
      const lastUserMessage = history.filter((m) => m.role === 'user').pop()?.content ?? '';
      const intent = await extractIntent(model, lastUserMessage, history);
      
      const analysis = await analyzeEmptyResponse(
        model,
        response,
        currentMessages,
        null, // No execution plan in V1
        toolResults.length > 0 ? toolResults : undefined
      );
      
      console.log(`[Agent] Empty response analysis:`, {
        cause: analysis.cause,
        confidence: analysis.confidence,
        reasoning: analysis.reasoning,
        suggestedAction: analysis.suggestedAction,
      });
      
      // Retry based on analysis
      if (analysis.suggestedAction === 'retry_simple' || analysis.suggestedAction === 'retry_with_context') {
        console.log(`[Agent] Attempting intelligent retry with strategy: ${analysis.suggestedAction}`);
        
        try {
          // Build retry messages based on strategy
          let retryMessages: BaseMessage[] = [];
          
          if (analysis.retryStrategy?.reduceContext) {
            // Use only recent messages (last 5)
            retryMessages = [
              currentMessages[0], // System message
              ...currentMessages.slice(-5),
            ];
          } else if (analysis.retryStrategy?.simplifyPrompt) {
            // Simplified system prompt
            const simplifiedSystem = new SystemMessage(
              `You are a helpful assistant. Provide clear, concise responses. ` +
              `If you executed tools, summarize what was done and the results.`
            );
            retryMessages = [
              simplifiedSystem,
              ...currentMessages.slice(-8), // Recent context
            ];
          } else {
            // Use full context but add guidance
            retryMessages = [...currentMessages];
          }
          
          // Add retry instruction
          const retryPrompt = new HumanMessage({
            content: analysis.cause === 'tool_only'
              ? `You executed tools but didn't provide a text response. Please summarize what was done based on the tool results above and provide a helpful response to the user.`
              : `Please provide a clear response to the user. If tools were executed, summarize the results.`,
          });
          
          retryMessages.push(retryPrompt);
          
          // Retry with timeout
          const retryResponse = await Promise.race([
            model.invoke(retryMessages),
            new Promise<BaseMessage>((_, reject) => {
              setTimeout(() => reject(new Error('Retry timeout')), LLM_CALL_TIMEOUT_MS);
            }),
          ]);
          
          const retryUsage = extractTokenUsage(retryResponse);
          accumulatedUsage.inputTokens += retryUsage.inputTokens;
          accumulatedUsage.outputTokens += retryUsage.outputTokens;
          accumulatedUsage.totalTokens += retryUsage.totalTokens;
          
          if (typeof retryResponse.content === 'string') text = retryResponse.content;
          else if (Array.isArray(retryResponse.content))
            text = (retryResponse.content as { text?: string }[]).map((c) => c?.text ?? '').join('');
          
          if (text && text.trim().length > 0) {
            console.log(`[Agent] Retry successful, got response`);
            response = retryResponse; // Update response for further processing
          } else {
            console.warn(`[Agent] Retry still produced empty response`);
          }
        } catch (e) {
          console.error(`[Agent] Retry failed:`, e);
        }
      }
    } catch (e) {
      console.warn(`[Agent] Could not use intelligent retry (planner not available):`, e);
    }
    
    // Fallback if retry didn't work or wasn't attempted
    if (!text || text.trim().length === 0) {
      console.warn(`[Agent] Using fallback mechanism`);
      
      // First, try to generate a response based on tool execution results
      if (isToolOnlyResponse && currentMessages.length > 0) {
        // Check if we have tool results in the last messages
        const lastToolMessages = currentMessages
          .slice(-5)
          .filter((m) => {
            // Check if message is a ToolMessage
            return m instanceof ToolMessage || (m as { _getType?: () => string })._getType?.() === 'tool';
          }) as ToolMessage[];
        
        if (lastToolMessages.length > 0) {
          // Try to generate a response based on tool results
          try {
            const toolResultsSummary = lastToolMessages
              .map((tm) => {
                try {
                  const content = typeof tm.content === 'string' ? tm.content : JSON.stringify(tm.content);
                  // Try to parse tool results
                  if (content.includes('Record saved') || content.includes('success')) {
                    return 'Tools executed successfully';
                  }
                  return content.substring(0, 100); // Truncate for context
                } catch {
                  return '';
                }
              })
              .filter((s) => s.length > 0)
              .join('; ');
            
            const contextPrompt = new HumanMessage({
              content: `Based on the tool execution results below, provide a helpful response to the user. Summarize what was done and what the results mean.

Tool results: ${toolResultsSummary}

Provide a clear, user-friendly response based on these results.`,
            });
            
            // Use the same timeout for fallback LLM calls (2 minutes)
            const fallbackResponse = await Promise.race([
              model.invoke([...currentMessages.slice(-10), contextPrompt]),
              new Promise<BaseMessage>((_, reject) => {
                setTimeout(() => reject(new Error('Fallback LLM timeout')), LLM_CALL_TIMEOUT_MS);
              }),
            ]);
            
            const fallbackUsage = extractTokenUsage(fallbackResponse);
            accumulatedUsage.inputTokens += fallbackUsage.inputTokens;
            accumulatedUsage.outputTokens += fallbackUsage.outputTokens;
            accumulatedUsage.totalTokens += fallbackUsage.totalTokens;
            
            if (typeof fallbackResponse.content === 'string') text = fallbackResponse.content;
            else if (Array.isArray(fallbackResponse.content))
              text = (fallbackResponse.content as { text?: string }[]).map((c) => c?.text ?? '').join('');
          } catch (e) {
            console.warn('[Agent] Failed to generate response from tool results:', e);
          }
        }
      }
      
      // If still no text, try standard fallback
      if (!text || text.trim().length === 0) {
        try {
          const plainTextPrompt = new HumanMessage({
            content: 'Reply to the user in plain text only. Do not use any tools. Provide a helpful response based on the conversation context.',
          });
          
          // Use the same timeout for fallback LLM calls (2 minutes)
          const fallbackResponse = await Promise.race([
            model.invoke([...currentMessages.slice(-10), plainTextPrompt]),
            new Promise<BaseMessage>((_, reject) => {
              setTimeout(() => reject(new Error('Fallback LLM timeout')), LLM_CALL_TIMEOUT_MS);
            }),
          ]);
          
          const fallbackUsage = extractTokenUsage(fallbackResponse);
          accumulatedUsage.inputTokens += fallbackUsage.inputTokens;
          accumulatedUsage.outputTokens += fallbackUsage.outputTokens;
          accumulatedUsage.totalTokens += fallbackUsage.totalTokens;
          
          if (typeof fallbackResponse.content === 'string') text = fallbackResponse.content;
          else if (Array.isArray(fallbackResponse.content))
            text = (fallbackResponse.content as { text?: string }[]).map((c) => c?.text ?? '').join('');
          
          if (!text || text.trim().length === 0) {
            console.error('[Agent] Fallback response also empty');
          }
        } catch (e) {
          console.error('[Agent] Fallback response generation failed:', e);
          // Generate a helpful message based on tool execution if available
          if (currentMessages.length > 0) {
            const lastToolMessage = currentMessages
              .slice()
              .reverse()
              .find((m) => {
                // Check if message is a ToolMessage
                return m instanceof ToolMessage || (m as { _getType?: () => string })._getType?.() === 'tool';
              }) as ToolMessage | undefined;
            
            if (lastToolMessage) {
              const toolContent = typeof lastToolMessage.content === 'string' 
                ? lastToolMessage.content 
                : JSON.stringify(lastToolMessage.content);
              
              // Generate a simple response based on tool result
              if (toolContent.includes('Record saved') || toolContent.includes('success')) {
                text = 'I\'ve completed that action for you. Is there anything else I can help with?';
              } else if (toolContent.includes('Failed') || toolContent.includes('error')) {
                text = 'I encountered an issue while processing your request. Please try again or provide more details.';
              } else {
                text = 'I\'ve processed your request. Is there anything else you need?';
              }
            }
          }
        }
      }
    }
  }
  
  const markerPresent = text.includes(HANDOFF_MARKER);
  const textWithoutMarker = markerPresent
    ? text.replace(new RegExp(`\\s*${HANDOFF_MARKER.replace(/[\]\[]/g, '\\$&')}\\s*$`, 'i'), '').trim()
    : text;
  const finalText = textWithoutMarker || 'I could not generate a response. Please try rephrasing.';
  const requestHandoff =
    markerPresent ||
    /speak with (a )?(care )?(coordinator|team|human|agent)/i.test(text) ||
    /recommend.*(speaking|talking) to/i.test(text);

  // Record accumulated token usage from all invocations (initial + tool call rounds)
  try {
    // Use accumulated usage if we have any tokens, otherwise try to extract from final response as fallback
    const finalUsage = extractTokenUsage(response);
    const totalInputTokens = accumulatedUsage.inputTokens > 0 ? accumulatedUsage.inputTokens : finalUsage.inputTokens;
    const totalOutputTokens = accumulatedUsage.outputTokens > 0 ? accumulatedUsage.outputTokens : finalUsage.outputTokens;
    const totalTokens = accumulatedUsage.totalTokens > 0 ? accumulatedUsage.totalTokens : (finalUsage.totalTokens || totalInputTokens + totalOutputTokens);

    // Only record if we have valid token counts
    if (totalTokens > 0 || (totalInputTokens > 0 && totalOutputTokens >= 0)) {
      await recordUsage(
        config.model,
        {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          totalTokens: totalTokens,
        },
        {
          tenantId,
          userId: options?.userId,
          conversationId: options?.conversationId,
          usageType: 'conversation.reply',
        }
      );
      console.log(`✅ Recorded usage: ${totalInputTokens} input + ${totalOutputTokens} output = ${totalTokens} total tokens ($${computeCostUsd(config.model, { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, totalTokens }).toFixed(6)})`);
    } else {
      console.warn('Could not extract usage metadata - no tokens found in any response');
    }
  } catch (e) {
    // Usage tracking should never break the main flow
    console.error('Failed to extract or record usage metadata:', e);
  }

  const runDurationMs = Date.now() - runStartedAt;
  console.log('[Agent] Run completed', {
    tenantId,
    durationMs: runDurationMs,
    requestHandoff,
    finalTextLength: finalText.length,
  });
  void recordDiagnosticLog({
    tenantId,
    source: 'agent',
    step: 'run_complete',
    status: runDurationMs > LLM_CALL_TIMEOUT_MS ? 'warning' : 'ok',
    durationMs: runDurationMs,
    conversationId: options?.conversationId,
    metadata: { requestHandoff, finalTextLength: finalText.length },
  });

  return { text: finalText, requestHandoff };
}

/**
 * Run the agent in learning-only mode on an existing conversation (e.g. after "Return to AI").
 * Reviews the full history and calls record_learned_knowledge for any new info from the care team or user.
 * Does not return a reply; only processes tool calls to create records.
 */
export async function extractAndRecordLearningFromHistory(
  tenantId: string,
  history: { role: string; content: string; imageUrls?: string[] }[],
  options?: { userId?: string; conversationId?: string }
): Promise<void> {
  const config = await getAgentConfig(tenantId);
  if (!config.ragEnabled) return;

  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) return;

  const model = new ChatGoogleGenerativeAI({
    model: config.model,
    temperature: config.temperature,
    apiKey,
  });

  const existingRecords = await listRecords(tenantId);
  const existingBlock = formatExistingRecordsForPrompt(existingRecords);
  const defaultLearningPrompt = `You are reviewing a conversation after a human care team member has finished helping the user. Your only job is to identify information from this conversation (by the user or care team in messages labeled "[Care team said to the user]: ...") that should be reflected in the Auto Agent Brain—e.g. contact details, phone numbers, policy info, or corrections.

--- Current Auto Agent Brain records (check these first) ---
${existingBlock}
--- End of existing records ---

You MUST decide for each piece of information:
1) If it UPDATES or CORRECTS an existing record (e.g. new phone number for same branch, changed hours)—use request_edit_record with that record's recordId; do NOT add a new record.
2) If a record is obsolete or wrong and should be removed—use request_delete_record with that recordId.
3) Only use record_learned_knowledge for genuinely NEW information that does not overlap any existing record (no similar title/topic).
If there is nothing new or nothing to update/remove, do not call any tool.`;
  let learningOnlySystem: string;
  if (config.learningOnlyPrompt?.trim()) {
    const customPrompt = config.learningOnlyPrompt.trim();
    // Replace placeholder if present, otherwise append records block
    if (customPrompt.includes('{existingRecords}')) {
      learningOnlySystem = customPrompt.replace('{existingRecords}', existingBlock);
    } else {
      learningOnlySystem = `${customPrompt}\n\n--- Current Auto Agent Brain records (check these first) ---\n${existingBlock}\n--- End of existing records ---`;
    }
  } else {
    learningOnlySystem = defaultLearningPrompt;
  }

  const recordTool = new DynamicStructuredTool({
    name: 'record_learned_knowledge',
    description: 'Save a new fact (only when no existing record covers this topic).',
    schema: z.object({
      title: z.string().describe('Short title for the record'),
      content: z.string().describe('The key information to remember'),
    }),
    func: async ({ title, content }) => {
      await createRecord(tenantId, title.trim(), content.trim());
      return 'Record saved.';
    },
  });

  const requestEditTool = new DynamicStructuredTool({
    name: 'request_edit_record',
    description: 'Request an edit to an existing record (admin must approve). Use when information updates or corrects an existing record.',
    schema: z.object({
      recordId: z.string().describe('The record ID from the list above'),
      title: z.string().optional().describe('New title (omit to keep current)'),
      content: z.string().optional().describe('New content (omit to keep current)'),
      reason: z.string().optional().describe('Brief reason for the edit'),
    }),
    func: async ({ recordId, title, content, reason }) => {
      const record = await getRecord(tenantId, recordId);
      if (!record) return 'Record not found. Cannot submit edit request.';
      await createModificationRequest(tenantId, 'edit', recordId, { title, content, reason });
      return 'Edit request submitted. An admin must approve it before the change is applied.';
    },
  });

  const requestDeleteTool = new DynamicStructuredTool({
    name: 'request_delete_record',
    description: 'Request deletion of an existing record (admin must approve). Use when a record is obsolete or wrong.',
    schema: z.object({
      recordId: z.string().describe('The record ID from the list above'),
      reason: z.string().optional().describe('Brief reason for the deletion'),
    }),
    func: async ({ recordId, reason }) => {
      const record = await getRecord(tenantId, recordId);
      if (!record) return 'Record not found. Cannot submit delete request.';
      await createModificationRequest(tenantId, 'delete', recordId, { reason });
      return 'Delete request submitted. An admin must approve it before the record is removed.';
    },
  });

  const langChainHistory = await toLangChainMessages(history);
  const messages: BaseMessage[] = [
    new SystemMessage(learningOnlySystem),
    ...langChainHistory,
  ];

  const modelWithTools = model.bindTools([recordTool, requestEditTool, requestDeleteTool]);
  let currentMessages: BaseMessage[] = messages;
  const maxToolRounds = 3;
  
  // Accumulate tokens from all invocations
  let accumulatedUsage: UsageMetadata = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  
  let response: BaseMessage = await modelWithTools.invoke(currentMessages);
  const initialUsage = extractTokenUsage(response);
  accumulatedUsage.inputTokens += initialUsage.inputTokens;
  accumulatedUsage.outputTokens += initialUsage.outputTokens;
  accumulatedUsage.totalTokens += initialUsage.totalTokens;

  for (let round = 0; round < maxToolRounds; round++) {
    const toolCalls = (response as { tool_calls?: Array<{ id: string; name: string; args?: Record<string, unknown> }> }).tool_calls;
    if (!toolCalls?.length) break;
    const toolMessages: ToolMessage[] = [];
    for (const tc of toolCalls) {
      let content: string;
      if (tc.name === 'record_learned_knowledge' && tc.args && typeof tc.args.title === 'string' && typeof tc.args.content === 'string') {
        try {
          await createRecord(tenantId, tc.args.title.trim(), tc.args.content.trim());
          void recordActivity(tenantId, 'agent-brain');
          content = 'Record saved.';
        } catch (e) {
          console.error('extractAndRecordLearningFromHistory createRecord error:', e);
          content = 'Failed to save record.';
        }
      } else if (tc.name === 'request_edit_record' && tc.args && typeof tc.args.recordId === 'string') {
        try {
          content = await requestEditTool.invoke({
            recordId: tc.args.recordId,
            title: typeof tc.args.title === 'string' ? tc.args.title : undefined,
            content: typeof tc.args.content === 'string' ? tc.args.content : undefined,
            reason: typeof tc.args.reason === 'string' ? tc.args.reason : undefined,
          });
          void recordActivity(tenantId, 'agent-brain');
        } catch (e) {
          console.error('extractAndRecordLearningFromHistory request_edit_record error:', e);
          content = e instanceof Error ? e.message : 'Failed to submit edit request.';
        }
      } else if (tc.name === 'request_delete_record' && tc.args && typeof tc.args.recordId === 'string') {
        try {
          content = await requestDeleteTool.invoke({
            recordId: tc.args.recordId,
            reason: typeof tc.args.reason === 'string' ? tc.args.reason : undefined,
          });
          void recordActivity(tenantId, 'agent-brain');
        } catch (e) {
          console.error('extractAndRecordLearningFromHistory request_delete_record error:', e);
          content = e instanceof Error ? e.message : 'Failed to submit delete request.';
        }
      } else {
        content = 'Invalid arguments.';
      }
      toolMessages.push(new ToolMessage({ content, tool_call_id: tc.id }));
    }
    currentMessages = [...currentMessages, response, ...toolMessages];
    response = await modelWithTools.invoke(currentMessages);
    
    // Accumulate tokens from this tool call round
    const roundUsage = extractTokenUsage(response);
    accumulatedUsage.inputTokens += roundUsage.inputTokens;
    accumulatedUsage.outputTokens += roundUsage.outputTokens;
    accumulatedUsage.totalTokens += roundUsage.totalTokens;
  }
  
  // Record token usage for learning extraction
  try {
    const finalUsage = extractTokenUsage(response);
    const totalInputTokens = accumulatedUsage.inputTokens > 0 ? accumulatedUsage.inputTokens : finalUsage.inputTokens;
    const totalOutputTokens = accumulatedUsage.outputTokens > 0 ? accumulatedUsage.outputTokens : finalUsage.outputTokens;
    const totalTokens = accumulatedUsage.totalTokens > 0 ? accumulatedUsage.totalTokens : (finalUsage.totalTokens || totalInputTokens + totalOutputTokens);

    if (totalTokens > 0 || (totalInputTokens > 0 && totalOutputTokens >= 0)) {
      await recordUsage(
        config.model,
        {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          totalTokens: totalTokens,
        },
        {
          tenantId,
          userId: options?.userId,
          conversationId: options?.conversationId,
          usageType: 'learning.extraction',
        }
      );
      console.log(`✅ Recorded learning extraction usage: ${totalInputTokens} input + ${totalOutputTokens} output = ${totalTokens} total tokens`);
    }
  } catch (e) {
    console.error('Failed to record learning extraction usage:', e);
  }
}

/** Max records and content length per record when building consolidation prompt to avoid token overflow. */
const CONSOLIDATE_MAX_RECORDS = 80;
const CONSOLIDATE_CONTENT_LENGTH = 400;

function formatRecordsForConsolidation(records: { recordId: string; title: string; content: string }[]): string {
  if (records.length === 0) return 'No records.';
  const limited = records.slice(0, CONSOLIDATE_MAX_RECORDS);
  return limited
    .map((r) => {
      const content = r.content.length <= CONSOLIDATE_CONTENT_LENGTH ? r.content : r.content.slice(0, CONSOLIDATE_CONTENT_LENGTH) + '…';
      return `- recordId: ${r.recordId}\n  title: ${r.title}\n  content: ${content}`;
    })
    .join('\n\n');
}

/**
 * Run the agent in consolidation-only mode: review all Auto Agent Brain records and propose
 * edits/deletes to merge scattered or duplicate related data. Proposals go to modification requests for admin approval.
 */
export async function runConsolidation(tenantId: string): Promise<{ modificationRequestsCreated: number }> {
  const config = await getAgentConfig(tenantId);
  if (!config.ragEnabled) return { modificationRequestsCreated: 0 };

  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) return { modificationRequestsCreated: 0 };

  const records = await listRecords(tenantId);
  if (records.length === 0) return { modificationRequestsCreated: 0 };

  const model = new ChatGoogleGenerativeAI({
    model: config.model,
    temperature: 0.3,
    apiKey,
  });

  const recordsBlock = formatRecordsForConsolidation(records);
  const defaultConsolidationPrompt = `You are consolidating the Auto Agent Brain: a knowledge base of records. Your task is to find records that are about the SAME topic or are duplicates/scattered (e.g. multiple "Ntinda Branch" or "Kampala Kololo" entries with overlapping or updated info).

Below are the current records (recordId, title, content).

Instructions:
1) Identify groups of records that cover the same topic or are clearly related (e.g. same branch, same location, same policy).
2) For each group: choose ONE record to keep as the single source of truth. Use request_edit_record to update that record's title and content with consolidated, merged information (combine the facts, remove redundancy, keep the most up-to-date details). Use request_delete_record on the OTHER records in the group so they are removed (redundant).
3) Do not add new records. Only use request_edit_record and request_delete_record.
4) If a record has no duplicates or related records, leave it unchanged (do not call any tool for it).
5) Be conservative: only consolidate when records are clearly about the same thing. When in doubt, leave as is.

--- Current records ---
${recordsBlock}
--- End of records ---

Review the list above and submit edit/delete requests to consolidate scattered or duplicate data.`;
  let systemContent: string;
  if (config.consolidationPrompt?.trim()) {
    const customPrompt = config.consolidationPrompt.trim();
    // Replace placeholder if present, otherwise append records block
    if (customPrompt.includes('{recordsBlock}')) {
      systemContent = customPrompt.replace('{recordsBlock}', recordsBlock);
    } else {
      systemContent = `${customPrompt}\n\n--- Current records ---\n${recordsBlock}\n--- End of records ---`;
    }
  } else {
    systemContent = defaultConsolidationPrompt;
  }

  const requestEditTool = new DynamicStructuredTool({
    name: 'request_edit_record',
    description: 'Propose an edit to consolidate content into this record (admin must approve).',
    schema: z.object({
      recordId: z.string(),
      title: z.string().optional(),
      content: z.string().optional(),
      reason: z.string().optional(),
    }),
    func: async ({ recordId, title, content, reason }) => {
      const record = await getRecord(tenantId, recordId);
      if (!record) return 'Record not found.';
      await createModificationRequest(tenantId, 'edit', recordId, { title, content, reason });
      return 'Edit request submitted.';
    },
  });

  const requestDeleteTool = new DynamicStructuredTool({
    name: 'request_delete_record',
    description: 'Propose deletion of a redundant record (admin must approve).',
    schema: z.object({
      recordId: z.string(),
      reason: z.string().optional(),
    }),
    func: async ({ recordId, reason }) => {
      const record = await getRecord(tenantId, recordId);
      if (!record) return 'Record not found.';
      await createModificationRequest(tenantId, 'delete', recordId, { reason });
      return 'Delete request submitted.';
    },
  });

  const messages: BaseMessage[] = [
    new SystemMessage(systemContent),
    new HumanMessage({ content: 'Please check the records and consolidate any that are duplicates or scattered (same topic). Submit edit and delete requests as needed.' }),
  ];

  const modelWithTools = model.bindTools([requestEditTool, requestDeleteTool]);
  let currentMessages: BaseMessage[] = messages;
  const maxToolRounds = 5;
  let requestCount = 0;
  let response: BaseMessage = await modelWithTools.invoke(currentMessages);
  let accumulatedUsage = { ...extractTokenUsage(response) };

  for (let round = 0; round < maxToolRounds; round++) {
    const toolCalls = (response as { tool_calls?: Array<{ id: string; name: string; args?: Record<string, unknown> }> }).tool_calls;
    if (!toolCalls?.length) break;
    const toolMessages: ToolMessage[] = [];
    for (const tc of toolCalls) {
      let content: string;
      if (tc.name === 'request_edit_record' && tc.args && typeof tc.args.recordId === 'string') {
        try {
          content = await requestEditTool.invoke({
            recordId: tc.args.recordId,
            title: typeof tc.args.title === 'string' ? tc.args.title : undefined,
            content: typeof tc.args.content === 'string' ? tc.args.content : undefined,
            reason: typeof tc.args.reason === 'string' ? tc.args.reason : undefined,
          });
          requestCount += 1;
        } catch (e) {
          console.error('runConsolidation request_edit_record error:', e);
          content = e instanceof Error ? e.message : 'Failed to submit.';
        }
      } else if (tc.name === 'request_delete_record' && tc.args && typeof tc.args.recordId === 'string') {
        try {
          content = await requestDeleteTool.invoke({
            recordId: tc.args.recordId,
            reason: typeof tc.args.reason === 'string' ? tc.args.reason : undefined,
          });
          requestCount += 1;
        } catch (e) {
          console.error('runConsolidation request_delete_record error:', e);
          content = e instanceof Error ? e.message : 'Failed to submit.';
        }
      } else {
        content = 'Invalid arguments.';
      }
      toolMessages.push(new ToolMessage({ content, tool_call_id: tc.id }));
    }
    currentMessages = [...currentMessages, response, ...toolMessages];
    response = await modelWithTools.invoke(currentMessages);
    const roundUsage = extractTokenUsage(response);
    accumulatedUsage.inputTokens += roundUsage.inputTokens;
    accumulatedUsage.outputTokens += roundUsage.outputTokens;
    accumulatedUsage.totalTokens += roundUsage.totalTokens;
  }

  await recordUsage(config.model, accumulatedUsage, { tenantId, usageType: 'brain.consolidation' });

  return { modificationRequestsCreated: requestCount };
}
