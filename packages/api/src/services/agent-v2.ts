/**
 * Agent V2 - Production-Grade Architecture
 * 
 * This version implements the layered agent architecture:
 * 1. Intent + Extraction Layer (LLM)
 * 2. Orchestrator / Planner (Deterministic backend)
 * 3. Tool Executor Layer (Strict contracts)
 * 4. State Store / Database
 * 5. Verification Layer
 * 6. Response Formatter (LLM)
 * 
 * Key differences from V1:
 * - LLM suggests, orchestrator decides
 * - Strict tool contracts with verification
 * - Multi-layer memory system
 * - Context optimization
 */

import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage, AIMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { getRagContext } from './rag.js';
import { createRecord, createModificationRequest, getRecord, listRecords } from './auto-agent-brain.js';
import { isGoogleConnected } from './google-sheets.js';
import { getAgentConfig, type GoogleSheetEntry } from './agent.js';
import { AgentOrchestrator, ToolCall } from './agent-orchestrator.js';
import { buildAgentContext, formatContextForPrompt, trimConversationHistory } from './agent-memory.js';
import { extractIntent, ExtractedIntent } from './agent-intent.js';

export type AgentResult = { text: string; requestHandoff?: boolean };

const HANDOFF_MARKER = '[HANDOFF]';

/** Format existing Auto Agent Brain records for the system prompt. */
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

type UsageMetadata = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

function extractTokenUsage(response: BaseMessage): UsageMetadata {
  try {
    const responseAny = response as any;
    const responseMetadata = responseAny.response_metadata ?? {};
    const tokenUsage = responseMetadata.tokenUsage ?? {};
    const usageMetadata = responseMetadata.usageMetadata ?? responseMetadata.usage_metadata ?? {};
    
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
    
    return {
      inputTokens: inputTokens || 0,
      outputTokens: outputTokens || 0,
      totalTokens: totalTokens || inputTokens + outputTokens,
    };
  } catch (e) {
    console.error('Failed to extract token usage:', e);
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }
}

async function recordUsage(
  modelName: string,
  usage: UsageMetadata,
  tenantId: string,
  userId?: string,
  conversationId?: string
): Promise<void> {
  try {
    const GEMINI_PRICING_USD: Record<string, { inputPer1K: number; outputPer1K: number }> = {
      'gemini-3-flash-preview': { inputPer1K: 0.000075, outputPer1K: 0.0003 },
      'gemini-1.5-pro': { inputPer1K: 0.0035, outputPer1K: 0.0105 },
    };
    const pricing = GEMINI_PRICING_USD[modelName] ?? GEMINI_PRICING_USD['gemini-3-flash-preview'];
    const costUsd = (usage.inputTokens / 1000) * pricing.inputPer1K + (usage.outputTokens / 1000) * pricing.outputPer1K;
    
    await db.collection('usage_events').add({
      tenantId,
      userId: userId ?? null,
      conversationId: conversationId ?? null,
      model: modelName,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.error('Failed to record usage event:', e);
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
          // In production, fetch and convert images here
          content.push({ type: 'image_url', image_url: { url } });
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

/**
 * Main agent function using production-grade architecture.
 */
export async function runAgentV2(
  tenantId: string,
  history: { role: string; content: string; imageUrls?: string[] }[],
  options?: { userId?: string; conversationId?: string }
): Promise<AgentResult> {
  try {
    const config = await getAgentConfig(tenantId);
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY not set');
    }

    const model = new ChatGoogleGenerativeAI({
      model: config.model,
      temperature: config.temperature,
      apiKey,
    });

    // ========================================================================
    // STEP 1: INTENT EXTRACTION (LLM suggests)
    // ========================================================================
    const lastUserMessage = history.filter((m) => m.role === 'user').pop()?.content ?? '';
    const intent = await extractIntent(model, lastUserMessage, history);

    // Early exit for human handoff
    if (intent.intent === 'request_human') {
      return {
        text: "I've requested that a care team member join this chat. They'll be with you shortly—please stay on this page.\n\nIf your need is urgent, please call your care team or 911 in an emergency.",
        requestHandoff: true,
      };
    }

    // ========================================================================
    // STEP 2: SETUP ORCHESTRATOR (Deterministic backend)
    // ========================================================================
    const googleSheetsList = config.googleSheets ?? [];
    const bookingCandidates = googleSheetsList.filter((s) => (s.useWhen ?? '').toLowerCase().includes('booking'));
    const bookingsSheetEntry = bookingCandidates.find((s) => /^(bookings?|appointments?)$/i.test((s.useWhen ?? '').trim()))
      ?? bookingCandidates[0];

    const orchestrator = new AgentOrchestrator(tenantId, bookingsSheetEntry);
    orchestrator.clearExecutionLogs(); // Start fresh for this turn

    // ========================================================================
    // STEP 3: BUILD OPTIMIZED CONTEXT (Multi-layer memory)
    // ========================================================================
    const trimmedMemory = trimConversationHistory(history, 10);
    const executionLogs = orchestrator.getExecutionLogs();
    
    let ragContext: string | undefined;
    if (config.ragEnabled) {
      ragContext = await getRagContext(tenantId, lastUserMessage);
    }

    const agentContext = await buildAgentContext(
      tenantId,
      options?.conversationId,
      trimmedMemory.recentMessages,
      executionLogs,
      ragContext,
      3 // Max 3 RAG chunks
    );

    // ========================================================================
    // STEP 4: BUILD SYSTEM PROMPT (Optimized context)
    // ========================================================================
    const nameInstruction = `Your name is ${config.agentName}. Always use this name when greeting or introducing yourself.`;
    const contextSection = formatContextForPrompt(agentContext);
    
    let systemContent = `${nameInstruction}\n\n${config.systemPrompt}\n\n${contextSection}\n\n`;
    
    // Add tool instructions
    systemContent += `CRITICAL RULES:
1. NEVER assume any action succeeded unless a tool explicitly returns success=true.
2. NEVER confirm bookings unless the tool returned success=true AND verification passed.
3. Trust the database, not your memory. Always verify state from tool results.
4. If a tool returns success=false, inform the user the action failed.
5. Binary state only: things either exist in the database or they don't.\n\n`;

    // Add RAG records if enabled
    if (config.ragEnabled) {
      const existingRecords = await listRecords(tenantId);
      systemContent += `--- Current Auto Agent Brain records ---\n${formatExistingRecordsForPrompt(existingRecords)}\n--- End of records ---\n\n`;
      systemContent += `When the user provides information to remember:\n`;
      systemContent += `1) If it UPDATES an existing record → use request_edit_record\n`;
      systemContent += `2) If a record is obsolete → use request_delete_record\n`;
      systemContent += `3) Only use record_learned_knowledge for NEW information\n\n`;
    }

    // Add Google Sheets instructions
    let sheetsEnabled = false;
    if (googleSheetsList.length > 0) {
      try {
        sheetsEnabled = await isGoogleConnected(tenantId);
        if (sheetsEnabled) {
          systemContent += `Google Sheets available:\n${googleSheetsList.map((s) => `- useWhen "${s.useWhen}" → use query_google_sheet with useWhen "${s.useWhen}"`).join('\n')}\n\n`;
          if (bookingsSheetEntry) {
            systemContent += `BOOKING RULES:\n`;
            systemContent += `- Use append_booking_row ONLY after user confirms a time\n`;
            systemContent += `- The orchestrator will automatically verify bookings\n`;
            systemContent += `- Only confirm if verification passes\n\n`;
          }
        }
      } catch (e) {
        console.warn('[Agent] Error checking Google Sheets:', e);
      }
    }

    systemContent += `How you should think: ${config.thinkingInstructions}\n\n`;
    systemContent += `Escalation: If you cannot help or user wants a human, end your reply with "${HANDOFF_MARKER}"\n`;

    // ========================================================================
    // STEP 5: PREPARE MESSAGES (Optimized conversation history)
    // ========================================================================
    const langChainHistory = await toLangChainMessages(trimmedMemory.recentMessages);
    const messages: BaseMessage[] = [
      new SystemMessage(systemContent),
      ...langChainHistory,
    ];

    // ========================================================================
    // STEP 6: CREATE TOOLS (Strict contracts)
    // ========================================================================
    const tools: DynamicStructuredTool[] = [];

    // Create note tool
    const createNoteTool = new DynamicStructuredTool({
      name: 'create_note',
      description: 'Create a note for admin review about analytics, insights, or patterns.',
      schema: z.object({
        content: z.string(),
        patientName: z.string().optional(),
        category: z.enum(['common_questions', 'keywords', 'analytics', 'insights', 'other']).optional(),
      }),
      func: async (args) => {
        // Orchestrator will handle execution
        return 'Note creation requested.';
      },
    });
    tools.push(createNoteTool);

    // RAG tools
    if (config.ragEnabled) {
      const recordTool = new DynamicStructuredTool({
        name: 'record_learned_knowledge',
        description: 'Save a new fact or piece of information.',
        schema: z.object({
          title: z.string(),
          content: z.string(),
        }),
        func: async () => 'Record creation requested.',
      });
      tools.push(recordTool);

      const requestEditTool = new DynamicStructuredTool({
        name: 'request_edit_record',
        description: 'Request that an existing memory record be edited.',
        schema: z.object({
          recordId: z.string(),
          title: z.string().optional(),
          content: z.string().optional(),
          reason: z.string().optional(),
        }),
        func: async () => 'Edit request submitted.',
      });
      tools.push(requestEditTool);

      const requestDeleteTool = new DynamicStructuredTool({
        name: 'request_delete_record',
        description: 'Request that a memory record be deleted.',
        schema: z.object({
          recordId: z.string(),
          reason: z.string().optional(),
        }),
        func: async () => 'Delete request submitted.',
      });
      tools.push(requestDeleteTool);
    }

    // Google Sheets tools
    if (sheetsEnabled && googleSheetsList.length > 0) {
      const queryGoogleSheetTool = new DynamicStructuredTool({
        name: 'query_google_sheet',
        description: `Fetch data from one of the organization's connected sheets.`,
        schema: z.object({
          useWhen: z.string(),
          range: z.string().optional(),
        }),
        func: async () => 'Sheet query requested.',
      });
      tools.push(queryGoogleSheetTool);

      if (bookingsSheetEntry) {
        const appendBookingRowTool = new DynamicStructuredTool({
          name: 'append_booking_row',
          description: `Record a confirmed appointment. Call ONLY after user confirms a time.`,
          schema: z.object({
            date: z.string(),
            patientName: z.string(),
            phone: z.string(),
            doctorName: z.string(),
            appointmentTime: z.string(),
            notes: z.string().optional(),
          }),
          func: async () => 'Booking requested.',
        });
        tools.push(appendBookingRowTool);

        const getAppointmentByPhoneTool = new DynamicStructuredTool({
          name: 'get_appointment_by_phone',
          description: `Verify if an appointment exists in the bookings sheet.`,
          schema: z.object({
            phone: z.string(),
            date: z.string().optional(),
          }),
          func: async () => 'Appointment query requested.',
        });
        tools.push(getAppointmentByPhoneTool);
      }
    }

    // ========================================================================
    // STEP 7: EXECUTE WITH ORCHESTRATOR (LLM suggests, orchestrator decides)
    // ========================================================================
    const modelWithTools = tools.length ? model.bindTools(tools) : model;
    let currentMessages: BaseMessage[] = messages;
    let accumulatedUsage: UsageMetadata = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const maxToolRounds = 3;

    let response: BaseMessage = await modelWithTools.invoke(currentMessages);
    let initialUsage = extractTokenUsage(response);
    accumulatedUsage.inputTokens += initialUsage.inputTokens;
    accumulatedUsage.outputTokens += initialUsage.outputTokens;
    accumulatedUsage.totalTokens += initialUsage.totalTokens;

    // Tool execution loop - orchestrator controls execution
    for (let round = 0; round < maxToolRounds; round++) {
      const toolCalls = (response as { tool_calls?: Array<{ id: string; name: string; args?: Record<string, unknown> }> }).tool_calls;
      if (!toolCalls?.length) break;

      const toolMessages: ToolMessage[] = [];
      
      for (const tc of toolCalls) {
        // Orchestrator executes deterministically
        const toolCall: ToolCall = {
          name: tc.name,
          args: tc.args ?? {},
        };

        const result = await orchestrator.executeToolCall(
          toolCall,
          googleSheetsList,
          options?.conversationId,
          options?.userId
        );

        // Format result for LLM
        let content: string;
        if (result.success) {
          if (result.data) {
            content = JSON.stringify(result.data);
          } else {
            content = 'Success';
          }
        } else {
          content = JSON.stringify({ success: false, error: result.error });
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

    // ========================================================================
    // STEP 8: FORMAT RESPONSE (LLM formats, orchestrator validates)
    // ========================================================================
    function extractTextFromResponse(res: BaseMessage): string {
      const content = (res as { content?: string | unknown[] }).content;
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return (content as unknown[])
          .map((c: unknown) => {
            if (c && typeof c === 'object' && 'text' in c && typeof (c as { text: string }).text === 'string')
              return (c as { text: string }).text;
            return '';
          })
          .join('');
      }
      return '';
    }

    let text = extractTextFromResponse(response);

    // Fallback if no text
    if (!text || text.trim().length === 0) {
      const plainTextPrompt = new HumanMessage({
        content: 'Reply to the user in plain text only. Do not use any tools.',
      });
      response = await model.invoke([...currentMessages, plainTextPrompt]);
      const fallbackUsage = extractTokenUsage(response);
      accumulatedUsage.inputTokens += fallbackUsage.inputTokens;
      accumulatedUsage.outputTokens += fallbackUsage.outputTokens;
      accumulatedUsage.totalTokens += fallbackUsage.totalTokens;
      text = extractTextFromResponse(response);
    }

    // ========================================================================
    // STEP 9: VALIDATE RESPONSE (Orchestrator guards)
    // ========================================================================
    const executionLogsFinal = orchestrator.getExecutionLogs();
    const verifiedBookings = executionLogsFinal.filter(
      (log) => log.toolCall.name === 'append_booking_row' && log.verified === true
    );

    // Guard: Don't claim booking unless verified
    const looksLikeBookingConfirmation = /\b(booked|booking confirmed|appointment (is )?(confirmed|scheduled|set))/i.test(text);
    if (looksLikeBookingConfirmation && verifiedBookings.length === 0) {
      const bookingAttempts = executionLogsFinal.filter((log) => log.toolCall.name === 'append_booking_row');
      if (bookingAttempts.length > 0) {
        console.warn('[Agent] Response claims booking but verification failed');
        text = "I attempted to save your appointment, but I wasn't able to verify it was successfully recorded. Please contact the care team to confirm your appointment.";
      }
    }

    // ========================================================================
    // STEP 10: HANDOFF DETECTION
    // ========================================================================
    const markerPresent = text.includes(HANDOFF_MARKER);
    const textWithoutMarker = markerPresent
      ? text.replace(new RegExp(`\\s*${HANDOFF_MARKER.replace(/[\]\[]/g, '\\$&')}\\s*$`, 'i'), '').trim()
      : text;

    const requestHandoff =
      markerPresent ||
      intent.intent === 'request_human' ||
      /speak with (a )?(care )?(coordinator|team|human|agent)/i.test(text);

    // ========================================================================
    // STEP 11: RECORD USAGE
    // ========================================================================
    try {
      await recordUsage(config.model, accumulatedUsage, tenantId, options?.userId, options?.conversationId);
    } catch (e) {
      console.error('Failed to record usage:', e);
    }

    return { text: textWithoutMarker || 'I could not generate a response. Please try rephrasing.', requestHandoff };
  } catch (e) {
    console.error('[Agent V2] Error:', e);
    throw e;
  }
}
