import type { BaseMessage } from '@langchain/core/messages';
import { db } from '../config/firebase.js';
import { createTenantNotification } from './tenant-notifications.js';

export type UsageMetadata = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  measurementSource?: 'provider' | 'estimated';
};

export type UsageContext = {
  tenantId: string;
  userId?: string;
  conversationId?: string;
  usageType?: string;
};

type BillingModelPricing = {
  model: string;
  inputCostPer1MTokensUsd: number;
  outputCostPer1MTokensUsd: number;
};

const BILLING_CONFIG_CACHE_TTL_MS = 60_000;
const DEFAULT_MODEL_PRICING: BillingModelPricing[] = [
  { model: 'gemini-2.0-flash', inputCostPer1MTokensUsd: 0.15, outputCostPer1MTokensUsd: 0.6 },
  { model: 'gemini-1.5-flash', inputCostPer1MTokensUsd: 0.15, outputCostPer1MTokensUsd: 0.6 },
  { model: 'gemini-1.5-pro', inputCostPer1MTokensUsd: 3.5, outputCostPer1MTokensUsd: 10.5 },
];

let cachedModelPricing:
  | {
      expiresAt: number;
      value: Map<string, { inputCostPer1MTokensUsd: number; outputCostPer1MTokensUsd: number }>;
    }
  | null = null;

export function invalidateBillingModelPricingCache(): void {
  cachedModelPricing = null;
}

function toNum(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizeModelPricing(entries: unknown): Map<string, { inputCostPer1MTokensUsd: number; outputCostPer1MTokensUsd: number }> {
  const normalized = new Map<string, { inputCostPer1MTokensUsd: number; outputCostPer1MTokensUsd: number }>();

  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const model = typeof (entry as { model?: unknown }).model === 'string' ? (entry as { model: string }).model.trim() : '';
      const inputCostPer1MTokensUsd = toNum((entry as { inputCostPer1MTokensUsd?: unknown }).inputCostPer1MTokensUsd);
      const outputCostPer1MTokensUsd = toNum((entry as { outputCostPer1MTokensUsd?: unknown }).outputCostPer1MTokensUsd);
      if (!model) continue;
      normalized.set(model, { inputCostPer1MTokensUsd, outputCostPer1MTokensUsd });
    }
  }

  if (normalized.size > 0) return normalized;

  for (const entry of DEFAULT_MODEL_PRICING) {
    normalized.set(entry.model, {
      inputCostPer1MTokensUsd: entry.inputCostPer1MTokensUsd,
      outputCostPer1MTokensUsd: entry.outputCostPer1MTokensUsd,
    });
  }
  return normalized;
}

async function getBillingModelPricing(): Promise<Map<string, { inputCostPer1MTokensUsd: number; outputCostPer1MTokensUsd: number }>> {
  const now = Date.now();
  if (cachedModelPricing && cachedModelPricing.expiresAt > now) {
    return cachedModelPricing.value;
  }

  try {
    const doc = await db.collection('platform_settings').doc('saas_billing').get();
    const modelPricing = normalizeModelPricing(doc.data()?.modelPricing);
    cachedModelPricing = {
      value: modelPricing,
      expiresAt: now + BILLING_CONFIG_CACHE_TTL_MS,
    };
    return modelPricing;
  } catch (error) {
    console.warn('Failed to load SaaS billing model pricing; using default billing config values.', error);
    const fallbackPricing = normalizeModelPricing(DEFAULT_MODEL_PRICING);
    cachedModelPricing = {
      value: fallbackPricing,
      expiresAt: now + BILLING_CONFIG_CACHE_TTL_MS,
    };
    return fallbackPricing;
  }
}

function estimateTokensFromText(text: string): number {
  // Lightweight approximation (~4 chars/token in English).
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateInputTokensFromMessages(messages: BaseMessage[]): number {
  const totalChars = messages.reduce((sum, msg) => {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
    return sum + content.length;
  }, 0);
  return Math.max(1, Math.ceil(totalChars / 4));
}

export function extractTokenUsage(response: BaseMessage): UsageMetadata {
  try {
    const additionalKwargs = (response as { additional_kwargs?: Record<string, unknown> }).additional_kwargs ?? {};
    const responseMetadata = (response as { response_metadata?: Record<string, unknown> }).response_metadata ?? {};

    const tokenUsage = (responseMetadata.tokenUsage ?? {}) as Record<string, unknown>;
    const usageMetadata = (responseMetadata.usageMetadata ?? responseMetadata.usage_metadata ?? {}) as Record<string, unknown>;

    const inputTokens =
      toNum(tokenUsage.promptTokens) ||
      toNum(tokenUsage.inputTokens) ||
      toNum(usageMetadata.promptTokenCount) ||
      toNum(usageMetadata.promptTokens) ||
      toNum(usageMetadata.input_tokens);

    const outputTokens =
      toNum(tokenUsage.completionTokens) ||
      toNum(tokenUsage.outputTokens) ||
      toNum(usageMetadata.candidatesTokenCount) ||
      toNum(usageMetadata.candidatesTokens) ||
      toNum(usageMetadata.output_tokens);

    const totalTokens =
      toNum(tokenUsage.totalTokens) ||
      toNum(usageMetadata.totalTokenCount) ||
      toNum(usageMetadata.totalTokens) ||
      toNum(usageMetadata.total_tokens) ||
      inputTokens + outputTokens;

    if (inputTokens > 0 || outputTokens > 0 || totalTokens > 0) {
      return { inputTokens, outputTokens, totalTokens: totalTokens || inputTokens + outputTokens, measurementSource: 'provider' };
    }

    const fallbackText =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content ?? additionalKwargs ?? '');
    const estimatedOutput = estimateTokensFromText(fallbackText);
    return {
      inputTokens: 0,
      outputTokens: estimatedOutput,
      totalTokens: estimatedOutput,
      measurementSource: 'estimated',
    };
  } catch (e) {
    console.error('Failed to extract token usage:', e);
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0, measurementSource: 'estimated' };
  }
}

export function mergeUsage(...usageParts: UsageMetadata[]): UsageMetadata {
  const inputTokens = usageParts.reduce((sum, u) => sum + (u.inputTokens || 0), 0);
  const outputTokens = usageParts.reduce((sum, u) => sum + (u.outputTokens || 0), 0);
  const totalTokens = usageParts.reduce((sum, u) => sum + (u.totalTokens || 0), 0) || inputTokens + outputTokens;
  const measurementSource = usageParts.every((u) => u.measurementSource === 'provider') ? 'provider' : 'estimated';
  return { inputTokens, outputTokens, totalTokens, measurementSource };
}

export async function computeCostUsd(model: string, usage: UsageMetadata): Promise<number> {
  const pricingMap = await getBillingModelPricing();
  const pricing = pricingMap.get(model) ?? pricingMap.get('gemini-2.0-flash') ?? pricingMap.values().next().value ?? {
    inputCostPer1MTokensUsd: 0,
    outputCostPer1MTokensUsd: 0,
  };
  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputCostPer1MTokensUsd;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputCostPer1MTokensUsd;
  return Number((inputCost + outputCost).toFixed(8));
}

export async function recordUsage(modelName: string, usage: UsageMetadata, ctx: UsageContext): Promise<void> {
  try {
    const costUsd = await computeCostUsd(modelName, usage);
    const createdAt = new Date();
    await db.collection('usage_events').add({
      tenantId: ctx.tenantId,
      userId: ctx.userId ?? null,
      conversationId: ctx.conversationId ?? null,
      model: modelName,
      usageType: ctx.usageType ?? 'unknown',
      measurementSource: usage.measurementSource ?? 'provider',
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      costUsd,
      createdAt,
    });

    const tenantRef = db.collection('tenants').doc(ctx.tenantId);
    const tenantDoc = await tenantRef.get();
    if (!tenantDoc.exists) return;
    const tenantData = tenantDoc.data() ?? {};

    const maxTokensPerUser = typeof tenantData.maxTokensPerUser === 'number' ? tenantData.maxTokensPerUser : null;
    const maxSpendUgxPerUser = typeof tenantData.maxSpendUgxPerUser === 'number' ? tenantData.maxSpendUgxPerUser : null;

    const billingPlanId = typeof tenantData.billingPlanId === 'string' ? tenantData.billingPlanId : 'free';
    const planDoc = await db.collection('billing_plans').doc(billingPlanId).get();
    const planData = planDoc.data() ?? {};
    const maxTokensPerPackage = typeof planData.maxTokensPerPackage === 'number' ? planData.maxTokensPerPackage : null;
    const maxUsageAmountUgxPerPackage = typeof planData.maxUsageAmountUgxPerPackage === 'number' ? planData.maxUsageAmountUgxPerPackage : null;

    const hasUserLimits = Boolean(maxTokensPerUser || maxSpendUgxPerUser);
    const hasPackageLimits = Boolean(maxTokensPerPackage || maxUsageAmountUgxPerPackage);
    if (!hasUserLimits && !hasPackageLimits) return;

    const cycleStart = tenantData.subscriptionStartedAt?.toMillis?.() ?? tenantData.trialStartedAt?.toMillis?.() ?? (Date.now() - 30 * 24 * 60 * 60 * 1000);
    const usageSnap = await db
      .collection('usage_events')
      .where('tenantId', '==', ctx.tenantId)
      .where('createdAt', '>=', new Date(cycleStart))
      .get();

    let userTokens = 0;
    let userCostUsd = 0;
    let totalTokens = 0;
    let totalCostUsd = 0;
    usageSnap.forEach((doc) => {
      const data = doc.data();
      const eventTokens = typeof data.totalTokens === 'number' ? data.totalTokens : 0;
      const eventCostUsd = typeof data.costUsd === 'number' ? data.costUsd : 0;
      const eventUserId = typeof data.userId === 'string' ? data.userId : null;

      totalTokens += eventTokens;
      totalCostUsd += eventCostUsd;

      if (ctx.userId && eventUserId === ctx.userId) {
        userTokens += eventTokens;
        userCostUsd += eventCostUsd;
      }
    });

    const userCostUgx = Math.round(userCostUsd * Number(process.env.MARZPAY_USD_TO_UGX_RATE ?? 3800));
    const totalCostUgx = Math.round(totalCostUsd * Number(process.env.MARZPAY_USD_TO_UGX_RATE ?? 3800));
    const exceededUserTokens = Boolean(ctx.userId) && typeof maxTokensPerUser === 'number' && userTokens >= maxTokensPerUser;
    const exceededUserSpend = Boolean(ctx.userId) && typeof maxSpendUgxPerUser === 'number' && userCostUgx >= maxSpendUgxPerUser;
    const exceededPackageTokens = typeof maxTokensPerPackage === 'number' && totalTokens >= maxTokensPerPackage;
    const exceededPackageSpend = typeof maxUsageAmountUgxPerPackage === 'number' && totalCostUgx >= maxUsageAmountUgxPerPackage;

    if (!exceededUserTokens && !exceededUserSpend && !exceededPackageTokens && !exceededPackageSpend) return;

    const exceededReason = exceededPackageTokens
      ? 'package_token_limit_reached'
      : exceededPackageSpend
        ? 'package_usage_amount_limit_reached'
        : exceededUserTokens
          ? 'user_token_limit_reached'
          : 'user_spend_limit_reached';

    const expiredMessage = exceededReason === 'package_token_limit_reached'
      ? 'Your package token limit has been depleted, so your subscription expired before month end.'
      : exceededReason === 'package_usage_amount_limit_reached'
        ? 'Your package usage amount has been depleted, so your subscription expired before month end.'
        : exceededReason === 'user_token_limit_reached'
          ? 'Your per-user token limit has been depleted, so your subscription expired before month end.'
          : 'Your per-user spend limit has been depleted, so your subscription expired before month end.';

    await tenantRef.set({
      subscriptionStatus: 'expired',
      subscriptionEndsAt: new Date(),
      updatedAt: new Date(),
      subscriptionExpiredReason: exceededReason,
    }, { merge: true });

    await createTenantNotification({
      tenantId: ctx.tenantId,
      type: 'subscription_expired',
      title: 'Subscription expired early',
      message: expiredMessage,
      metadata: {
        userId: ctx.userId,
        userTokens,
        userCostUgx,
        totalTokens,
        totalCostUgx,
        maxTokensPerUser,
        maxSpendUgxPerUser,
        maxTokensPerPackage,
        maxUsageAmountUgxPerPackage,
      },
    });
  } catch (e) {
    console.error('Failed to record usage event:', e);
  }
}
