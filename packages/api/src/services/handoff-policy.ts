const EXPLICIT_HUMAN_REQUEST_PATTERNS = [
  /\b(?:i\s+want|i\s+need|can\s+you|could\s+you|please|let\s+me|get\s+me|connect\s+me|transfer\s+me|hand\s+me\s+off)\b[\s\S]{0,80}\b(?:human|real\s+person|live\s+agent|person|agent|representative|care\s+team|staff|someone)\b/i,
  /\b(?:talk|speak|connect|transfer)\s+(?:me\s+)?(?:to|with)\s+(?:a\s+)?(?:human|real\s+person|live\s+agent|person|agent|representative|care\s+team|staff|someone)\b/i,
  /\b(?:not\s+a\s+bot|real\s+human|actual\s+person|live\s+person|human\s+please)\b/i,
];

const URGENT_HANDOFF_PATTERNS = [
  /\b(?:urgent|emergency|immediately|right\s+away|asap)\b/i,
  /\b(?:chest\s+pain|shortness\s+of\s+breath|difficulty\s+breathing|can(?:not|'?t)\s+breathe|stroke|seizure|passed?\s+out|faint(?:ing|ed)?|heavy\s+bleeding|bleeding\s+heavily|suicidal|overdose|anaphylaxis)\b/i,
  /\b(?:need\s+help\s+now|need\s+someone\s+now|someone\s+right\s+now)\b/i,
];

/**
 * Immediate emergency signals should bypass triage and trigger an instant
 * human handoff + emergency instruction message.
 *
 * Keep this narrower than URGENT_HANDOFF_PATTERNS so high-risk symptoms
 * (for example "chest pain") can still get at least a brief triage check first.
 */
const IMMEDIATE_EMERGENCY_HANDOFF_PATTERNS = [
  /\b(?:emergency|call\s+911|ambulance)\b/i,
  /\b(?:can(?:not|'?t)\s+breathe|not\s+breathing|struggling\s+to\s+breathe)\b/i,
  /\b(?:unconscious|not\s+responsive|passed?\s+out|faint(?:ing|ed)?)\b/i,
  /\b(?:heavy\s+bleeding|bleeding\s+heavily|won'?t\s+stop\s+bleeding)\b/i,
  /\b(?:seizure|convulsion)\b/i,
  /\b(?:suicidal|want\s+to\s+die|kill\s+myself|overdose|anaphylaxis)\b/i,
];

const UNHELPFUL_ASSISTANT_PATTERNS = [
  "i'm not sure",
  'i am not sure',
  "i can't",
  'i cannot',
  "i don't have",
  'i do not have',
  'rephrase',
  'contact your doctor',
  'speak with a doctor',
  'recommend speaking',
  'recommend talking',
  'cannot diagnose',
  "can't diagnose",
  'beyond my',
  'outside my',
  'outside of my',
  'not able to help',
  'unable to help',
  "don't have enough",
  'do not have enough',
];

export function isExplicitHumanRequest(text: string | undefined): boolean {
  if (typeof text !== 'string' || !text.trim()) return false;
  return EXPLICIT_HUMAN_REQUEST_PATTERNS.some((pattern) => pattern.test(text));
}

export function isUrgentHandoffSituation(text: string | undefined): boolean {
  if (typeof text !== 'string' || !text.trim()) return false;
  return URGENT_HANDOFF_PATTERNS.some((pattern) => pattern.test(text));
}

export function isImmediateEmergencyHandoffSituation(text: string | undefined): boolean {
  if (typeof text !== 'string' || !text.trim()) return false;
  return IMMEDIATE_EMERGENCY_HANDOFF_PATTERNS.some((pattern) => pattern.test(text));
}

export function isUnhelpfulAssistantReply(text: string | undefined): boolean {
  if (typeof text !== 'string' || !text.trim()) return false;
  const normalized = text.toLowerCase();
  return UNHELPFUL_ASSISTANT_PATTERNS.some((phrase) => normalized.includes(phrase));
}

export function countRecentUnresolvedUserTurns(history: Array<{ role: string; content: string }>): number {
  let consecutiveUserTurns = 0;
  let sawUnhelpfulAssistant = false;

  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    if (!message?.content?.trim()) continue;

    if (message.role === 'user') {
      consecutiveUserTurns += 1;
      continue;
    }

    if (message.role !== 'assistant') {
      continue;
    }

    if (isUnhelpfulAssistantReply(message.content)) {
      sawUnhelpfulAssistant = true;
      continue;
    }

    break;
  }

  return sawUnhelpfulAssistant ? consecutiveUserTurns : 0;
}

export function shouldTriggerRepeatedFailureHandoff(
  history: Array<{ role: string; content: string }>,
  minimumTurns = 3
): boolean {
  return countRecentUnresolvedUserTurns(history) >= minimumTurns;
}
