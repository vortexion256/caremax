import { Router, Request, Response } from 'express';
import {
  getGoogleAuthUrl,
  exchangeCodeForTokens,
  isGoogleConnected,
  disconnectGoogle,
} from '../services/google-sheets.js';
import { requireAuth, requireTenantParam, requireAdmin } from '../middleware/auth.js';

/** Callback from Google OAuth - no auth; state = tenantId. Redirects to admin. */
export const integrationsCallbackRouter: Router = Router();

integrationsCallbackRouter.get('/google/callback', async (req: Request, res: Response) => {
  const { code, state: tenantId, error } = req.query;
  const adminBaseUrl = process.env.ADMIN_BASE_URL ?? 'http://localhost:5173';
  const redirectPath = '/integrations';
  const successUrl = `${adminBaseUrl}${redirectPath}?google=success&tenantId=${encodeURIComponent(String(tenantId ?? ''))}`;
  const errorUrl = `${adminBaseUrl}${redirectPath}?google=error&tenantId=${encodeURIComponent(String(tenantId ?? ''))}`;

  if (error || !code || !tenantId || typeof tenantId !== 'string') {
    res.redirect(errorUrl);
    return;
  }
  try {
    await exchangeCodeForTokens(tenantId, String(code));
    res.redirect(successUrl);
  } catch (e) {
    console.error('Google OAuth callback error:', e);
    res.redirect(errorUrl);
  }
});

/** Tenant-scoped integration routes (auth, status, disconnect). */
export const tenantIntegrationsRouter: Router = Router({ mergeParams: true });

tenantIntegrationsRouter.use(requireTenantParam);

/** Returns the Google OAuth URL so the admin can redirect the user (with auth token in request). */
tenantIntegrationsRouter.get('/google/auth-url', requireAuth, requireAdmin, (req, res) => {
  const tenantId = res.locals.tenantId as string;
  try {
    const url = getGoogleAuthUrl(tenantId);
    res.json({ url });
  } catch (e) {
    console.error('Google auth URL error:', e);
    res.status(500).json({ error: 'Google OAuth not configured (set GOOGLE_OAUTH_* env vars)' });
  }
});

tenantIntegrationsRouter.get('/google/status', requireAuth, requireAdmin, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  try {
    const connected = await isGoogleConnected(tenantId);
    res.json({ connected });
  } catch (e) {
    console.error('Google status error:', e);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

tenantIntegrationsRouter.post('/google/disconnect', requireAuth, requireAdmin, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  try {
    await disconnectGoogle(tenantId);
    res.json({ ok: true });
  } catch (e) {
    console.error('Google disconnect error:', e);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});
