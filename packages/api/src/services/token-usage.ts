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

const GEMINI_PRICING_USD: Record<string, { inputPer1K: number; outputPer1K: number }> = {
  'gemini-3-flash-preview': { inputPer1K: 0.000075, outputPer1K: 0.0003 },
  'gemini-1.5-pro': { inputPer1K: 0.0035, outputPer1K: 0.0105 },
};

function toNum(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
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

export function computeCostUsd(model: string, usage: UsageMetadata): number {
  const pricing = GEMINI_PRICING_USD[model] ?? GEMINI_PRICING_USD['gemini-3-flash-preview'];
  const inputCost = (usage.inputTokens / 1000) * pricing.inputPer1K;
  const outputCost = (usage.outputTokens / 1000) * pricing.outputPer1K;
  return Number((inputCost + outputCost).toFixed(8));
}

export async function recordUsage(modelName: string, usage: UsageMetadata, ctx: UsageContext): Promise<void> {
  try {
    const costUsd = computeCostUsd(modelName, usage);
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

    if (!ctx.userId) return;

    const tenantRef = db.collection('tenants').doc(ctx.tenantId);
    const tenantDoc = await tenantRef.get();
    if (!tenantDoc.exists) return;
    const tenantData = tenantDoc.data() ?? {};

    const maxTokensPerUser = typeof tenantData.maxTokensPerUser === 'number' ? tenantData.maxTokensPerUser : null;
    const maxSpendUgxPerUser = typeof tenantData.maxSpendUgxPerUser === 'number' ? tenantData.maxSpendUgxPerUser : null;

    if (!maxTokensPerUser && !maxSpendUgxPerUser) return;

    const cycleStart = tenantData.subscriptionStartedAt?.toMillis?.() ?? tenantData.trialStartedAt?.toMillis?.() ?? (Date.now() - 30 * 24 * 60 * 60 * 1000);
    const usageSnap = await db
      .collection('usage_events')
      .where('tenantId', '==', ctx.tenantId)
      .where('userId', '==', ctx.userId)
      .where('createdAt', '>=', new Date(cycleStart))
      .get();

    let totalTokens = 0;
    let totalCostUsd = 0;
    usageSnap.forEach((doc) => {
      const data = doc.data();
      totalTokens += typeof data.totalTokens === 'number' ? data.totalTokens : 0;
      totalCostUsd += typeof data.costUsd === 'number' ? data.costUsd : 0;
    });

    const totalCostUgx = Math.round(totalCostUsd * Number(process.env.MARZPAY_USD_TO_UGX_RATE ?? 3800));
    const exceededTokens = typeof maxTokensPerUser === 'number' && totalTokens >= maxTokensPerUser;
    const exceededSpend = typeof maxSpendUgxPerUser === 'number' && totalCostUgx >= maxSpendUgxPerUser;

    if (!exceededTokens && !exceededSpend) return;

    await tenantRef.set({
      subscriptionStatus: 'expired',
      subscriptionEndsAt: new Date(),
      updatedAt: new Date(),
      subscriptionExpiredReason: exceededTokens
        ? 'user_token_limit_reached'
        : 'user_spend_limit_reached',
    }, { merge: true });

    await createTenantNotification({
      tenantId: ctx.tenantId,
      type: 'subscription_expired',
      title: 'Subscription expired early',
      message: exceededTokens
        ? 'Your per-user token limit has been depleted, so your subscription expired before month end.'
        : 'Your per-user spend limit has been depleted, so your subscription expired before month end.',
      metadata: {
        userId: ctx.userId,
        totalTokens,
        totalCostUgx,
        maxTokensPerUser,
        maxSpendUgxPerUser,
      },
    });
  } catch (e) {
    console.error('Failed to record usage event:', e);
  }
}
