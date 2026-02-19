import { Router } from 'express';
import { requireAuth, requireTenantParam } from '../middleware/auth.js';
import { db } from '../config/firebase.js';

export const tenantRouter: Router = Router();

tenantRouter.use(requireAuth);
tenantRouter.use(requireTenantParam);

tenantRouter.get('/:tenantId', async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const doc = await db.collection('tenants').doc(tenantId).get();
  if (!doc.exists) {
    res.status(404).json({ error: 'Tenant not found' });
    return;
  }
  res.json({ tenantId, ...doc.data() });
});

tenantRouter.get('/:tenantId/analytics', async (req, res) => {
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
