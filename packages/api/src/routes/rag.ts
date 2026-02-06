import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/firebase.js';
import { requireAuth, requireTenantParam, requireAdmin } from '../middleware/auth.js';
import { indexDocument } from '../services/rag.js';
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

const addDocBody = z.object({ name: z.string(), content: z.string() });

ragRouter.post('/documents', requireAuth, requireAdmin, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const parsed = addDocBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    return;
  }
  const ref = await db.collection(DOCUMENTS).add({
    tenantId,
    name: parsed.data.name,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
  });
  const chunkSize = 500;
  const text = parsed.data.content;
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  if (chunks.length === 0) chunks.push(text || ' ');
  await indexDocument(tenantId, ref.id, chunks);
  await ref.update({ status: 'indexed' });
  res.status(201).json({
    documentId: ref.id,
    name: parsed.data.name,
    status: 'indexed',
  });
});
