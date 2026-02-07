import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage, AIMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { getRagContext } from './rag.js';
import { createRecord } from './auto-agent-brain.js';

export type AgentResult = { text: string; requestHandoff?: boolean };

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

type UsageContext = {
  tenantId: string;
  userId?: string;
  conversationId?: string;
};

type UsageMetadata = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

// Simple pricing table – adjust these to match your actual Gemini pricing
const GEMINI_PRICING_USD: Record<
  string,
  {
    inputPer1K: number;
    outputPer1K: number;
  }
> = {
  'gemini-3-flash-preview': { inputPer1K: 0.000075, outputPer1K: 0.0003 },
  'gemini-1.5-pro': { inputPer1K: 0.0035, outputPer1K: 0.0105 },
};

function computeCostUsd(model: string, usage: UsageMetadata): number {
  const pricing = GEMINI_PRICING_USD[model] ?? GEMINI_PRICING_USD['gemini-3-flash-preview'];
  const inputCost = (usage.inputTokens / 1000) * pricing.inputPer1K;
  const outputCost = (usage.outputTokens / 1000) * pricing.outputPer1K;
  // Round to 6 decimals to avoid tiny floating point noise
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

async function recordUsage(modelName: string, usage: UsageMetadata, ctx: UsageContext): Promise<void> {
  try {
    const costUsd = computeCostUsd(modelName, usage);
    await db.collection('usage_events').add({
      tenantId: ctx.tenantId,
      userId: ctx.userId ?? null,
      conversationId: ctx.conversationId ?? null,
      model: modelName,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      costUsd,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    // Usage tracking should never break the main flow
    console.error('Failed to record usage event:', e);
  }
}

export async function getAgentConfig(tenantId: string): Promise<{
  agentName: string;
  systemPrompt: string;
  thinkingInstructions: string;
  model: string;
  temperature: number;
  ragEnabled: boolean;
}> {
  const configRef = db.collection('agent_config').doc(tenantId);
  const configDoc = await configRef.get();
  const data = configDoc.data();

  if (configDoc.exists && data?.agentName) {
    const prompt = (data.systemPrompt?.trim() ?? '') || defaultPromptForName(data.agentName);
    return {
      agentName: data.agentName,
      systemPrompt: prompt,
      thinkingInstructions: data?.thinkingInstructions ?? 'Be concise, empathetic, and safety-conscious.',
      model: data?.model ?? 'gemini-3-flash-preview',
      temperature: data?.temperature ?? 0.7,
      ragEnabled: data?.ragEnabled === true,
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
      model: 'gemini-3-flash-preview',
      temperature: 0.7,
      ragEnabled: false,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => {});
  }

  return {
    agentName,
    systemPrompt,
    thinkingInstructions: data?.thinkingInstructions ?? 'Be concise, empathetic, and safety-conscious.',
    model: data?.model ?? 'gemini-3-flash-preview',
    temperature: data?.temperature ?? 0.7,
    ragEnabled: data?.ragEnabled === true,
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

  let systemContent = `${nameInstruction}\n\n${config.systemPrompt}\n\n${historyInstruction}\n\n${imageInstruction}\n\n${toneInstruction}\n\n${escalationInstruction}${followUpHint}\n\nHow you should think: ${config.thinkingInstructions}`;
  if (config.ragEnabled) {
    const lastUser = history.filter((m) => m.role === 'user').pop();
    const ragContext = lastUser ? await getRagContext(tenantId, lastUser.content) : '';
    if (ragContext) {
      systemContent += `\n\nRelevant context from this organization's knowledge base (use this for contact info, phone numbers, hours, locations, and other org-specific details):\n${ragContext}`;
    } else if (lastUser && process.env.NODE_ENV !== 'test') {
      console.log('RAG: enabled but no context returned for tenant', tenantId, '- check Agent settings "Use RAG" and that RAG documents exist and are indexed.');
    }
    systemContent += `\n\nWhen the user or care team has provided information that you did not previously know and that would help answer similar questions in the future (e.g. an email address, phone number, or policy detail), use the record_learned_knowledge tool to save it. Use a short, clear title and the key facts as content. Only call when you have learned something new and useful to remember.`;
  }

  const langChainHistory = await toLangChainMessages(history);
  const messages: BaseMessage[] = [
    new SystemMessage(systemContent),
    ...langChainHistory,
  ];

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

  const modelWithTools = config.ragEnabled ? model.bindTools([recordTool]) : model;
  let currentMessages: BaseMessage[] = messages;
  const maxToolRounds = 3;
  let response: BaseMessage = await modelWithTools.invoke(currentMessages);

  for (let round = 0; round < maxToolRounds; round++) {
    const toolCalls = (response as { tool_calls?: Array<{ id: string; name: string; args?: Record<string, unknown> }> }).tool_calls;
    if (!toolCalls?.length) break;
    const toolMessages: ToolMessage[] = [];
    for (const tc of toolCalls) {
      if (tc.name === 'record_learned_knowledge' && tc.args && typeof tc.args.title === 'string' && typeof tc.args.content === 'string') {
        try {
          await createRecord(tenantId, tc.args.title.trim(), tc.args.content.trim());
          toolMessages.push(new ToolMessage({ content: 'Record saved.', tool_call_id: tc.id }));
        } catch (e) {
          console.error('AutoAgentBrain createRecord error:', e);
          toolMessages.push(new ToolMessage({ content: 'Failed to save record.', tool_call_id: tc.id }));
        }
      } else {
        toolMessages.push(new ToolMessage({ content: 'Invalid arguments.', tool_call_id: tc.id }));
      }
    }
    currentMessages = [...currentMessages, response, ...toolMessages];
    response = await modelWithTools.invoke(currentMessages);
  }

  let text = '';
  if (typeof response.content === 'string') text = response.content;
  else if (Array.isArray(response.content))
    text = response.content.map((c: { text?: string }) => c?.text ?? '').join('');
  const markerPresent = text.includes(HANDOFF_MARKER);
  const textWithoutMarker = markerPresent
    ? text.replace(new RegExp(`\\s*${HANDOFF_MARKER.replace(/[\]\[]/g, '\\$&')}\\s*$`, 'i'), '').trim()
    : text;
  const finalText = textWithoutMarker || 'I could not generate a response. Please try rephrasing.';
  const requestHandoff =
    markerPresent ||
    /speak with (a )?(care )?(coordinator|team|human|agent)/i.test(text) ||
    /recommend.*(speaking|talking) to/i.test(text);

  // Extract token usage metadata from LangChain / Gemini response
  // LangChain ChatGoogleGenerativeAI returns usage in response_metadata.tokenUsage
  try {
    const responseAny = response as any;
    const responseMetadata = responseAny.response_metadata ?? {};
    
    // Try tokenUsage first (most common format in LangChain)
    const tokenUsage = responseMetadata.tokenUsage ?? {};
    
    // Also check for usageMetadata/usage_metadata (alternative formats)
    const usageMetadata = responseMetadata.usageMetadata ?? responseMetadata.usage_metadata ?? {};
    
    // Extract token counts - try tokenUsage format first, then usageMetadata format
    const inputTokens: number =
      tokenUsage.promptTokens ??
      tokenUsage.inputTokens ??
      usageMetadata.promptTokenCount ??
      usageMetadata.promptTokens ??
      (typeof usageMetadata.input_tokens === 'number' ? usageMetadata.input_tokens : 0);
    
    const outputTokens: number =
      tokenUsage.completionTokens ??
      tokenUsage.outputTokens ??
      usageMetadata.candidatesTokenCount ??
      usageMetadata.candidatesTokens ??
      (typeof usageMetadata.output_tokens === 'number' ? usageMetadata.output_tokens : 0);
    
    const totalTokens: number =
      tokenUsage.totalTokens ??
      usageMetadata.totalTokenCount ??
      usageMetadata.totalTokens ??
      (typeof usageMetadata.total_tokens === 'number' ? usageMetadata.total_tokens : inputTokens + outputTokens);

    // Only record if we have valid token counts
    if (totalTokens > 0 || (inputTokens > 0 && outputTokens >= 0)) {
      await recordUsage(
        config.model,
        {
          inputTokens: inputTokens || 0,
          outputTokens: outputTokens || 0,
          totalTokens: totalTokens || inputTokens + outputTokens,
        },
        {
          tenantId,
          userId: options?.userId,
          conversationId: options?.conversationId,
        }
      );
      // Temporary debug log to confirm usage is being recorded
      console.log(`✅ Recorded usage: ${inputTokens} input + ${outputTokens} output = ${totalTokens} total tokens ($${computeCostUsd(config.model, { inputTokens, outputTokens, totalTokens }).toFixed(6)})`);
    } else {
      // Log when we can't extract usage (for debugging)
      console.warn('Could not extract usage metadata from response:', {
        hasResponseMetadata: !!responseAny.response_metadata,
        responseMetadataKeys: Object.keys(responseMetadata),
        tokenUsageKeys: tokenUsage ? Object.keys(tokenUsage) : [],
        tokenUsageValue: tokenUsage,
        usageMetadataValue: usageMetadata,
      });
    }
  } catch (e) {
    // Usage tracking should never break the main flow
    console.error('Failed to extract or record usage metadata:', e);
  }

  return { text: finalText, requestHandoff };
}
