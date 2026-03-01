/**
 * Multi-Layer Memory System
 * 
 * Separates memory into:
 * 1. Conversation Memory - Short-term window (trimmed aggressively)
 * 2. Structured State Memory - Database truth
 * 3. Long-Term Memory - Embeddings / summaries
 * 4. Execution Logs - Tool result history
 * 
 * Never relies on "the model remembers what it said earlier"
 */

import { BaseMessage } from '@langchain/core/messages';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { listNotes } from './agent-notes.js';
import { ExecutionLog } from './agent-orchestrator.js';
import { ExecutionPlan } from './agent-planner.js';

// ============================================================================
// CONVERSATION MEMORY - Aggressively trimmed short-term window
// ============================================================================

export interface ConversationMemory {
  recentMessages: Array<{ role: string; content: string; imageUrls?: string[] }>;
  summary?: string; // Summary of older conversation
  lastSummaryAt?: Date;
}

/**
 * Trim conversation history aggressively to keep context lean.
 * Only keeps recent messages and summarizes older ones.
 */
export function trimConversationHistory(
  history: Array<{ role: string; content: string; imageUrls?: string[] }>,
  maxRecentMessages: number = 10
): ConversationMemory {
  if (history.length <= maxRecentMessages) {
    return {
      recentMessages: history,
    };
  }

  // Keep only the most recent messages
  const recentMessages = history.slice(-maxRecentMessages);
  const olderMessages = history.slice(0, -maxRecentMessages);

  // Create a simple summary of older messages
  const userMessages = olderMessages.filter((m) => m.role === 'user');
  const assistantMessages = olderMessages.filter((m) => m.role === 'assistant');

  const summary = `Earlier in this conversation:
- User sent ${userMessages.length} message(s)
- Assistant sent ${assistantMessages.length} response(s)
- Key topics discussed: ${extractKeyTopics(olderMessages).join(', ') || 'general conversation'}`;

  return {
    recentMessages,
    summary,
    lastSummaryAt: new Date(),
  };
}

function extractKeyTopics(messages: Array<{ role: string; content: string }>): string[] {
  const topics = new Set<string>();
  const content = messages.map((m) => m.content.toLowerCase()).join(' ');

  // Simple keyword extraction (could be enhanced with NLP)
  const keywords = [
    'appointment',
    'booking',
    'doctor',
    'symptom',
    'pain',
    'medication',
    'test',
    'schedule',
    'time',
    'date',
  ];

  for (const keyword of keywords) {
    if (content.includes(keyword)) {
      topics.add(keyword);
    }
  }

  return Array.from(topics).slice(0, 5); // Limit to 5 topics
}

// ============================================================================
// STRUCTURED STATE MEMORY - Database truth
// ============================================================================

export interface StructuredState {
  appointments: Array<{
    appointmentId: string;
    date: string;
    patientName: string;
    phone: string;
    doctor: string;
    time: string;
  }>;
  notes: Array<{
    category: string;
    content: string;
    patientName?: string;
  }>;
  activePlan?: ExecutionPlan;
  lastUpdated: Date;
}

/**
 * Load structured state from database (appointments, notes, etc.)
 * This is the source of truth, not conversation history.
 */
export async function loadStructuredState(
  tenantId: string,
  conversationId?: string,
  userId?: string
): Promise<StructuredState> {
  const state: StructuredState = {
    appointments: [],
    notes: [],
    lastUpdated: new Date(),
  };

  // Load notes and active plan for this conversation
  if (conversationId) {
    try {
      const notes = await listNotes(tenantId, { conversationId, userId, limit: 20 });
      state.notes = notes.map((n) => ({
        category: n.category,
        content: n.content,
        patientName: n.patientName ?? undefined,
      }));

      // Load active plan
      const planSnap = await db.collection('execution_plans')
        .where('conversationId', '==', conversationId)
        .where('status', 'in', ['ready', 'executing', 'needs_info', 'awaiting_confirmation'])
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();
      
      if (!planSnap.empty) {
        const planData = planSnap.docs[0].data();
        state.activePlan = {
          ...planData,
          planId: planSnap.docs[0].id,
          createdAt: planData.createdAt?.toDate(),
          updatedAt: planData.updatedAt?.toDate(),
        } as ExecutionPlan;
      }

      // Extract bookings from notes
      for (const note of notes) {
        if (note.content.includes('Booking') || note.content.includes('Appointment')) {
          const content = note.content;
          const dateMatch = content.match(/on (\d{4}-\d{2}-\d{2})/);
          const timeMatch = content.match(/at (\d{1,2}:\d{2}\s*(am|pm)?)/i);
          const doctorMatch = content.match(/with Dr\. (.*?)(?= on| at|$)/);
          const phoneMatch = content.match(/\((\d{10,})\)/);

          if (dateMatch && timeMatch) {
            state.appointments.push({
              appointmentId: `NOTE-${note.noteId}`,
              date: dateMatch[1],
              patientName: note.patientName || 'unknown',
              phone: phoneMatch ? phoneMatch[1] : 'unknown',
              doctor: doctorMatch ? doctorMatch[1] : 'unknown',
              time: timeMatch[1],
            });
          }
        }
      }
    } catch (e) {
      console.warn('[Memory] Failed to load conversation state:', e);
    }
  }

  // Appointments from Excel are handled by the orchestrator tools, 
  // but we've now added notes-based tracking to the state as well.

  return state;
}

// ============================================================================
// EXECUTION LOG MEMORY - Tool result history
// ============================================================================

/**
 * Format execution logs for LLM context.
 * Only includes recent, relevant logs.
 */
export function formatExecutionLogs(logs: ExecutionLog[], maxLogs: number = 5): string {
  if (logs.length === 0) return '';

  const recentLogs = logs.slice(-maxLogs);
  const formatted = recentLogs.map((log, idx) => {
    const toolName = log.toolCall.name;
    const success = log.result.success ? '✓' : '✗';
    const verified = log.verified ? ' (verified)' : '';
    const error = log.result.error ? ` - Error: ${log.result.error}` : '';

    return `${idx + 1}. ${success} ${toolName}${verified}${error}`;
  });

  return `Recent tool executions:\n${formatted.join('\n')}`;
}

// ============================================================================
// LONG-TERM MEMORY - Summaries and embeddings
// ============================================================================

export interface ConversationSummary {
  conversationId: string;
  summary: string;
  keyTopics: string[];
  createdAt: Date;
}

/**
 * Store conversation summary for long-term memory.
 */
export async function storeConversationSummary(
  tenantId: string,
  conversationId: string,
  summary: string,
  keyTopics: string[],
  options?: { userId?: string; scope?: "shared" | "user" }
): Promise<void> {
  try {
    const scope: 'shared' | 'user' = options?.scope ?? (options?.userId ? 'user' : 'shared');
    await db.collection('conversation_summaries').add({
      tenantId,
      conversationId,
      summary,
      keyTopics,
      scope,
      userId: scope === 'user' ? (options?.userId ?? null) : null,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.error('[Memory] Failed to store conversation summary:', e);
  }
}

/**
 * Load relevant conversation summaries (for context).
 */
export async function loadRelevantSummaries(
  tenantId: string,
  currentTopics: string[],
  limit: number = 3,
  options?: { userId?: string; includeShared?: boolean }
): Promise<ConversationSummary[]> {
  try {
    // Simple implementation - could be enhanced with semantic search
    const snapshot = await db
      .collection('conversation_summaries')
      .where('tenantId', '==', tenantId)
      .orderBy('createdAt', 'desc')
      .limit(limit * 2) // Get more, then filter
      .get();

    const summaries: ConversationSummary[] = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const summaryTopics = (data.keyTopics as string[]) || [];
      const scope = (data.scope as 'shared' | 'user' | undefined) ?? 'shared';
      const summaryUserId = (data.userId as string | null | undefined) ?? null;
      const includeShared = options?.includeShared ?? true;
      const currentUserId = options?.userId?.trim();

      if (scope === 'user' && (!currentUserId || summaryUserId !== currentUserId)) {
        continue;
      }
      if (scope !== 'user' && !includeShared) {
        continue;
      }

      // Check if any topics overlap
      const hasOverlap = currentTopics.some((topic) =>
        summaryTopics.some((st) => st.toLowerCase().includes(topic.toLowerCase()))
      );

      if (hasOverlap || summaries.length < limit) {
        summaries.push({
          conversationId: data.conversationId as string,
          summary: data.summary as string,
          keyTopics: summaryTopics,
          createdAt: (data.createdAt as any)?.toDate() || new Date(),
        });
      }

      if (summaries.length >= limit) break;
    }

    return summaries;
  } catch (e) {
    console.error('[Memory] Failed to load summaries:', e);
    return [];
  }
}

// ============================================================================
// CONTEXT BUILDER - Optimizes context for LLM
// ============================================================================

export interface AgentContext {
  conversationMemory: ConversationMemory;
  structuredState: StructuredState;
  executionLogs: string;
  relevantSummaries: ConversationSummary[];
  ragContext?: string;
}

/**
 * Build optimized context for LLM.
 * Limits RAG to 2-4 chunks, summarizes conversation, injects only relevant memory.
 */
export async function buildAgentContext(
  tenantId: string,
  conversationId: string | undefined,
  history: Array<{ role: string; content: string; imageUrls?: string[] }>,
  executionLogs: ExecutionLog[],
  ragContext?: string,
  maxRagChunks: number = 3,
  userId?: string
): Promise<AgentContext> {
  // 1. Trim conversation history
  const conversationMemory = trimConversationHistory(history, 10);

  // 2. Load structured state
  const structuredState = await loadStructuredState(tenantId, conversationId, userId);

  // 3. Format execution logs
  const logsFormatted = formatExecutionLogs(executionLogs, 5);

  // 4. Load relevant summaries
  const keyTopics = extractKeyTopics(history);
  const relevantSummaries = await loadRelevantSummaries(tenantId, keyTopics, 3, { userId });

  // 5. Limit RAG context (if provided)
  const limitedRagContext = ragContext
    ? limitRagChunks(ragContext, maxRagChunks)
    : undefined;

  return {
    conversationMemory,
    structuredState,
    executionLogs: logsFormatted,
    relevantSummaries,
    ragContext: limitedRagContext,
  };
}

/**
 * Limit RAG chunks to prevent token overflow.
 * Simple implementation - splits by double newlines and takes first N chunks.
 */
function limitRagChunks(ragContext: string, maxChunks: number): string {
  const chunks = ragContext.split('\n\n').filter((chunk) => chunk.trim().length > 0);
  const limited = chunks.slice(0, maxChunks);
  return limited.join('\n\n');
}

/**
 * Format context for LLM system prompt.
 */
export function formatContextForPrompt(context: AgentContext): string {
  const parts: string[] = [];

  // Conversation summary
  if (context.conversationMemory.summary) {
    parts.push(`Conversation Summary:\n${context.conversationMemory.summary}\n`);
  }

  // Recent messages count
  parts.push(
    `Recent conversation (last ${context.conversationMemory.recentMessages.length} messages):\n[Recent messages will be included in message history]\n`
  );

  // Structured state
  if (context.structuredState.notes.length > 0) {
    parts.push(
      `Existing notes in this conversation:\n${context.structuredState.notes
        .map((n, i) => `${i + 1}. [${n.category}] ${n.content}${n.patientName ? ` (User: ${n.patientName})` : ''}`)
        .join('\n')}\n`
    );
  }

  // Execution logs
  if (context.executionLogs) {
    parts.push(`${context.executionLogs}\n`);
  }

  // Relevant summaries
  if (context.relevantSummaries.length > 0) {
    parts.push(
      `Relevant past conversations:\n${context.relevantSummaries
        .map((s, i) => `${i + 1}. Topics: ${s.keyTopics.join(', ')}\n   Summary: ${s.summary.substring(0, 200)}...`)
        .join('\n\n')}\n`
    );
  }

  // RAG context
  if (context.ragContext) {
    parts.push(`Knowledge base context:\n${context.ragContext}\n`);
  }

  return parts.join('\n');
}
