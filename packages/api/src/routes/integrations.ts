import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  getGoogleAuthUrl,
  exchangeCodeForTokens,
  isGoogleConnected,
  disconnectGoogle,
} from '../services/google-sheets.js';
import { requireAuth, requireTenantParam, requireAdmin } from '../middleware/auth.js';
import { db } from '../config/firebase.js';
import { activateTenantSubscription } from '../services/billing.js';
import { verifyMarzPayTransaction } from '../services/marzpay.js';
import { createTenantNotification } from '../services/tenant-notifications.js';
import { runAgent } from '../services/agent.js';
import { FieldValue } from 'firebase-admin/firestore';

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


type MarzPayCallbackPayload = {
  event_type?: string;
  transaction?: {
    uuid?: string;
    reference?: string;
    status?: string;
    updated_at?: string;
  };
  collection?: {
    provider_transaction_id?: string;
  };
};

integrationsCallbackRouter.post('/marzpay/callback', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as MarzPayCallbackPayload;
  const txRef = body.transaction?.reference;

  if (!txRef) {
    res.status(400).json({ error: 'Missing transaction reference' });
    return;
  }

  try {
    const paymentRef = db.collection('payments').doc(txRef);
    const paymentDoc = await paymentRef.get();
    if (!paymentDoc.exists) {
      res.status(404).json({ error: 'Payment not found' });
      return;
    }

    const paymentData = paymentDoc.data() ?? {};
    const tenantId = typeof paymentData.tenantId === 'string' ? paymentData.tenantId : null;
    const billingPlanId = typeof paymentData.billingPlanId === 'string' ? paymentData.billingPlanId : null;
    const collectionUuid = typeof paymentData.providerCollectionUuid === 'string' ? paymentData.providerCollectionUuid : body.transaction?.uuid;

    if (!tenantId || !billingPlanId) {
      await paymentRef.set({ status: 'failed', failureReason: 'Invalid payment metadata', updatedAt: new Date() }, { merge: true });
      res.status(400).json({ error: 'Invalid payment metadata' });
      return;
    }

    const verified = await verifyMarzPayTransaction({
      txRef,
      collectionUuid,
      status: body.transaction?.status,
    });

    const success = verified.status === 'completed';

    if (success) {
      await activateTenantSubscription(tenantId, billingPlanId);
      await createTenantNotification({
        tenantId,
        type: 'payment_success',
        title: 'Payment successful',
        message: `Your subscription payment for package "${billingPlanId}" has been completed.`,
        metadata: { txRef, billingPlanId },
      });
    } else {
      await createTenantNotification({
        tenantId,
        type: 'payment_failed',
        title: 'Payment failed',
        message: 'Your payment was not completed. Please try again to keep your subscription active.',
        metadata: { txRef, billingPlanId },
      });
    }

    await paymentRef.set({
      status: success ? 'completed' : 'failed',
      providerStatus: body.transaction?.status ?? verified.status,
      providerTransactionId: body.collection?.provider_transaction_id ?? verified.transactionId ?? null,
      providerCollectionUuid: collectionUuid ?? null,
      paidAt: success ? new Date(verified.paidAt ?? body.transaction?.updated_at ?? new Date().toISOString()) : null,
      callbackEvent: body.event_type ?? null,
      callbackPayload: body,
      updatedAt: new Date(),
    }, { merge: true });

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Marz Pay callback processing error:', error);
    res.status(500).json({ error: 'Failed to process callback' });
  }
});

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlResponse(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`;
}

integrationsCallbackRouter.post('/twilio/whatsapp/webhook/:tenantId', async (req: Request, res: Response) => {
  const tenantId = req.params.tenantId;
  const from = typeof req.body?.From === 'string' ? req.body.From.trim() : '';
  const body = typeof req.body?.Body === 'string' ? req.body.Body.trim() : '';

  if (!tenantId || !from || !body) {
    res.set('Content-Type', 'text/xml');
    res.status(200).send(xmlResponse('Message not received correctly. Please try again.'));
    return;
  }

  try {
    const integrationDoc = await db.collection('tenant_integrations').doc(tenantId).get();
    const whatsapp = integrationDoc.data()?.whatsapp;

    if (!whatsapp?.connected) {
      res.set('Content-Type', 'text/xml');
      res.status(200).send(xmlResponse('WhatsApp integration is not connected for this tenant.'));
      return;
    }

    const configuredSecret = typeof whatsapp.webhookSecret === 'string' ? whatsapp.webhookSecret.trim() : '';
    if (configuredSecret) {
      const suppliedSecret =
        (typeof req.query.secret === 'string' ? req.query.secret : '') ||
        (typeof req.headers['x-webhook-secret'] === 'string' ? req.headers['x-webhook-secret'] : '');
      if (suppliedSecret !== configuredSecret) {
        res.set('Content-Type', 'text/xml');
        res.status(200).send(xmlResponse('Webhook secret mismatch.'));
        return;
      }
    }

    const conversationsRef = db.collection('conversations');
    const existingConversationSnap = await conversationsRef
      .where('tenantId', '==', tenantId)
      .where('channel', '==', 'whatsapp')
      .where('externalUserId', '==', from)
      .where('status', 'in', ['open', 'handoff_requested', 'human_joined'])
      .orderBy('updatedAt', 'desc')
      .limit(1)
      .get();

    const conversationRef = existingConversationSnap.empty
      ? await conversationsRef.add({
        tenantId,
        userId: from,
        externalUserId: from,
        channel: 'whatsapp',
        status: 'open',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      : existingConversationSnap.docs[0].ref;

    await db.collection('messages').add({
      conversationId: conversationRef.id,
      tenantId,
      role: 'user',
      content: body,
      channel: 'whatsapp',
      createdAt: FieldValue.serverTimestamp(),
    });

    const conversationData = (await conversationRef.get()).data() ?? {};
    const status = typeof conversationData.status === 'string' ? conversationData.status : 'open';
    const humanActive = status === 'human_joined';
    const alreadyRequestedHandoff = status === 'handoff_requested';

    if (humanActive) {
      await conversationRef.update({ updatedAt: FieldValue.serverTimestamp() });
      res.set('Content-Type', 'text/xml');
      res.status(200).send(xmlResponse('A human care team member is currently assisting you.'));
      return;
    }

    const wantsHumanAgain =
      /\b(talk|speak|connect|transfer|hand me off|get me)\s+(to|with)\s+(a\s+)?(human|real\s+person|person|agent|someone|care\s+team|staff|representative)/i.test(body) ||
      /\b(let me\s+)?(talk|speak)\s+to\s+(a\s+)?(human|person|someone)/i.test(body) ||
      /\b(want|need)\s+to\s+(speak|talk)\s+to\s+(a\s+)?(human|person|someone)/i.test(body) ||
      /\b(real\s+person|human\s+agent|live\s+agent)/i.test(body);

    if (alreadyRequestedHandoff && wantsHumanAgain) {
      await conversationRef.update({ updatedAt: FieldValue.serverTimestamp() });
      const shortMessage = 'A care team member has already been notified and will join shortly.';
      await db.collection('messages').add({
        conversationId: conversationRef.id,
        tenantId,
        role: 'assistant',
        content: shortMessage,
        channel: 'whatsapp',
        createdAt: FieldValue.serverTimestamp(),
      });
      res.set('Content-Type', 'text/xml');
      res.status(200).send(xmlResponse(shortMessage));
      return;
    }

    if (status === 'open' && wantsHumanAgain) {
      await conversationRef.update({
        status: 'handoff_requested',
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    const historySnap = await db
      .collection('messages')
      .where('conversationId', '==', conversationRef.id)
      .orderBy('createdAt', 'asc')
      .get();

    const history = historySnap.docs.map((doc) => {
      const data = doc.data();
      return {
        role: data.role,
        content: data.content,
        imageUrls: data.imageUrls ?? [],
      };
    });

    const agentResponse = await runAgent(tenantId, history, {
      userId: from,
      conversationId: conversationRef.id,
    });

    await db.collection('messages').add({
      conversationId: conversationRef.id,
      tenantId,
      role: 'assistant',
      content: agentResponse.text,
      channel: 'whatsapp',
      createdAt: FieldValue.serverTimestamp(),
    });

    const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (agentResponse.requestHandoff) {
      updates.status = 'handoff_requested';
    }
    await conversationRef.update(updates);

    res.set('Content-Type', 'text/xml');
    res.status(200).send(xmlResponse(agentResponse.text));
  } catch (error) {
    console.error('Twilio WhatsApp webhook error:', error);
    res.set('Content-Type', 'text/xml');
    res.status(200).send(xmlResponse('Sorry, something went wrong while processing your message.'));
  }
});

/** Tenant-scoped integration routes (auth, status, disconnect). */
export const tenantIntegrationsRouter: Router = Router({ mergeParams: true });

tenantIntegrationsRouter.use(requireTenantParam);

const updateWhatsAppBody = z.object({
  accountSid: z.string().min(1),
  authToken: z.string().min(1),
  whatsappNumber: z.string().min(1),
  messagingServiceSid: z.string().optional(),
  webhookSecret: z.string().optional(),
});

function maskSecret(secret: string): string {
  if (secret.length <= 4) return '*'.repeat(secret.length);
  return `${'*'.repeat(Math.max(secret.length - 4, 0))}${secret.slice(-4)}`;
}

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

tenantIntegrationsRouter.get('/whatsapp', requireAuth, requireAdmin, async (_req, res) => {
  const tenantId = res.locals.tenantId as string;
  try {
    const doc = await db.collection('tenant_integrations').doc(tenantId).get();
    const whatsapp = doc.data()?.whatsapp;
    if (!whatsapp) {
      res.json({ connected: false });
      return;
    }

    res.json({
      connected: true,
      whatsappNumber: whatsapp.whatsappNumber,
      accountSid: whatsapp.accountSid,
      accountSidMasked: maskSecret(whatsapp.accountSid),
      authTokenMasked: maskSecret(whatsapp.authToken),
      messagingServiceSid: whatsapp.messagingServiceSid ?? '',
      webhookSecretMasked: whatsapp.webhookSecret ? maskSecret(whatsapp.webhookSecret) : '',
      updatedAt: whatsapp.updatedAt ?? null,
    });
  } catch (error) {
    console.error('WhatsApp integration fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch WhatsApp integration' });
  }
});

tenantIntegrationsRouter.put('/whatsapp', requireAuth, requireAdmin, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const parsed = updateWhatsAppBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    return;
  }

  try {
    await db.collection('tenant_integrations').doc(tenantId).set({
      tenantId,
      whatsapp: {
        ...parsed.data,
        connected: true,
        updatedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    res.json({ ok: true, connected: true });
  } catch (error) {
    console.error('WhatsApp integration update error:', error);
    res.status(500).json({ error: 'Failed to save WhatsApp integration' });
  }
});

tenantIntegrationsRouter.delete('/whatsapp', requireAuth, requireAdmin, async (_req, res) => {
  const tenantId = res.locals.tenantId as string;
  try {
    await db.collection('tenant_integrations').doc(tenantId).set({
      tenantId,
      whatsapp: null,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    res.json({ ok: true });
  } catch (error) {
    console.error('WhatsApp integration disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect WhatsApp integration' });
  }
});
