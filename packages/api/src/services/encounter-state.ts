import { createHash } from 'node:crypto';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db } from '../config/firebase.js';

const ENCOUNTER_FACTS_COLLECTION = 'encounter_facts';
const GEMINI_SUPPORTED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export type EncounterFactType = 'medication' | 'symptom' | 'document' | 'observation' | 'other';

export type EncounterFact = {
  factId: string;
  tenantId: string;
  conversationId: string;
  userId: string | null;
  externalUserId: string | null;
  sourceHash: string;
  sourceKind: 'image';
  imageUrls: string[];
  factType: EncounterFactType;
  title: string;
  value: string;
  evidenceSource: string;
  confidence: 'low' | 'medium' | 'high';
  safetyFlags: string[];
  capturedAtTurn: number | null;
  createdAt: number | null;
  updatedAt: number | null;
};

function normalizeFactString(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeSafetyFlags(flags: string[] | undefined): string[] {
  return Array.from(
    new Set(
      (flags ?? [])
        .map((flag) => normalizeFactString(flag).toLowerCase())
        .filter(Boolean)
    )
  ).slice(0, 8);
}

async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    let contentType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
    if (!GEMINI_SUPPORTED_IMAGE_TYPES.has(contentType.toLowerCase())) {
      if (contentType.toLowerCase().startsWith('image/')) {
        contentType = 'image/jpeg';
      } else {
        return null;
      }
    }
    const b64 = buf.toString('base64');
    return `data:${contentType};base64,${b64}`;
  } catch {
    return null;
  }
}

function buildSourceHash(input: { conversationId: string; content: string; imageUrls: string[] }): string {
  return createHash('sha256')
    .update(JSON.stringify({
      conversationId: input.conversationId,
      content: input.content.trim(),
      imageUrls: input.imageUrls.map((value) => value.trim()).filter(Boolean).sort(),
    }))
    .digest('hex');
}

export async function listEncounterFacts(
  tenantId: string,
  options: {
    conversationId: string;
    userId?: string;
    externalUserId?: string;
    limit?: number;
  }
): Promise<EncounterFact[]> {
  let query = db.collection(ENCOUNTER_FACTS_COLLECTION)
    .where('tenantId', '==', tenantId)
    .where('conversationId', '==', options.conversationId);

  if (options.userId) {
    query = query.where('userId', '==', options.userId.trim());
  }

  if (options.externalUserId) {
    query = query.where('externalUserId', '==', options.externalUserId.trim());
  }

  try {
    query = query.orderBy('createdAt', 'desc');
    if (options.limit) query = query.limit(options.limit);
    const snap = await query.get();
    return snap.docs.map((doc) => {
      const data = doc.data();
      return {
        factId: doc.id,
        tenantId: data.tenantId as string,
        conversationId: data.conversationId as string,
        userId: (data.userId as string | null | undefined) ?? null,
        externalUserId: (data.externalUserId as string | null | undefined) ?? null,
        sourceHash: data.sourceHash as string,
        sourceKind: (data.sourceKind as 'image') ?? 'image',
        imageUrls: Array.isArray(data.imageUrls) ? data.imageUrls.filter((value): value is string => typeof value === 'string') : [],
        factType: (data.factType as EncounterFactType) ?? 'other',
        title: data.title as string,
        value: data.value as string,
        evidenceSource: data.evidenceSource as string,
        confidence: (data.confidence as EncounterFact['confidence']) ?? 'medium',
        safetyFlags: Array.isArray(data.safetyFlags) ? data.safetyFlags.filter((value): value is string => typeof value === 'string') : [],
        capturedAtTurn: data.capturedAtTurn?.valueOf?.() ?? data.capturedAtTurn ?? null,
        createdAt: data.createdAt?.toMillis?.() ?? null,
        updatedAt: data.updatedAt?.toMillis?.() ?? null,
      };
    });
  } catch (error: any) {
    if (error?.code === 9 || error?.message?.includes('index')) {
      const snap = await query.get();
      return snap.docs.map((doc) => {
        const data = doc.data();
        return {
          factId: doc.id,
          tenantId: data.tenantId as string,
          conversationId: data.conversationId as string,
          userId: (data.userId as string | null | undefined) ?? null,
          externalUserId: (data.externalUserId as string | null | undefined) ?? null,
          sourceHash: data.sourceHash as string,
          sourceKind: (data.sourceKind as 'image') ?? 'image',
          imageUrls: Array.isArray(data.imageUrls) ? data.imageUrls.filter((value): value is string => typeof value === 'string') : [],
          factType: (data.factType as EncounterFactType) ?? 'other',
          title: data.title as string,
          value: data.value as string,
          evidenceSource: data.evidenceSource as string,
          confidence: (data.confidence as EncounterFact['confidence']) ?? 'medium',
          safetyFlags: Array.isArray(data.safetyFlags) ? data.safetyFlags.filter((value): value is string => typeof value === 'string') : [],
          capturedAtTurn: data.capturedAtTurn?.valueOf?.() ?? data.capturedAtTurn ?? null,
          createdAt: data.createdAt?.toMillis?.() ?? null,
          updatedAt: data.updatedAt?.toMillis?.() ?? null,
        };
      }).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, options.limit ?? Number.MAX_SAFE_INTEGER);
    }
    throw error;
  }
}

async function hasEncounterFactsForSource(
  tenantId: string,
  conversationId: string,
  sourceHash: string
): Promise<boolean> {
  const snap = await db.collection(ENCOUNTER_FACTS_COLLECTION)
    .where('tenantId', '==', tenantId)
    .where('conversationId', '==', conversationId)
    .get();
  return snap.docs.some((doc) => doc.data().sourceHash === sourceHash);
}

export async function persistEncounterFacts(
  tenantId: string,
  conversationId: string,
  facts: Array<Omit<EncounterFact, 'factId' | 'tenantId' | 'conversationId' | 'createdAt' | 'updatedAt'>>,
): Promise<void> {
  if (facts.length === 0) return;
  const batch = db.batch();
  for (const fact of facts) {
    const ref = db.collection(ENCOUNTER_FACTS_COLLECTION).doc();
    batch.set(ref, {
      tenantId,
      conversationId,
      userId: fact.userId,
      externalUserId: fact.externalUserId,
      sourceHash: fact.sourceHash,
      sourceKind: fact.sourceKind,
      imageUrls: fact.imageUrls,
      factType: fact.factType,
      title: fact.title,
      value: fact.value,
      evidenceSource: fact.evidenceSource,
      confidence: fact.confidence,
      safetyFlags: fact.safetyFlags,
      capturedAtTurn: fact.capturedAtTurn,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}

export async function processEncounterEvidence(params: {
  tenantId: string;
  conversationId?: string;
  userId?: string;
  externalUserId?: string;
  history: Array<{ role: string; content: string; imageUrls?: string[] }>;
  model: ChatGoogleGenerativeAI;
}): Promise<EncounterFact[]> {
  const conversationId = params.conversationId?.trim();
  if (!conversationId) return [];

  const latestUserIndex = [...params.history].map((message, index) => ({ message, index }))
    .reverse()
    .find((entry) => entry.message.role === 'user' && Array.isArray(entry.message.imageUrls) && entry.message.imageUrls.length > 0);
  if (!latestUserIndex) return [];

  const imageUrls = (latestUserIndex.message.imageUrls ?? []).map((value) => value.trim()).filter(Boolean);
  if (imageUrls.length === 0) return [];

  const sourceHash = buildSourceHash({
    conversationId,
    content: latestUserIndex.message.content ?? '',
    imageUrls,
  });
  if (await hasEncounterFactsForSource(params.tenantId, conversationId, sourceHash)) {
    return listEncounterFacts(params.tenantId, {
      conversationId,
      userId: params.userId,
      externalUserId: params.externalUserId,
      limit: 20,
    });
  }

  const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
    {
      type: 'text',
      text: `Analyze the user-provided medication-related image(s) and extract only high-confidence encounter facts that will help future turns stay grounded.
User text with the image: ${latestUserIndex.message.content?.trim() || '(no text provided)'}

Rules:
- Only return facts you can support from the image(s) and user text.
- Focus on medication names, dosage/form clues, and high-level safety flags.
- Do not invent treatment advice.
- If unsure, return no facts.`,
    },
  ];

  for (const url of imageUrls) {
    const dataUrl = await fetchImageAsDataUrl(url);
    if (dataUrl) {
      content.push({ type: 'image_url', image_url: { url: dataUrl } });
    }
  }

  if (content.length === 1) return [];

  const extractionTool = new DynamicStructuredTool({
    name: 'record_encounter_facts',
    description: 'Return structured encounter facts extracted from user-provided evidence.',
    schema: z.object({
      facts: z.array(z.object({
        factType: z.enum(['medication', 'symptom', 'document', 'observation', 'other']),
        title: z.string(),
        value: z.string(),
        evidenceSource: z.string(),
        confidence: z.enum(['low', 'medium', 'high']),
        safetyFlags: z.array(z.string()).optional(),
      })).max(8),
    }),
    func: async ({ facts }) => JSON.stringify({ facts }),
  });

  const modelWithTools = params.model.bindTools([extractionTool]);
  const response = await modelWithTools.invoke([
    new SystemMessage('You extract structured encounter facts from clinical conversation evidence. Return only high-confidence, concise facts.'),
    new HumanMessage({ content }),
  ]);

  const toolCalls = (response as { tool_calls?: Array<{ name: string; args?: unknown }> }).tool_calls ?? [];
  const factCall = toolCalls.find((toolCall) => toolCall.name === 'record_encounter_facts');
  const rawFacts = ((factCall?.args as { facts?: Array<{
    factType: EncounterFactType;
    title: string;
    value: string;
    evidenceSource: string;
    confidence: 'low' | 'medium' | 'high';
    safetyFlags?: string[];
  }> })?.facts ?? [])
    .filter((fact) => normalizeFactString(fact.title).length > 0 && normalizeFactString(fact.value).length > 0)
    .filter((fact) => fact.confidence === 'high' || fact.confidence === 'medium');

  if (rawFacts.length === 0) return [];

  const factsToPersist = rawFacts.map((fact) => ({
    userId: params.userId?.trim() || null,
    externalUserId: params.externalUserId?.trim() || null,
    sourceHash,
    sourceKind: 'image' as const,
    imageUrls,
    factType: fact.factType,
    title: normalizeFactString(fact.title),
    value: normalizeFactString(fact.value),
    evidenceSource: normalizeFactString(fact.evidenceSource) || 'user_uploaded_image',
    confidence: fact.confidence,
    safetyFlags: normalizeSafetyFlags(fact.safetyFlags),
    capturedAtTurn: latestUserIndex.index + 1,
  }));

  await persistEncounterFacts(params.tenantId, conversationId, factsToPersist);

  return listEncounterFacts(params.tenantId, {
    conversationId,
    userId: params.userId,
    externalUserId: params.externalUserId,
    limit: 20,
  });
}
