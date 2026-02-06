import { Router } from 'express';
import { db, auth } from '../config/firebase.js';
import { requireAuth, requirePlatformAdmin } from '../middleware/auth.js';

export const platformRouter = Router();

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

    res.json({
      tenantId: doc.id,
      name: data?.name ?? '',
      allowedDomains: data?.allowedDomains ?? [],
      createdAt: data?.createdAt?.toMillis?.() ?? null,
      createdBy: data?.createdBy ?? null,
      createdByEmail,
      agentConfig,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load tenant details' });
  }
});

