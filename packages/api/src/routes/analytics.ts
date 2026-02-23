import { Router } from 'express';
import { db } from '../config/firebase.js';
import { requireAuth, requireTenantParam, requireAdmin } from '../middleware/auth.js';

export const analyticsRouter: Router = Router({ mergeParams: true });

analyticsRouter.use(requireTenantParam);
analyticsRouter.use(requireAuth);
analyticsRouter.use(requireAdmin);

analyticsRouter.get('/interactions', async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const now = Date.now();
  
  const periods = {
    '1d': now - 24 * 60 * 60 * 1000,
    '7d': now - 7 * 24 * 60 * 60 * 1000,
    '1w': now - 7 * 24 * 60 * 60 * 1000, // Same as 7d
    '1m': now - 30 * 24 * 60 * 60 * 1000,
    '1y': now - 365 * 24 * 60 * 60 * 1000,
  };

  try {
    // Fetch all conversations for the tenant once to avoid multiple queries and potential index issues
    // We'll filter in-memory for the different periods since the dataset for a single tenant is likely manageable
    const [conversationSnap, messageSnap] = await Promise.all([
      db.collection('conversations')
        .where('tenantId', '==', tenantId)
        .get(),
      db.collection('messages')
        .where('tenantId', '==', tenantId)
        .where('role', '==', 'human_agent')
        .get(),
    ]);

    const conversationsWithHumanMessages = new Set(
      messageSnap.docs
        .map((doc) => doc.data().conversationId as string | undefined)
        .filter((conversationId): conversationId is string => Boolean(conversationId)),
    );

    const results: Record<string, any> = {};
    const allDocs = conversationSnap.docs.map(doc => ({
      id: doc.id,
      data: doc.data(),
      createdAtMs: doc.data().createdAt?.toMillis?.() || 0
    }));

    for (const [label, startTime] of Object.entries(periods)) {
      let aiOnly = 0;
      let handoff = 0;
      const uniqueUsers = new Set();
      let count = 0;

      allDocs.forEach(doc => {
        if (doc.createdAtMs >= startTime) {
          count++;
          const data = doc.data;
          uniqueUsers.add(data.userId);
          
          const hasHumanMessage = conversationsWithHumanMessages.has(doc.id);
          if (hasHumanMessage || data.status === 'handoff_requested' || data.status === 'human_joined') {
            handoff++;
          } else {
            aiOnly++;
          }
        }
      });

      results[label] = {
        totalConversations: count,
        aiOnlyResolved: aiOnly,
        humanAiResolved: handoff,
        uniqueUsers: uniqueUsers.size,
      };
    }

    res.json(results);
  } catch (e) {
    console.error('Analytics error:', e);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});


analyticsRouter.get('/conversations', async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const period = typeof req.query.period === 'string' ? req.query.period : '7d';
  const now = Date.now();

  const offsetByPeriod: Record<string, number> = {
    '1d': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '1w': 7 * 24 * 60 * 60 * 1000,
    '1m': 30 * 24 * 60 * 60 * 1000,
    '1y': 365 * 24 * 60 * 60 * 1000,
  };
  const startTime = now - (offsetByPeriod[period] ?? offsetByPeriod['7d']);

  try {
    const [conversationSnap, messageSnap] = await Promise.all([
      db.collection('conversations').where('tenantId', '==', tenantId).get(),
      db.collection('messages').where('tenantId', '==', tenantId).get(),
    ]);

    const conversationMap = new Map<string, { conversationId: string; createdAt: number; totalMessages: number }>();
    for (const doc of conversationSnap.docs) {
      const data = doc.data();
      const createdAt = data.createdAt?.toMillis?.() ?? 0;
      if (createdAt >= startTime) {
        conversationMap.set(doc.id, { conversationId: doc.id, createdAt, totalMessages: 0 });
      }
    }

    for (const doc of messageSnap.docs) {
      const data = doc.data();
      const convId = typeof data.conversationId === 'string' ? data.conversationId : null;
      if (!convId || !conversationMap.has(convId)) continue;
      const bucket = conversationMap.get(convId)!;
      bucket.totalMessages += 1;
    }

    const conversations = Array.from(conversationMap.values()).sort((a, b) => b.createdAt - a.createdAt);

    res.json({
      period,
      totalConversations: conversations.length,
      conversations,
    });
  } catch (e) {
    console.error('Conversation analytics error:', e);
    res.status(500).json({ error: 'Failed to fetch conversation analytics' });
  }
});
