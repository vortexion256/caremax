import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireTenantParam } from '../middleware/auth.js';
import { createWhatsAppReminder, dispatchDueReminders } from '../services/reminders.js';

export const reminderRouter: Router = Router({ mergeParams: true });
export const reminderDispatchRouter: Router = Router();

reminderRouter.use(requireTenantParam);

const createReminderBody = z.object({
  message: z.string().min(1),
  remindAtIso: z.string().min(1),
  timezone: z.string().optional(),
  externalUserId: z.string().optional(),
  conversationId: z.string().optional(),
  channel: z.enum(['whatsapp', 'whatsapp_meta']).optional(),
});

reminderRouter.post('/', requireAuth, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const parsed = createReminderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    return;
  }

  try {
    const created = await createWhatsAppReminder({
      tenantId,
      message: parsed.data.message,
      remindAtIso: parsed.data.remindAtIso,
      timezone: parsed.data.timezone,
      externalUserId: parsed.data.externalUserId,
      userId: res.locals.uid as string | undefined,
      conversationId: parsed.data.conversationId,
      channel: parsed.data.channel,
    });
    res.status(201).json({ ok: true, ...created });
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Failed to create reminder';
    res.status(400).json({ error: 'Failed to create reminder', details });
  }
});

reminderDispatchRouter.post('/dispatch', async (req, res) => {
  const configuredSecret = process.env.REMINDER_DISPATCH_SECRET?.trim();
  if (!configuredSecret) {
    res.status(500).json({
      error: 'REMINDER_DISPATCH_SECRET is not configured.',
      hint: 'Set REMINDER_DISPATCH_SECRET in the API runtime environment (e.g. Vercel project env vars).',
    });
    return;
  }

  const suppliedSecret = String(req.headers['x-reminder-secret'] ?? '').trim();
  if (!suppliedSecret || suppliedSecret !== configuredSecret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const parsedLimit = Number.parseInt(String(req.query.limit ?? '25'), 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 25;

  try {
    const result = await dispatchDueReminders({ limit });
    res.json({ ok: true, ...result });
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Failed to dispatch reminders';
    const lowerDetails = details.toLowerCase();

    const hints: string[] = [];
    if (lowerDetails.includes('firebase') || lowerDetails.includes('credential')) {
      hints.push('Verify Firebase server credentials are configured for this deployment environment.');
    }
    if (lowerDetails.includes('requires an index') || lowerDetails.includes('failed-precondition')) {
      hints.push('Create the Firestore composite index for reminders(status ASC, dueAt ASC).');
    }
    if (lowerDetails.includes('permission') || lowerDetails.includes('missing or insufficient permissions')) {
      hints.push('Check Firestore IAM/security rules for server-side reminder reads and updates.');
    }

    console.error('Reminder dispatch failed:', error);
    res.status(500).json({ error: 'Dispatch failed', details, hints });
  }
});
