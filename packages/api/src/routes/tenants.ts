import { randomUUID } from 'node:crypto';
import { Request, Router } from 'express';
import { requireAuth, requireTenantParam } from '../middleware/auth.js';
import { db } from '../config/firebase.js';
import { activateTenantSubscription, getTenantBillingStatus, getTenantUsageTotalsSince } from '../services/billing.js';
import { initializeMarzPayPayment, verifyMarzPayTransaction } from '../services/marzpay.js';
import { z } from 'zod';
import { createTenantNotification } from '../services/tenant-notifications.js';

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



type TenantNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: number | null;
  metadata?: Record<string, unknown> | null;
};

type TenantUserActivity = {
  userKey: string;
  reminderCount: number;
  dueSoonCount: number;
  reminders: Array<{
    reminderId: string;
    message: string;
    dueAt: number | null;
    dueAtIso: string | null;
    channel: string | null;
    targetType: string | null;
    source: string | null;
    conversationId: string | null;
  }>;
  logCount: number;
  logs: Array<{
    logId: string;
    source: string;
    step: string;
    status: string;
    durationMs: number | null;
    conversationId: string | null;
    error: string | null;
    createdAt: number | null;
  }>;
};

const tenantNameUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

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
  const publicContentDoc = await db.collection('platform_settings').doc('public_content').get();
  const publicContent = publicContentDoc.data() ?? {};
  res.json({
    tenantId,
    name: data.name ?? '',
    privacyPolicy: typeof publicContent.privacyPolicy === 'string' ? publicContent.privacyPolicy : 'CareMax processes triage and operational data to provide secure healthcare support services. Legal policy content is maintained by the SaaS administrator.',
    termsOfService: typeof publicContent.termsOfService === 'string' ? publicContent.termsOfService : 'Use of CareMax must comply with applicable law and clinical governance standards. Full service terms are maintained by the SaaS administrator.',
    contactEmail: typeof publicContent.contactEmail === 'string' ? publicContent.contactEmail : 'support@caremax.health',
    contactPhonePrimary: typeof publicContent.contactPhonePrimary === 'string' ? publicContent.contactPhonePrimary : '+256782830524',
    contactPhoneSecondary: typeof publicContent.contactPhoneSecondary === 'string' ? publicContent.contactPhoneSecondary : '+256753190830',
    allowedDomains: data.allowedDomains ?? [],
    createdAt: data.createdAt?.toMillis?.() ?? null,
    createdBy: data.createdBy ?? null,
    billingPlanId: data.billingPlanId ?? 'free',
  });
});

tenantRouter.get('/:tenantId/user-activity', requireTenantParam, async (req, res) => {
  try {
    const tenantId = res.locals.tenantId as string;
    const { reminderLimit = '200', logLimit = '250' } = req.query as {
      reminderLimit?: string;
      logLimit?: string;
    };

    const parsedReminderLimit = Number.parseInt(reminderLimit, 10);
    const parsedLogLimit = Number.parseInt(logLimit, 10);
    const reminderCap = Number.isFinite(parsedReminderLimit) ? Math.min(Math.max(parsedReminderLimit, 1), 500) : 200;
    const logCap = Number.isFinite(parsedLogLimit) ? Math.min(Math.max(parsedLogLimit, 1), 500) : 250;
    const now = new Date();

    const remindersSnap = await db
      .collection('reminders')
      .where('tenantId', '==', tenantId)
      .where('status', '==', 'pending')
      .orderBy('dueAt', 'asc')
      .limit(reminderCap)
      .get();

    const logsSnap = await db
      .collection('tenant_diagnostic_logs')
      .where('tenantId', '==', tenantId)
      .orderBy('createdAt', 'desc')
      .limit(logCap)
      .get();

    const conversationIds = new Set<string>();
    for (const d of logsSnap.docs) {
      const conversationId = d.data().conversationId;
      if (typeof conversationId === 'string' && conversationId.trim()) {
        conversationIds.add(conversationId.trim());
      }
    }

    const normalizePatientKey = (value: unknown): string => {
      if (typeof value !== 'string') return '';
      const trimmed = value.trim();
      if (!trimmed) return '';
      return trimmed.toLowerCase().startsWith('whatsapp:') ? trimmed : `whatsapp:${trimmed}`;
    };

    const conversationUserById = new Map<string, string>();
    if (conversationIds.size > 0) {
      const refs = Array.from(conversationIds).map((id) => db.collection('conversations').doc(id));
      const convDocs = await db.getAll(...refs);
      for (const doc of convDocs) {
        if (!doc.exists) continue;
        const data = doc.data() ?? {};
        const resolvedUser = normalizePatientKey(data.externalUserId);
        if (resolvedUser) conversationUserById.set(doc.id, resolvedUser);
      }
    }

    const userMap = new Map<string, TenantUserActivity>();
    const ensureUserBucket = (userKey: string): TenantUserActivity | null => {
      const normalizedKey = userKey.trim();
      if (!normalizedKey) return null;
      if (!userMap.has(normalizedKey)) {
        userMap.set(normalizedKey, {
          userKey: normalizedKey,
          reminderCount: 0,
          dueSoonCount: 0,
          reminders: [],
          logCount: 0,
          logs: [],
        });
      }
      return userMap.get(normalizedKey) ?? null;
    };

    for (const d of remindersSnap.docs) {
      const data = d.data();
      const userKey =
        normalizePatientKey(data.ownerExternalUserId)
        || normalizePatientKey(data.externalUserId)
        || normalizePatientKey(data.targetExternalUserId)
        || '';
      const bucket = ensureUserBucket(userKey);
      if (!bucket) continue;

      const dueAtMs = data.dueAt?.toMillis?.() ?? null;
      bucket.reminderCount += 1;
      if (typeof dueAtMs === 'number' && dueAtMs <= now.getTime() + (24 * 60 * 60 * 1000)) {
        bucket.dueSoonCount += 1;
      }
      bucket.reminders.push({
        reminderId: d.id,
        message: typeof data.message === 'string' ? data.message : '',
        dueAt: dueAtMs,
        dueAtIso: typeof dueAtMs === 'number' ? new Date(dueAtMs).toISOString() : null,
        channel: typeof data.channel === 'string' ? data.channel : null,
        targetType: typeof data.targetType === 'string' ? data.targetType : null,
        source: typeof data.source === 'string' ? data.source : null,
        conversationId: typeof data.conversationId === 'string' ? data.conversationId : null,
      });
    }

    for (const d of logsSnap.docs) {
      const data = d.data();
      const metadata = data.metadata && typeof data.metadata === 'object'
        ? (data.metadata as Record<string, unknown>)
        : null;
      const metadataUser =
        normalizePatientKey(metadata?.externalUserId)
        || normalizePatientKey(metadata?.ownerExternalUserId)
        || normalizePatientKey(metadata?.patientExternalUserId)
        || normalizePatientKey(metadata?.targetExternalUserId)
        || '';
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : '';
      const conversationUser = conversationId ? (conversationUserById.get(conversationId) ?? '') : '';
      const userKey = metadataUser || conversationUser;
      const bucket = ensureUserBucket(userKey);
      if (!bucket) continue;

      bucket.logCount += 1;
      if (bucket.logs.length < 40) {
        bucket.logs.push({
          logId: d.id,
          source: typeof data.source === 'string' ? data.source : 'unknown',
          step: typeof data.step === 'string' ? data.step : 'unknown',
          status: typeof data.status === 'string' ? data.status : 'ok',
          durationMs: typeof data.durationMs === 'number' ? data.durationMs : null,
          conversationId: conversationId || null,
          error: typeof data.error === 'string' ? data.error : null,
          createdAt: data.createdAt?.toMillis?.() ?? null,
        });
      }
    }

    const users = Array.from(userMap.values()).sort((a, b) => {
      if (b.reminderCount !== a.reminderCount) return b.reminderCount - a.reminderCount;
      return b.logCount - a.logCount;
    });

    res.json({
      users,
      totals: {
        usersWithReminders: users.filter((u) => u.reminderCount > 0).length,
        usersWithLogs: users.filter((u) => u.logCount > 0).length,
        reminders: users.reduce((sum, u) => sum + u.reminderCount, 0),
        logs: users.reduce((sum, u) => sum + u.logCount, 0),
      },
    });
  } catch (e) {
    console.error('Failed to load user activity for tenant:', e);
    res.status(500).json({ error: 'Failed to load user activity for tenant' });
  }
});

tenantRouter.put('/:tenantId/account', requireTenantParam, async (req, res) => {
  const body = tenantNameUpdateSchema.safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: 'Invalid body', details: body.error.flatten() });
    return;
  }

  const tenantId = res.locals.tenantId as string;
  const tenantRef = db.collection('tenants').doc(tenantId);
  const tenantDoc = await tenantRef.get();

  if (!tenantDoc.exists) {
    res.status(404).json({ error: 'Tenant not found' });
    return;
  }

  await tenantRef.set(
    {
      name: body.data.name,
      updatedAt: new Date(),
    },
    { merge: true }
  );

  res.json({ success: true, ...body.data });
});

tenantRouter.get('/:tenantId/billing', requireTenantParam, async (_req, res) => {
  const tenantId = res.locals.tenantId as string;

  const tenantDoc = await db.collection('tenants').doc(tenantId).get();
  const tenantData = tenantDoc.data() ?? {};
  const cycleStartMs =
    tenantData.subscriptionStartedAt?.toMillis?.()
    ?? tenantData.trialStartedAt?.toMillis?.()
    ?? tenantData.createdAt?.toMillis?.()
    ?? (Date.now() - (30 * 24 * 60 * 60 * 1000));

  const totals = await getTenantUsageTotalsSince(tenantId, cycleStartMs);

  const usageSnap = await db
    .collection('usage_events')
    .where('tenantId', '==', tenantId)
    .where('createdAt', '>=', new Date(cycleStartMs))
    .orderBy('createdAt', 'desc')
    .limit(200)
    .get();

  const summaryByType: Record<string, { calls: number; inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number }> = {};
  let summarizedTotals = { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 };

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

    summarizedTotals.calls += 1;
    summarizedTotals.inputTokens += inputTokens;
    summarizedTotals.outputTokens += outputTokens;
    summarizedTotals.totalTokens += totalTokens;
    summarizedTotals.costUsd += costUsd;

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
    availablePlans: plans.filter((plan) => plan.active !== false && plan.id !== 'free'),
    totals,
    byUsageType: Object.entries(summaryByType).map(([usageType, v]) => ({ usageType, ...v })),
    recentUsageWindowTotals: summarizedTotals,
    showUsageByApiFlow: tenantData.showUsageByApiFlow === true,
    maxTokensPerUser: typeof tenantData.maxTokensPerUser === 'number' ? tenantData.maxTokensPerUser : null,
    maxSpendUgxPerUser: typeof tenantData.maxSpendUgxPerUser === 'number' ? tenantData.maxSpendUgxPerUser : null,
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
    const tenantData = tenantDoc.data() ?? {};
    const currentPlanId = typeof tenantData.billingPlanId === 'string' ? tenantData.billingPlanId : 'free';
    const billingStatus = await getTenantBillingStatus(tenantId);

    if (currentPlanId !== 'free' && billingStatus.isActive && body.data.billingPlanId !== currentPlanId) {
      res.status(400).json({ error: 'Plan changes are only allowed after your current package expires.' });
      return;
    }

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

tenantRouter.get('/:tenantId/payments/:txRef/status', requireTenantParam, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const txRef = req.params.txRef;

  if (!txRef || txRef.trim().length < 1) {
    res.status(400).json({ error: 'Invalid transaction reference' });
    return;
  }

  try {
    const paymentDoc = await db.collection('payments').doc(txRef).get();
    if (!paymentDoc.exists) {
      res.status(404).json({ error: 'Payment not found' });
      return;
    }

    const paymentData = paymentDoc.data() ?? {};
    if (paymentData.tenantId !== tenantId) {
      res.status(403).json({ error: 'Payment does not belong to this tenant' });
      return;
    }

    res.json({
      txRef,
      status: typeof paymentData.status === 'string' ? paymentData.status : 'pending',
      providerStatus: typeof paymentData.providerStatus === 'string' ? paymentData.providerStatus : null,
      failureReason: typeof paymentData.failureReason === 'string' ? paymentData.failureReason : null,
      billingPlanId: typeof paymentData.billingPlanId === 'string' ? paymentData.billingPlanId : null,
      paidAt: paymentData.paidAt?.toMillis?.() ?? null,
      updatedAt: paymentData.updatedAt?.toMillis?.() ?? null,
    });
  } catch (e) {
    console.error('Failed to fetch payment status:', e);
    res.status(500).json({ error: 'Failed to fetch payment status' });
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
      await createTenantNotification({
        tenantId,
        type: 'payment_failed',
        title: 'Payment failed',
        message: 'Your latest subscription payment could not be verified. Please try again.',
        metadata: { txRef: body.data.txRef },
      });
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

    await createTenantNotification({
      tenantId,
      type: 'payment_success',
      title: 'Payment successful',
      message: `Your subscription payment for package "${billingPlanId}" has been completed.`,
      metadata: { txRef: body.data.txRef, billingPlanId },
    });

    res.json({ success: true, status: 'completed', billingPlanId, durationDays: 30 });
  } catch (e) {
    console.error('Failed to verify Marz Pay payment:', e);
    res.status(500).json({ error: 'Failed to verify Marz Pay payment' });
  }
});



tenantRouter.get('/:tenantId/notifications', requireTenantParam, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);

  try {
    let snap;
    try {
      snap = await db
        .collection('tenant_notifications')
        .where('tenantId', '==', tenantId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
    } catch (e: any) {
      if (e?.code === 9 || e?.message?.includes('index')) {
        console.warn('Firestore index missing for tenant notifications, falling back to in-memory sorting');
        snap = await db
          .collection('tenant_notifications')
          .where('tenantId', '==', tenantId)
          .limit(limit)
          .get();
      } else {
        throw e;
      }
    }

    let notifications: TenantNotification[] = snap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        type: typeof data.type === 'string' ? data.type : 'info',
        title: typeof data.title === 'string' ? data.title : 'Notification',
        message: typeof data.message === 'string' ? data.message : '',
        read: data.read === true,
        metadata: (data.metadata as Record<string, unknown>) ?? null,
        createdAt: data.createdAt?.toMillis?.() ?? null,
      };
    });

    notifications = notifications
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .slice(0, limit);

    res.json({ notifications });
  } catch (e) {
    console.error('Failed to load tenant notifications:', e);
    res.status(500).json({ error: 'Failed to load tenant notifications' });
  }
});

tenantRouter.patch('/:tenantId/notifications/:notificationId/read', requireTenantParam, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const { notificationId } = req.params;

  try {
    const ref = db.collection('tenant_notifications').doc(notificationId);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }

    const data = doc.data() ?? {};
    if (data.tenantId !== tenantId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    await ref.set({ read: true, readAt: new Date() }, { merge: true });
    res.json({ success: true });
  } catch (e) {
    console.error('Failed to mark notification as read:', e);
    res.status(500).json({ error: 'Failed to update notification' });
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
