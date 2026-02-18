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
import {
  decideIfNeedsPlanning,
  createExecutionPlan,
  updatePlanWithResult,
  getNextStep,
  planNeedsInfo,
  formatMissingInfoQuestion,
  analyzeEmptyResponse,
  createRecoveryPlan,
  type ExecutionPlan,
  type EmptyResponseAnalysis,
} from './agent-planner.js';

export type AgentResult = {
  text: string;
  requestHandoff?: boolean;
  needsInfo?: boolean;
  missingInfo?: string[];
  planStatus?: ExecutionPlan['status'];
};

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
    const wantsHumanHandoff = intent.intent === 'request_human';

    // Early exit for human handoff
    if (wantsHumanHandoff) {
      return {
        text: "I've requested that a care team member join this chat. They'll be with you shortly—please stay on this page.\n\nIf your need is urgent, please call your care team or 911 in an emergency.",
        requestHandoff: true,
      };
    }

    // ========================================================================
    // STEP 1.5: PLANNING DECISION (Planner agent decides if planning needed)
    // ========================================================================
    const planningDecision = await decideIfNeedsPlanning(model, intent, lastUserMessage, history);
    let executionPlan: ExecutionPlan | null = null;

    // Create plan if needed
    if (planningDecision.needsPlanning) {
      const availableTools: string[] = [];
      if (config.ragEnabled) {
        availableTools.push('record_learned_knowledge', 'request_edit_record', 'request_delete_record');
      }
      const googleSheetsList = config.googleSheets ?? [];
      if (googleSheetsList.length > 0) {
        availableTools.push('query_google_sheet');
        const bookingCandidates = googleSheetsList.filter((s) => (s.useWhen ?? '').toLowerCase().includes('booking'));
        if (bookingCandidates.length > 0) {
          availableTools.push('append_booking_row', 'get_appointment_by_phone', 'check_availability');
        }
      }
      availableTools.push('create_note');

      executionPlan = await createExecutionPlan(
        model,
        intent,
        lastUserMessage,
        history,
        availableTools
      );

      // If plan needs info, ask user
      if (planNeedsInfo(executionPlan)) {
        const question = await formatMissingInfoQuestion(
          model,
          executionPlan.missingInfo,
          `User wants to: ${intent.intent}. ${executionPlan.description}`
        );
        return {
          text: question,
          needsInfo: true,
          missingInfo: executionPlan.missingInfo,
          planStatus: executionPlan.status,
        };
      }
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
1. CONSISTENCY IS TOP PRIORITY: Before answering availability or confirming bookings, ALWAYS check the "Existing notes in this conversation" section. If a booking is mentioned in the notes, it is REAL and must be respected even if not yet in the knowledge base.
2. NEVER assume any action succeeded unless a tool explicitly returns success=true.
3. NEVER confirm bookings unless the tool returned success=true AND verification passed.
4. Trust the database and conversation notes, not your internal memory. Always verify state from tool results and the provided notes context.
5. If a tool returns success=false, inform the user the action failed.
6. Binary state only: things either exist in the database/notes or they don't.\n\n`;

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

        const checkAvailabilityTool = new DynamicStructuredTool({
          name: 'check_availability',
          description: `Check if a doctor or time slot is available by querying the bookings sheet.`,
          schema: z.object({
            date: z.string(),
            range: z.string().optional(),
          }),
          func: async () => 'Availability check requested.',
        });
        tools.push(checkAvailabilityTool);
      }
    }

    // ========================================================================
    // STEP 7: EXECUTE WITH ORCHESTRATOR (LLM suggests, orchestrator decides)
    // ========================================================================
    const modelWithTools = tools.length ? model.bindTools(tools) : model;
    let currentMessages: BaseMessage[] = messages;
    let accumulatedUsage: UsageMetadata = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const maxToolRounds = 3;

    // If we have a plan, add plan context to system message
    if (executionPlan) {
      const planContext = `\n\nEXECUTION PLAN:
Description: ${executionPlan.description}
Steps: ${executionPlan.steps.map((s) => `${s.stepNumber}. ${s.description}${s.toolName ? ` (tool: ${s.toolName})` : ''}`).join('\n')}
Status: ${executionPlan.status}

Follow this plan step by step. Execute each step in order.`;
      currentMessages[0] = new SystemMessage((currentMessages[0] as SystemMessage).content + planContext);
    }

    let response: BaseMessage = await modelWithTools.invoke(currentMessages);
    let initialUsage = extractTokenUsage(response);
    accumulatedUsage.inputTokens += initialUsage.inputTokens;
    accumulatedUsage.outputTokens += initialUsage.outputTokens;
    accumulatedUsage.totalTokens += initialUsage.totalTokens;

    // Tool execution loop - orchestrator controls execution
    // If we have a plan, execute steps sequentially
    if (executionPlan && (executionPlan.status === 'ready' || executionPlan.status === 'executing')) {
      if (executionPlan.status === 'ready') {
        executionPlan.status = 'executing';
      }
      const planToolMessages: ToolMessage[] = [];
      
      for (const step of executionPlan.steps) {
        if (step.status === 'completed' || step.status === 'failed' || step.status === 'skipped') {
          continue;
        }

        // Check if step needs information
        if (step.requiredInfo && step.requiredInfo.length > 0) {
          const missingFromStep = step.requiredInfo.filter((info) => {
            // Check if info is available in intent entities or conversation
            const infoLower = info.toLowerCase();
            if (infoLower.includes('date') && !intent.entities.date) return true;
            if (infoLower.includes('phone') && !intent.entities.phone) return true;
            if (infoLower.includes('name') && !intent.entities.patientName) return true;
            if (infoLower.includes('doctor') && !intent.entities.doctor) return true;
            if (infoLower.includes('time') && !intent.entities.time) return true;
            return false;
          });

          if (missingFromStep.length > 0) {
            const question = await formatMissingInfoQuestion(
              model,
              missingFromStep,
              step.description
            );
            executionPlan = updatePlanWithResult(executionPlan, step.stepNumber, {
              success: false,
              error: 'Missing required information',
            });
            return {
              text: question,
              needsInfo: true,
              missingInfo: missingFromStep,
              planStatus: executionPlan.status,
            };
          }
        }

        // Execute step if it has a tool
        if (step.toolName) {
          const toolCall: ToolCall = {
            name: step.toolName,
            args: step.toolArgs ?? {},
          };

          const result = await orchestrator.executeToolCall(
            toolCall,
            googleSheetsList,
            options?.conversationId,
            options?.userId
          );

          // Format result for LLM with enhanced state information
          let content: string;
          if (result.success) {
            const resultData: Record<string, unknown> = {
              success: true,
              action: result.action,
              verified: result.verified ?? false,
            };
            if (result.data) {
              resultData.data = result.data;
            }
            content = JSON.stringify(resultData);
          } else {
            content = JSON.stringify({
              success: false,
              action: result.action,
              error: result.error,
              verified: false,
            });
          }

          // Create a tool message for this step (using step number as ID)
          planToolMessages.push(
            new ToolMessage({
              content: `Step ${step.stepNumber}: ${content}`,
              tool_call_id: `step-${step.stepNumber}`,
            })
          );

          // Update plan with result
          executionPlan = updatePlanWithResult(executionPlan, step.stepNumber, {
            success: result.success,
            data: result.data,
            error: result.error,
            verified: result.verified,
          });

          // If step failed, stop execution
          if (!result.success) {
            break;
          }
        } else {
          // Step without tool - mark as completed
          executionPlan = updatePlanWithResult(executionPlan, step.stepNumber, {
            success: true,
          });
        }
      }

      // Add plan execution results to messages and get final response
      if (planToolMessages.length > 0) {
        currentMessages = [...currentMessages, response, ...planToolMessages];
        response = await modelWithTools.invoke(currentMessages);
        const planUsage = extractTokenUsage(response);
        accumulatedUsage.inputTokens += planUsage.inputTokens;
        accumulatedUsage.outputTokens += planUsage.outputTokens;
        accumulatedUsage.totalTokens += planUsage.totalTokens;
      }
    } else {
      // Standard execution without plan
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

          // Format result for LLM with enhanced state information
          let content: string;
          if (result.success) {
            const resultData: Record<string, unknown> = {
              success: true,
              action: result.action,
              verified: result.verified ?? false,
            };
            if (result.data) {
              resultData.data = result.data;
            }
            content = JSON.stringify(resultData);
          } else {
            content = JSON.stringify({
              success: false,
              action: result.action,
              error: result.error,
              verified: false,
            });
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
    }

    // ========================================================================
    // STEP 8: FORMAT RESPONSE (LLM formats, orchestrator validates)
    // If we have a plan, include plan status in response
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

    // Check if response only contains tool calls (no text)
    const hasToolCalls = response != null && ((response as { tool_calls?: unknown[] }).tool_calls?.length ?? 0) > 0;
    const isEmptyResponse = (!text || text.trim().length === 0) && !hasToolCalls;
    const isToolOnlyResponse = (!text || text.trim().length === 0) && hasToolCalls;

    // Intelligent empty response handling with analysis and retry
    if (isEmptyResponse || isToolOnlyResponse) {
      console.warn(`[Agent V2] Empty response detected (isEmpty: ${isEmptyResponse}, toolOnly: ${isToolOnlyResponse})`);
      
      // Analyze the cause of empty response
      const executionLogsForAnalysis = orchestrator.getExecutionLogs();
      const toolResults = executionLogsForAnalysis.map((log) => ({
        success: log.result.success,
        error: log.result.error,
      }));
      
      const analysis = await analyzeEmptyResponse(
        model,
        response,
        currentMessages,
        executionPlan,
        toolResults
      );
      
      console.log(`[Agent V2] Empty response analysis:`, {
        cause: analysis.cause,
        confidence: analysis.confidence,
        reasoning: analysis.reasoning,
        suggestedAction: analysis.suggestedAction,
      });

      // Create recovery plan if needed
      if (analysis.suggestedAction === 'use_planner' || analysis.suggestedAction === 'retry_with_context') {
        const recoveryPlan = await createRecoveryPlan(
          model,
          analysis,
          intent,
          lastUserMessage,
          history,
          toolResults
        );
        
        if (recoveryPlan) {
          console.log(`[Agent V2] Created recovery plan: ${recoveryPlan.planId}`);
          executionPlan = recoveryPlan;
        }
      }

      // Retry based on analysis
      let retryAttempted = false;
      
      if (analysis.suggestedAction === 'retry_simple' || analysis.suggestedAction === 'retry_with_context') {
        retryAttempted = true;
        console.log(`[Agent V2] Attempting intelligent retry with strategy: ${analysis.suggestedAction}`);
        
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
              setTimeout(() => reject(new Error('Retry timeout')), 60000);
            }),
          ]);
          
          const retryUsage = extractTokenUsage(retryResponse);
          accumulatedUsage.inputTokens += retryUsage.inputTokens;
          accumulatedUsage.outputTokens += retryUsage.outputTokens;
          accumulatedUsage.totalTokens += retryUsage.totalTokens;
          
          text = extractTextFromResponse(retryResponse);
          
          if (text && text.trim().length > 0) {
            console.log(`[Agent V2] Retry successful, got response`);
            response = retryResponse; // Update response for further processing
          } else {
            console.warn(`[Agent V2] Retry still produced empty response`);
          }
        } catch (e) {
          console.error(`[Agent V2] Retry failed:`, e);
        }
      }
      
      // If retry didn't work or wasn't attempted, use fallback
      if (!text || text.trim().length === 0) {
        console.warn(`[Agent V2] ${retryAttempted ? 'Retry failed, using' : 'Using'} fallback mechanism`);
        
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
                    if (content.includes('success') || content.includes('"success":true')) {
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
              
              // Use timeout wrapper for fallback (60 seconds)
              const fallbackResponse = await Promise.race([
                model.invoke([...currentMessages.slice(-10), contextPrompt]),
                new Promise<BaseMessage>((_, reject) => {
                  setTimeout(() => reject(new Error('Fallback LLM timeout')), 60000);
                }),
              ]);
              
              const fallbackUsage = extractTokenUsage(fallbackResponse);
              accumulatedUsage.inputTokens += fallbackUsage.inputTokens;
              accumulatedUsage.outputTokens += fallbackUsage.outputTokens;
              accumulatedUsage.totalTokens += fallbackUsage.totalTokens;
              
              text = extractTextFromResponse(fallbackResponse);
            } catch (e) {
              console.warn('[Agent V2] Failed to generate response from tool results:', e);
            }
          }
        }
        
        // If still no text, try standard fallback
        if (!text || text.trim().length === 0) {
          try {
            const plainTextPrompt = new HumanMessage({
              content: 'Reply to the user in plain text only. Do not use any tools. Provide a helpful response based on the conversation context.',
            });
            
            // Use timeout wrapper for fallback (60 seconds)
            response = await Promise.race([
              model.invoke([...currentMessages.slice(-10), plainTextPrompt]),
              new Promise<BaseMessage>((_, reject) => {
                setTimeout(() => reject(new Error('Fallback LLM timeout')), 60000);
              }),
            ]);
            
            const fallbackUsage = extractTokenUsage(response);
            accumulatedUsage.inputTokens += fallbackUsage.inputTokens;
            accumulatedUsage.outputTokens += fallbackUsage.outputTokens;
            accumulatedUsage.totalTokens += fallbackUsage.totalTokens;
            text = extractTextFromResponse(response);
            
            if (!text || text.trim().length === 0) {
              console.error('[Agent V2] Fallback response also empty');
            }
          } catch (e) {
            console.error('[Agent V2] Fallback response generation failed:', e);
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
                if (toolContent.includes('success') || toolContent.includes('"success":true')) {
                  text = 'I\'ve completed that action for you. Is there anything else I can help with?';
                } else if (toolContent.includes('Failed') || toolContent.includes('error') || toolContent.includes('"success":false')) {
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
      wantsHumanHandoff ||
      /speak with (a )?(care )?(coordinator|team|human|agent)/i.test(text);

    // ========================================================================
    // STEP 11: RECORD USAGE
    // ========================================================================
    try {
      await recordUsage(config.model, accumulatedUsage, tenantId, options?.userId, options?.conversationId);
    } catch (e) {
      console.error('Failed to record usage:', e);
    }

    const finalResult: AgentResult = {
      text: textWithoutMarker || 'I could not generate a response. Please try rephrasing.',
      requestHandoff,
    };

    // Include plan status if we have a plan
    if (executionPlan) {
      finalResult.planStatus = executionPlan.status;
      
      // If plan needs info, include it
      if (planNeedsInfo(executionPlan)) {
        finalResult.needsInfo = true;
        finalResult.missingInfo = executionPlan.missingInfo;
      }
    }

    return finalResult;
  } catch (e) {
    console.error('[Agent V2] Error:', e);
    throw e;
  }
}
