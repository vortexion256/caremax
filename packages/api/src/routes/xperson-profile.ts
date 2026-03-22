import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin, requireTenantParam } from '../middleware/auth.js';
import { deleteXPersonProfileById, getXPersonProfile, listRecentlyActiveWhatsAppProfiles, listXPersonProfiles, sendWhatsAppNotificationToProfiles, updateXPersonProfileById, upsertXPersonProfile } from '../services/xperson-profile.js';

export const xPersonProfileRouter: Router = Router({ mergeParams: true });

xPersonProfileRouter.use(requireTenantParam, requireAuth, requireAdmin);

xPersonProfileRouter.get('/', async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const limit = Number(req.query.limit);
  const profiles = await listXPersonProfiles(tenantId, Number.isFinite(limit) ? limit : 200);
  res.json({ profiles });
});

xPersonProfileRouter.get('/lookup', async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
  const externalUserId = typeof req.query.externalUserId === 'string' ? req.query.externalUserId : undefined;
  const profile = await getXPersonProfile({ tenantId, userId, externalUserId });
  res.json({ profile });
});

xPersonProfileRouter.get('/whatsapp-active', async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const activeWithinHours = Number(req.query.activeWithinHours);
  const limit = Number(req.query.limit);
  const profiles = await listRecentlyActiveWhatsAppProfiles({
    tenantId,
    activeWithinHours: Number.isFinite(activeWithinHours) ? activeWithinHours : 22,
    limit: Number.isFinite(limit) ? limit : 500,
  });
  res.json({ profiles, activeWithinHours: Number.isFinite(activeWithinHours) ? activeWithinHours : 22 });
});

const upsertSchema = z.object({
  userId: z.string().optional(),
  externalUserId: z.string().optional(),
  channel: z.enum(['widget', 'whatsapp', 'unknown']).optional(),
  conversationId: z.string().optional(),
  details: z.object({
    name: z.string().optional(),
    phone: z.string().optional(),
    location: z.string().optional(),
  }).optional(),
  attributes: z.record(z.string()).optional(),
});

xPersonProfileRouter.post('/upsert', async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    return;
  }

  const result = await upsertXPersonProfile({ tenantId, ...parsed.data });
  res.json({ ok: true, ...result });
});

const whatsappNotificationSchema = z.object({
  message: z.string().trim().min(3).max(1000),
  selectAllActive: z.boolean().optional(),
  activeWithinHours: z.number().int().min(1).max(168).optional(),
  profileIds: z.array(z.string().min(1)).max(1000).optional(),
});

xPersonProfileRouter.post('/whatsapp-notifications', async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const uid = res.locals.uid as string | undefined;
  const parsed = whatsappNotificationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    return;
  }

  if (!parsed.data.selectAllActive && (!parsed.data.profileIds || parsed.data.profileIds.length === 0)) {
    res.status(400).json({ error: 'Select at least one active WhatsApp contact or choose Send to all active contacts.' });
    return;
  }

  try {
    const result = await sendWhatsAppNotificationToProfiles({
      tenantId,
      message: parsed.data.message,
      profileIds: parsed.data.profileIds,
      selectAllActive: parsed.data.selectAllActive === true,
      activeWithinHours: parsed.data.activeWithinHours ?? 22,
      requestedBy: uid,
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send WhatsApp notifications.';
    res.status(400).json({ error: message });
  }
});


const updateSchema = z.object({
  details: z.object({
    name: z.string().optional(),
    phone: z.string().optional(),
    location: z.string().optional(),
  }).optional(),
  attributes: z.record(z.string()).optional(),
});

xPersonProfileRouter.patch('/:profileId', async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const profileId = typeof req.params.profileId === 'string' ? req.params.profileId : '';
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    return;
  }

  const result = await updateXPersonProfileById({
    tenantId,
    profileId,
    details: parsed.data.details,
    attributes: parsed.data.attributes,
  });

  if (!result.updated) {
    res.status(404).json({ error: 'Profile not found' });
    return;
  }

  res.json({ ok: true });
});

xPersonProfileRouter.delete('/:profileId', async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const profileId = typeof req.params.profileId === 'string' ? req.params.profileId : '';
  const result = await deleteXPersonProfileById({ tenantId, profileId });

  if (!result.deleted) {
    res.status(404).json({ error: 'Profile not found' });
    return;
  }

  res.status(204).send();
});
