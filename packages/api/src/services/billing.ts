import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';

type BillingPlan = {
  id: string;
  trialDays?: number;
  billingCycle?: 'monthly';
};

type TenantBillingDoc = {
  billingPlanId?: string;
  createdAt?: Timestamp | Date | { toMillis?: () => number };
  trialStartedAt?: Timestamp | Date | { toMillis?: () => number };
  trialEndsAt?: Timestamp | Date | { toMillis?: () => number };
  subscriptionEndsAt?: Timestamp | Date | { toMillis?: () => number };
  subscriptionStatus?: 'active' | 'expired' | 'trialing' | string;
  subscriptionExpiredReason?: string;
  trialUsed?: boolean;
};

export const WIDGET_BILLING_ERROR = 'Widget Error 725 - "please contact admin"';

const DAY_MS = 24 * 60 * 60 * 1000;

function toMillis(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && value !== null) {
    if ('toMillis' in value && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
      return (value as { toMillis: () => number }).toMillis();
    }
  }
  return null;
}

function remainingDays(untilMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((untilMs - nowMs) / DAY_MS));
}

async function loadPlans(): Promise<Map<string, BillingPlan>> {
  const snap = await db.collection('billing_plans').get();
  return new Map(snap.docs.map((d) => [d.id, { id: d.id, ...(d.data() as Omit<BillingPlan, 'id'>) }]));
}

export async function getTenantBillingStatus(tenantId: string): Promise<{
  billingPlanId: string;
  isTrialPlan: boolean;
  isActive: boolean;
  isExpired: boolean;
  expiredReason: string | null;
  daysRemaining: number | null;
  trialEndsAt: number | null;
  subscriptionEndsAt: number | null;
  trialUsed: boolean;
}> {
  const [tenantDoc, plans] = await Promise.all([
    db.collection('tenants').doc(tenantId).get(),
    loadPlans(),
  ]);

  if (!tenantDoc.exists) {
    return {
      billingPlanId: 'free',
      isTrialPlan: true,
      isActive: false,
      isExpired: true,
      expiredReason: 'tenant_not_found',
      daysRemaining: 0,
      trialEndsAt: null,
      subscriptionEndsAt: null,
      trialUsed: true,
    };
  }

  const data = (tenantDoc.data() ?? {}) as TenantBillingDoc;
  const billingPlanId = data.billingPlanId ?? 'free';
  const isTrialPlan = billingPlanId === 'free';
  const nowMs = Date.now();

  const createdAtMs = toMillis(data.createdAt);
  const trialStartedAtMs = toMillis(data.trialStartedAt) ?? createdAtMs ?? nowMs;
  const configuredTrialDays = plans.get('free')?.trialDays ?? 30;
  const trialEndsAtMs = toMillis(data.trialEndsAt) ?? (trialStartedAtMs + configuredTrialDays * DAY_MS);

  const subscriptionEndsAtMs = toMillis(data.subscriptionEndsAt);
  const forceExpired = data.subscriptionStatus === 'expired';
  const storedExpiredReason = typeof data.subscriptionExpiredReason === 'string' ? data.subscriptionExpiredReason : null;
  const trialUsed = data.trialUsed === true || isTrialPlan || Boolean(toMillis(data.trialEndsAt));

  if (isTrialPlan) {
    const isActive = !forceExpired && nowMs <= trialEndsAtMs;
    const expiredReason = isActive ? null : (storedExpiredReason ?? 'trial_ended');
    return {
      billingPlanId,
      isTrialPlan,
      isActive,
      isExpired: !isActive,
      expiredReason,
      daysRemaining: remainingDays(trialEndsAtMs, nowMs),
      trialEndsAt: trialEndsAtMs,
      subscriptionEndsAt: null,
      trialUsed,
    };
  }

  if (!subscriptionEndsAtMs) {
    const isActive = !forceExpired;
    const expiredReason = isActive ? null : (storedExpiredReason ?? 'limit_reached');
    return {
      billingPlanId,
      isTrialPlan,
      isActive,
      isExpired: !isActive,
      expiredReason,
      daysRemaining: null,
      trialEndsAt: trialEndsAtMs,
      subscriptionEndsAt: null,
      trialUsed,
    };
  }

  const isActive = !forceExpired && nowMs <= subscriptionEndsAtMs;
  const expiredReason = isActive ? null : (storedExpiredReason ?? 'duration_elapsed');
  return {
    billingPlanId,
    isTrialPlan,
    isActive,
    isExpired: !isActive,
    expiredReason,
    daysRemaining: remainingDays(subscriptionEndsAtMs, nowMs),
    trialEndsAt: trialEndsAtMs,
    subscriptionEndsAt: subscriptionEndsAtMs,
    trialUsed,
  };
}

export async function activateTenantSubscription(tenantId: string, billingPlanId: string, nowMs = Date.now()): Promise<void> {
  const tenantRef = db.collection('tenants').doc(tenantId);
  const monthlyDurationMs = 30 * DAY_MS;

  await tenantRef.set({
    billingPlanId,
    trialUsed: true,
    subscriptionStartedAt: new Date(nowMs),
    subscriptionEndsAt: new Date(nowMs + monthlyDurationMs),
    subscriptionStatus: 'active',
    updatedAt: new Date(nowMs),
  }, { merge: true });
}
