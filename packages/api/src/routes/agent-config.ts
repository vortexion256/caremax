import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/firebase.js';
import { requireAuth, requireTenantParam, requireAdmin } from '../middleware/auth.js';
import { FieldValue } from 'firebase-admin/firestore';

export const agentConfigRouter: Router = Router({ mergeParams: true });

agentConfigRouter.use(requireTenantParam);

const googleSheetEntry = z.object({
  spreadsheetId: z.string().min(1),
  range: z.string().optional(),
  useWhen: z.string().min(1),
});

const updateBody = z.object({
  agentName: z.string().optional(),
  chatTitle: z.string().optional(),
  welcomeText: z.string().optional(),
  systemPrompt: z.string().optional(),
  thinkingInstructions: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  ragEnabled: z.boolean().optional(),
  googleSheetsEnabled: z.boolean().optional(),
  googleSheetsSpreadsheetId: z.string().optional(),
  googleSheetsRange: z.string().optional(),
  googleSheets: z.array(googleSheetEntry).optional(),
  learningOnlyPrompt: z.string().optional(),
  consolidationPrompt: z.string().optional(),
});

/** Public endpoint for the chat widget: returns only title and agent name (no system prompt etc.). */
agentConfigRouter.get('/widget', async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const doc = await db.collection('agent_config').doc(tenantId).get();
  const data = doc.data() ?? {};
    res.json({
    chatTitle: (data.chatTitle ?? '').trim(),
    agentName: data.agentName ?? 'CareMax Assistant',
    welcomeText: data.welcomeText ?? 'Hello, how can I be of service?',
  });
});

agentConfigRouter.get('/', async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const doc = await db.collection('agent_config').doc(tenantId).get();
  if (!doc.exists) {
    res.json({
      tenantId,
      agentName: 'CareMax Assistant',
      chatTitle: '',
      systemPrompt: '',
      thinkingInstructions: '',
      model: 'gemini-3-flash-preview',
      temperature: 0.7,
      ragEnabled: false,
    });
    return;
  }
  res.json({ tenantId, ...doc.data() });
});

agentConfigRouter.put('/', requireAuth, requireAdmin, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const parsed = updateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    return;
  }
  const ref = db.collection('agent_config').doc(tenantId);
  await ref.set(
    { ...parsed.data, tenantId, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  const updated = await ref.get();
  res.json({ tenantId, ...updated.data() });
});
