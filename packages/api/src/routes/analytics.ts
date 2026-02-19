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
    const results: Record<string, any> = {};

    for (const [label, startTime] of Object.entries(periods)) {
      const startTimestamp = new Date(startTime);
      
      // Query conversations for this tenant created after startTime
      const snap = await db.collection('conversations')
        .where('tenantId', '==', tenantId)
        .where('createdAt', '>=', startTimestamp)
        .get();

      let aiOnly = 0;
      let handoff = 0;
      const uniqueUsers = new Set();

      snap.docs.forEach(doc => {
        const data = doc.data();
        uniqueUsers.add(data.userId);
        
        // If status was ever handoff_requested or human_joined, count as handoff
        if (data.status === 'handoff_requested' || data.status === 'human_joined') {
          handoff++;
        } else {
          aiOnly++;
        }
      });

      results[label] = {
        totalConversations: snap.size,
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
