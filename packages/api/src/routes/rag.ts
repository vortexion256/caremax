import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/firebase.js';
import { requireAuth, requireTenantParam, requireAdmin } from '../middleware/auth.js';
import { indexDocument, deleteChunksForDocument } from '../services/rag.js';
import { FieldValue } from 'firebase-admin/firestore';

export const ragRouter = Router({ mergeParams: true });
const DOCUMENTS = 'rag_documents';

ragRouter.use(requireTenantParam);

ragRouter.get('/documents', async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const snap = await db.collection(DOCUMENTS).where('tenantId', '==', tenantId).get();
  const list = snap.docs.map((d) => {
    const data = d.data();
    return {
      documentId: d.id,
      name: data.name,
      status: data.status,
      createdAt: data.createdAt?.toMillis?.() ?? null,
    };
  });
  res.json({ documents: list });
});

ragRouter.get('/documents/:documentId', requireAuth, requireAdmin, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const { documentId } = req.params;
  const doc = await db.collection(DOCUMENTS).doc(documentId).get();
  if (!doc.exists) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  const data = doc.data()!;
  if ((data.tenantId as string) !== tenantId) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  res.json({
    documentId: doc.id,
    name: data.name,
    status: data.status,
    content: data.content ?? '',
    createdAt: data.createdAt?.toMillis?.() ?? null,
  });
});

const addDocBody = z.object({ name: z.string(), content: z.string() });
const updateDocBody = z.object({ name: z.string().optional(), content: z.string().optional() });

ragRouter.post('/documents', requireAuth, requireAdmin, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const parsed = addDocBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    return;
  }
  const content = parsed.data.content.trim();
  const ref = await db.collection(DOCUMENTS).add({
    tenantId,
    name: parsed.data.name.trim(),
    content,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
  });
  const chunks = chunkText(content, 500);
  await indexDocument(tenantId, ref.id, chunks);
  await ref.update({ status: 'indexed' });
  res.status(201).json({
    documentId: ref.id,
    name: parsed.data.name.trim(),
    status: 'indexed',
  });
});

ragRouter.put('/documents/:documentId', requireAuth, requireAdmin, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const { documentId } = req.params;
  const parsed = updateDocBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    return;
  }
  const ref = db.collection(DOCUMENTS).doc(documentId);
  const doc = await ref.get();
  if (!doc.exists) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  const data = doc.data()!;
  if ((data.tenantId as string) !== tenantId) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name.trim();
  if (parsed.data.content !== undefined) {
    const content = parsed.data.content.trim();
    updates.content = content;
    await deleteChunksForDocument(tenantId, documentId);
    const chunks = chunkText(content, 500);
    await indexDocument(tenantId, documentId, chunks);
    updates.status = 'indexed';
  }
  await ref.update(updates);
  const updated = await ref.get();
  const out = updated.data()!;
  res.json({
    documentId: updated.id,
    name: out.name,
    status: out.status,
    createdAt: out.createdAt?.toMillis?.() ?? null,
  });
});

ragRouter.delete('/documents/:documentId', requireAuth, requireAdmin, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const { documentId } = req.params;
  const ref = db.collection(DOCUMENTS).doc(documentId);
  const doc = await ref.get();
  if (!doc.exists) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  const data = doc.data()!;
  if ((data.tenantId as string) !== tenantId) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  await deleteChunksForDocument(tenantId, documentId);
  await ref.delete();
  res.status(204).send();
});

function chunkText(text: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  if (chunks.length === 0) chunks.push(text || ' ');
  return chunks;
}
