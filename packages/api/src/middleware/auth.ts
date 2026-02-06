import { Request, Response, NextFunction } from 'express';
import { auth } from '../config/firebase.js';

export type AuthLocals = {
  uid: string;
  email?: string;
  tenantId?: string;
  isAdmin?: boolean;
};

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }
  try {
    const decoded = await auth.verifyIdToken(token);
    (res.locals as AuthLocals).uid = decoded.uid;
    (res.locals as AuthLocals).email = decoded.email;
    (res.locals as AuthLocals).tenantId = (decoded as { tenantId?: string }).tenantId;
    (res.locals as AuthLocals).isAdmin = (decoded as { isAdmin?: boolean }).isAdmin === true;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

export function requireTenantParam(req: Request, res: Response, next: NextFunction): void {
  const tenantId = req.params.tenantId;
  if (!tenantId) {
    res.status(400).json({ error: 'Missing tenantId' });
    return;
  }
  (res.locals as { tenantId: string }).tenantId = tenantId;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const locals = res.locals as AuthLocals;
  if (!locals.isAdmin) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}
