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
    const snap = await db.collection('conversations')
      .where('tenantId', '==', tenantId)
      .get();

    const results: Record<string, any> = {};
    const allDocs = snap.docs.map(doc => ({
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
          
          if (data.status === 'handoff_requested' || data.status === 'human_joined') {
            handoff++;
          } else {
            aiOnly++;
          }
        }
      });

      results[label] = {
        totalConversations: count,
        aiOnly,
        handoff,
        uniqueUsers: uniqueUsers.size,
      };
    }

    res.json(results);
  } catch (e) {
    console.error('Analytics error:', e);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});
