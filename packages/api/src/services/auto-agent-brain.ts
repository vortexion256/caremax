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
