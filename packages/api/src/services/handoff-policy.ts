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

const MENTAL_HEALTH_DISTRESS_PATTERNS = [
  /\b(?:depress(?:ed|ion)?|hopeless|overwhelmed|panic(?:king)?|anxious|anxiety|sad(?:ness)?|can't\s+cope|cannot\s+cope)\b/i,
  /\b(?:self[-\s]?harm|hurt\s+myself|end\s+my\s+life|suicid(?:al|e))\b/i,
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

type QuickHelpRule = {
  pattern: RegExp;
  advice: string;
  followUp: string;
};

const QUICK_HELP_RULES: QuickHelpRule[] = [
  {
    pattern: /\b(?:severe|heavy)\s+bleeding|bleeding\s+heavily\b/i,
    advice:
      'Apply firm, direct pressure with a clean cloth and keep pressure on continuously. If bleeding does not stop quickly, call 911 now.',
    followUp: 'Where is the bleeding and how long has it been ongoing?',
  },
  {
    pattern: /\bchest\s+pain|pressure\s+in\s+chest\b/i,
    advice:
      'Call 911 now, especially if pain is severe, spreading, or comes with shortness of breath, nausea, or sweating. Rest while waiting for help.',
    followUp: 'Did the chest pain start suddenly, and do you also feel short of breath?',
  },
  {
    pattern: /\bshortness\s+of\s+breath|difficulty\s+breathing|can(?:not|\'?t)\s+breathe\b/i,
    advice:
      'If breathing is severe or worsening, call 911 now. Sit upright, loosen tight clothing, and avoid lying flat.',
    followUp: 'Are you able to speak in full sentences right now?',
  },
  {
    pattern: /\bstroke|face\s+droop|slurred\s+speech|one\s+side\s+weak\b/i,
    advice:
      'Call 911 now for possible stroke symptoms. Note the exact time symptoms started and do not drive yourself.',
    followUp: 'What time did these symptoms first begin?',
  },
  {
    pattern: /\bseizure|convulsion\b/i,
    advice:
      'Protect from injury by clearing nearby objects and turning the person onto their side once possible. Call 911 if seizure lasts more than 5 minutes, repeats, or injury occurs.',
    followUp: 'How long has the seizure lasted, and is the person awake now?',
  },
  {
    pattern: /\bfaint(?:ed|ing)?|passed?\s+out\b/i,
    advice:
      'Lay the person flat and raise legs if possible. Call 911 if they do not wake quickly, have chest pain, trouble breathing, or were injured.',
    followUp: 'Did they fully wake up, and are they breathing normally?',
  },
];

export function isExplicitHumanRequest(text: string | undefined): boolean {
  if (typeof text !== 'string' || !text.trim()) return false;
  return EXPLICIT_HUMAN_REQUEST_PATTERNS.some((pattern) => pattern.test(text));
}

export function isUrgentHandoffSituation(text: string | undefined): boolean {
  if (typeof text !== 'string' || !text.trim()) return false;
  return URGENT_HANDOFF_PATTERNS.some((pattern) => pattern.test(text));
}

export function isMentalHealthDistress(text: string | undefined): boolean {
  if (typeof text !== 'string' || !text.trim()) return false;
  return MENTAL_HEALTH_DISTRESS_PATTERNS.some((pattern) => pattern.test(text));
}

export function buildHandoffMessage(userText: string | undefined): string {
  const mentalHealthDistress = isMentalHealthDistress(userText);
  const normalizedText = typeof userText === 'string' ? userText.trim() : '';
  const matchedRule = QUICK_HELP_RULES.find((rule) => rule.pattern.test(normalizedText));

  if (mentalHealthDistress) {
    return `I've requested that a care team member join this chat. They'll be with you shortly—please stay on this page.

Quick help right now: I’m really glad you reached out. If you might act on thoughts of self-harm or feel unsafe, call or text 988 now. If you can, stay with a trusted person and remove anything you could use to hurt yourself.

While you wait, I can stay with you and keep helping here. ${normalizedText ? 'Based on what you shared, ' : ''}${matchedRule?.advice ?? 'If you feel in immediate danger, call 911 now.'}

To help right now: ${matchedRule?.followUp ?? 'Can you tell me the main symptom that feels most urgent right now?'}

If your need is urgent, please call your care team or 911 in an emergency.`;
  }

  return `I've requested that a care team member join this chat. They'll be with you shortly—please stay on this page.

Quick help right now: ${matchedRule?.advice ?? 'If there is severe bleeding, apply firm direct pressure with a clean cloth. If there is chest pain, severe breathing trouble, fainting, seizures, or stroke signs, call 911 now. If this is a mental health crisis or you may act on self-harm thoughts, call or text 988 now and stay with a trusted person.'}

While you wait, I can keep helping you in this chat with next steps based on your symptoms.

To help right now: ${matchedRule?.followUp ?? 'What symptom worries you most at this moment, and when did it begin?'}

If your need is urgent, please call your care team or 911 in an emergency.`;
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
