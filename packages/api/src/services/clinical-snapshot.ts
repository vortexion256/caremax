import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';

type ClinicalSnapshotParams = {
  tenantId: string;
  conversationId: string;
  userId?: string;
  externalUserId?: string;
  text: string;
  source: 'widget' | 'whatsapp' | 'whatsapp_meta' | 'other';
};

type ClinicalSnapshot = {
  symptoms: string[];
  severity?: 'mild' | 'moderate' | 'severe' | 'critical';
  duration?: string;
  cause?: string;
  bodyPart?: string;
  riskLevel?: 'low' | 'medium' | 'high';
  smartTags: string[];
};

const SYMPTOM_KEYWORDS = [
  'headache', 'fever', 'cough', 'sore throat', 'joint pain', 'swelling', 'chest pain', 'shortness of breath',
  'vomiting', 'diarrhea', 'dizziness', 'abdominal pain', 'back pain', 'bleeding', 'rash', 'fatigue',
];

const BODY_PART_KEYWORDS = [
  'head', 'chest', 'abdomen', 'stomach', 'back', 'knee', 'leg', 'arm', 'neck', 'throat', 'eye', 'ear', 'hip',
];

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean)));
}

function inferSeverity(text: string): ClinicalSnapshot['severity'] {
  const lower = text.toLowerCase();
  if (/critical|unconscious|not breathing|seizure/.test(lower)) return 'critical';
  if (/severe|very bad|extreme|cannot move|worst/.test(lower)) return 'severe';
  if (/moderate|getting worse|persistent/.test(lower)) return 'moderate';
  if (/mild|slight/.test(lower)) return 'mild';
  return undefined;
}

function inferDuration(text: string): string | undefined {
  const match = text.match(/\b(\d+\s*(?:minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years))\b/i);
  return match?.[1]?.trim();
}

function inferCause(text: string): string | undefined {
  const lower = text.toLowerCase();
  if (/accident|fall|crash|injury|wound/.test(lower)) return 'accident';
  if (/pregnan/.test(lower)) return 'pregnancy_related';
  if (/medicine|medication|drug/.test(lower)) return 'medication_related';
  if (/allerg/.test(lower)) return 'allergy';
  return undefined;
}

function inferBodyPart(text: string): string | undefined {
  const lower = text.toLowerCase();
  return BODY_PART_KEYWORDS.find((part) => lower.includes(part));
}

function inferSymptoms(text: string): string[] {
  const lower = text.toLowerCase();
  return SYMPTOM_KEYWORDS.filter((symptom) => lower.includes(symptom));
}

function inferRiskLevel(text: string, severity?: ClinicalSnapshot['severity']): ClinicalSnapshot['riskLevel'] {
  const lower = text.toLowerCase();
  if (/emergency|urgent|can't breathe|cannot breathe|severe bleeding|unconscious/.test(lower)) return 'high';
  if (severity === 'critical' || severity === 'severe') return 'high';
  if (/worse|persistent|painful/.test(lower) || severity === 'moderate') return 'medium';
  return undefined;
}

function inferSmartTags(snapshot: ClinicalSnapshot, text: string): string[] {
  const tags: string[] = [];
  if (snapshot.riskLevel === 'high') tags.push('high_risk_patient', 'emergency_case');
  if (snapshot.symptoms.length === 0) tags.push('general_question');
  if (/not sure|i don't know|unknown/.test(text.toLowerCase())) tags.push('low_confidence_response');
  if (snapshot.symptoms.length > 0) tags.push('symptom_reported');
  return unique(tags);
}

function buildSnapshot(text: string): ClinicalSnapshot {
  const severity = inferSeverity(text);
  const symptoms = inferSymptoms(text);
  const duration = inferDuration(text);
  const cause = inferCause(text);
  const bodyPart = inferBodyPart(text);
  const riskLevel = inferRiskLevel(text, severity);

  const snapshot: ClinicalSnapshot = {
    symptoms,
    ...(severity ? { severity } : {}),
    ...(duration ? { duration } : {}),
    ...(cause ? { cause } : {}),
    ...(bodyPart ? { bodyPart } : {}),
    ...(riskLevel ? { riskLevel } : {}),
    smartTags: [],
  };

  snapshot.smartTags = inferSmartTags(snapshot, text);
  return snapshot;
}

export async function upsertClinicalSnapshot(params: ClinicalSnapshotParams): Promise<void> {
  const text = params.text.trim();
  if (!text) return;

  const snapshot = buildSnapshot(text);
  const ref = db.collection('session_clinical_snapshots').doc(`${params.tenantId}__${params.conversationId}`);
  const existing = await ref.get();
  const existingData = existing.data() ?? {};
  const existingSymptoms = Array.isArray(existingData.symptoms) ? existingData.symptoms.filter((v): v is string => typeof v === 'string') : [];
  const existingTags = Array.isArray(existingData.smartTags) ? existingData.smartTags.filter((v): v is string => typeof v === 'string') : [];

  const mergedSymptoms = unique([...existingSymptoms, ...snapshot.symptoms]);
  const mergedTags = unique([...existingTags, ...snapshot.smartTags]);

  await ref.set({
    tenantId: params.tenantId,
    conversationId: params.conversationId,
    userId: params.userId ?? existingData.userId ?? null,
    externalUserId: params.externalUserId ?? existingData.externalUserId ?? null,
    source: params.source,
    symptoms: mergedSymptoms,
    smartTags: mergedTags,
    ...(snapshot.severity ? { severity: snapshot.severity } : {}),
    ...(snapshot.duration ? { duration: snapshot.duration } : {}),
    ...(snapshot.cause ? { cause: snapshot.cause } : {}),
    ...(snapshot.bodyPart ? { bodyPart: snapshot.bodyPart } : {}),
    ...(snapshot.riskLevel ? { riskLevel: snapshot.riskLevel } : {}),
    createdAt: existing.exists ? (existingData.createdAt ?? FieldValue.serverTimestamp()) : FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}
