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
  suggestedQuestions: z.array(z.string()).optional(),
  widgetColor: z.string().optional(),
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
  learningOnlyPromptEnabled: z.boolean().optional(),
  consolidationPrompt: z.string().optional(),
  consolidationPromptEnabled: z.boolean().optional(),
});

const fallbackModels = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];

async function getAvailableModels(): Promise<string[]> {
  const doc = await db.collection('platform_settings').doc('saas_billing').get();
  const data = doc.data();
  if (Array.isArray(data?.availableModels) && data.availableModels.length > 0) {
    return data.availableModels.filter((model): model is string => typeof model === 'string' && model.trim().length > 0);
  }
  return fallbackModels;
}

/** Public endpoint for the chat widget: returns only title and agent name (no system prompt etc.). */
agentConfigRouter.get('/widget', async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const doc = await db.collection('agent_config').doc(tenantId).get();
  const data = doc.data() ?? {};
    res.json({
    chatTitle: (data.chatTitle ?? '').trim(),
    agentName: data.agentName ?? 'CareMax Assistant',
    welcomeText: data.welcomeText ?? 'Hello, how can I be of service?',
    suggestedQuestions: data.suggestedQuestions ?? [],
    widgetColor: data.widgetColor ?? '#2563eb',
  });
});

agentConfigRouter.get('/', async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const availableModels = await getAvailableModels();
  const doc = await db.collection('agent_config').doc(tenantId).get();
  if (!doc.exists) {
    res.json({
      tenantId,
      agentName: 'CareMax Assistant',
      chatTitle: '',
      systemPrompt: '',
      thinkingInstructions: '',
      model: availableModels[0] ?? 'gemini-2.0-flash',
      temperature: 0.7,
      ragEnabled: false,
      availableModels,
    });
    return;
  }
  res.json({ tenantId, ...doc.data(), availableModels });
});

agentConfigRouter.put('/', requireAuth, requireAdmin, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const locals = res.locals as { isPlatformAdmin?: boolean };
  const parsed = updateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    return;
  }
  const availableModels = await getAvailableModels();
  const advancedPromptFields = ['learningOnlyPrompt', 'learningOnlyPromptEnabled', 'consolidationPrompt', 'consolidationPromptEnabled'] as const;
  const isUpdatingAdvancedPrompts = advancedPromptFields.some((field) => Object.prototype.hasOwnProperty.call(parsed.data, field));
  if (isUpdatingAdvancedPrompts && locals.isPlatformAdmin !== true) {
    res.status(403).json({ error: 'Only SaaS admins can update learning and consolidation prompts' });
    return;
  }

  if (parsed.data.model && !availableModels.includes(parsed.data.model)) {
    res.status(400).json({ error: 'Model is not allowed for tenant selection' });
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
