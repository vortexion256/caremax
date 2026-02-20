import { Router } from 'express';
import { db, auth, bucket } from '../config/firebase.js';
import { requireAuth, requirePlatformAdmin } from '../middleware/auth.js';
import { z } from 'zod';
import { getTenantBillingStatus } from '../services/billing.js';

export const platformRouter: Router = Router();

// All platform routes require authentication and platform admin role
platformRouter.use(requireAuth, requirePlatformAdmin);

platformRouter.get('/tenants', async (_req, res) => {
  try {
    const snap = await db
      .collection('tenants')
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();

    const tenants = snap.docs.map((d) => {
      const data = d.data();
      return {
        tenantId: d.id,
        name: data.name ?? '',
        allowedDomains: data.allowedDomains ?? [],
        createdAt: data.createdAt?.toMillis?.() ?? null,
        createdBy: data.createdBy ?? null,
      };
    });

    res.json({ tenants });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load tenants' });
  }
});

platformRouter.get('/tenants/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const doc = await db.collection('tenants').doc(tenantId).get();
    
    if (!doc.exists) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    const data = doc.data();
    let createdByEmail: string | null = null;
    
    // Try to get the creator's email if createdBy UID exists
    if (data?.createdBy) {
      try {
        const user = await auth.getUser(data.createdBy);
        createdByEmail = user.email ?? null;
      } catch {
        // User might not exist anymore, ignore
      }
    }

    // Get agent config if it exists
    let agentConfig = null;
    try {
      const agentDoc = await db.collection('agent_config').doc(tenantId).get();
      if (agentDoc.exists) {
        const agentData = agentDoc.data();
        agentConfig = {
          agentName: agentData?.agentName ?? null,
          model: agentData?.model ?? null,
          ragEnabled: agentData?.ragEnabled ?? false,
          createdAt: agentData?.createdAt?.toMillis?.() ?? null,
        };
      }
    } catch {
      // Ignore if agent config doesn't exist
    }

    const usageSnap = await db
      .collection('usage_events')
      .where('tenantId', '==', tenantId)
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();

    const summaryByType: Record<string, { calls: number; inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number }> = {};
    let totals = { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 };

    const recentEvents = usageSnap.docs.map((eventDoc) => {
      const usageData = eventDoc.data();
      const usageType = typeof usageData.usageType === 'string' ? usageData.usageType : 'unknown';
      const inputTokens = typeof usageData.inputTokens === 'number' ? usageData.inputTokens : 0;
      const outputTokens = typeof usageData.outputTokens === 'number' ? usageData.outputTokens : 0;
      const totalTokens = typeof usageData.totalTokens === 'number' ? usageData.totalTokens : inputTokens + outputTokens;
      const costUsd = typeof usageData.costUsd === 'number' ? usageData.costUsd : 0;

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
        eventId: eventDoc.id,
        usageType,
        measurementSource: usageData.measurementSource ?? 'provider',
        inputTokens,
        outputTokens,
        totalTokens,
        costUsd,
        createdAt: usageData.createdAt?.toMillis?.() ?? null,
      };
    });

    const billingStatus = await getTenantBillingStatus(tenantId);

    res.json({
      tenantId: doc.id,
      name: data?.name ?? '',
      allowedDomains: data?.allowedDomains ?? [],
      createdAt: data?.createdAt?.toMillis?.() ?? null,
      createdBy: data?.createdBy ?? null,
      createdByEmail,
      agentConfig,
      billingPlanId: data?.billingPlanId ?? 'free',
      billingStatus,
      totals,
      byUsageType: Object.entries(summaryByType).map(([usageType, values]) => ({ usageType, ...values })),
      recentEvents,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load tenant details' });
  }
});

platformRouter.patch('/tenants/:tenantId/trial/end', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const tenantRef = db.collection('tenants').doc(tenantId);
    const tenantDoc = await tenantRef.get();

    if (!tenantDoc.exists) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    const tenantData = tenantDoc.data() ?? {};
    if ((tenantData.billingPlanId ?? 'free') !== 'free') {
      res.status(400).json({ error: 'Only trial tenants can have trial ended early.' });
      return;
    }

    const now = new Date();
    await tenantRef.set({
      trialUsed: true,
      trialEndsAt: now,
      subscriptionStatus: 'expired',
      updatedAt: now,
    }, { merge: true });

    const billingStatus = await getTenantBillingStatus(tenantId);
    res.json({ success: true, billingStatus });
  } catch (e) {
    console.error('Failed to end trial early:', e);
    res.status(500).json({ error: 'Failed to end trial early' });
  }
});

// Helper function to aggregate usage events
function aggregateUsage(
  docs: FirebaseFirestore.QueryDocumentSnapshot[]
): Array<{
  tenantId: string;
  totalTokens: number;
  totalCostUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  lastUsed: number | null;
}> {
  const totals: Record<
    string,
    {
      tenantId: string;
      totalTokens: number;
      totalCostUsd: number;
      calls: number;
      inputTokens: number;
      outputTokens: number;
      lastUsed: number | null;
    }
  > = {};

  for (const d of docs) {
    const data = d.data() as {
      tenantId?: string;
      totalTokens?: number;
      inputTokens?: number;
      outputTokens?: number;
      costUsd?: number;
      createdAt?: { toMillis?: () => number };
    };
    const tId = data.tenantId ?? 'unknown';
    const totalTokens = typeof data.totalTokens === 'number' ? data.totalTokens : 0;
    const inputTokens = typeof data.inputTokens === 'number' ? data.inputTokens : 0;
    const outputTokens = typeof data.outputTokens === 'number' ? data.outputTokens : 0;
    const costUsd = typeof data.costUsd === 'number' ? data.costUsd : 0;
    const createdAt = data.createdAt?.toMillis?.() ?? null;

    if (!totals[tId]) {
      totals[tId] = {
        tenantId: tId,
        totalTokens: 0,
        totalCostUsd: 0,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        lastUsed: null,
      };
    }
    totals[tId].totalTokens += totalTokens;
    totals[tId].inputTokens += inputTokens;
    totals[tId].outputTokens += outputTokens;
    totals[tId].totalCostUsd += costUsd;
    totals[tId].calls += 1;
    if (createdAt && (!totals[tId].lastUsed || createdAt > totals[tId].lastUsed)) {
      totals[tId].lastUsed = createdAt;
    }
  }

  return Object.values(totals).sort((a, b) => b.totalCostUsd - a.totalCostUsd);
}


const billingPlanSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  priceUsd: z.number().nonnegative(),
  billingCycle: z.enum(['monthly']),
  trialDays: z.number().int().nonnegative().default(0),
  active: z.boolean().default(true),
  description: z.string().optional(),
});

const billingPlansSchema = z.object({ plans: z.array(billingPlanSchema).min(1) });
const billingConfigSchema = z.object({
  inputCostPer1MTokensUsd: z.number().nonnegative(),
  outputCostPer1MTokensUsd: z.number().nonnegative(),
  availableModels: z.array(z.string().min(1)).min(1),
});

const defaultBillingConfig = {
  inputCostPer1MTokensUsd: 0.15,
  outputCostPer1MTokensUsd: 0.6,
  availableModels: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
};

platformRouter.get('/billing/plans', async (_req, res) => {
  try {
    let snap = await db.collection('billing_plans').orderBy('priceUsd', 'asc').get();

    if (snap.empty) {
      const defaults = [
        { id: 'free', name: '1 Month Free', priceUsd: 0, billingCycle: 'monthly', trialDays: 30, active: true, description: 'Worth 5 USD tokens' },
        { id: 'starter', name: 'Starter Pack', priceUsd: 10, billingCycle: 'monthly', trialDays: 0, active: true, description: 'Starter plan' },
        { id: 'advanced', name: 'Advanced Pack', priceUsd: 20, billingCycle: 'monthly', trialDays: 0, active: true, description: 'Advanced plan' },
        { id: 'super', name: 'Super Pack', priceUsd: 60, billingCycle: 'monthly', trialDays: 0, active: true, description: 'Super plan' },
        { id: 'enterprise', name: 'Enterprise', priceUsd: 100, billingCycle: 'monthly', trialDays: 0, active: true, description: 'Enterprise plan' },
      ];
      const batch = db.batch();
      for (const plan of defaults) {
        batch.set(db.collection('billing_plans').doc(plan.id), { ...plan, updatedAt: new Date() });
      }
      await batch.commit();
      snap = await db.collection('billing_plans').orderBy('priceUsd', 'asc').get();
    }

    const plans = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ plans });
  } catch (e) {
    console.error('Failed to load billing plans:', e);
    res.status(500).json({ error: 'Failed to load billing plans' });
  }
});

platformRouter.get('/billing/config', async (_req, res) => {
  try {
    const ref = db.collection('platform_settings').doc('saas_billing');
    const doc = await ref.get();
    if (!doc.exists) {
      await ref.set({ ...defaultBillingConfig, updatedAt: new Date() }, { merge: true });
      res.json(defaultBillingConfig);
      return;
    }

    const data = doc.data() ?? {};
    res.json({
      inputCostPer1MTokensUsd: typeof data.inputCostPer1MTokensUsd === 'number' ? data.inputCostPer1MTokensUsd : defaultBillingConfig.inputCostPer1MTokensUsd,
      outputCostPer1MTokensUsd: typeof data.outputCostPer1MTokensUsd === 'number' ? data.outputCostPer1MTokensUsd : defaultBillingConfig.outputCostPer1MTokensUsd,
      availableModels: Array.isArray(data.availableModels) && data.availableModels.length > 0 ? data.availableModels : defaultBillingConfig.availableModels,
    });
  } catch (e) {
    console.error('Failed to load billing config:', e);
    res.status(500).json({ error: 'Failed to load billing config' });
  }
});

platformRouter.put('/billing/config', async (req, res) => {
  const parsed = billingConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    return;
  }

  try {
    await db.collection('platform_settings').doc('saas_billing').set({
      ...parsed.data,
      updatedAt: new Date(),
    }, { merge: true });
    res.json({ success: true, ...parsed.data });
  } catch (e) {
    console.error('Failed to save billing config:', e);
    res.status(500).json({ error: 'Failed to save billing config' });
  }
});

platformRouter.put('/billing/plans', async (req, res) => {
  const parsed = billingPlansSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    return;
  }

  try {
    const batch = db.batch();
    for (const plan of parsed.data.plans) {
      batch.set(db.collection('billing_plans').doc(plan.id), { ...plan, updatedAt: new Date() }, { merge: true });
    }
    await batch.commit();
    res.json({ success: true, plans: parsed.data.plans });
  } catch (e) {
    console.error('Failed to save billing plans:', e);
    res.status(500).json({ error: 'Failed to save billing plans' });
  }
});

platformRouter.patch('/tenants/:tenantId/billing', async (req, res) => {
  const body = z.object({ billingPlanId: z.string().min(1) }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: 'Invalid body', details: body.error.flatten() });
    return;
  }

  try {
    const tenantRef = db.collection('tenants').doc(req.params.tenantId);
    const [tenantDoc, planDoc] = await Promise.all([
      tenantRef.get(),
      db.collection('billing_plans').doc(body.data.billingPlanId).get(),
    ]);

    if (!tenantDoc.exists) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    if (!planDoc.exists) {
      res.status(404).json({ error: 'Billing plan not found' });
      return;
    }

    const tenantData = tenantDoc.data() ?? {};
    const planData = planDoc.data() ?? {};
    const trialUsed = tenantData.trialUsed === true || Boolean(tenantData.trialEndsAt);

    if (body.data.billingPlanId === 'free' && trialUsed && tenantData.billingPlanId !== 'free') {
      res.status(400).json({ error: 'Free trial can only be used once during registration.' });
      return;
    }

    const now = Date.now();
    const monthlyDurationMs = 30 * 24 * 60 * 60 * 1000;
    const trialDays = typeof planData.trialDays === 'number' ? planData.trialDays : 30;

    if (body.data.billingPlanId === 'free') {
      await tenantRef.set({
        billingPlanId: 'free',
        trialUsed: true,
        trialStartedAt: tenantData.trialStartedAt ?? new Date(now),
        trialEndsAt: tenantData.trialEndsAt ?? new Date(now + trialDays * 24 * 60 * 60 * 1000),
        subscriptionEndsAt: null,
        subscriptionStatus: 'trialing',
        updatedAt: new Date(now),
      }, { merge: true });
      res.json({ success: true });
      return;
    }

    await tenantRef.set({
      billingPlanId: body.data.billingPlanId,
      trialUsed: true,
      subscriptionStartedAt: new Date(now),
      subscriptionEndsAt: new Date(now + monthlyDurationMs),
      subscriptionStatus: 'active',
      updatedAt: new Date(now),
    }, { merge: true });
    res.json({ success: true });
  } catch (e) {
    console.error('Failed to update tenant billing plan:', e);
    res.status(500).json({ error: 'Failed to update tenant billing plan' });
  }
});

// Usage summary per tenant (for billing / monitoring)
platformRouter.get('/usage', async (req, res) => {
  try {
    const { from, to, tenantId } = req.query as { from?: string; to?: string; tenantId?: string };

    // Build query - Firestore requires composite index for multiple where clauses with orderBy
    // Strategy: Use the most selective filter first, then filter in memory if needed
    let query: FirebaseFirestore.Query = db.collection('usage_events');

    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    if (toDate && !isNaN(toDate.getTime())) {
      toDate.setHours(23, 59, 59, 999);
    }

    // If we have both tenantId and date filters, prioritize tenantId (more selective)
    // and filter dates in memory to avoid composite index requirement
    if (tenantId && (fromDate || toDate)) {
      query = query.where('tenantId', '==', tenantId);
      const snap = await query.limit(10000).get();
      
      // Filter in memory by date
      const filteredDocs = snap.docs.filter((d) => {
        const data = d.data();
        const createdAt = data.createdAt?.toMillis?.() ?? null;
        if (!createdAt) return false;
        if (fromDate && !isNaN(fromDate.getTime()) && createdAt < fromDate.getTime()) return false;
        if (toDate && !isNaN(toDate.getTime()) && createdAt > toDate.getTime()) return false;
        return true;
      });

      const usageArray = aggregateUsage(filteredDocs);
      return res.json({ usage: usageArray });
    }

    // Simpler cases: single filter or no filters
    if (tenantId) {
      query = query.where('tenantId', '==', tenantId);
    }
    if (fromDate && !isNaN(fromDate.getTime())) {
      query = query.where('createdAt', '>=', fromDate);
    }
    if (toDate && !isNaN(toDate.getTime())) {
      query = query.where('createdAt', '<=', toDate);
    }

    // Only add orderBy if we don't have multiple where clauses (to avoid index requirement)
    if (!((tenantId && fromDate) || (tenantId && toDate) || (fromDate && toDate))) {
      query = query.orderBy('createdAt', 'desc');
    }

    const snap = await query.limit(10000).get();
    const usageArray = aggregateUsage(snap.docs);
    res.json({ usage: usageArray });
  } catch (e) {
    console.error('Failed to load usage summary:', e);
    res.status(500).json({ error: 'Failed to load usage summary' });
  }
});

// Get detailed usage for a specific tenant
platformRouter.get('/usage/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { from, to, limit = '100' } = req.query as { from?: string; to?: string; limit?: string };

    let query: FirebaseFirestore.Query = db
      .collection('usage_events')
      .where('tenantId', '==', tenantId)
      .orderBy('createdAt', 'desc');

    if (from) {
      const fromDate = new Date(from);
      if (!isNaN(fromDate.getTime())) {
        query = query.where('createdAt', '>=', fromDate);
      }
    }
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      if (!isNaN(toDate.getTime())) {
        query = query.where('createdAt', '<=', toDate);
      }
    }

    const limitNum = parseInt(limit, 10) || 100;
    const snap = await query.limit(Math.min(limitNum, 1000)).get();

    const events = snap.docs.map((d) => {
      const data = d.data();
      return {
        eventId: d.id,
        tenantId: data.tenantId ?? null,
        userId: data.userId ?? null,
        conversationId: data.conversationId ?? null,
        model: data.model ?? null,
        usageType: data.usageType ?? 'unknown',
        measurementSource: data.measurementSource ?? 'provider',
        inputTokens: data.inputTokens ?? 0,
        outputTokens: data.outputTokens ?? 0,
        totalTokens: data.totalTokens ?? 0,
        costUsd: data.costUsd ?? 0,
        createdAt: data.createdAt?.toMillis?.() ?? null,
      };
    });

    res.json({ events });
  } catch (e) {
    console.error('Failed to load tenant usage:', e);
    res.status(500).json({ error: 'Failed to load tenant usage' });
  }
});

// Reset/delete all usage events for a tenant
platformRouter.delete('/usage/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    // Verify tenant exists
    const tenantDoc = await db.collection('tenants').doc(tenantId).get();
    if (!tenantDoc.exists) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    // Delete all usage events for this tenant
    const usageSnap = await db.collection('usage_events').where('tenantId', '==', tenantId).get();
    
    if (usageSnap.empty) {
      res.json({ success: true, deletedCount: 0, message: 'No usage events found for this tenant' });
      return;
    }

    // Batch delete (Firestore limit is 500 operations per batch)
    let batch = db.batch();
    let batchCount = 0;
    let totalDeleted = 0;

    for (const doc of usageSnap.docs) {
      batch.delete(doc.ref);
      batchCount++;
      totalDeleted++;
      
      if (batchCount >= 500) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }

    // Commit final batch if there are remaining deletions
    if (batchCount > 0) {
      await batch.commit();
    }

    res.json({ success: true, deletedCount: totalDeleted, message: `Deleted ${totalDeleted} usage event(s) for tenant ${tenantId}` });
  } catch (e) {
    console.error('Failed to reset tenant usage:', e);
    res.status(500).json({ error: 'Failed to reset tenant usage' });
  }
});

platformRouter.delete('/tenants/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    // Verify tenant exists
    const tenantDoc = await db.collection('tenants').doc(tenantId).get();
    if (!tenantDoc.exists) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    const tenantData = tenantDoc.data();
    const createdBy = tenantData?.createdBy;

    // Helper function to commit batches (Firestore limit is 500 operations per batch)
    const commitBatch = async (batch: ReturnType<typeof db.batch>) => {
      await batch.commit();
    };

    // Delete all conversations and their messages
    const conversationsSnap = await db.collection('conversations').where('tenantId', '==', tenantId).get();
    const conversationIds: string[] = [];
    
    // Batch conversations deletions
    let batch = db.batch();
    let batchCount = 0;
    for (const convDoc of conversationsSnap.docs) {
      conversationIds.push(convDoc.id);
      batch.delete(convDoc.ref);
      batchCount++;
      if (batchCount >= 500) {
        await commitBatch(batch);
        batch = db.batch();
        batchCount = 0;
      }
    }

    // Delete all messages for these conversations
    if (conversationIds.length > 0) {
      // Firestore has a limit of 10 items per 'in' query, so we batch queries
      for (let i = 0; i < conversationIds.length; i += 10) {
        const batchIds = conversationIds.slice(i, i + 10);
        const messagesSnap = await db.collection('messages')
          .where('conversationId', 'in', batchIds)
          .get();
        for (const msgDoc of messagesSnap.docs) {
          batch.delete(msgDoc.ref);
          batchCount++;
          if (batchCount >= 500) {
            await commitBatch(batch);
            batch = db.batch();
            batchCount = 0;
          }
        }
      }
    }

    // Delete all RAG documents
    const ragDocsSnap = await db.collection('rag_documents').where('tenantId', '==', tenantId).get();
    for (const doc of ragDocsSnap.docs) {
      batch.delete(doc.ref);
      batchCount++;
      if (batchCount >= 500) {
        await commitBatch(batch);
        batch = db.batch();
        batchCount = 0;
      }
    }

    // Delete all RAG chunks for this tenant
    const ragChunksSnap = await db.collection('rag_chunks').where('tenantId', '==', tenantId).get();
    for (const chunkDoc of ragChunksSnap.docs) {
      batch.delete(chunkDoc.ref);
      batchCount++;
      if (batchCount >= 500) {
        await commitBatch(batch);
        batch = db.batch();
        batchCount = 0;
      }
    }

    // Delete agent config
    const agentConfigRef = db.collection('agent_config').doc(tenantId);
    const agentConfigDoc = await agentConfigRef.get();
    if (agentConfigDoc.exists) {
      batch.delete(agentConfigRef);
      batchCount++;
    }

    // Delete tenant document
    batch.delete(tenantDoc.ref);
    batchCount++;

    // Commit final batch
    if (batchCount > 0) {
      await commitBatch(batch);
    }

    // Delete storage files
    if (bucket) {
      try {
        const [files] = await bucket.getFiles({ prefix: `tenants/${tenantId}/` });
        await Promise.all(files.map((file) => file.delete()));
      } catch (storageError) {
        // Log but don't fail - storage deletion is best effort
        console.error('Error deleting storage files:', storageError);
      }
    }

    // Remove tenantId from user's custom claims (if createdBy exists)
    // IMPORTANT: Preserve isPlatformAdmin claim if user is a platform admin
    if (createdBy) {
      try {
        const user = await auth.getUser(createdBy);
        const currentClaims = user.customClaims || {};
        const updatedClaims = { ...currentClaims };
        delete updatedClaims.tenantId;
        delete updatedClaims.isAdmin;
        // Preserve isPlatformAdmin if it exists
        if (currentClaims.isPlatformAdmin) {
          updatedClaims.isPlatformAdmin = true;
        }
        await auth.setCustomUserClaims(createdBy, updatedClaims);
      } catch (authError) {
        // Log but don't fail - user might not exist anymore
        console.error('Error updating user claims:', authError);
      }
    }

    res.json({ success: true, message: 'Tenant and all associated data deleted successfully' });
  } catch (e) {
    console.error('Error deleting tenant:', e);
    res.status(500).json({ error: 'Failed to delete tenant' });
  }
});
