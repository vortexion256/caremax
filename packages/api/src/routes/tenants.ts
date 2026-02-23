import { randomUUID } from 'node:crypto';
import { Request, Router } from 'express';
import { requireAuth, requireTenantParam } from '../middleware/auth.js';
import { db } from '../config/firebase.js';
import { activateTenantSubscription, getTenantBillingStatus } from '../services/billing.js';
import { initializeMarzPayPayment, verifyMarzPayTransaction } from '../services/marzpay.js';
import { z } from 'zod';

export const tenantRouter: Router = Router();

tenantRouter.use(requireAuth);


function resolveMarzPayCallbackUrl(req: Request, requestedCallbackUrl?: string): string {
  const explicit = (requestedCallbackUrl ?? '').trim();
  if (explicit) return explicit;

  const fromEnv = (process.env.MARZPAY_CALLBACK_URL ?? '').trim();
  if (fromEnv) return fromEnv;

  const fromApiBase = (process.env.API_BASE_URL ?? 'https://caremax-api.vercel.app').trim();
  if (fromApiBase) {
    return `${fromApiBase.replace(/\/$/, '')}/integrations/marzpay/callback`;
  }

  const forwardedProto = (req.header('x-forwarded-proto') ?? '').split(',')[0]?.trim();
  const protocol = forwardedProto || req.protocol || 'https';
  const host = req.get('host');
  if (!host) {
    throw new Error('Unable to resolve callback URL host. Set MARZPAY_CALLBACK_URL explicitly.');
  }

  return `${protocol}://${host}/integrations/marzpay/callback`;
}

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
  const plans = plansSnap.docs
    .map((d) => {
      const data = d.data() as { active?: boolean; priceUgx?: number; priceUsd?: number; [key: string]: unknown };
      const priceUgx = typeof data.priceUgx === 'number'
        ? data.priceUgx
        : (typeof data.priceUsd === 'number' ? Math.round(data.priceUsd * Number(process.env.MARZPAY_USD_TO_UGX_RATE ?? 3800)) : 0);
      return { id: d.id, ...data, priceUgx };
    })
    .sort((a, b) => ((a.priceUgx as number) - (b.priceUgx as number)));
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
    country: z.string().trim().length(2).default('UG'),
    description: z.string().trim().max(255).optional(),
    callbackUrl: z.string().url().max(255).optional(),
    callback_url: z.string().url().max(255).optional(),
  }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: 'Invalid body', details: body.error.flatten() });
    return;
  }

  const phoneNumber = body.data.phoneNumber ?? body.data.phone_number;
  if (!phoneNumber) {
    res.status(400).json({ error: 'Invalid body', details: { phoneNumber: ['Required'] } });
    return;
  }

  const callbackUrl = resolveMarzPayCallbackUrl(req, body.data.callbackUrl ?? body.data.callback_url);

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
    const priceUgx = typeof plan.priceUgx === 'number'
      ? plan.priceUgx
      : (typeof plan.priceUsd === 'number' ? Math.round(plan.priceUsd * Number(process.env.MARZPAY_USD_TO_UGX_RATE ?? 3800)) : 0);

    if (!Number.isFinite(priceUgx) || priceUgx < 500) {
      res.status(400).json({ error: 'Selected plan amount is invalid for Marz Pay collection (minimum 500 UGX).' });
      return;
    }

    const txRef = randomUUID();

    const initResult = await initializeMarzPayPayment({
      reference: txRef,
      amount: priceUgx,
      phoneNumber,
      country: body.data.country.toUpperCase(),
      description: body.data.description ?? `Subscription payment for ${body.data.billingPlanId}`,
      callbackUrl,
    });

    await db.collection('payments').doc(txRef).set({
      provider: 'marzpay',
      tenantId,
      billingPlanId: body.data.billingPlanId,
      amount: priceUgx,
      currency: 'UGX',
      txRef,
      status: initResult.status,
      phoneNumber,
      providerCollectionUuid: initResult.collectionUuid,
      providerReference: initResult.providerReference ?? null,
      createdByUid: res.locals.uid,
      createdAt: new Date(),
      updatedAt: new Date(),
    }, { merge: true });

    res.json({
      txRef,
      collectionUuid: initResult.collectionUuid,
      callbackUrl: callbackUrl ?? null,
      provider: 'marzpay',
      status: initResult.status,
      message: 'Collection initiated. Prompt customer to approve payment on their phone.',
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to initialize Marz Pay payment';
    console.error('Failed to initialize Marz Pay payment:', e);
    res.status(502).json({ error: message });
  }
});

tenantRouter.post('/:tenantId/payments/marzpay/verify', requireTenantParam, async (req, res) => {
  const body = z.object({ txRef: z.string().min(1), collectionUuid: z.string().uuid().optional(), status: z.string().optional() }).safeParse(req.body);
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

    const verified = await verifyMarzPayTransaction(body.data);
    if (!verified) {
      res.status(400).json({ error: 'Payment verification failed' });
      return;
    }
    const billingPlanId = typeof paymentData.billingPlanId === 'string' ? paymentData.billingPlanId : null;
    const verificationStatus = (verified.status ?? '').toLowerCase();
    const status = ['successful', 'success', 'completed', 'paid'].includes(verificationStatus) ? 'completed' : 'failed';

    const isValid = status === 'completed' && billingPlanId;

    if (!isValid || !billingPlanId) {
      await paymentRef.set({
        status: 'failed',
        failureReason: 'Verification mismatch or incomplete payment',
        providerTransactionId: verified.transactionId ?? body.data.collectionUuid ?? null,
        providerStatus: verified.status ?? 'unknown',
        updatedAt: new Date(),
      }, { merge: true });
      res.status(400).json({ error: 'Payment verification failed' });
      return;
    }

    await activateTenantSubscription(tenantId, billingPlanId);

    await paymentRef.set({
      status,
      providerTransactionId: verified.transactionId ?? body.data.collectionUuid ?? null,
      providerStatus: verified.status ?? 'unknown',
      paidAt: verified.paidAt ? new Date(verified.paidAt) : new Date(),
      verifiedByUid: res.locals.uid,
      updatedAt: new Date(),
    }, { merge: true });

    res.json({ success: true, status: 'completed', billingPlanId, durationDays: 30 });
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
