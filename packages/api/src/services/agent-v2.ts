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
import { decomposeQuestion, DecomposedQuestion } from './agent-decomposer.js';
import { extractTokenUsage, recordUsage, type UsageMetadata } from './token-usage.js';
import { extractDefaultProfileFields, getXPersonProfile } from './xperson-profile.js';
import { listUserReminders } from './reminders.js';
import { getHealthProfile, logVitals } from './health-tools.js';
import {
  decideIfNeedsPlanning,
  createExecutionPlan,
  updatePlanWithResult,
  getNextStep,
  planNeedsInfo,
  formatMissingInfoQuestion,
  formatConfirmationQuestion,
  confirmStep,
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
const REMINDER_RELATED_TURN_REGEX = /\b(reminder|remind|upcoming|scheduled|schedule|delete|remove|cancel|edit|change|update)\b/i;


type TriageState = 'chief_complaint' | 'duration' | 'severity' | 'associated_symptoms' | 'risk_factors' | 'advice';

type PersistedTriageState = {
  currentState: TriageState;
  askedStates: TriageState[];
  answeredStates: TriageState[];
  symptomSummary?: string | null;
  lastQuestion?: string | null;
  lastUpdatedAt?: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp | Date | null;
};

const TRIAGE_STATE_ORDER: TriageState[] = [
  'chief_complaint',
  'duration',
  'severity',
  'associated_symptoms',
  'risk_factors',
  'advice',
];

const TRIAGE_STATE_LABELS: Record<TriageState, string> = {
  chief_complaint: 'chief complaint',
  duration: 'duration',
  severity: 'severity',
  associated_symptoms: 'associated symptoms',
  risk_factors: 'risk factors',
  advice: 'advice',
};

const QUICK_ADVICE_SYMPTOM_REGEX = /\b(cough|cold|flu|headache|fever|diarrhea|diarrhoea|vomiting|nausea|stomach(?:\s+ache)?|abdominal pain|runny nose|sore throat|constipation|rash|allergy|back pain|body aches?)\b/i;
const HIGH_RISK_TRIAGE_REGEX = /\b(chest pain|difficulty breathing|shortness of breath|can't breathe|seizure|faint(?:ed|ing)?|passed out|stroke|weakness on one side|confused|confusion|pregnant|pregnancy|newborn|infant|baby|blood in (?:stool|vomit|urine)|black stool|severe dehydration|cannot keep fluids down|can't keep fluids down|not passing urine|suicidal|overdose|poison|anaphylaxis)\b/i;

type AgentFlowStage =
  | 'start'
  | 'decomposition'
  | 'intent'
  | 'handoff'
  | 'memory'
  | 'planning'
  | 'plan_execution'
  | 'orchestrator'
  | 'context'
  | 'llm'
  | 'retry'
  | 'validation'
  | 'triage_state'
  | 'complete'
  | 'error';

function logAgentFlow(
  variant: AgentRuntimeVariant,
  stage: AgentFlowStage,
  details: Record<string, unknown>
): void {
  const prefix = `[Agent ${variant.toUpperCase()} Flow]`;
  console.log(`${prefix} ${stage}`, details);
}

function createDefaultTriageState(): PersistedTriageState {
  return {
    currentState: 'chief_complaint',
    askedStates: [],
    answeredStates: [],
    symptomSummary: null,
    lastQuestion: null,
    lastUpdatedAt: null,
  };
}

function normalizeTriageState(raw: unknown): PersistedTriageState {
  const base = createDefaultTriageState();
  if (!raw || typeof raw !== 'object') return base;
  const data = raw as Record<string, unknown>;
  const currentState = TRIAGE_STATE_ORDER.includes(data.currentState as TriageState) ? data.currentState as TriageState : base.currentState;
  const askedStates = Array.isArray(data.askedStates) ? data.askedStates.filter((s): s is TriageState => TRIAGE_STATE_ORDER.includes(s as TriageState)) : [];
  const answeredStates = Array.isArray(data.answeredStates) ? data.answeredStates.filter((s): s is TriageState => TRIAGE_STATE_ORDER.includes(s as TriageState)) : [];
  return {
    currentState,
    askedStates: Array.from(new Set(askedStates)),
    answeredStates: Array.from(new Set(answeredStates)),
    symptomSummary: typeof data.symptomSummary === 'string' ? data.symptomSummary : null,
    lastQuestion: typeof data.lastQuestion === 'string' ? data.lastQuestion : null,
    lastUpdatedAt: null,
  };
}

function messageLooksLikeClarification(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.includes('?')) return true;
  return /^(what|which|how|why|when|where|who|do you mean|meaning|explain)\b/.test(normalized);
}

function messageAnswersState(text: string, state: TriageState): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized || messageLooksLikeClarification(normalized)) return false;

  switch (state) {
    case 'chief_complaint':
      return normalized.split(/\s+/).length >= 2;
    case 'duration':
      return /(today|yesterday|morning|evening|night|week|day|month|year|hour|minute|since|for \d+|\d+\s*(day|days|week|weeks|month|months|year|years|hour|hours))/i.test(normalized);
    case 'severity':
      return /\b([1-9]|10)\b/.test(normalized) || /(mild|moderate|severe|very bad|bad|worst)/i.test(normalized);
    case 'associated_symptoms':
    case 'risk_factors':
      return normalized.length > 0;
    case 'advice':
      return false;
    default:
      return false;
  }
}

function getNextUnansweredTriageState(answeredStates: TriageState[]): TriageState {
  return TRIAGE_STATE_ORDER.find((state) => !answeredStates.includes(state)) ?? 'advice';
}

function shouldFastTrackV3Advice(
  triageState: PersistedTriageState,
  history: { role: string; content: string; imageUrls?: string[] }[]
): boolean {
  if (!triageState.answeredStates.includes('chief_complaint')) return false;
  if (!triageState.answeredStates.includes('duration')) return false;
  if (!triageState.answeredStates.includes('severity')) return false;
  if (triageState.answeredStates.includes('advice')) return true;

  const combinedUserText = history
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
    .join(' \n ')
    .trim();

  const symptomSummary = triageState.symptomSummary ?? combinedUserText;
  if (!symptomSummary || !QUICK_ADVICE_SYMPTOM_REGEX.test(symptomSummary)) return false;
  if (HIGH_RISK_TRIAGE_REGEX.test(combinedUserText)) return false;

  const normalizedHistory = combinedUserText.toLowerCase();
  const moderateOrWorse = /\b(severe|very bad|worst|unbearable|can't manage|cannot manage|8\/10|9\/10|10\/10|eight\/10|nine\/10|ten\/10)\b/.test(normalizedHistory);
  if (moderateOrWorse) return false;

  return true;
}

function prepareV3TriageState(history: { role: string; content: string; imageUrls?: string[] }[], persisted: PersistedTriageState): PersistedTriageState {
  const nextState = normalizeTriageState(persisted);
  const lastUserMessage = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';

  if (!nextState.askedStates.includes('chief_complaint') && history.some((m) => m.role === 'user' && m.content.trim())) {
    nextState.askedStates.push('chief_complaint');
    nextState.answeredStates.push('chief_complaint');
    nextState.symptomSummary = history.find((m) => m.role === 'user' && m.content.trim())?.content ?? nextState.symptomSummary ?? null;
  }

  const pendingAskedState = [...nextState.askedStates].reverse().find((state) => state !== 'chief_complaint' && !nextState.answeredStates.includes(state));
  if (pendingAskedState && messageAnswersState(lastUserMessage, pendingAskedState)) {
    nextState.answeredStates.push(pendingAskedState);
  }

  nextState.answeredStates = Array.from(new Set(nextState.answeredStates));

  if (shouldFastTrackV3Advice(nextState, history)) {
    nextState.currentState = 'advice';
    return nextState;
  }

  nextState.currentState = getNextUnansweredTriageState(nextState.answeredStates);
  return nextState;
}

function buildPersistedV3StateAfterResponse(
  triageState: PersistedTriageState,
  responseText: string
): PersistedTriageState {
  const nextState = normalizeTriageState(triageState);
  const responseNormalized = responseText.trim().toLowerCase();
  const givingAdvice = nextState.currentState === 'advice' || /\b(should|please|drink|rest|go to|seek care|urgent|emergency|home care)\b/.test(responseNormalized);

  if (givingAdvice) {
    if (!nextState.answeredStates.includes('advice')) nextState.answeredStates.push('advice');
    nextState.currentState = 'advice';
    nextState.lastQuestion = null;
  } else {
    if (!nextState.askedStates.includes(nextState.currentState)) nextState.askedStates.push(nextState.currentState);
    nextState.lastQuestion = responseText.trim();
  }

  nextState.askedStates = Array.from(new Set(nextState.askedStates));
  nextState.answeredStates = Array.from(new Set(nextState.answeredStates));
  nextState.lastUpdatedAt = FieldValue.serverTimestamp();
  return nextState;
}

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
type AgentRuntimeOptions = {
  userId?: string;
  externalUserId?: string;
  conversationId?: string;
  preferredResponseLanguage?: 'luganda' | 'english' | null;
  conversationLanguageCode?: string | null;
  conversationLanguageName?: string | null;
  channel?: 'widget' | 'whatsapp' | 'whatsapp_meta';
}
type AgentRuntimeVariant = 'v2' | 'v3';

type ReminderClarification = {
  question: string;
  missingInfo: string[];
  reason: string;
};

const REMINDER_TIME_REGEX = /\b(\d{1,2}:\d{2}\s*(am|pm)?|\d{1,2}\s*(am|pm)|today|tomorrow|tonight|this (morning|afternoon|evening|night)|next \w+|in \d+\s*(minute|minutes|min|mins|hour|hours|day|days|week|weeks)|after \d+\s*(minute|minutes|min|mins|hour|hours|day|days)|on \w+|at \d{1,2})\b/i;
const REMINDER_SELF_REFERENCE_REGEX = /\b(remind me(?: to)?|set (?:a )?reminder(?: for me)?(?: to| for)?|create (?:a )?reminder(?: for me)?(?: to| for)?)\b/i;
const REMINDER_OTHER_REFERENCE_REGEX = /\b(remind (?:him|her|them|my|our|next of kin|mother|mom|father|dad|wife|husband|child|son|daughter|brother|sister)|set (?:a )?reminder for (?:him|her|them|my|our|next of kin|mother|mom|father|dad|wife|husband|child|son|daughter|brother|sister))\b/i;

function isWhatsAppReminderChannel(channel: AgentRuntimeOptions['channel']): boolean {
  return channel === 'whatsapp' || channel === 'whatsapp_meta';
}

function hasReminderTimeHint(text: string): boolean {
  return REMINDER_TIME_REGEX.test(text);
}

function looksLikeBareReminderRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return /^(remind me|set (?:a )?reminder|create (?:a )?reminder|i need a reminder|help me set a reminder)[.!?]*$/.test(normalized);
}

function extractReminderMessageCandidate(text: string): string | null {
  const normalized = text.trim();
  if (!normalized) return null;

  const patterns = [
    /\bremind me to\s+(.+)$/i,
    /\bremind me about\s+(.+)$/i,
    /\bset (?:a )?reminder(?: for me)? to\s+(.+)$/i,
    /\bset (?:a )?reminder(?: for me)? about\s+(.+)$/i,
    /\bset (?:a )?reminder(?: for me)? for\s+(.+)$/i,
    /\bcreate (?:a )?reminder(?: for me)? to\s+(.+)$/i,
    /\bcreate (?:a )?reminder(?: for me)? about\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate && candidate.length > 0 && !hasReminderTimeHint(candidate)) {
      return candidate.replace(/[.?!]+$/, '').trim();
    }
  }

  return null;
}

function getRecentReminderContext(history: { role: string; content: string }[]): {
  recentAssistantReminderOffer?: string;
  recentUserReminderMessage?: string;
} {
  const recentMessages = history.slice(-6);
  const recentAssistantReminderOffer = [...recentMessages]
    .reverse()
    .find((message) => message.role === 'assistant' && /would you like me to set (?:one|a reminder)|should i set (?:one|a reminder)|when should i remind/i.test(message.content))
    ?.content;
  const recentUserReminderMessage = [...recentMessages]
    .reverse()
    .find((message) => message.role === 'user' && extractReminderMessageCandidate(message.content))
    ?.content;

  return { recentAssistantReminderOffer, recentUserReminderMessage };
}

function getReminderClarification(
  currentTask: string,
  history: { role: string; content: string }[],
  intent: ExtractedIntent,
  options?: AgentRuntimeOptions
): ReminderClarification | null {
  if (!isWhatsAppReminderChannel(options?.channel)) return null;

  const normalizedTask = currentTask.trim();
  if (!normalizedTask) return null;

  const { recentAssistantReminderOffer, recentUserReminderMessage } = getRecentReminderContext(history);
  const reminderMessageCandidate = extractReminderMessageCandidate(normalizedTask)
    ?? (recentUserReminderMessage ? extractReminderMessageCandidate(recentUserReminderMessage) : null);
  const hasReminderContext =
    REMINDER_RELATED_TURN_REGEX.test(normalizedTask)
    || !!recentAssistantReminderOffer
    || !!recentUserReminderMessage;
  const isReminderCreationTurn =
    hasReminderContext
    && (
      REMINDER_SELF_REFERENCE_REGEX.test(normalizedTask)
      || REMINDER_OTHER_REFERENCE_REGEX.test(normalizedTask)
      || intent.intent === 'confirm_action'
      || /\b(yes|yeah|yep|ok|okay|sure|please|go ahead|do it)\b/i.test(normalizedTask)
    );

  if (!isReminderCreationTurn) return null;

  const missingInfo: string[] = [];
  if (!reminderMessageCandidate) {
    missingInfo.push('reminder_message');
  }

  const hasTime = hasReminderTimeHint(normalizedTask) || Boolean(intent.entities.date || intent.entities.time);
  if (!hasTime) {
    missingInfo.push('reminder_time');
  }

  if (missingInfo.length === 0) return null;

  if (missingInfo.includes('reminder_message') && missingInfo.includes('reminder_time')) {
    return {
      question: looksLikeBareReminderRequest(normalizedTask)
        ? 'Sure — what should I remind you about?'
        : 'Sure — what should I remind you about, and when should I send it?',
      missingInfo,
      reason: looksLikeBareReminderRequest(normalizedTask) ? 'missing_message_then_time' : 'missing_message_and_time',
    };
  }

  if (missingInfo.includes('reminder_message')) {
    return {
      question: 'Sure — what should I remind you about?',
      missingInfo,
      reason: 'missing_message',
    };
  }

  return {
    question: 'Sure — when should I send the reminder?',
    missingInfo,
    reason: 'missing_time',
  };
}

function getReminderFailureClarification(
  executionLogs: ReturnType<AgentOrchestrator['getExecutionLogs']>,
  currentTask: string,
  history: { role: string; content: string }[],
  intent: ExtractedIntent,
  options?: AgentRuntimeOptions
): ReminderClarification | null {
  const latestReminderAttempt = [...executionLogs]
    .reverse()
    .find((log) => log.toolCall.name === 'set_reminder' && log.result.success === false);

  if (!latestReminderAttempt) {
    return getReminderClarification(currentTask, history, intent, options);
  }

  const error = (latestReminderAttempt.result.error ?? '').toLowerCase();
  if (error.includes('invalid arguments for set_reminder')) {
    return getReminderClarification(currentTask, history, intent, options);
  }

  if (error.includes('invalid remindatiso date')) {
    return {
      question: 'I can do that — what exact time should I use for the reminder?',
      missingInfo: ['reminder_time'],
      reason: 'invalid_time_format',
    };
  }

  if (error.includes('must be in the future')) {
    return {
      question: 'That time has already passed. What future time would you like me to use for the reminder?',
      missingInfo: ['reminder_time'],
      reason: 'time_not_in_future',
    };
  }

  return null;
}

function buildRuntimeConversationInstructions(variant: AgentRuntimeVariant): string {
  if (variant === 'v3') {
    return [
      'V3 conversation rules:',
      '- Ask exactly ONE short follow-up question at a time.',
      '- Keep visible responses under 20 words unless urgent safety advice or a tool result requires more detail.',
      '- If you still need information, reply with only the next question.',
      '- Before asking, think silently: "What is the most important missing clinical detail right now?" Then ask only that.',
      '- Never bundle multiple symptom checks into one message. Avoid phrases like "fever, vomiting, or blood in stool" in a single question.',
      '- Prefer natural wording like "Do you have a fever?" or "Any vomiting?" instead of formal checklist language.',
      '- Use this triage state order without skipping ahead: chief complaint, duration, severity, associated symptoms, risk factors, advice.',
      '- Important exception: for low-risk, common symptoms, once chief complaint, duration, and severity are clear, you may stop intake and give practical advice with red flags.',
      '- Once the chief complaint is clear, branch into symptom-specific follow-up questions instead of generic intake.',
      '- Example branch for diarrhea: ask frequency, dehydration, food exposure, sick contacts, and blood in stool one at a time.',
      '- For diarrhea or vomiting, actively check dehydration with one question such as "Are you able to drink fluids?".',
      '- For identity or names, never assert who the user is. Ask permission, for example: "I can call you Praxis if that\'s okay?".',
      '- Do NOT give advice, explanations, or lists until you have enough information.',
      '- When you do give advice, make it personalized: say the likely category (for example stomach infection or food poisoning), the home-care step, and the exact red flags that change urgency.',
      '- Map mild symptoms to home care, moderate symptoms to caution with close follow-up, and severe or high-risk symptoms to urgent escalation.',
      '- Sound like a calm Ugandan doctor: short, clear, human, and curious.',
      '- If urgent symptoms appear, stop questioning and escalate immediately.'
    ].join('\n');
  }

  return '';
}

function buildCurrentDateTimePayload(timezone: string, countryCode: string) {
  const now = new Date();
  const resolvedTimezone = timezone.trim() || 'UTC';
  const resolvedCountryCode = countryCode.trim().toUpperCase() || 'US';
  const localNow = new Intl.DateTimeFormat('en-GB', {
    timeZone: resolvedTimezone,
    dateStyle: 'full',
    timeStyle: 'long',
  }).format(now);
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: resolvedTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const localTime = new Intl.DateTimeFormat('en-US', {
    timeZone: resolvedTimezone,
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(now);
  const localNowIso = new Intl.DateTimeFormat('sv-SE', {
    timeZone: resolvedTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(now).replace(' ', 'T');

  return {
    timezone: resolvedTimezone,
    countryCode: resolvedCountryCode,
    localNow,
    localDate,
    localTime,
    localNowIso,
    unixMs: now.getTime(),
  };
}


async function runAgentRuntime(
  tenantId: string,
  history: { role: string; content: string; imageUrls?: string[] }[],
  options: AgentRuntimeOptions | undefined,
  variant: AgentRuntimeVariant
): Promise<AgentResult> {
  try {
    const lastUserMessage = history.filter((m) => m.role === 'user').pop()?.content ?? '';
    logAgentFlow(variant, 'start', {
      tenantId,
      conversationId: options?.conversationId ?? null,
      userId: options?.userId ?? null,
      channel: options?.channel ?? 'widget',
      messageCount: history.length,
      lastUserMessage,
    });

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
    // STEP 1: DECOMPOSITION (Decomposer layer)
    // ========================================================================
    const decomposition = await decomposeQuestion(model, lastUserMessage, history, {
      tenantId,
      userId: options?.userId,
      conversationId: options?.conversationId,
      modelName: config.model,
    });
    
    // If complex, we handle the first part and inform the user about the rest
    // This prevents the agent from getting lost in multi-part questions
    let currentTask = lastUserMessage;
    let decompositionNote = '';
    if (decomposition.isComplex && decomposition.subQuestions.length > 1) {
      currentTask = decomposition.subQuestions[0];
      decompositionNote = `[Decomposer] Handling first part: "${currentTask}". Remaining: ${decomposition.subQuestions.slice(1).join(', ')}`;
      console.log(decompositionNote);
    }
    logAgentFlow(variant, 'decomposition', {
      isComplex: decomposition.isComplex,
      currentTask,
      subQuestions: decomposition.subQuestions,
      reasoning: decomposition.reasoning,
    });

    // ========================================================================
    // STEP 1.1: INTENT EXTRACTION (LLM suggests)
    // ========================================================================
    const intent = await extractIntent(model, currentTask, history, {
      tenantId,
      userId: options?.userId,
      conversationId: options?.conversationId,
      modelName: config.model,
    });
    const wantsHumanHandoff = intent.intent === 'request_human';
    logAgentFlow(variant, 'intent', {
      intent: intent.intent,
      entities: intent.entities,
      currentTask,
      wantsHumanHandoff,
    });

    const reminderClarification = getReminderClarification(currentTask, history, intent, options);
    if (reminderClarification) {
      logAgentFlow(variant, 'planning', {
        action: 'reminder_missing_info',
        currentTask,
        missingInfo: reminderClarification.missingInfo,
        reason: reminderClarification.reason,
      });
      return {
        text: reminderClarification.question,
        needsInfo: true,
        missingInfo: reminderClarification.missingInfo,
      };
    }

    // Early exit for human handoff
    if (wantsHumanHandoff) {
      logAgentFlow(variant, 'handoff', {
        reason: 'intent_requested_human',
      });
      return {
        text: "I've requested that a care team member join this chat. They'll be with you shortly—please stay on this page.\n\nIf your need is urgent, please call your care team or 911 in an emergency.",
        requestHandoff: true,
      };
    }

    // ========================================================================
    // STEP 1.5: PLANNING DECISION (Planner agent decides if planning needed)
    // ========================================================================
    const memory = await buildAgentContext(tenantId, options?.conversationId, history, [], undefined, 3, options?.userId);
    let executionPlan: ExecutionPlan | null = memory.structuredState.activePlan || null;
    logAgentFlow(variant, 'memory', {
      hasActivePlan: !!executionPlan,
      activePlanId: executionPlan?.planId ?? null,
      structuredStateKeys: Object.keys(memory.structuredState ?? {}),
    });

    // Handle confirmation intent
    if (intent.intent === 'confirm_action' && executionPlan && executionPlan.status === 'awaiting_confirmation') {
      const stepToConfirm = executionPlan.steps.find(s => s.status === 'awaiting_confirmation');
      if (stepToConfirm) {
        executionPlan = confirmStep(executionPlan, stepToConfirm.stepNumber);
        // Update plan in database
        if (options?.conversationId) {
          await db.collection('execution_plans').doc(executionPlan.planId).update({
            steps: executionPlan.steps,
            status: executionPlan.status,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }
    }

    const planningDecision = await decideIfNeedsPlanning(model, intent, currentTask, history, {
      tenantId,
      userId: options?.userId,
      conversationId: options?.conversationId,
      modelName: config.model,
    });
    logAgentFlow(variant, 'planning', {
      decision: planningDecision,
      existingPlanId: executionPlan?.planId ?? null,
    });

    let persistedV3TriageState = createDefaultTriageState();
    if (variant === 'v3' && options?.conversationId) {
      try {
        const conversationDoc = await db.collection('conversations').doc(options.conversationId).get();
        persistedV3TriageState = prepareV3TriageState(history, normalizeTriageState(conversationDoc.data()?.v3TriageState));
        logAgentFlow(variant, 'triage_state', {
          source: 'loaded',
          currentState: persistedV3TriageState.currentState,
          askedStates: persistedV3TriageState.askedStates,
          answeredStates: persistedV3TriageState.answeredStates,
          symptomSummary: persistedV3TriageState.symptomSummary ?? null,
        });
      } catch (e) {
        console.warn('[Agent V3] Failed to load persisted triage state:', e);
        persistedV3TriageState = prepareV3TriageState(history, createDefaultTriageState());
        logAgentFlow(variant, 'triage_state', {
          source: 'fallback_after_load_error',
          currentState: persistedV3TriageState.currentState,
          askedStates: persistedV3TriageState.askedStates,
          answeredStates: persistedV3TriageState.answeredStates,
        });
      }
    }

    // Guardrail: drop stale active plans when the user switches to normal conversation.
    // Without this, the agent can keep executing an old plan and repeat previous answers
    // even when the latest user turn is a greeting or unrelated follow-up.
    const isLikelyGreetingTurn = /\b(hi|hello|hey|good\s+(morning|afternoon|evening)|how are you|what'?s up)\b/i.test(lastUserMessage);
    const shouldIgnoreActivePlan =
      executionPlan
      && intent.intent !== 'confirm_action'
      && (intent.intent === 'general_conversation' || (intent.intent === 'query_information' && isLikelyGreetingTurn));

    if (shouldIgnoreActivePlan) {
      logAgentFlow(variant, 'planning', {
        action: 'discard_stale_plan',
        ignoredPlanId: executionPlan?.planId ?? null,
        intent: intent.intent,
        isLikelyGreetingTurn,
      });
      executionPlan = null;
    }

    // Create plan if needed and no active plan exists
    if (planningDecision.needsPlanning && !executionPlan) {
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
      if (config.xPersonProfileEnabled) {
        availableTools.push('patient_profile');
      }
      if (options?.channel === 'whatsapp' || options?.channel === 'whatsapp_meta') {
        availableTools.push('set_reminder', 'list_user_reminders', 'get_upcoming_reminders', 'edit_reminder', 'delete_reminder');
      }

      executionPlan = await createExecutionPlan(
        model,
        intent,
        currentTask,
        history,
        availableTools,
        {
          tenantId,
          userId: options?.userId,
          conversationId: options?.conversationId,
          modelName: config.model,
        }
      );
      logAgentFlow(variant, 'planning', {
        action: 'created_plan',
        planId: executionPlan.planId,
        status: executionPlan.status,
        stepCount: executionPlan.steps.length,
        steps: executionPlan.steps.map((step) => ({
          stepNumber: step.stepNumber,
          description: step.description,
          toolName: step.toolName ?? null,
          status: step.status,
        })),
      });

      // Save new plan to database
      if (options?.conversationId) {
        await db.collection('execution_plans').doc(executionPlan.planId).set({
          ...executionPlan,
          tenantId,
          conversationId: options.conversationId,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      // If plan needs info, ask user
      if (planNeedsInfo(executionPlan)) {
        logAgentFlow(variant, 'planning', {
          action: 'plan_needs_info',
          planId: executionPlan.planId,
          missingInfo: executionPlan.missingInfo,
        });
        const question = await formatMissingInfoQuestion(
          model,
          executionPlan.missingInfo,
          `User wants to: ${intent.intent}. ${executionPlan.description}`,
          {
            tenantId,
            userId: options?.userId,
            conversationId: options?.conversationId,
            modelName: config.model,
          }
        );
        return {
          text: question,
          needsInfo: true,
          missingInfo: executionPlan.missingInfo,
          planStatus: executionPlan.status,
        };
      }

      // If plan is awaiting confirmation, ask user
      if (executionPlan.status === 'awaiting_confirmation') {
        const stepToConfirm = executionPlan.steps.find(s => s.status === 'awaiting_confirmation');
        if (stepToConfirm) {
          logAgentFlow(variant, 'planning', {
            action: 'awaiting_confirmation',
            planId: executionPlan.planId,
            stepNumber: stepToConfirm.stepNumber,
            description: stepToConfirm.description,
          });
          const question = await formatConfirmationQuestion(
            model,
            stepToConfirm,
            `User wants to: ${intent.intent}. ${executionPlan.description}`,
            {
              tenantId,
              userId: options?.userId,
              conversationId: options?.conversationId,
              modelName: config.model,
            }
          );
          return {
            text: question,
            planStatus: executionPlan.status,
          };
        }
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
      3, // Max 3 RAG chunks
      options?.userId
    );
    logAgentFlow(variant, 'context', {
      trimmedRecentMessageCount: trimmedMemory.recentMessages.length,
      ragEnabled: config.ragEnabled,
      hasRagContext: !!ragContext,
      executionLogCount: executionLogs.length,
      hasConversationSummary: !!agentContext.conversationMemory.summary,
    });

    // ========================================================================
    // STEP 4: BUILD SYSTEM PROMPT (Optimized context)
    // ========================================================================
    const nameInstruction = `Your name is ${config.agentName}. Always use this name when greeting or introducing yourself.`;
    const contextSection = formatContextForPrompt(agentContext);
    
    let reminderSnapshotContext = '';
    const shouldPreloadReminders =
      (options?.channel === 'whatsapp' || options?.channel === 'whatsapp_meta')
      && !!options?.externalUserId
      && REMINDER_RELATED_TURN_REGEX.test(currentTask);
    if (shouldPreloadReminders && options?.externalUserId) {
      try {
        const upcomingReminders = await listUserReminders({
          tenantId,
          externalUserId: options.externalUserId,
          upcomingOnly: true,
          limit: 10,
        });
        reminderSnapshotContext = `\nUpcoming reminders for this WhatsApp user (tenant-scoped lookup, safe fields only): ${JSON.stringify(upcomingReminders)}\n`;
      } catch (e) {
        console.warn('[Agent V2] Reminder preload failed:', e);
      }
    }

    const currentProfile = config.xPersonProfileEnabled
      ? await getXPersonProfile({
          tenantId,
          userId: options?.userId,
          externalUserId: options?.externalUserId,
          conversationId: options?.conversationId,
        })
      : null;

    const runtimeConversationInstructions = buildRuntimeConversationInstructions(variant);
    const v3StateInstruction = variant === 'v3'
      ? `Backend triage state (authoritative, persisted): current=${persistedV3TriageState.currentState}; answered=${persistedV3TriageState.answeredStates.map((state) => TRIAGE_STATE_LABELS[state]).join(', ') || 'none'}; asked=${persistedV3TriageState.askedStates.map((state) => TRIAGE_STATE_LABELS[state]).join(', ') || 'none'}; symptom_summary=${persistedV3TriageState.symptomSummary ?? 'unknown'}. You MUST respect this backend state. Do not re-ask any answered state. Ask only for the current backend state unless urgent escalation is needed. If the current state is advice, stop asking intake questions and give advice. When backend state is advice after only chief complaint + duration + severity, that is intentional for low-risk/common symptoms: give concise home-care advice plus the exact red flags and when to seek in-person care instead of asking more checklist questions.`
      : '';

    let systemContent = `${nameInstruction}\n\n${config.systemPrompt}\n\n${contextSection}\n${reminderSnapshotContext}\n`;
    if (runtimeConversationInstructions) {
      systemContent += `${runtimeConversationInstructions}\n\n`;
    }
    if (v3StateInstruction) {
      systemContent += `${v3StateInstruction}\n\n`;
    }
    if (options?.conversationLanguageCode && options?.conversationLanguageName) {
      systemContent += `Conversation language flag: ${options.conversationLanguageName} (${options.conversationLanguageCode}). Reply in natural ${options.conversationLanguageName} unless the user explicitly asks to switch languages.\n\n`;
    }
    systemContent += `Time handling rules:\n- The tenant-configured timezone in Agent Settings is authoritative.\n- Never guess or invent the current date/time.\n- Before you mention the current time, compare a requested reminder time to now, or interpret words like today/tonight/this afternoon using the current clock, call get_current_datetime first.\n- Use get_current_datetime output as the source of truth for reminder timing language.\n\n`;

    // Add tool instructions
    systemContent += `CRITICAL RULES:
1. CONSISTENCY IS TOP PRIORITY: Before answering availability or confirming bookings, ALWAYS check the "Existing notes in this conversation" section. If a booking is mentioned in the notes, it is REAL and must be respected.
2. TOOL EXECUTION IS MANDATORY: You are NOT allowed to confirm a booking, update, or deletion in your response unless you have JUST received a successful tool result (success=true) in the current turn.
3. NO HALLUCINATIONS: If you do not call a tool, or if the tool fails, you MUST NOT tell the user the action was successful. Instead, explain the error or ask for missing information.
4. VERIFICATION: Only confirm bookings if the tool returned success=true AND verification passed.
5. Trust the database and conversation notes, not your internal memory. Always verify state from tool results and the provided notes context.\n\n`;

    if (options?.channel === 'whatsapp' || options?.channel === 'whatsapp_meta') {
      systemContent += `Reminder routing rules (WhatsApp):\n- targetType is REQUIRED for set_reminder: choose self or next_of_kin explicitly.\n- If the user says things like "remind me", "set a reminder", or "remember to remind me", help them create the reminder step-by-step.\n- If the user asks to remind someone else (next of kin / a named person), you MUST set targetType=next_of_kin.\n- If the user has not clearly provided BOTH the reminder message and the reminder time, do NOT call set_reminder yet; ask only for the single missing detail.\n- If the user gives relative reminder times such as today, tomorrow, tonight, next week, this afternoon, or in 2 hours, call get_current_datetime first, resolve the exact reminder time using the tenant Agent Settings timezone, and only then call set_reminder.\n- Never invent the current date, time, or timezone. The tenant Agent Settings timezone is authoritative.\n- Store reminder text as a clear sentence, for example "Reminder: Please take your medication".\n- When confirming a saved reminder, make the content explicit, for example "Reminder: You told me to remind you to take your medication at [time/date]".\n- For next_of_kin reminders, do not claim success unless the tool succeeds. If profile next_of_kin_phone is missing, ask the user to save it first.\n- After scheduling next_of_kin reminders, clearly tell the user they will receive a delivery update when the reminder is sent.\n\n`;
    }

    // Add RAG records if enabled
    if (config.ragEnabled) {
      const existingRecords = await listRecords(tenantId, { userId: options?.userId, externalUserId: options?.externalUserId });
      systemContent += `--- Current Auto Agent Brain records ---\n${formatExistingRecordsForPrompt(existingRecords)}\n--- End of records ---\n\n`;
      systemContent += `When the user provides information to remember:\n`;
      systemContent += `1) If it UPDATES an existing record → use request_edit_record\n`;
      systemContent += `2) If a record is obsolete → use request_delete_record\n`;
      systemContent += `3) Only use record_learned_knowledge for NEW information\n\n`;
    }

    if (config.xPersonProfileEnabled) {
      systemContent += `Patient Profile tool is enabled:
`;
      systemContent += `- Use patient_profile to query or upsert user profile data for this conversation identity.\n`;
      systemContent += `- The profile snapshot for this identity is already preloaded below; use it before asking repeated demographic questions.\n`;
      systemContent += `- If the snapshot already contains a value (for example name), do NOT claim no details are known and do NOT ask for that same value again unless the user asks to update it.\n`;
      systemContent += `- Treat profile updates as background memory work: do NOT announce that you saved, updated, captured, or recorded profile details unless the user explicitly asks about their profile or what you remembered.\n`;
      systemContent += `- Always keep name, phone, and location updated when new details are provided.\n`;
      if (config.xPersonProfileCustomFields.length > 0) {
        systemContent += `- Custom fields configured by tenant: ${config.xPersonProfileCustomFields.map((f) => f.description ? `${f.field} (${f.description})` : f.field).join(', ')}\n`;
        systemContent += `- Always keep conversation_duration_last_conversation_seconds updated from the user's latest conversation duration across widget or WhatsApp.\n`;
      } else {
        systemContent += `- Always keep conversation_duration_last_conversation_seconds updated from the user's latest conversation duration across widget or WhatsApp.\n`;
      }
      systemContent += `Current profile snapshot: ${currentProfile ? JSON.stringify(currentProfile) : 'No profile found yet for this identity.'}\n\n`;
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
    const configuredTimeContext = buildCurrentDateTimePayload(
      config.agentTimezone ?? 'UTC',
      config.agentCountryCode ?? 'US',
    );

    const getCurrentDateTimeTool = new DynamicStructuredTool({
      name: 'get_current_datetime',
      description: 'Get the current date/time using the tenant Agent Settings timezone. Always use this timezone as the source of truth for current-time answers and reminder timing.',
      schema: z.object({}),
      func: async () => JSON.stringify(
        buildCurrentDateTimePayload(
          configuredTimeContext.timezone,
          configuredTimeContext.countryCode,
        )
      ),
    });
    tools.push(getCurrentDateTimeTool);

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


    if (config.xPersonProfileEnabled) {
      const xPersonProfileTool = new DynamicStructuredTool({
        name: 'patient_profile',
        description: 'Read or upsert patient profile data for the current user identity (Patient Profile).',
        schema: z.object({
          operation: z.enum(['get', 'upsert']),
          details: z.object({
            name: z.string().optional(),
            phone: z.string().optional(),
            location: z.string().optional(),
          }).optional(),
          attributes: z.record(z.string()).optional(),
        }),
        func: async (args) => {
          if (args.operation === 'upsert' && args.details) {
            const extracted = extractDefaultProfileFields(`${args.details.name ?? ''} ${args.details.phone ?? ''} ${args.details.location ?? ''}`.trim());
            return `Patient profile upsert requested (${Object.keys(extracted).join(', ') || 'no default fields'}).`;
          }
          return 'Patient profile lookup requested.';
        },
      });
      tools.push(xPersonProfileTool);
    }

    if (options?.channel === 'whatsapp' || options?.channel === 'whatsapp_meta') {
      const setReminderTool = new DynamicStructuredTool({
        name: 'set_reminder',
        description: 'Schedule a future reminder message for WhatsApp users only after you have the reminder content and an exact datetime resolved in the tenant Agent Settings timezone.',
        schema: z.object({
          message: z.string(),
          remindAtIso: z.string().describe('Reminder datetime in ISO format. Resolve relative dates like today, tomorrow, next week, or in 2 hours using get_current_datetime and the tenant Agent Settings timezone before calling this tool.'),
          timezone: z.string().optional().describe('Optional IANA timezone, but the tenant Agent Settings timezone remains authoritative.'),
          targetType: z.enum(['self', 'next_of_kin']),
          targetExternalUserId: z.string().optional(),
        }),
        func: async () => 'Reminder scheduling requested.',
      });
      tools.push(setReminderTool);

      const listUserRemindersTool = new DynamicStructuredTool({
        name: 'list_user_reminders',
        description: 'List reminders for the current WhatsApp user. Returns safe fields only: reminderId, dueAtIso, message, status.',
        schema: z.object({
          includePast: z.boolean().optional(),
          limit: z.number().int().min(1).max(50).optional(),
        }),
        func: async () => 'Reminder listing requested.',
      });
      tools.push(listUserRemindersTool);

      const getUpcomingRemindersTool = new DynamicStructuredTool({
        name: 'get_upcoming_reminders',
        description: 'Get pending upcoming reminders for the current WhatsApp user.',
        schema: z.object({
          limit: z.number().int().min(1).max(50).optional(),
        }),
        func: async () => 'Upcoming reminder lookup requested.',
      });
      tools.push(getUpcomingRemindersTool);

      const editReminderTool = new DynamicStructuredTool({
        name: 'edit_reminder',
        description: 'Edit a pending reminder for the current WhatsApp user by reminderId.',
        schema: z.object({
          reminderId: z.string(),
          message: z.string().optional(),
          remindAtIso: z.string().optional(),
          timezone: z.string().optional(),
        }),
        func: async () => 'Reminder edit requested.',
      });
      tools.push(editReminderTool);

      const deleteReminderTool = new DynamicStructuredTool({
        name: 'delete_reminder',
        description: 'Delete (cancel) a pending reminder for the current WhatsApp user by reminderId.',
        schema: z.object({
          reminderId: z.string(),
        }),
        func: async () => 'Reminder deletion requested.',
      });
      tools.push(deleteReminderTool);
    }

    const logVitalsTool = new DynamicStructuredTool({
      name: 'logVitals',
      description: "Store a user's vital signs for health monitoring.",
      schema: z.object({
        userId: z.string(),
        type: z.enum(['temperature', 'blood_pressure', 'heart_rate', 'blood_sugar', 'oxygen', 'weight']),
        value: z.number(),
        unit: z.string().optional(),
        timestamp: z.string().optional(),
      }),
      func: async ({ userId, type, value, unit, timestamp }) => {
        const result = await logVitals({ userId, type, value, unit, timestamp });
        return JSON.stringify(result);
      },
    });
    tools.push(logVitalsTool);

    const getHealthProfileTool = new DynamicStructuredTool({
      name: 'getHealthProfile',
      description: "Retrieve a user's health profile from storage.",
      schema: z.object({
        userId: z.string(),
      }),
      func: async ({ userId }) => {
        const result = await getHealthProfile({ userId });
        return JSON.stringify(result);
      },
    });
    tools.push(getHealthProfileTool);

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
    logAgentFlow(variant, 'llm', {
      event: 'initial_response',
      toolCallCount: ((response as { tool_calls?: unknown[] }).tool_calls?.length ?? 0),
      hasText: extractTextFromResponse(response).trim().length > 0,
    });
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
            logAgentFlow(variant, 'plan_execution', {
              planId: executionPlan.planId,
              stepNumber: step.stepNumber,
              status: 'missing_info',
              missingInfo: missingFromStep,
            });
            const question = await formatMissingInfoQuestion(
              model,
              missingFromStep,
              step.description,
              {
                tenantId,
                userId: options?.userId,
                conversationId: options?.conversationId,
                modelName: config.model,
              }
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
          const toolArgs = { ...(step.toolArgs ?? {}) };
          if (step.toolName === 'set_reminder' && options?.channel) {
            toolArgs.channel = options.channel;
          }
          const toolCall: ToolCall = {
            name: step.toolName,
            args: toolArgs,
          };

          const result = await orchestrator.executeToolCall(
            toolCall,
            googleSheetsList,
            options?.conversationId,
            options?.userId,
            options?.externalUserId
          );
          logAgentFlow(variant, 'plan_execution', {
            planId: executionPlan.planId,
            stepNumber: step.stepNumber,
            toolName: step.toolName,
            toolArgs,
            success: result.success,
            verified: result.verified ?? false,
            error: result.error ?? null,
          });

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

          // Update plan in database
          if (options?.conversationId) {
            await db.collection('execution_plans').doc(executionPlan.planId).update({
              steps: executionPlan.steps,
              status: executionPlan.status,
              updatedAt: FieldValue.serverTimestamp(),
            });
          }

          // If step failed, stop execution
          if (!result.success) {
            break;
          }
        } else {
          // Step without tool - mark as completed
          logAgentFlow(variant, 'plan_execution', {
            planId: executionPlan.planId,
            stepNumber: step.stepNumber,
            status: 'completed_without_tool',
          });
          executionPlan = updatePlanWithResult(executionPlan, step.stepNumber, {
            success: true,
          });
        }
      }

      // Add plan execution results to messages and get final response
      if (planToolMessages.length > 0) {
        currentMessages = [...currentMessages, response, ...planToolMessages];
        response = await modelWithTools.invoke(currentMessages);
        logAgentFlow(variant, 'llm', {
          event: 'post_plan_execution_response',
          planId: executionPlan.planId,
          toolMessageCount: planToolMessages.length,
          toolCallCount: ((response as { tool_calls?: unknown[] }).tool_calls?.length ?? 0),
          hasText: extractTextFromResponse(response).trim().length > 0,
        });
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
        logAgentFlow(variant, 'orchestrator', {
          event: 'tool_round_start',
          round: round + 1,
          toolCalls: toolCalls.map((tc) => ({ id: tc.id, name: tc.name, args: tc.args ?? {} })),
        });

        const toolMessages: ToolMessage[] = [];
        
        for (const tc of toolCalls) {
          // Orchestrator executes deterministically
          const toolArgs = { ...(tc.args ?? {}) };
          if (tc.name === 'set_reminder' && options?.channel) {
            toolArgs.channel = options.channel;
          }
          const toolCall: ToolCall = {
            name: tc.name,
            args: toolArgs,
          };

          const result = await orchestrator.executeToolCall(
            toolCall,
            googleSheetsList,
            options?.conversationId,
            options?.userId,
            options?.externalUserId
          );
          logAgentFlow(variant, 'orchestrator', {
            event: 'tool_call_result',
            round: round + 1,
            toolName: tc.name,
            toolArgs,
            success: result.success,
            verified: result.verified ?? false,
            error: result.error ?? null,
          });

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
        logAgentFlow(variant, 'llm', {
          event: 'tool_round_response',
          round: round + 1,
          toolMessageCount: toolMessages.length,
          toolCallCount: ((response as { tool_calls?: unknown[] }).tool_calls?.length ?? 0),
          hasText: extractTextFromResponse(response).trim().length > 0,
        });
        
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
          logAgentFlow(variant, 'retry', {
            action: 'created_recovery_plan',
            planId: recoveryPlan.planId,
            cause: analysis.cause,
            suggestedAction: analysis.suggestedAction,
          });
        }
      }

      // Retry based on analysis
      let retryAttempted = false;
      
      if (analysis.suggestedAction === 'retry_simple' || analysis.suggestedAction === 'retry_with_context') {
        retryAttempted = true;
        console.log(`[Agent V2] Attempting intelligent retry with strategy: ${analysis.suggestedAction}`);
        logAgentFlow(variant, 'retry', {
          action: 'attempt',
          cause: analysis.cause,
          suggestedAction: analysis.suggestedAction,
          retryStrategy: analysis.retryStrategy ?? null,
        });
        
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
              variant === 'v3'
                ? 'You are a clinical triage assistant. Ask exactly one short, natural question. Never combine multiple checks in one question unless urgent safety advice is required.'
                : (`You are a helpful assistant. Provide clear, concise responses. ` +
                  `If you executed tools, summarize what was done and the results.`)
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
              ? (variant === 'v3'
                ? `You executed tools but gave no text. Reply briefly. If more info is needed, ask exactly one short next question and make it the single most important missing clinical detail.`
                : `You executed tools but didn't provide a text response. Please summarize what was done based on the tool results above and provide a helpful response to the user.`)
              : (variant === 'v3'
                ? `Reply briefly. Ask exactly one short, natural next question unless urgent safety advice is needed. Do not combine multiple symptom checks.`
                : `Please provide a clear response to the user. If tools were executed, summarize the results.`),
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
            logAgentFlow(variant, 'retry', {
              action: 'success',
              suggestedAction: analysis.suggestedAction,
            });
          } else {
            console.warn(`[Agent V2] Retry still produced empty response`);
            logAgentFlow(variant, 'retry', {
              action: 'empty_after_retry',
              suggestedAction: analysis.suggestedAction,
            });
          }
        } catch (e) {
          console.error(`[Agent V2] Retry failed:`, e);
          logAgentFlow(variant, 'retry', {
            action: 'failure',
            suggestedAction: analysis.suggestedAction,
            error: e instanceof Error ? e.message : String(e),
          });
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
    const reminderFailureClarification = getReminderFailureClarification(
      executionLogsFinal,
      currentTask,
      history,
      intent,
      options
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
    if (reminderFailureClarification) {
      const reminderAttemptFailed = executionLogsFinal.some(
        (log) => log.toolCall.name === 'set_reminder' && log.result.success === false
      );
      const soundsLikeReminderFailure = /\b(?:cannot|can't|unable|failed|could not|couldn't)\b.*\b(?:remind|reminder)\b/i.test(text);
      if (reminderAttemptFailed || soundsLikeReminderFailure) {
        logAgentFlow(variant, 'validation', {
          action: 'override_reminder_failure_with_clarification',
          missingInfo: reminderFailureClarification.missingInfo,
          reason: reminderFailureClarification.reason,
        });
        text = reminderFailureClarification.question;
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
    logAgentFlow(variant, 'validation', {
      executionLogCount: executionLogsFinal.length,
      verifiedBookingCount: verifiedBookings.length,
      requestHandoffCandidate: requestHandoff,
    });

    // ========================================================================
    // STEP 11: RECORD USAGE
    // ========================================================================
    try {
      await recordUsage(config.model, accumulatedUsage, { tenantId, userId: options?.userId, conversationId: options?.conversationId, usageType: 'conversation.reply.v2' });
    } catch (e) {
      console.error('Failed to record usage:', e);
    }

    const finalText = textWithoutMarker || 'I could not generate a response. Please try rephrasing.';

    if (variant === 'v3' && options?.conversationId) {
      try {
        const nextPersistedState = buildPersistedV3StateAfterResponse(persistedV3TriageState, finalText);
        await db.collection('conversations').doc(options.conversationId).set({
          v3TriageState: nextPersistedState,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        logAgentFlow(variant, 'triage_state', {
          source: 'persisted_after_response',
          currentState: nextPersistedState.currentState,
          askedStates: nextPersistedState.askedStates,
          answeredStates: nextPersistedState.answeredStates,
          lastQuestion: nextPersistedState.lastQuestion ?? null,
        });
      } catch (e) {
        console.warn('[Agent V3] Failed to persist triage state:', e);
      }
    }

    const finalResult: AgentResult = {
      text: finalText,
      requestHandoff,
    };

    if (reminderFailureClarification) {
      finalResult.needsInfo = true;
      finalResult.missingInfo = reminderFailureClarification.missingInfo;
    }

    // Include plan status if we have a plan
    if (executionPlan) {
      finalResult.planStatus = executionPlan.status;
      
      // If plan needs info, include it
      if (planNeedsInfo(executionPlan)) {
        finalResult.needsInfo = true;
        finalResult.missingInfo = executionPlan.missingInfo;
      }
    }

    logAgentFlow(variant, 'complete', {
      requestHandoff,
      planStatus: finalResult.planStatus ?? null,
      needsInfo: finalResult.needsInfo ?? false,
      finalText,
    });

    return finalResult;
  } catch (e) {
    logAgentFlow(variant, 'error', {
      error: e instanceof Error ? e.message : String(e),
    });
    console.error('[Agent V2] Error:', e);
    throw e;
  }
}

export async function runAgentV2(
  tenantId: string,
  history: { role: string; content: string; imageUrls?: string[] }[],
  options?: AgentRuntimeOptions
): Promise<AgentResult> {
  return runAgentRuntime(tenantId, history, options, 'v2');
}

export async function runAgentV3(
  tenantId: string,
  history: { role: string; content: string; imageUrls?: string[] }[],
  options?: AgentRuntimeOptions
): Promise<AgentResult> {
  return runAgentRuntime(tenantId, history, options, 'v3');
}
