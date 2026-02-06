import { Request, Response, NextFunction } from 'express';

const store = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = Number(process.env.RATE_LIMIT_MAX) || 600;

export function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = req.ip ?? req.get('x-forwarded-for') ?? req.get('x-real-ip') ?? 'unknown';
  const now = Date.now();
  let entry = store.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    store.set(key, entry);
  }
  entry.count++;
  if (entry.count > MAX_PER_WINDOW) {
    res.status(429).json({ error: 'Too many requests' });
    return;
  }
  setImmediate(() => {
    const e = store.get(key);
    if (e && Date.now() > e.resetAt) store.delete(key);
  });
  next();
}
