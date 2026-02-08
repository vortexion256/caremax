import { db } from '../config/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';
import { indexDocument, deleteChunksForDocument } from './rag.js';

const COLLECTION = 'auto_agent_brain';
const CHUNK_SIZE = 500;

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }
  if (chunks.length === 0) chunks.push(text || ' ');
  return chunks;
}

export type AgentRecord = {
  recordId: string;
  title: string;
  content: string;
  createdAt: number | null;
  updatedAt?: number | null;
};

/** Create a new AutoAgentBrain record and index it for RAG. */
export async function createRecord(
  tenantId: string,
  title: string,
  content: string
): Promise<{ recordId: string; title: string }> {
  const trimmedTitle = title.trim();
  const trimmedContent = content.trim();
  const ref = await db.collection(COLLECTION).add({
    tenantId,
    title: trimmedTitle,
    content: trimmedContent,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  const chunks = chunkText(trimmedContent);
  await indexDocument(tenantId, ref.id, chunks);
  return { recordId: ref.id, title: trimmedTitle };
}

export async function listRecords(tenantId: string): Promise<AgentRecord[]> {
  const snap = await db.collection(COLLECTION).where('tenantId', '==', tenantId).get();
  const records = snap.docs.map((d) => {
    const data = d.data();
    return {
      recordId: d.id,
      title: data.title ?? '',
      content: data.content ?? '',
      createdAt: data.createdAt?.toMillis?.() ?? null,
      updatedAt: data.updatedAt?.toMillis?.() ?? null,
    };
  });
  records.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return records;
}

export async function getRecord(tenantId: string, recordId: string): Promise<AgentRecord | null> {
  const doc = await db.collection(COLLECTION).doc(recordId).get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  if ((data.tenantId as string) !== tenantId) return null;
  return {
    recordId: doc.id,
    title: data.title ?? '',
    content: data.content ?? '',
    createdAt: data.createdAt?.toMillis?.() ?? null,
    updatedAt: data.updatedAt?.toMillis?.() ?? null,
  };
}

export async function updateRecord(
  tenantId: string,
  recordId: string,
  updates: { title?: string; content?: string }
): Promise<AgentRecord | null> {
  const ref = db.collection(COLLECTION).doc(recordId);
  const doc = await ref.get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  if ((data.tenantId as string) !== tenantId) return null;

  const set: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (updates.title !== undefined) set.title = updates.title.trim();
  if (updates.content !== undefined) {
    const content = updates.content.trim();
    set.content = content;
    await deleteChunksForDocument(tenantId, recordId);
    const chunks = chunkText(content);
    await indexDocument(tenantId, recordId, chunks);
  }
  await ref.update(set);
  return getRecord(tenantId, recordId);
}

export async function deleteRecord(tenantId: string, recordId: string): Promise<boolean> {
  const ref = db.collection(COLLECTION).doc(recordId);
  const doc = await ref.get();
  if (!doc.exists) return false;
  const data = doc.data()!;
  if ((data.tenantId as string) !== tenantId) return false;
  await deleteChunksForDocument(tenantId, recordId);
  await ref.delete();
  return true;
}

// --- Modification requests (agent requests edit/delete; admin approves before they are applied) ---

const MODIFICATION_REQUESTS_COLLECTION = 'agent_brain_modification_requests';

export type ModificationRequestType = 'edit' | 'delete';

export type AgentBrainModificationRequest = {
  requestId: string;
  tenantId: string;
  type: ModificationRequestType;
  recordId: string;
  title?: string;
  content?: string;
  reason?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number | null;
  updatedAt?: number | null;
  reviewedBy?: string | null;
  reviewedAt?: number | null;
};

export async function createModificationRequest(
  tenantId: string,
  type: ModificationRequestType,
  recordId: string,
  options: { title?: string; content?: string; reason?: string }
): Promise<{ requestId: string }> {
  const ref = await db.collection(MODIFICATION_REQUESTS_COLLECTION).add({
    tenantId,
    type,
    recordId,
    title: options.title ?? null,
    content: options.content ?? null,
    reason: options.reason ?? null,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { requestId: ref.id };
}

export async function listModificationRequests(tenantId: string): Promise<AgentBrainModificationRequest[]> {
  const snap = await db
    .collection(MODIFICATION_REQUESTS_COLLECTION)
    .where('tenantId', '==', tenantId)
    .where('status', '==', 'pending')
    .get();
  const list = snap.docs.map((d) => {
    const data = d.data();
    return {
      requestId: d.id,
      tenantId: data.tenantId as string,
      type: data.type as ModificationRequestType,
      recordId: data.recordId as string,
      title: data.title ?? undefined,
      content: data.content ?? undefined,
      reason: data.reason ?? undefined,
      status: data.status as AgentBrainModificationRequest['status'],
      createdAt: data.createdAt?.toMillis?.() ?? null,
      updatedAt: data.updatedAt?.toMillis?.() ?? null,
      reviewedBy: data.reviewedBy ?? null,
      reviewedAt: data.reviewedAt?.toMillis?.() ?? null,
    };
  });
  list.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return list;
}

export async function approveModificationRequest(
  tenantId: string,
  requestId: string,
  reviewedBy: string
): Promise<{ applied: boolean; error?: string }> {
  const ref = db.collection(MODIFICATION_REQUESTS_COLLECTION).doc(requestId);
  const doc = await ref.get();
  if (!doc.exists) return { applied: false, error: 'Request not found' };
  const data = doc.data()!;
  if ((data.tenantId as string) !== tenantId) return { applied: false, error: 'Request not found' };
  if (data.status !== 'pending') return { applied: false, error: 'Request already processed' };

  const type = data.type as ModificationRequestType;
  const recordId = data.recordId as string;

  try {
    if (type === 'edit') {
      const record = await getRecord(tenantId, recordId);
      if (!record) {
        await ref.update({
          status: 'rejected',
          updatedAt: FieldValue.serverTimestamp(),
          reviewedBy,
          reviewedAt: FieldValue.serverTimestamp(),
        });
        return { applied: false, error: 'Record no longer exists' };
      }
      await updateRecord(tenantId, recordId, {
        title: data.title != null ? String(data.title) : undefined,
        content: data.content != null ? String(data.content) : undefined,
      });
    } else {
      const deleted = await deleteRecord(tenantId, recordId);
      if (!deleted) {
        await ref.update({
          status: 'rejected',
          updatedAt: FieldValue.serverTimestamp(),
          reviewedBy,
          reviewedAt: FieldValue.serverTimestamp(),
        });
        return { applied: false, error: 'Record not found or already deleted' };
      }
    }
    await ref.update({
      status: 'approved',
      updatedAt: FieldValue.serverTimestamp(),
      reviewedBy,
      reviewedAt: FieldValue.serverTimestamp(),
    });
    return { applied: true };
  } catch (e) {
    console.error('approveModificationRequest error:', e);
    await ref.update({
      status: 'rejected',
      updatedAt: FieldValue.serverTimestamp(),
      reviewedBy,
      reviewedAt: FieldValue.serverTimestamp(),
    });
    return { applied: false, error: e instanceof Error ? e.message : 'Failed to apply' };
  }
}

export async function rejectModificationRequest(
  tenantId: string,
  requestId: string,
  reviewedBy: string
): Promise<boolean> {
  const ref = db.collection(MODIFICATION_REQUESTS_COLLECTION).doc(requestId);
  const doc = await ref.get();
  if (!doc.exists) return false;
  const data = doc.data()!;
  if ((data.tenantId as string) !== tenantId) return false;
  if (data.status !== 'pending') return false;
  await ref.update({
    status: 'rejected',
    updatedAt: FieldValue.serverTimestamp(),
    reviewedBy,
    reviewedAt: FieldValue.serverTimestamp(),
  });
  return true;
}
