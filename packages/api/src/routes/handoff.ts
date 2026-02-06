import { Router } from 'express';
import { db } from '../config/firebase.js';
import { requireAuth, requireTenantParam, requireAdmin } from '../middleware/auth.js';

export const handoffRouter = Router({ mergeParams: true });

handoffRouter.use(requireTenantParam);

handoffRouter.get('/', requireAuth, requireAdmin, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const snap = await db
    .collection('conversations')
    .where('tenantId', '==', tenantId)
    .where('status', 'in', ['handoff_requested', 'human_joined'])
    .orderBy('updatedAt', 'desc')
    .limit(50)
    .get();
  const list = snap.docs.map((d) => {
    const data = d.data();
    return {
      conversationId: d.id,
      tenantId: data.tenantId,
      userId: data.userId,
      status: data.status,
      updatedAt: data.updatedAt?.toMillis?.() ?? null,
    };
  });
  res.json({ handoffs: list });
});
