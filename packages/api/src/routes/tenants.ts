import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { requireAuth, requireTenantParam } from '../middleware/auth.js';
import { db } from '../config/firebase.js';
import { activateTenantSubscription, getTenantBillingStatus } from '../services/billing.js';
import { createMarzCollection, getMarzCollectionDetails } from '../services/marzpay.js';
import { z } from 'zod';

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
  const plans = plansSnap.docs.map((d) => ({ id: d.id, ...(d.data() as { active?: boolean; [key: string]: unknown }) }));
  const currentPlan = plans.find((p) => p.id === billingPlanId) ?? null;
  const billingStatus = await getTenantBillingStatus(tenantId);

  res.json({
    tenantId,
    billingPlanId,
    currentPlan,
    billingStatus,
    availablePlans: plans.filter((plan) => plan.active !== false),
    totals,
    byUsageType: Object.entries(summaryByType).map(([usageType, v]) => ({ usageType, ...v })),
    recentEvents: events,
  });
});

tenantRouter.post('/:tenantId/payments/marzpay/initialize', requireTenantParam, async (req, res) => {
  const body = z.object({
    billingPlanId: z.string().min(1),
    phoneNumber: z.string().trim().regex(/^\+\d{10,15}$/).optional(),
    phone_number: z.string().trim().regex(/^\+\d{10,15}$/).optional(),
    country: z.string().trim().length(2).optional(),
    description: z.string().trim().max(255).optional(),
    callbackUrl: z.string().url().max(255).optional(),
    callback_url: z.string().url().max(255).optional(),
  }).transform((data) => ({
    ...data,
    phoneNumber: data.phoneNumber ?? data.phone_number,
    callbackUrl: data.callbackUrl ?? data.callback_url,
  })).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: 'Invalid body', details: body.error.flatten() });
    return;
  }

  try {
    const tenantId = res.locals.tenantId as string;
    const tenantDoc = await db.collection('tenants').doc(tenantId).get();
    if (!tenantDoc.exists) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    const planDoc = await db.collection('billing_plans').doc(body.data.billingPlanId).get();
    if (!planDoc.exists) {
      res.status(404).json({ error: 'Billing plan not found' });
      return;
    }

    const plan = planDoc.data() ?? {};
    const usdAmount = typeof plan.priceUsd === 'number' ? plan.priceUsd : 0;
    const ugxAmount = typeof plan.priceUgx === 'number'
      ? plan.priceUgx
      : Math.round(usdAmount * Number(process.env.MARZPAY_USD_TO_UGX_RATE ?? 3800));

    if (ugxAmount < 500) {
      res.status(400).json({ error: 'Selected plan amount is below Marz minimum collection amount (500 UGX).' });
      return;
    }

    if (!body.data.phoneNumber) {
      res.status(400).json({ error: 'phoneNumber (or phone_number) is required for Marz collection.' });
      return;
    }

    const txRef = randomUUID();
    const webhookToken = process.env.MARZPAY_WEBHOOK_TOKEN?.trim();
    const apiBaseUrl = (process.env.API_BASE_URL ?? '').replace(/\/$/, '');
    const generatedCallbackBase = `${apiBaseUrl}/webhooks/marzpay/collections`;
    const generatedCallbackUrl = webhookToken ? `${generatedCallbackBase}?token=${encodeURIComponent(webhookToken)}` : generatedCallbackBase;
    const callbackUrl = body.data.callbackUrl ?? generatedCallbackUrl;

    if (!body.data.callbackUrl && !apiBaseUrl) {
      res.status(400).json({ error: 'Set API_BASE_URL env or provide callbackUrl in request body.' });
      return;
    }

    const initResult = await createMarzCollection({
      amount: ugxAmount,
      phoneNumber: body.data.phoneNumber,
      country: (body.data.country ?? 'UG').toUpperCase(),
      reference: txRef,
      description: body.data.description ?? `Subscription payment for ${body.data.billingPlanId}`,
      callbackUrl: callbackUrl || undefined,
    });

    await db.collection('payments').doc(txRef).set({
      provider: 'marzpay',
      tenantId,
      billingPlanId: body.data.billingPlanId,
      amount: ugxAmount,
      currency: 'UGX',
      txRef,
      status: 'processing',
      providerCollectionUuid: initResult.transactionUuid,
      providerTransactionId: initResult.providerReference,
      providerStatus: initResult.transactionStatus,
      callbackUrl: callbackUrl || null,
      createdByUid: res.locals.uid,
      createdAt: new Date(),
      updatedAt: new Date(),
    }, { merge: true });

    res.json({
      txRef,
      collectionUuid: initResult.transactionUuid,
      callbackUrl: callbackUrl || null,
      provider: 'marzpay',
      status: initResult.transactionStatus,
      message: 'Collection initiated. Prompt sent to tenant phone for approval.',
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to initialize Marz Pay payment';
    console.error('Failed to initialize Marz Pay payment:', e);
    res.status(502).json({ error: message });
  }
});

tenantRouter.post('/:tenantId/payments/marzpay/verify', requireTenantParam, async (req, res) => {
  const body = z.object({ txRef: z.string().uuid() }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: 'Invalid body', details: body.error.flatten() });
    return;
  }

  try {
    const tenantId = res.locals.tenantId as string;
    const paymentRef = db.collection('payments').doc(body.data.txRef);
    const paymentDoc = await paymentRef.get();
    if (!paymentDoc.exists) {
      res.status(404).json({ error: 'Payment not found' });
      return;
    }

    const paymentData = paymentDoc.data() ?? {};
    if (paymentData.tenantId !== tenantId) {
      res.status(403).json({ error: 'Payment does not belong to this tenant' });
      return;
    }

    const collectionUuid = typeof paymentData.providerCollectionUuid === 'string' ? paymentData.providerCollectionUuid : '';
    if (!collectionUuid) {
      res.status(400).json({ error: 'Missing collection uuid on payment record' });
      return;
    }

    const details = await getMarzCollectionDetails(collectionUuid);
    const billingPlanId = typeof paymentData.billingPlanId === 'string' ? paymentData.billingPlanId : null;
    const status = ['successful', 'success', 'completed', 'paid'].includes(details.status) ? 'completed' : details.status;

    if (status === 'completed' && billingPlanId) {
      await activateTenantSubscription(tenantId, billingPlanId);
    }

    await paymentRef.set({
      status,
      providerStatus: details.status,
      providerTransactionId: details.providerReference,
      paidAt: status === 'completed' ? new Date() : null,
      verifiedByUid: res.locals.uid,
      updatedAt: new Date(),
    }, { merge: true });

    res.json({ success: true, status });
  } catch (e) {
    console.error('Failed to verify Marz Pay payment:', e);
    res.status(500).json({ error: 'Failed to verify Marz Pay payment' });
  }
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
