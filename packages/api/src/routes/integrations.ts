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
import { runConfiguredAgent } from '../services/agent-dispatcher.js';
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

function xmlEmptyResponse(): string {
  return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function twilioBasicAuthHeader(accountSid: string, authToken: string): string {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;
}

async function sendWhatsAppMessage(params: {
  accountSid: string;
  authToken: string;
  to: string;
  body: string;
  from?: string;
  messagingServiceSid?: string;
}): Promise<void> {
  const payload = new URLSearchParams();
  payload.set('To', params.to);
  payload.set('Body', params.body);

  if (params.messagingServiceSid) {
    payload.set('MessagingServiceSid', params.messagingServiceSid);
  } else if (params.from) {
    payload.set('From', params.from);
  } else {
    throw new Error('Twilio outbound message requires either messagingServiceSid or from number');
  }

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(params.accountSid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: twilioBasicAuthHeader(params.accountSid, params.authToken),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: payload,
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Twilio outbound send failed (${response.status}): ${errorText}`);
  }
}


function isLikelyWhatsAppVoiceNote(payload: Request['body']): boolean {
  const messageType = typeof payload?.MessageType === 'string' ? payload.MessageType.trim().toLowerCase() : '';
  const numMedia = Number.parseInt(String(payload?.NumMedia ?? '0'), 10);
  const mediaType = typeof payload?.MediaContentType0 === 'string' ? payload.MediaContentType0.trim().toLowerCase() : '';
  const mediaUrl = typeof payload?.MediaUrl0 === 'string' ? payload.MediaUrl0.trim().toLowerCase() : '';

  if (!Number.isFinite(numMedia) || numMedia !== 1) return false;
  if (!mediaType.startsWith('audio/')) return false;

  // Twilio commonly marks inbound WhatsApp voice notes as MessageType=audio.
  // We also accept typical voice-note codecs/extensions as a fallback.
  const hasVoiceType = messageType === 'audio';
  const hasVoiceCodec = mediaType.includes('ogg') || mediaType.includes('opus');
  const hasVoiceExt = mediaUrl.endsWith('.ogg') || mediaUrl.endsWith('.opus');

  return hasVoiceType || hasVoiceCodec || hasVoiceExt;
}

async function transcribeWhatsAppAudio(params: {
  mediaUrl: string;
  contentType: string;
  accountSid: string;
  authToken: string;
}): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;

  try {
    const audioRes = await fetch(params.mediaUrl, {
      headers: {
        Authorization: twilioBasicAuthHeader(params.accountSid, params.authToken),
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!audioRes.ok) return null;

    const audioBuf = Buffer.from(await audioRes.arrayBuffer());
    const base64Audio = audioBuf.toString('base64');

    const transcriptionRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: 'Transcribe this audio verbatim. Return only the transcript text with no extra commentary.',
              },
              {
                inline_data: {
                  mime_type: params.contentType,
                  data: base64Audio,
                },
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!transcriptionRes.ok) return null;

    const payload = await transcriptionRes.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const transcript = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join(' ').trim();
    return transcript || null;
  } catch (error) {
    console.warn('WhatsApp audio transcription failed:', error);
    return null;
  }
}

integrationsCallbackRouter.post('/twilio/whatsapp/webhook/:tenantId', async (req: Request, res: Response) => {
  const tenantId = req.params.tenantId;
  const from = typeof req.body?.From === 'string' ? req.body.From.trim() : '';

  if (!tenantId || !from) {
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

    let body = typeof req.body?.Body === 'string' ? req.body.Body.trim() : '';
    const hasVoiceNote = isLikelyWhatsAppVoiceNote(req.body);

    if (!body && hasVoiceNote) {
      const mediaUrl = typeof req.body?.MediaUrl0 === 'string' ? req.body.MediaUrl0.trim() : '';
      const mediaType = typeof req.body?.MediaContentType0 === 'string' ? req.body.MediaContentType0.trim().toLowerCase() : '';
      const isAudio = mediaType.startsWith('audio/');
      const accountSid = typeof whatsapp.accountSid === 'string' ? whatsapp.accountSid.trim() : '';
      const authToken = typeof whatsapp.authToken === 'string' ? whatsapp.authToken.trim() : '';

      if (isAudio && mediaUrl && accountSid && authToken) {
        const transcript = await transcribeWhatsAppAudio({
          mediaUrl,
          contentType: mediaType,
          accountSid,
          authToken,
        });
        if (transcript) {
          body = transcript;
        }
      }
    }

    if (!body) {
      res.set('Content-Type', 'text/xml');
      res.status(200).send(xmlResponse('We could not read that message yet. Please send text or a clearer voice note.'));
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
      res.status(200).send(xmlEmptyResponse());
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
      res.set('Content-Type', 'text/xml');
      res.status(200).send(xmlResponse(shortMessage));

      void db.collection('messages').add({
        conversationId: conversationRef.id,
        tenantId,
        role: 'assistant',
        content: shortMessage,
        channel: 'whatsapp',
        createdAt: FieldValue.serverTimestamp(),
      }).catch((error) => {
        console.error('Failed to persist WhatsApp short handoff message:', error);
      });
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
      .orderBy('createdAt', 'desc')
      .limit(30)
      .get();

    const history = historySnap.docs.reverse().map((doc) => {
      const data = doc.data();
      return {
        role: data.role,
        content: data.content,
        imageUrls: data.imageUrls ?? [],
      };
    });

    const pendingReplyText = 'Thanks for your message. I am checking and will reply shortly.';
    let responseText = pendingReplyText;
    let requestHandoff = false;
    let aiTimedOut = false;

    try {
      const agentResponse = await withTimeout(
        runConfiguredAgent(tenantId, history, {
          userId: from,
          conversationId: conversationRef.id,
        }),
        14000,
        'AI response timed out while handling Twilio webhook',
      );
      responseText = agentResponse.text;
      requestHandoff = agentResponse.requestHandoff ?? false;
    } catch (error) {
      aiTimedOut = true;
      console.error('WhatsApp webhook AI execution timed out or failed:', error);
    }

    res.set('Content-Type', 'text/xml');
    res.status(200).send(xmlResponse(responseText));

    void (async () => {
      await db.collection('messages').add({
        conversationId: conversationRef.id,
        tenantId,
        role: 'assistant',
        content: responseText,
        channel: 'whatsapp',
        createdAt: FieldValue.serverTimestamp(),
      });

      const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
      if (requestHandoff) {
        updates.status = 'handoff_requested';
      }
      await conversationRef.update(updates);

      if (!aiTimedOut) {
        return;
      }

      try {
        const delayedAgentResponse = await runConfiguredAgent(tenantId, history, {
          userId: from,
          conversationId: conversationRef.id,
        });

        if (!delayedAgentResponse.text || delayedAgentResponse.text.trim() === pendingReplyText) {
          return;
        }

        await sendWhatsAppMessage({
          accountSid: whatsapp.accountSid,
          authToken: whatsapp.authToken,
          to: from,
          body: delayedAgentResponse.text,
          from: whatsapp.whatsappNumber,
          messagingServiceSid: whatsapp.messagingServiceSid,
        });

        await db.collection('messages').add({
          conversationId: conversationRef.id,
          tenantId,
          role: 'assistant',
          content: delayedAgentResponse.text,
          channel: 'whatsapp',
          createdAt: FieldValue.serverTimestamp(),
        });

        if (delayedAgentResponse.requestHandoff) {
          await conversationRef.update({
            status: 'handoff_requested',
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      } catch (delayedError) {
        console.error('Failed to send delayed WhatsApp AI response after timeout:', delayedError);
      }
    })().catch((error) => {
      console.error('Failed to persist WhatsApp assistant response after TwiML response:', error);
    });
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
