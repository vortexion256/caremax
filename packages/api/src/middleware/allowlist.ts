import { Request, Response, NextFunction } from 'express';

const fromEnv = process.env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean) ?? [];
const devOrigins = ['http://localhost:3002', 'http://localhost:3010', 'http://localhost:5173', 'http://localhost:5177', 'http://127.0.0.1:3002', 'http://127.0.0.1:3010', 'http://127.0.0.1:5173', 'http://127.0.0.1:5177'];
const allowedOrigins = fromEnv.length ? [...new Set([...fromEnv, ...devOrigins])] : [];

function isDevOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export function domainAllowlist(req: Request, res: Response, next: NextFunction): void {
  const referrer = req.get('referer') ?? req.get('origin') ?? '';
  let origin = '';
  try {
    origin = referrer ? new URL(referrer).origin : '';
  } catch {
    origin = '';
  }
  if (origin && allowedOrigins.length > 0) {
    if (isDevOrigin(origin) || allowedOrigins.includes(origin)) {
      next();
      return;
    }
    res.status(403).json({ error: 'Origin not allowed' });
    return;
  }
  next();
}
