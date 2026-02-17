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
