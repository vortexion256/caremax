import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../config/firebase.js';
import { requireAuth } from '../middleware/auth.js';

export const authRouter = Router();

const googleBody = z.object({ idToken: z.string() });

authRouter.post('/google', async (req, res) => {
  const parsed = googleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    return;
  }
  try {
    const decoded = await auth.verifyIdToken(parsed.data.idToken);
    res.json({
      uid: decoded.uid,
      email: decoded.email,
      tenantId: (decoded as { tenantId?: string }).tenantId,
      isAdmin: (decoded as { isAdmin?: boolean }).isAdmin === true,
    });
  } catch (e) {
    res.status(401).json({ error: 'Invalid Google token' });
  }
});

authRouter.get('/me', requireAuth, (_req, res) => {
  const { uid, email, tenantId, isAdmin } = res.locals as { uid: string; email?: string; tenantId?: string; isAdmin?: boolean };
  res.json({ uid, email, tenantId, isAdmin });
});
