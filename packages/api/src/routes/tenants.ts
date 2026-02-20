import { Router } from 'express';
import { requireAuth, requireTenantParam } from '../middleware/auth.js';
import { db } from '../config/firebase.js';

export const tenantRouter: Router = Router();

tenantRouter.use(requireAuth);

tenantRouter.get('/:tenantId', requireTenantParam, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const doc = await db.collection('tenants').doc(tenantId).get();
  if (!doc.exists) {
    res.status(404).json({ error: 'Tenant not found' });
    return;
  }
  res.json({ tenantId, ...doc.data() });
});

tenantRouter.get('/:tenantId/account', requireTenantParam, async (_req, res) => {
  const tenantId = res.locals.tenantId as string;
  const tenantDoc = await db.collection('tenants').doc(tenantId).get();
  if (!tenantDoc.exists) {
    res.status(404).json({ error: 'Tenant not found' });
    return;
  }

  const data = tenantDoc.data() ?? {};
  res.json({
    tenantId,
    name: data.name ?? '',
    allowedDomains: data.allowedDomains ?? [],
    createdAt: data.createdAt?.toMillis?.() ?? null,
    createdBy: data.createdBy ?? null,
    billingPlanId: data.billingPlanId ?? 'free',
  });
});

tenantRouter.get('/:tenantId/billing', requireTenantParam, async (_req, res) => {
  const tenantId = res.locals.tenantId as string;

  const usageSnap = await db
    .collection('usage_events')
    .where('tenantId', '==', tenantId)
    .orderBy('createdAt', 'desc')
    .limit(200)
    .get();

  const summaryByType: Record<string, { calls: number; inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number }> = {};
  let totals = { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 };

  const events = usageSnap.docs.map((doc) => {
    const data = doc.data();
    const usageType = typeof data.usageType === 'string' ? data.usageType : 'unknown';
    const inputTokens = typeof data.inputTokens === 'number' ? data.inputTokens : 0;
    const outputTokens = typeof data.outputTokens === 'number' ? data.outputTokens : 0;
    const totalTokens = typeof data.totalTokens === 'number' ? data.totalTokens : inputTokens + outputTokens;
    const costUsd = typeof data.costUsd === 'number' ? data.costUsd : 0;

    if (!summaryByType[usageType]) {
      summaryByType[usageType] = { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 };
    }

    summaryByType[usageType].calls += 1;
    summaryByType[usageType].inputTokens += inputTokens;
    summaryByType[usageType].outputTokens += outputTokens;
    summaryByType[usageType].totalTokens += totalTokens;
    summaryByType[usageType].costUsd += costUsd;

    totals.calls += 1;
    totals.inputTokens += inputTokens;
    totals.outputTokens += outputTokens;
    totals.totalTokens += totalTokens;
    totals.costUsd += costUsd;

    return {
      eventId: doc.id,
      usageType,
      measurementSource: data.measurementSource ?? 'provider',
      model: data.model ?? null,
      inputTokens,
      outputTokens,
      totalTokens,
      costUsd,
      createdAt: data.createdAt?.toMillis?.() ?? null,
    };
  });

  const tenantDoc = await db.collection('tenants').doc(tenantId).get();
  const tenantData = tenantDoc.data() ?? {};
  const billingPlanId = tenantData.billingPlanId ?? 'free';

  const plansSnap = await db.collection('billing_plans').orderBy('priceUsd', 'asc').get();
  const plans = plansSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const currentPlan = plans.find((p) => p.id === billingPlanId) ?? null;

  res.json({
    tenantId,
    billingPlanId,
    currentPlan,
    totals,
    byUsageType: Object.entries(summaryByType).map(([usageType, v]) => ({ usageType, ...v })),
    recentEvents: events,
  });
});

tenantRouter.get('/:tenantId/analytics', requireTenantParam, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const { period } = req.query as { period?: string };

  try {
    const now = Date.now();
    let startTime = 0;

    switch (period) {
      case '1d':
        startTime = now - 24 * 60 * 60 * 1000;
        break;
      case '7d':
      case '1w':
        startTime = now - 7 * 24 * 60 * 60 * 1000;
        break;
      case '1m':
        startTime = now - 30 * 24 * 60 * 60 * 1000;
        break;
      case '1y':
        startTime = now - 365 * 24 * 60 * 60 * 1000;
        break;
      default:
        startTime = 0; // All time
    }

    const startTimestamp = startTime > 0 ? new Date(startTime) : null;

    // Query conversations for this tenant
    let convQuery: FirebaseFirestore.Query = db.collection('conversations').where('tenantId', '==', tenantId);
    if (startTimestamp) {
      convQuery = convQuery.where('createdAt', '>=', startTimestamp);
    }

    const convSnap = await convQuery.get();
    const totalConversations = convSnap.size;
    
    let aiOnly = 0;
    let handoffInvolved = 0;

    convSnap.docs.forEach(doc => {
      const data = doc.data();
      if (data.status === 'human_joined' || data.joinedBy) {
        handoffInvolved++;
      } else {
        aiOnly++;
      }
    });

    res.json({
      period: period || 'all',
      totalConversations,
      aiOnly,
      handoffInvolved,
      timestamp: now
    });
  } catch (e) {
    console.error('Failed to load analytics:', e);
    res.status(500).json({ error: 'Failed to load analytics' });
  }
});
