import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';

type SeverityLevel = 'mild' | 'moderate' | 'severe' | 'critical' | 'unknown';
type TriageOutcome = 'home_care' | 'monitor' | 'clinic_visit' | 'escalate' | 'unknown';

const PRIMARY_SYMPTOM_KEYWORDS = [
  'nasal congestion', 'runny nose', 'cough', 'fever', 'sore throat', 'headache',
  'back pain', 'chest pain', 'abdominal pain', 'nausea', 'vomiting', 'diarrhea',
];

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function parseSeverity(text: string): SeverityLevel {
  const lower = text.toLowerCase();
  if (/\bcritical|unconscious|not breathing\b/.test(lower)) return 'critical';
  if (/\bsevere|worst|extreme|very bad\b/.test(lower)) return 'severe';
  if (/\bmoderate|getting worse|persistent\b/.test(lower)) return 'moderate';
  if (/\bmild|slight\b/.test(lower)) return 'mild';
  return 'unknown';
}

function parseSymptomDuration(text: string): string | null {
  const tagged = text.match(/\bsymptom_duration\s*:\s*([^\n,.]+)/i);
  if (tagged?.[1]) return normalizeText(tagged[1]);
  const duration = text.match(/\b(\d+\s*(?:hour|hours|day|days|week|weeks|month|months|year|years))\b/i);
  return duration?.[1] ? normalizeText(duration[1]) : null;
}

function parsePrimarySymptom(text: string): string | null {
  const tagged = text.match(/\bprimary_symptom\s*:\s*([^\n,.]+)/i);
  if (tagged?.[1]) return normalizeText(tagged[1]).toLowerCase();
  const lower = text.toLowerCase();
  const found = PRIMARY_SYMPTOM_KEYWORDS.find((symptom) => lower.includes(symptom));
  return found ?? null;
}

function parseRedFlags(text: string): string[] {
  const tagged = text.match(/\bred_flags?\s*:\s*([^\n]+)/i);
  if (tagged?.[1]) {
    return tagged[1]
      .split(/,|;/)
      .map((value) => normalizeText(value).toLowerCase())
      .filter(Boolean);
  }
  const lower = text.toLowerCase();
  const flags: string[] = [];
  if (/\bchest pain\b/.test(lower)) flags.push('chest pain');
  if (/\bshortness of breath|cannot breathe|can\'t breathe\b/.test(lower)) flags.push('difficulty breathing');
  if (/\bunconscious|fainting|seizure\b/.test(lower)) flags.push('neurologic emergency');
  return flags.length > 0 ? flags : ['none'];
}

function parseTriageOutcome(text: string, severity: SeverityLevel): TriageOutcome {
  const tagged = text.match(/\btriage_outcome\s*:\s*([^\n,.]+)/i)?.[1]?.toLowerCase().trim();
  if (tagged === 'home_care' || tagged === 'monitor' || tagged === 'clinic_visit' || tagged === 'escalate') return tagged;
  const lower = text.toLowerCase();
  if (/\bgo to (the )?(clinic|hospital)|seek urgent care|emergency\b/.test(lower)) return 'escalate';
  if (severity === 'mild' && /\brest|hydration|home care|self care\b/.test(lower)) return 'home_care';
  if (severity === 'moderate') return 'monitor';
  if (severity === 'severe' || severity === 'critical') return 'escalate';
  return 'unknown';
}

export async function upsertConversationClinicalAnalytics(params: {
  tenantId: string;
  conversationId: string;
  userId?: string;
  externalUserId?: string;
  text: string;
  source: 'widget' | 'whatsapp' | 'whatsapp_meta' | 'other';
}): Promise<{ primarySymptom: string; symptomDuration: string | null; severity: SeverityLevel; triageOutcome: TriageOutcome; redFlags: string[] } | null> {
  const text = normalizeText(params.text);
  if (!text) return null;

  const severity = parseSeverity(text);
  const primarySymptom = parsePrimarySymptom(text);
  if (!primarySymptom) return null;
  const symptomDuration = parseSymptomDuration(text);
  const redFlags = parseRedFlags(text);
  const triageOutcome = parseTriageOutcome(text, severity);

  const dayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const docId = `${params.tenantId}__${params.conversationId}`;
  await db.collection('conversation_clinical_analytics').doc(docId).set({
    tenantId: params.tenantId,
    conversationId: params.conversationId,
    userId: params.userId ?? null,
    externalUserId: params.externalUserId ?? null,
    source: params.source,
    dayKey,
    symptomDuration: symptomDuration ?? null,
    severity,
    primarySymptom,
    redFlags,
    triageOutcome,
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { primarySymptom, symptomDuration, severity, triageOutcome, redFlags };
}

export async function buildNightlyClinicalAnalyticsSummary(params: {
  tenantId: string;
  dayKey?: string;
}): Promise<{ dayKey: string; conversationCount: number }> {
  const dayKey = params.dayKey ?? new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() - 24 * 60 * 60 * 1000));

  const snap = await db.collection('conversation_clinical_analytics')
    .where('tenantId', '==', params.tenantId)
    .where('dayKey', '==', dayKey)
    .get();

  const symptomCounts = new Map<string, number>();
  const outcomeCounts = new Map<string, number>();
  for (const doc of snap.docs) {
    const data = doc.data();
    const symptom = typeof data.primarySymptom === 'string' ? data.primarySymptom.trim().toLowerCase() : '';
    if (symptom) symptomCounts.set(symptom, (symptomCounts.get(symptom) ?? 0) + 1);
    const outcome = typeof data.triageOutcome === 'string' ? data.triageOutcome.trim().toLowerCase() : 'unknown';
    outcomeCounts.set(outcome, (outcomeCounts.get(outcome) ?? 0) + 1);
  }

  await db.collection('clinical_analytics_daily').doc(`${params.tenantId}__${dayKey}`).set({
    tenantId: params.tenantId,
    dayKey,
    conversationCount: snap.size,
    topSymptoms: Array.from(symptomCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([symptom, count]) => ({ symptom, count })),
    triageOutcomes: Array.from(outcomeCounts.entries()).sort((a, b) => b[1] - a[1]).map(([outcome, count]) => ({ outcome, count })),
    generatedAt: Timestamp.fromDate(new Date()),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { dayKey, conversationCount: snap.size };
}
