import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  getGoogleAuthUrl,
  exchangeCodeForTokens,
  isGoogleConnected,
  disconnectGoogle,
} from '../services/google-sheets.js';
import { requireAuth, requireTenantParam, requireAdmin } from '../middleware/auth.js';
import { bucket, db } from '../config/firebase.js';
import { activateTenantSubscription } from '../services/billing.js';
import { verifyMarzPayTransaction } from '../services/marzpay.js';
import { createTenantNotification } from '../services/tenant-notifications.js';
import { runConfiguredAgent } from '../services/agent-dispatcher.js';
import { resolveConversationIdentity } from '../services/user-identity.js';
import { extractCustomProfileAttributes, extractDefaultProfileFields, getConversationDurationSeconds, normalizeXPersonCustomFields, syncXPersonProfileConversationDuration, upsertXPersonProfile } from '../services/xperson-profile.js';
import { claimTwilioWebhookMessage, resolveRelayReplyQuotedContext, resolveRelayTicketIdFromReplyContext, routeNokRelayReply } from '../services/whatsapp-relay.js';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import { google } from 'googleapis';
import { tmpdir } from 'os';
import { join } from 'path';
import { promises as fs } from 'fs';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { isExplicitHumanRequest, isUrgentHandoffSituation } from '../services/handoff-policy.js';
import { upsertClinicalSnapshot } from '../services/clinical-snapshot.js';

const execFile = promisify(execFileCb);


async function recordAgentActivity(tenantId: string, type: string): Promise<void> {
  try {
    await db.collection('agent_activities').add({
      tenantId,
      type,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.warn('[Integrations] Failed to record agent activity:', { tenantId, type, error });
  }
}

let googleCloudTtsAccessTokenClient: { getAccessToken: () => Promise<string | { token?: string | null } | null> } | null | undefined;

async function getGoogleCloudTtsAccessTokenClient(): Promise<{ getAccessToken: () => Promise<string | { token?: string | null } | null> } | null> {
  if (googleCloudTtsAccessTokenClient !== undefined) return googleCloudTtsAccessTokenClient;

  const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!credentialsJson) {
    googleCloudTtsAccessTokenClient = null;
    return googleCloudTtsAccessTokenClient;
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(credentialsJson),
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    googleCloudTtsAccessTokenClient = await auth.getClient();
  } catch (error) {
    console.warn('Failed to initialize Google Cloud TTS auth client from GOOGLE_APPLICATION_CREDENTIALS_JSON:', error);
    googleCloudTtsAccessTokenClient = null;
  }

  return googleCloudTtsAccessTokenClient;
}

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

const WHATSAPP_PENDING_REPLY_TEXT = 'Please hold on while I prepare the response.';
const WHATSAPP_PENDING_REPLY_DELAY_MS = 10_000;
const WHATSAPP_PROCESS_COALESCE_DELAY_MS = 1_200;
const WHATSAPP_PROCESS_LOCK_TTL_MS = 60_000;
const WHATSAPP_MAX_VOICE_NOTE_DURATION_SECONDS = 120;
const WHATSAPP_MAX_AUDIO_BYTES = 6 * 1024 * 1024;
const WHATSAPP_TRANSCRIPTION_DOWNLOAD_TIMEOUT_MS = 35_000;
const WHATSAPP_TRANSCRIPTION_REQUEST_TIMEOUT_MS = 45_000;
const WHATSAPP_AI_RESPONSE_TIMEOUT_MS = 45_000;
const WHATSAPP_IMAGE_DOWNLOAD_TIMEOUT_MS = 40_000;
const WHATSAPP_TTS_REQUEST_TIMEOUT_MS = 120_000;
const WHATSAPP_TTS_AUDIO_DOWNLOAD_TIMEOUT_MS = 40_000;
const WHATSAPP_LUGANDA_TTS_CLEAN_TIMEOUT_MS = Number(process.env.WHATSAPP_LUGANDA_TTS_CLEAN_TIMEOUT_MS ?? 35_000);
const WHATSAPP_ENGLISH_TTS_CLEAN_TIMEOUT_MS = Number(process.env.WHATSAPP_ENGLISH_TTS_CLEAN_TIMEOUT_MS ?? 20_000);
const WHATSAPP_VOICE_NOTE_SAMPLE_RATE = 16_000;
const WHATSAPP_VOICE_NOTE_BITRATE = '16k';
const WHATSAPP_MAX_IMAGE_COUNT = Number(process.env.WHATSAPP_MAX_IMAGE_COUNT ?? 4);
const WHATSAPP_MAX_IMAGE_BYTES = Number(process.env.WHATSAPP_MAX_IMAGE_BYTES ?? (8 * 1024 * 1024));
const WHATSAPP_ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function normalizeTextForSunbirdTts(text: string): string {
  const normalized = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[[^\]]*\]\(([^\)]*)\)/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[@#][\p{L}\p{N}_-]+/gu, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, ' ')
    .replace(/[{}\[\]<>*_~^|\\/=+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized;
}

function isAbortTimeoutError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'TimeoutError';
}

function buildMetaWebhookEventDedupId(tenantId: string, messageId: string): string {
  return `${tenantId}:${messageId}`;
}

async function claimMetaWebhookMessage(tenantId: string, messageId: string): Promise<boolean> {
  const dedupRef = db.collection('meta_whatsapp_webhook_events').doc(buildMetaWebhookEventDedupId(tenantId, messageId));
  try {
    await dedupRef.create({
      tenantId,
      messageId,
      createdAt: FieldValue.serverTimestamp(),
    });
    return true;
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 6 || code === 'already-exists') {
      return false;
    }
    throw error;
  }
}

async function cleanLugandaTextForSunbirdTts(text: string): Promise<string> {
  const normalized = normalizeTextForSunbirdTts(text);
  if (!normalized) return '';

  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) return normalized;

  try {
    const cleanRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{
            text: `You are cleaning Luganda text for speech synthesis.
Return only clean Luganda prose for TTS.
Rules:
- Keep meaning, keep Luganda wording natural and grammatical.
- Remove markdown, URLs, usernames, hashtags, code snippets, and symbols that are read badly by TTS.
- Expand or rewrite abbreviations into natural spoken Luganda where possible.
- Keep sentence punctuation minimal and speech-friendly.
- Do not add explanations, labels, or quotes.

Text:
${normalized}`,
          }],
        }],
      }),
      signal: AbortSignal.timeout(WHATSAPP_LUGANDA_TTS_CLEAN_TIMEOUT_MS),
    });

    if (!cleanRes.ok) return normalized;

    const payload = await cleanRes.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const cleaned = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join(' ').trim();
    if (!cleaned) return normalized;

    const finalText = normalizeTextForSunbirdTts(cleaned);
    return finalText || normalized;
  } catch (error) {
    if (isAbortTimeoutError(error)) {
      console.info('Luganda TTS text cleaning timed out; using normalized text fallback');
      return normalized;
    }

    console.warn('Failed to clean Luganda text for Sunbird TTS via AI:', error);
    return normalized;
  }
}

async function cleanEnglishTextForGoogleCloudTts(text: string): Promise<string> {
  const normalized = normalizeTextForSunbirdTts(text);
  if (!normalized) return '';

  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) return normalized;

  try {
    const cleanRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{
            text: `You are cleaning English text for speech synthesis.
Return only clean spoken English prose for TTS.
Rules:
- Keep the original meaning.
- Remove markdown formatting (including asterisks), URLs, usernames, hashtags, code snippets, and symbols that are read badly by TTS.
- Rewrite abbreviations or shorthand into natural spoken English where possible.
- Keep punctuation minimal and speech-friendly.
- Do not add explanations, labels, or quotes.

Text:
${normalized}`,
          }],
        }],
      }),
      signal: AbortSignal.timeout(WHATSAPP_ENGLISH_TTS_CLEAN_TIMEOUT_MS),
    });

    if (!cleanRes.ok) return normalized;

    const payload = await cleanRes.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const cleaned = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join(' ').trim();
    if (!cleaned) return normalized;

    const finalText = normalizeTextForSunbirdTts(cleaned);
    return finalText || normalized;
  } catch (error) {
    if (isAbortTimeoutError(error)) {
      console.info('English TTS text cleaning timed out; using normalized text fallback');
      return normalized;
    }

    console.warn('Failed to clean English text for Google Cloud TTS via AI:', error);
    return normalized;
  }
}
const WHATSAPP_LANGUAGE_DETECT_TIMEOUT_MS = 24_000;

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

async function sendMetaWhatsAppTextMessage(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  body: string;
}): Promise<string | undefined> {
  const res = await fetch(`https://graph.facebook.com/v22.0/${encodeURIComponent(params.phoneNumberId)}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: params.to,
      type: 'text',
      text: {
        body: params.body,
      },
    }),
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) {
    throw new Error(`Meta WhatsApp outbound send failed (${res.status}): ${await res.text()}`);
  }

  try {
    const payload = await res.json() as { messages?: Array<{ id?: unknown }> };
    const providerMessageId = payload.messages?.[0]?.id;
    return typeof providerMessageId === 'string' ? providerMessageId : undefined;
  } catch {
    return undefined;
  }
}

type MetaTemplateLanguage = {
  code: string;
};

type MetaTemplateParameter = {
  type: string;
  text?: string;
  payload?: string;
  currency?: {
    fallback_value: string;
    code: string;
    amount_1000: number;
  };
  date_time?: {
    fallback_value: string;
  };
  image?: {
    link: string;
  };
  video?: {
    link: string;
  };
  document?: {
    link: string;
    filename?: string;
  };
};

type MetaTemplateComponent = {
  type: 'header' | 'body' | 'button';
  sub_type?: 'quick_reply' | 'url';
  index?: string;
  parameters?: MetaTemplateParameter[];
};

async function sendMetaWhatsAppTemplateMessage(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  template: {
    name: string;
    language: MetaTemplateLanguage;
    components?: MetaTemplateComponent[];
  };
}): Promise<string | undefined> {
  const res = await fetch(`https://graph.facebook.com/v22.0/${encodeURIComponent(params.phoneNumberId)}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: params.to,
      type: 'template',
      template: {
        name: params.template.name,
        language: {
          code: params.template.language.code,
        },
        ...(params.template.components?.length
          ? { components: params.template.components }
          : {}),
      },
    }),
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) {
    throw new Error(`Meta WhatsApp outbound template send failed (${res.status}): ${await res.text()}`);
  }

  try {
    const payload = await res.json() as { messages?: Array<{ id?: unknown }> };
    const providerMessageId = payload.messages?.[0]?.id;
    return typeof providerMessageId === 'string' ? providerMessageId : undefined;
  } catch {
    return undefined;
  }
}

async function sendMetaWhatsAppAudioMessage(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  mediaUrl: string;
}): Promise<string | undefined> {
  const res = await fetch(`https://graph.facebook.com/v22.0/${encodeURIComponent(params.phoneNumberId)}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: params.to,
      type: 'audio',
      audio: {
        link: params.mediaUrl,
      },
    }),
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) {
    throw new Error(`Meta WhatsApp outbound audio send failed (${res.status}): ${await res.text()}`);
  }

  try {
    const payload = await res.json() as { messages?: Array<{ id?: unknown }> };
    const providerMessageId = payload.messages?.[0]?.id;
    return typeof providerMessageId === 'string' ? providerMessageId : undefined;
  } catch {
    return undefined;
  }
}

type StoredReplyContext = {
  quotedMessageId?: string;
  quotedContent?: string;
  quotedRole?: string;
};

function sanitizeQuotedContent(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.slice(0, 280);
}

async function resolveConversationReplyContext(params: {
  conversationId: string;
  providerMessageId?: string | null;
}): Promise<StoredReplyContext | undefined> {
  const providerMessageId = params.providerMessageId?.trim();
  if (!providerMessageId) return undefined;

  const snap = await db.collection('messages')
    .where('conversationId', '==', params.conversationId)
    .where('providerMessageId', '==', providerMessageId)
    .limit(1)
    .get();

  if (snap.empty) return undefined;

  const data = snap.docs[0].data() as { content?: unknown; role?: unknown };
  const quotedContent = sanitizeQuotedContent(data.content);
  if (!quotedContent) return undefined;

  return {
    quotedMessageId: providerMessageId,
    quotedContent,
    quotedRole: typeof data.role === 'string' ? data.role : undefined,
  };
}

function buildReplyAwareHistoryMessage(data: {
  role?: unknown;
  content?: unknown;
  imageUrls?: unknown;
  metadata?: unknown;
}): { role: 'user' | 'assistant'; content: string; imageUrls: string[] } {
  const role = data.role === 'assistant' ? 'assistant' : 'user';
  const content = typeof data.content === 'string' ? data.content : '';
  const imageUrls = Array.isArray(data.imageUrls)
    ? data.imageUrls.filter((value): value is string => typeof value === 'string')
    : [];
  const metadata = data.metadata && typeof data.metadata === 'object'
    ? data.metadata as { replyContext?: StoredReplyContext }
    : undefined;
  const quotedContent = sanitizeQuotedContent(metadata?.replyContext?.quotedContent);
  const quotedRole = metadata?.replyContext?.quotedRole === 'assistant' ? 'assistant' : 'user';

  if (role === 'user' && quotedContent) {
    return {
      role,
      content: `Replying to previous ${quotedRole} message: "${quotedContent}"\nUser message: ${content}`,
      imageUrls,
    };
  }

  return { role, content, imageUrls };
}

async function getMetaWhatsAppMediaDownloadInfo(params: {
  mediaId: string;
  accessToken: string;
}): Promise<{ url: string; mimeType: string } | null> {
  const res = await fetch(`https://graph.facebook.com/v22.0/${encodeURIComponent(params.mediaId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
    },
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) return null;

  const payload = await res.json() as { url?: string; mime_type?: string };
  const url = typeof payload.url === 'string' ? payload.url.trim() : '';
  const mimeType = typeof payload.mime_type === 'string' ? payload.mime_type.trim() : '';

  if (!url || !mimeType) return null;
  return { url, mimeType };
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
  authHeader?: string;
}): Promise<{ transcript: string | null; rejectedForLength: boolean }> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) return { transcript: null, rejectedForLength: false };

  try {
    const audioRes = await fetch(params.mediaUrl, {
      headers: params.authHeader ? { Authorization: params.authHeader } : undefined,
      signal: AbortSignal.timeout(WHATSAPP_TRANSCRIPTION_DOWNLOAD_TIMEOUT_MS),
    });
    if (!audioRes.ok) return { transcript: null, rejectedForLength: false };

    const contentLength = reqNumberHeader(audioRes.headers.get('content-length'), params.mediaUrl);
    if (contentLength !== null && contentLength > WHATSAPP_MAX_AUDIO_BYTES) {
      return { transcript: null, rejectedForLength: true };
    }

    const audioBuf = Buffer.from(await audioRes.arrayBuffer());
    if (audioBuf.length > WHATSAPP_MAX_AUDIO_BYTES) {
      return { transcript: null, rejectedForLength: true };
    }
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
      signal: AbortSignal.timeout(WHATSAPP_TRANSCRIPTION_REQUEST_TIMEOUT_MS),
    });

    if (!transcriptionRes.ok) return { transcript: null, rejectedForLength: false };

    const payload = await transcriptionRes.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const transcript = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join(' ').trim();
    return { transcript: transcript || null, rejectedForLength: false };
  } catch (error) {
    console.warn('WhatsApp audio transcription failed:', error);
    return { transcript: null, rejectedForLength: false };
  }
}

function reqNumberHeader(value: string | null | undefined, context: string): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.warn(`Unable to parse numeric header (${context}):`, value);
    return null;
  }
  return parsed;
}

function getWhatsAppAudioDurationSeconds(payload: Request['body']): number | null {
  const durationCandidates = [payload?.MediaDuration0, payload?.MediaDuration, payload?.RecordingDuration, payload?.Duration]
    .map((value) => Number.parseInt(String(value ?? ''), 10))
    .filter((value) => Number.isFinite(value) && value >= 0);

  if (durationCandidates.length === 0) return null;
  return durationCandidates[0];
}

function normalizeMimeType(value: string | null | undefined): string {
  return (value ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

function inferImageExtensionFromMimeType(mimeType: string): string {
  switch (mimeType) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/jpeg':
    default:
      return 'jpg';
  }
}

function inferAudioExtensionFromMimeType(mimeType: string): string {
  switch (mimeType) {
    case 'audio/ogg':
    case 'audio/opus':
      return 'ogg';
    case 'audio/webm':
      return 'webm';
    case 'audio/mp4':
    case 'audio/aac':
      return 'm4a';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav';
    default:
      return 'bin';
  }
}

async function storeIncomingWhatsAppAudio(params: {
  tenantId: string;
  channel: 'whatsapp' | 'whatsapp_meta';
  mediaUrl: string;
  mimeType: string;
  authHeader?: string;
}): Promise<string | null> {
  if (!bucket) return null;

  const normalizedMimeType = normalizeMimeType(params.mimeType);
  if (!normalizedMimeType.startsWith('audio/')) {
    return null;
  }

  try {
    const mediaRes = await fetch(params.mediaUrl, {
      headers: params.authHeader ? { Authorization: params.authHeader } : undefined,
      signal: AbortSignal.timeout(WHATSAPP_TRANSCRIPTION_DOWNLOAD_TIMEOUT_MS),
    });
    if (!mediaRes.ok) return null;

    const contentType = normalizeMimeType(mediaRes.headers.get('content-type')) || normalizedMimeType;
    if (!contentType.startsWith('audio/')) {
      return null;
    }

    const contentLength = reqNumberHeader(mediaRes.headers.get('content-length'), params.mediaUrl);
    if (contentLength !== null && contentLength > WHATSAPP_MAX_AUDIO_BYTES) {
      return null;
    }

    const mediaBuf = Buffer.from(await mediaRes.arrayBuffer());
    if (mediaBuf.length > WHATSAPP_MAX_AUDIO_BYTES) {
      return null;
    }

    const extension = inferAudioExtensionFromMimeType(contentType);
    const path = `tenants/${params.tenantId}/whatsapp-inbound-audio/${params.channel}/${randomUUID()}.${extension}`;
    const fileRef = bucket.file(path);
    await fileRef.save(mediaBuf, { metadata: { contentType } });
    const [signedUrl] = await fileRef.getSignedUrl({
      action: 'read',
      expires: Date.now() + 1000 * 60 * 60 * 24 * 7,
    });
    return signedUrl;
  } catch (error) {
    console.warn('Failed to store incoming WhatsApp audio:', {
      tenantId: params.tenantId,
      channel: params.channel,
      mediaUrl: params.mediaUrl,
      error,
    });
    return null;
  }
}

async function storeIncomingWhatsAppImage(params: {
  tenantId: string;
  channel: 'whatsapp' | 'whatsapp_meta';
  mediaUrl: string;
  mimeType: string;
  authHeader?: string;
}): Promise<string | null> {
  if (!bucket) return null;

  const normalizedMimeType = normalizeMimeType(params.mimeType);
  if (!WHATSAPP_ALLOWED_IMAGE_MIME_TYPES.has(normalizedMimeType)) {
    return null;
  }

  try {
    const mediaRes = await fetch(params.mediaUrl, {
      headers: params.authHeader ? { Authorization: params.authHeader } : undefined,
      signal: AbortSignal.timeout(WHATSAPP_IMAGE_DOWNLOAD_TIMEOUT_MS),
    });
    if (!mediaRes.ok) return null;

    const contentType = normalizeMimeType(mediaRes.headers.get('content-type')) || normalizedMimeType;
    if (!WHATSAPP_ALLOWED_IMAGE_MIME_TYPES.has(contentType)) {
      return null;
    }

    const contentLength = reqNumberHeader(mediaRes.headers.get('content-length'), params.mediaUrl);
    if (contentLength !== null && contentLength > WHATSAPP_MAX_IMAGE_BYTES) {
      return null;
    }

    const mediaBuf = Buffer.from(await mediaRes.arrayBuffer());
    if (mediaBuf.length > WHATSAPP_MAX_IMAGE_BYTES) {
      return null;
    }

    const extension = inferImageExtensionFromMimeType(contentType);
    const path = `tenants/${params.tenantId}/whatsapp-inbound-images/${params.channel}/${randomUUID()}.${extension}`;
    const fileRef = bucket.file(path);
    await fileRef.save(mediaBuf, { metadata: { contentType } });
    const [signedUrl] = await fileRef.getSignedUrl({
      action: 'read',
      expires: Date.now() + 1000 * 60 * 60 * 24 * 7,
    });
    return signedUrl;
  } catch (error) {
    console.warn('Failed to store incoming WhatsApp image:', {
      tenantId: params.tenantId,
      channel: params.channel,
      mediaUrl: params.mediaUrl,
      error,
    });
    return null;
  }
}

async function extractTwilioInboundImageUrls(params: {
  tenantId: string;
  payload: Request['body'];
  authHeader?: string;
}): Promise<string[]> {
  const numMedia = Number.parseInt(String(params.payload?.NumMedia ?? '0'), 10);
  if (!Number.isFinite(numMedia) || numMedia <= 0) return [];

  const imageUrls: string[] = [];
  const maxImages = Math.max(0, WHATSAPP_MAX_IMAGE_COUNT);
  for (let i = 0; i < numMedia && imageUrls.length < maxImages; i += 1) {
    const mediaUrl = typeof params.payload?.[`MediaUrl${i}`] === 'string' ? params.payload[`MediaUrl${i}`].trim() : '';
    const mediaContentTypeRaw = typeof params.payload?.[`MediaContentType${i}`] === 'string' ? params.payload[`MediaContentType${i}`].trim() : '';
    const mediaContentType = normalizeMimeType(mediaContentTypeRaw);

    if (!mediaUrl || !mediaContentType.startsWith('image/')) continue;
    if (!WHATSAPP_ALLOWED_IMAGE_MIME_TYPES.has(mediaContentType)) continue;

    const storedUrl = await storeIncomingWhatsAppImage({
      tenantId: params.tenantId,
      channel: 'whatsapp',
      mediaUrl,
      mimeType: mediaContentType,
      authHeader: params.authHeader,
    });

    if (storedUrl) {
      imageUrls.push(storedUrl);
    }
  }

  return imageUrls;
}

async function runAgentWithRetry(
  tenantId: string,
  history: Array<{ role: string; content: string; imageUrls?: string[] }>,
  context: {
    userId: string;
    externalUserId: string;
    conversationId: string;
    preferredResponseLanguage?: 'luganda' | 'english' | null;
    conversationLanguageCode?: string | null;
    conversationLanguageName?: string | null;
    channel?: 'whatsapp' | 'whatsapp_meta';
  },
): Promise<{ text?: string; requestHandoff?: boolean }> {
  try {
    return await withTimeout(
      runConfiguredAgent(tenantId, history, context),
      WHATSAPP_AI_RESPONSE_TIMEOUT_MS,
      'AI response timed out while handling Twilio async processor',
    );
  } catch (error) {
    const isTimeoutError = error instanceof Error && /timed out/i.test(error.message);
    if (!isTimeoutError) throw error;

    return withTimeout(
      runConfiguredAgent(tenantId, history, context),
      WHATSAPP_AI_RESPONSE_TIMEOUT_MS,
      'AI response timed out while handling Twilio async processor retry',
    );
  }
}


function parseExtraHeaders(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.entries(parsed).reduce<Record<string, string>>((acc, [key, value]) => {
      if (typeof value === 'string' && value.trim()) {
        acc[key] = value;
      }
      return acc;
    }, {});
  } catch {
    return {};
  }
}

type WhatsAppTtsProvider = 'sunbird' | 'google-cloud-tts' | 'elevenlabs' | 'gemini-2.5-flash-preview-tts';
type WhatsAppLanguageDetectionProvider = 'gemini' | 'sunbird';
type SupportedConversationLanguageCode = 'eng' | 'lug' | 'ach' | 'teo' | 'lgg' | 'nyn';

const DEFAULT_CONVERSATION_LANGUAGE_CODE: SupportedConversationLanguageCode = 'eng';
const LANGUAGE_SWITCH_PROMPT_FLOW = 'language_switch_prompt';
const LANGUAGE_SWITCH_CONFIRMATION_FLOW = 'language_switch_confirmation';

const LANGUAGE_SWITCH_CONFIRM_KEYWORDS = {
  yes: new Set(['yes', 'y', 'okay', 'ok', 'continue', 'proceed', 'switch', 'go ahead', 'sure']),
  no: new Set(['no', 'n', 'stay', 'keep english', 'dont switch', "don't switch", 'nope']),
};
const LANGUAGE_DETECTION_MIN_WORDS = 3;
const LANGUAGE_DETECTION_MIN_CHARACTERS = 16;

const SUPPORTED_CONVERSATION_LANGUAGES: Record<SupportedConversationLanguageCode, {
  name: string;
  aliases: string[];
  sunbirdSpeakerConfigKey?: 'whatsappSunbirdAcholiSpeakerId' | 'whatsappSunbirdAtesoSpeakerId' | 'whatsappSunbirdLugandaSpeakerId' | 'whatsappSunbirdLugbaraSpeakerId' | 'whatsappSunbirdRunyankoleSpeakerId';
  defaultSpeakerId?: number;
}> = {
  eng: { name: 'English', aliases: ['en', 'eng', 'english'] },
  lug: { name: 'Luganda', aliases: ['lg', 'lug', 'luganda'], sunbirdSpeakerConfigKey: 'whatsappSunbirdLugandaSpeakerId', defaultSpeakerId: 248 },
  ach: { name: 'Acholi', aliases: ['ach', 'acholi'], sunbirdSpeakerConfigKey: 'whatsappSunbirdAcholiSpeakerId', defaultSpeakerId: 241 },
  teo: { name: 'Ateso', aliases: ['teo', 'ateso'], sunbirdSpeakerConfigKey: 'whatsappSunbirdAtesoSpeakerId', defaultSpeakerId: 242 },
  lgg: { name: 'Lugbara', aliases: ['lgg', 'lugbara'], sunbirdSpeakerConfigKey: 'whatsappSunbirdLugbaraSpeakerId', defaultSpeakerId: 245 },
  nyn: { name: 'Runyankole', aliases: ['nyn', 'nyankole', 'runyankole'], sunbirdSpeakerConfigKey: 'whatsappSunbirdRunyankoleSpeakerId', defaultSpeakerId: 243 },
};

async function convertAudioToWhatsAppVoiceNote(audioBuffer: Buffer, inputExt: string): Promise<Buffer | null> {
  const tempBase = join(tmpdir(), `caremax-voice-note-${randomUUID()}`);
  const sourcePath = `${tempBase}.${inputExt}`;
  const outputPath = `${tempBase}.ogg`;

  try {
    await fs.writeFile(sourcePath, audioBuffer);

    // Prefer bundled ffmpeg (if present) for serverless compatibility; fallback to configured/system ffmpeg.
    const dynamicImport = new Function('moduleName', 'return import(moduleName);') as (moduleName: string) => Promise<any>;
    const configuredFfmpegPath = process.env.FFMPEG_PATH?.trim();
    const ffmpegBinary = configuredFfmpegPath || 'ffmpeg';
    let usedFluentFfmpeg = false;

    try {
      const [ffmpegModule, ffmpegInstallerModule] = await Promise.all([
        dynamicImport('fluent-ffmpeg'),
        dynamicImport('@ffmpeg-installer/ffmpeg'),
      ]);

      const ffmpeg = ffmpegModule.default ?? ffmpegModule;
      const ffmpegInstaller = ffmpegInstallerModule.default ?? ffmpegInstallerModule;
      const installerPath = typeof ffmpegInstaller?.path === 'string' ? ffmpegInstaller.path : '';

      if (installerPath && typeof ffmpeg?.setFfmpegPath === 'function') {
        ffmpeg.setFfmpegPath(installerPath);
      }

      if (typeof ffmpeg === 'function') {
        await new Promise<void>((resolve, reject) => {
          ffmpeg(sourcePath)
            .audioChannels(1)
            .audioFrequency(WHATSAPP_VOICE_NOTE_SAMPLE_RATE)
            .audioCodec('libopus')
            .audioBitrate(WHATSAPP_VOICE_NOTE_BITRATE)
            .outputOptions(['-vbr on', '-application voip'])
            .save(outputPath)
            .on('end', () => resolve())
            .on('error', (error: unknown) => reject(error));
        });
        usedFluentFfmpeg = true;
      }
    } catch {
      usedFluentFfmpeg = false;
    }

    if (!usedFluentFfmpeg) {
      try {
        await execFile(ffmpegBinary, [
          '-y',
          '-i', sourcePath,
          '-ac', '1',
          '-ar', String(WHATSAPP_VOICE_NOTE_SAMPLE_RATE),
          '-c:a', 'libopus',
          '-b:a', WHATSAPP_VOICE_NOTE_BITRATE,
          '-vbr', 'on',
          '-application', 'voip',
          outputPath,
        ]);
      } catch (error) {
        const maybeSpawnError = error as { code?: string };
        if (maybeSpawnError?.code === 'ENOENT') {
          const location = configuredFfmpegPath ? `at configured path: ${configuredFfmpegPath}` : 'on PATH';
          console.warn(`Skipping WhatsApp voice-note transcoding because ffmpeg is unavailable (${location}).`);
          return null;
        }
        throw error;
      }
    }

    return await fs.readFile(outputPath);
  } catch (error) {
    console.warn('Failed to transcode WhatsApp voice reply audio to Opus/Ogg:', error);
    return null;
  } finally {
    await Promise.allSettled([
      fs.rm(sourcePath, { force: true }),
      fs.rm(outputPath, { force: true }),
    ]);
  }
}

function isOggLikeAudioExtension(ext: string): boolean {
  const normalized = ext.trim().toLowerCase();
  return normalized === 'ogg' || normalized === 'opus';
}

function inferAudioExtensionFromUrl(url: string): string {
  const clean = url.split('?')[0]?.toLowerCase() ?? '';
  if (clean.endsWith('.wav')) return 'wav';
  if (clean.endsWith('.ogg')) return 'ogg';
  if (clean.endsWith('.opus')) return 'opus';
  return 'mp3';
}

async function generateVoiceMediaUrl(params: {
  tenantId: string;
  text: string;
  provider: WhatsAppTtsProvider;
  sunbirdTemperature: number;
  sunbirdLanguageCode: string | null;
  configData?: Record<string, unknown>;
  shouldCleanText: boolean;
  googleLanguageCode: string;
  googleVoiceName: string;
  elevenLabsVoiceId: string;
}): Promise<string | null> {
  if (params.provider === 'google-cloud-tts' || params.provider === 'gemini-2.5-flash-preview-tts') {
    return generateVoiceMediaUrlWithGoogleCloud(params);
  }
  if (params.provider === 'elevenlabs') {
    return generateVoiceMediaUrlWithElevenLabs(params);
  }
  return generateVoiceMediaUrlWithSunbird(params);
}

async function generateVoiceMediaUrlWithSunbird(params: {
  tenantId: string;
  text: string;
  sunbirdTemperature: number;
  sunbirdLanguageCode: string | null;
  configData?: Record<string, unknown>;
  shouldCleanText: boolean;
}): Promise<string | null> {
  const ttsUrl = process.env.SUNBIRD_TTS_URL ?? process.env.TTS_URL;
  const apiKey = process.env.SUNBIRD_TTS_API_KEY ?? process.env.SUNBIRD_API_KEY;
  if (!ttsUrl) return null;

  const speakerId = resolveSunbirdSpeakerId({
    languageCode: params.sunbirdLanguageCode,
    configData: params.configData,
  });

  const headerJson = process.env.SUNBIRD_TTS_HEADERS_JSON ?? '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...parseExtraHeaders(headerJson),
  };
  if (apiKey && !headers.Authorization) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const textForTts = params.shouldCleanText
    ? await cleanLugandaTextForSunbirdTts(params.text)
    : params.text.trim();
  if (!textForTts) return null;

  const ttsRes = await fetch(ttsUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ text: textForTts, speaker_id: speakerId, temperature: params.sunbirdTemperature }),
    signal: AbortSignal.timeout(WHATSAPP_TTS_REQUEST_TIMEOUT_MS),
  });

  if (!ttsRes.ok) {
    const errText = await ttsRes.text().catch(() => '');
    throw new Error(`WhatsApp TTS request failed (${ttsRes.status}): ${errText}`);
  }

  const ttsData = await ttsRes.json() as { output?: { audio_url?: string } };
  const audioUrl = typeof ttsData?.output?.audio_url === 'string' ? ttsData.output.audio_url.trim() : '';
  if (!audioUrl) return null;

  if (!bucket) return audioUrl;

  const audioRes = await fetch(audioUrl, { signal: AbortSignal.timeout(WHATSAPP_TTS_AUDIO_DOWNLOAD_TIMEOUT_MS) });
  if (!audioRes.ok) {
    throw new Error(`Failed to download generated WhatsApp voice reply audio (${audioRes.status})`);
  }

  const sourceAudioBuffer = Buffer.from(await audioRes.arrayBuffer());
  const sourceExt = inferAudioExtensionFromUrl(audioUrl);
  const voiceNoteBuffer = isOggLikeAudioExtension(sourceExt)
    ? sourceAudioBuffer
    : await convertAudioToWhatsAppVoiceNote(sourceAudioBuffer, sourceExt);
  const audioBuffer = voiceNoteBuffer ?? sourceAudioBuffer;
  const path = `tenants/${params.tenantId}/whatsapp-voice-replies/${randomUUID()}.${voiceNoteBuffer ? 'ogg' : 'mp3'}`;
  const fileRef = bucket.file(path);

  try {
    await fileRef.save(audioBuffer, {
      metadata: {
        contentType: voiceNoteBuffer ? 'audio/ogg' : 'audio/mpeg',
      },
    });

    const [signedUrl] = await fileRef.getSignedUrl({
      action: 'read',
      expires: Date.now() + 24 * 60 * 60 * 1000,
    });

    return signedUrl;
  } catch (error) {
    console.warn('WhatsApp voice reply upload failed; falling back to direct TTS audio URL:', error);
    return audioUrl;
  }
}



async function generateVoiceMediaUrlWithElevenLabs(params: {
  tenantId: string;
  text: string;
  shouldCleanText: boolean;
  elevenLabsVoiceId: string;
}): Promise<string | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey || !bucket) return null;

  const textForTts = params.shouldCleanText
    ? await cleanEnglishTextForGoogleCloudTts(params.text)
    : params.text.trim();
  if (!textForTts) return null;

  const voiceId = params.elevenLabsVoiceId;
  const modelId = process.env.ELEVENLABS_MODEL_ID?.trim() || 'eleven_multilingual_v2';
  const outputFormat = process.env.ELEVENLABS_OUTPUT_FORMAT?.trim() || 'mp3_44100_128';

  const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: textForTts,
      model_id: modelId,
      output_format: outputFormat,
    }),
    signal: AbortSignal.timeout(WHATSAPP_TTS_REQUEST_TIMEOUT_MS),
  });

  if (!ttsRes.ok) {
    const errText = await ttsRes.text().catch(() => '');
    throw new Error(`ElevenLabs TTS request failed (${ttsRes.status}): ${errText}`);
  }

  const sourceAudioBuffer = Buffer.from(await ttsRes.arrayBuffer());
  const sourceExt = outputFormat.toLowerCase().startsWith('mp3_') ? 'mp3' : (outputFormat.toLowerCase().startsWith('ogg_') ? 'ogg' : 'mp3');
  const voiceNoteBuffer = isOggLikeAudioExtension(sourceExt)
    ? sourceAudioBuffer
    : await convertAudioToWhatsAppVoiceNote(sourceAudioBuffer, sourceExt);
  const audioBuffer = voiceNoteBuffer ?? sourceAudioBuffer;
  const path = `tenants/${params.tenantId}/whatsapp-voice-replies/${randomUUID()}.${voiceNoteBuffer ? 'ogg' : 'mp3'}`;
  const fileRef = bucket.file(path);
  await fileRef.save(audioBuffer, { metadata: { contentType: voiceNoteBuffer ? 'audio/ogg' : 'audio/mpeg' } });

  const [signedUrl] = await fileRef.getSignedUrl({
    action: 'read',
    expires: Date.now() + 24 * 60 * 60 * 1000,
  });

  return signedUrl;
}
async function generateVoiceMediaUrlWithGoogleCloud(params: {
  tenantId: string;
  text: string;
  shouldCleanText: boolean;
  googleLanguageCode: string;
  googleVoiceName: string;
}): Promise<string | null> {
  const authClient = await getGoogleCloudTtsAccessTokenClient();
  if (!authClient || !bucket) return null;

  const accessTokenResponse = await authClient.getAccessToken();
  const accessToken = typeof accessTokenResponse === 'string'
    ? accessTokenResponse
    : accessTokenResponse?.token;
  if (!accessToken) return null;

  const textForTts = params.shouldCleanText
    ? await cleanEnglishTextForGoogleCloudTts(params.text)
    : params.text.trim();
  if (!textForTts) return null;

  const ttsRes = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: {
        text: textForTts,
      },
      voice: {
        languageCode: params.googleLanguageCode,
        name: params.googleVoiceName,
      },
      audioConfig: {
        audioEncoding: process.env.GOOGLE_CLOUD_TTS_AUDIO_ENCODING ?? 'OGG_OPUS',
      },
    }),
    signal: AbortSignal.timeout(WHATSAPP_TTS_REQUEST_TIMEOUT_MS),
  });

  if (!ttsRes.ok) {
    const errText = await ttsRes.text().catch(() => '');
    throw new Error(`Google Cloud TTS request failed (${ttsRes.status}): ${errText}`);
  }

  const ttsData = await ttsRes.json() as { audioContent?: string };
  const audioBase64 = ttsData.audioContent?.trim() ?? '';
  if (!audioBase64) return null;

  const sourceAudioBuffer = Buffer.from(audioBase64, 'base64');
  const requestedEncoding = (process.env.GOOGLE_CLOUD_TTS_AUDIO_ENCODING ?? 'OGG_OPUS').trim().toLowerCase();
  const inputExt = requestedEncoding === 'linear16'
    ? 'wav'
    : (requestedEncoding === 'ogg_opus' ? 'ogg' : 'mp3');
  const voiceNoteBuffer = isOggLikeAudioExtension(inputExt)
    ? sourceAudioBuffer
    : await convertAudioToWhatsAppVoiceNote(sourceAudioBuffer, inputExt);
  const audioBuffer = voiceNoteBuffer ?? sourceAudioBuffer;
  const path = `tenants/${params.tenantId}/whatsapp-voice-replies/${randomUUID()}.${voiceNoteBuffer ? 'ogg' : 'mp3'}`;
  const fileRef = bucket.file(path);
  await fileRef.save(audioBuffer, { metadata: { contentType: voiceNoteBuffer ? 'audio/ogg' : 'audio/mpeg' } });

  const [signedUrl] = await fileRef.getSignedUrl({
    action: 'read',
    expires: Date.now() + 24 * 60 * 60 * 1000,
  });

  return signedUrl;
}

function isLugandaLanguageTag(tag: string): boolean {
  const normalized = tag.trim().toLowerCase();
  return normalized === 'lg' || normalized === 'luganda';
}

function isEnglishLanguageTag(tag: string): boolean {
  const normalized = tag.trim().toLowerCase();
  return normalized === 'en' || normalized === 'eng' || normalized === 'english';
}

function normalizeConversationLanguageCode(value: string | null | undefined): SupportedConversationLanguageCode | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  const matched = Object.entries(SUPPORTED_CONVERSATION_LANGUAGES).find(([, config]) => config.aliases.includes(normalized));
  return (matched?.[0] as SupportedConversationLanguageCode | undefined) ?? null;
}

function getConversationLanguageName(languageCode: string | null | undefined): string {
  const normalized = normalizeConversationLanguageCode(languageCode);
  return normalized ? SUPPORTED_CONVERSATION_LANGUAGES[normalized].name : SUPPORTED_CONVERSATION_LANGUAGES[DEFAULT_CONVERSATION_LANGUAGE_CODE].name;
}

function resolveConversationLanguageState(conversationData: Record<string, unknown> | undefined): {
  currentLanguageCode: SupportedConversationLanguageCode;
  currentLanguageName: string;
  pendingLanguageCode: SupportedConversationLanguageCode | null;
  pendingLanguageName: string | null;
  pendingOriginalMessage: string | null;
} {
  const currentLanguageCode = normalizeConversationLanguageCode(typeof conversationData?.currentLanguageCode === 'string' ? conversationData.currentLanguageCode : null)
    ?? DEFAULT_CONVERSATION_LANGUAGE_CODE;
  const pendingLanguageCode = normalizeConversationLanguageCode(typeof conversationData?.pendingLanguageCode === 'string' ? conversationData.pendingLanguageCode : null);
  return {
    currentLanguageCode,
    currentLanguageName: getConversationLanguageName(currentLanguageCode),
    pendingLanguageCode,
    pendingLanguageName: pendingLanguageCode ? getConversationLanguageName(pendingLanguageCode) : null,
    pendingOriginalMessage: typeof conversationData?.pendingLanguageOriginalMessage === 'string' && conversationData.pendingLanguageOriginalMessage.trim().length > 0
      ? conversationData.pendingLanguageOriginalMessage.trim()
      : null,
  };
}

function shouldFilterLanguageFlowMessage(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  const flow = (metadata as { flow?: unknown }).flow;
  return flow === LANGUAGE_SWITCH_PROMPT_FLOW || flow === LANGUAGE_SWITCH_CONFIRMATION_FLOW;
}

function normalizeLanguageSwitchDecision(text: string | null | undefined): 'yes' | 'no' | null {
  if (!text) return null;
  const normalized = text.trim().toLowerCase().replace(/[.!?,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  if (LANGUAGE_SWITCH_CONFIRM_KEYWORDS.yes.has(normalized)) return 'yes';
  if (LANGUAGE_SWITCH_CONFIRM_KEYWORDS.no.has(normalized)) return 'no';
  return null;
}

function isLongEnoughForLanguageDetection(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  return wordCount >= LANGUAGE_DETECTION_MIN_WORDS || trimmed.length >= LANGUAGE_DETECTION_MIN_CHARACTERS;
}

function buildLanguageSwitchPrompt(params: {
  fromLanguageName: string;
  toLanguageName: string;
}): string {
  return `I noticed your message changed from ${params.fromLanguageName} to ${params.toLanguageName}. Should I continue in ${params.toLanguageName}? Reply YES to switch or NO to stay in ${params.fromLanguageName}.`;
}

function buildLanguageSwitchConfirmation(params: {
  accepted: boolean;
  currentLanguageName: string;
  requestedLanguageName: string;
}): string {
  if (params.accepted) {
    return `Okay — I will continue in ${params.requestedLanguageName}.`;
  }
  return `Okay — I will continue in ${params.currentLanguageName}.`;
}

function resolveLanguageSwitchPromptAction(params: {
  body: string;
  currentLanguageCode: SupportedConversationLanguageCode;
  currentLanguageName: string;
  pendingLanguageCode: SupportedConversationLanguageCode | null;
  pendingLanguageName: string | null;
  detectedIncomingLanguage: SupportedConversationLanguageCode | null;
}): {
  type: 'none';
} | {
  type: 'prompt';
  nextLanguageCode: SupportedConversationLanguageCode;
  nextLanguageName: string;
  prompt: string;
} | {
  type: 'confirm';
  accepted: boolean;
  confirmation: string;
} {
  if (params.pendingLanguageCode && params.pendingLanguageName) {
    const decision = normalizeLanguageSwitchDecision(params.body);
    if (decision === 'yes') {
      return {
        type: 'confirm',
        accepted: true,
        confirmation: buildLanguageSwitchConfirmation({
          accepted: true,
          currentLanguageName: params.currentLanguageName,
          requestedLanguageName: params.pendingLanguageName,
        }),
      };
    }
    if (decision === 'no') {
      return {
        type: 'confirm',
        accepted: false,
        confirmation: buildLanguageSwitchConfirmation({
          accepted: false,
          currentLanguageName: params.currentLanguageName,
          requestedLanguageName: params.pendingLanguageName,
        }),
      };
    }
    return {
      type: 'prompt',
      nextLanguageCode: params.pendingLanguageCode,
      nextLanguageName: params.pendingLanguageName,
      prompt: buildLanguageSwitchPrompt({
        fromLanguageName: params.currentLanguageName,
        toLanguageName: params.pendingLanguageName,
      }),
    };
  }

  if (params.detectedIncomingLanguage && params.detectedIncomingLanguage !== params.currentLanguageCode) {
    const nextLanguageName = getConversationLanguageName(params.detectedIncomingLanguage);
    return {
      type: 'prompt',
      nextLanguageCode: params.detectedIncomingLanguage,
      nextLanguageName,
      prompt: buildLanguageSwitchPrompt({
        fromLanguageName: params.currentLanguageName,
        toLanguageName: nextLanguageName,
      }),
    };
  }

  return { type: 'none' };
}

function resolveLanguageAwareTtsProvider(params: {
  configuredProvider: WhatsAppTtsProvider;
  responseLanguage: string | null;
}): WhatsAppTtsProvider {
  if (!params.responseLanguage) return params.configuredProvider;
  if (!isEnglishLanguageTag(params.responseLanguage)) return 'sunbird';
  if (isEnglishLanguageTag(params.responseLanguage)) {
    if (params.configuredProvider === 'elevenlabs' || params.configuredProvider === 'google-cloud-tts') {
      return params.configuredProvider;
    }
    return 'google-cloud-tts';
  }
  return params.configuredProvider;
}

function resolveWhatsAppLanguageDetectionProvider(configData: Record<string, unknown> | undefined): WhatsAppLanguageDetectionProvider {
  return configData?.whatsappLanguageDetectionProvider === 'sunbird' ? 'sunbird' : 'gemini';
}

function resolveSunbirdSpeakerId(params: {
  languageCode: string | null;
  configData: Record<string, unknown> | undefined;
}): number {
  const normalized = normalizeConversationLanguageCode(params.languageCode) ?? 'lug';
  const config = SUPPORTED_CONVERSATION_LANGUAGES[normalized];
  const configKey = config.sunbirdSpeakerConfigKey;
  if (configKey) {
    const configuredValue = params.configData?.[configKey];
    if (typeof configuredValue === 'number' && Number.isFinite(configuredValue) && configuredValue > 0) {
      return Math.floor(configuredValue);
    }
  }
  return config.defaultSpeakerId ?? 248;
}

function resolveElevenLabsVoiceId(configData: Record<string, unknown> | undefined): string {
  const rawVoiceId = configData?.whatsappElevenLabsVoiceId;
  if (typeof rawVoiceId === 'string' && rawVoiceId.trim().length > 0) {
    return rawVoiceId.trim();
  }
  return process.env.ELEVENLABS_VOICE_ID?.trim() || 'JBFqnCBsd6RMkjVDRZzb';
}

function resolveGoogleCloudVoiceConfig(configData: Record<string, unknown> | undefined): {
  languageCode: string;
  voiceName: string;
} {
  const rawLanguageCode = configData?.whatsappGoogleTtsLanguageCode;
  const rawVoiceName = configData?.whatsappGoogleTtsVoiceName;
  const languageCode = typeof rawLanguageCode === 'string' && rawLanguageCode.trim().length > 0
    ? rawLanguageCode.trim()
    : (process.env.GOOGLE_CLOUD_TTS_LANGUAGE_CODE ?? 'en-US');
  const voiceName = typeof rawVoiceName === 'string' && rawVoiceName.trim().length > 0
    ? rawVoiceName.trim()
    : (process.env.GOOGLE_CLOUD_TTS_VOICE_NAME ?? 'en-US-Neural2-F');

  return { languageCode, voiceName };
}

async function detectLanguageWithGemini(text: string): Promise<string | null> {
  const input = text.trim();
  if (!input) return null;

  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;

  try {
    const detectRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{
            text: `Detect the language of this text and return ONLY the ISO 639-1 code in lowercase (for Luganda return \\"lg\\").\n\nText:\n${input}`,
          }],
        }],
      }),
      signal: AbortSignal.timeout(WHATSAPP_LANGUAGE_DETECT_TIMEOUT_MS),
    });

    if (!detectRes.ok) return null;

    const payload = await detectRes.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const raw = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join(' ').trim().toLowerCase();
    if (!raw) return null;

    const cleaned = raw.replace(/[^a-z\-]/g, ' ').trim().split(/\s+/)[0] ?? '';
    return cleaned || null;
  } catch (error) {
    console.warn('Failed to detect WhatsApp language via Gemini:', error);
    return null;
  }
}

async function detectLanguageWithSunbird(text: string): Promise<string | null> {
  const input = text.trim();
  if (!input) return null;

  const apiUrl = process.env.SUNBIRD_LANGUAGE_ID_URL?.trim() || 'https://api.sunbird.ai/tasks/language_id';
  const apiKey = process.env.SUNBIRD_API_KEY?.trim() || process.env.SUNBIRD_TTS_API_KEY?.trim();
  if (!apiKey) return null;

  try {
    const detectRes = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: input }),
      signal: AbortSignal.timeout(WHATSAPP_LANGUAGE_DETECT_TIMEOUT_MS),
    });

    if (!detectRes.ok) return null;

    const payload = await detectRes.json() as { language?: string | null };
    return normalizeConversationLanguageCode(payload.language ?? null);
  } catch (error) {
    console.warn('Failed to detect WhatsApp language via Sunbird:', error);
    return null;
  }
}

async function detectWhatsAppLanguage(params: {
  text: string;
  provider: WhatsAppLanguageDetectionProvider;
}): Promise<SupportedConversationLanguageCode | null> {
  if (!isLongEnoughForLanguageDetection(params.text)) return null;

  const detected = params.provider === 'sunbird'
    ? await detectLanguageWithSunbird(params.text)
    : await detectLanguageWithGemini(params.text);
  return normalizeConversationLanguageCode(detected);
}

function getLanguagePreferenceInstructionTag(languageTag: string | null): 'luganda' | 'english' | null {
  if (!languageTag) return null;
  if (isLugandaLanguageTag(languageTag)) return 'luganda';
  if (isEnglishLanguageTag(languageTag)) return 'english';
  return null;
}

integrationsCallbackRouter.post('/twilio/whatsapp/webhook/:tenantId', async (req: Request, res: Response) => {
  const tenantId = req.params.tenantId;
  const from = typeof req.body?.From === 'string' ? req.body.From.trim() : '';
  const identity = resolveConversationIdentity({ channel: 'whatsapp', externalUserId: from });

  if (!tenantId || !identity.externalUserId) {
    res.set('Content-Type', 'text/xml');
    res.status(200).send(xmlResponse('Message not received correctly. Please try again.'));
    return;
  }

  try {
    const integrationDoc = await db.collection('tenant_integrations').doc(tenantId).get();
    const whatsapp = integrationDoc.data()?.whatsappTwilio;

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

    const incomingBody = typeof req.body?.Body === 'string' ? req.body.Body.trim() : '';
    const providerMessageId = typeof req.body?.MessageSid === 'string' ? req.body.MessageSid.trim() : '';
    const repliedToMessageId = [
      req.body?.OriginalRepliedMessageSid,
      req.body?.OriginalRepliedMessageSid0,
      req.body?.InReplyTo,
    ].find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() ?? '';

    if (providerMessageId) {
      const claimed = await claimTwilioWebhookMessage(tenantId, providerMessageId);
      if (!claimed) {
        res.set('Content-Type', 'text/xml');
        res.status(200).send(xmlEmptyResponse());
        return;
      }
    }

    if (incomingBody) {
      const linkedRelayTicketId = repliedToMessageId
        ? await resolveRelayTicketIdFromReplyContext({
          tenantId,
          provider: 'twilio',
          providerMessageId: repliedToMessageId,
          nokExternalUserId: identity.externalUserId,
        }) ?? undefined
        : undefined;
      const quotedOriginalMessage = repliedToMessageId
        ? await resolveRelayReplyQuotedContext({
          tenantId,
          provider: 'twilio',
          providerMessageId: repliedToMessageId,
          nokExternalUserId: identity.externalUserId,
        }) ?? undefined
        : undefined;

      const relayRoute = await routeNokRelayReply({
        tenantId,
        nokExternalUserId: identity.externalUserId,
        inboundBody: incomingBody,
        preferredRelayTicketId: linkedRelayTicketId,
        requireExplicitSelection: !linkedRelayTicketId,
        allowGeneralChatFallback: true,
        quotedOriginalMessage,
      });

      if (relayRoute.type === 'routed') {
        res.set('Content-Type', 'text/xml');
        res.status(200).send(xmlResponse('Thanks. We have forwarded your reply'));
        return;
      }

      if (relayRoute.type === 'ambiguous' || relayRoute.type === 'invalid_code') {
        res.set('Content-Type', 'text/xml');
        res.status(200).send(xmlResponse(relayRoute.prompt));
        return;
      }
    }

    const mediaUrl = typeof req.body?.MediaUrl0 === 'string' ? req.body.MediaUrl0.trim() : '';
    const mediaContentType = typeof req.body?.MediaContentType0 === 'string' ? req.body.MediaContentType0.trim() : '';

    const accountSid = typeof whatsapp.accountSid === 'string' ? whatsapp.accountSid.trim() : '';
    const authToken = typeof whatsapp.authToken === 'string' ? whatsapp.authToken.trim() : '';
    const twilioAuthHeader = accountSid && authToken
      ? twilioBasicAuthHeader(accountSid, authToken)
      : undefined;
    const imageUrls = await extractTwilioInboundImageUrls({
      tenantId,
      payload: req.body,
      authHeader: twilioAuthHeader,
    });

    let body = incomingBody;
    let cameFromVoiceNote = false;
    let storedVoiceNoteAudioUrl: string | null = null;
    if (!body && isLikelyWhatsAppVoiceNote(req.body) && mediaUrl && mediaContentType) {
      const mediaDurationSeconds = getWhatsAppAudioDurationSeconds(req.body);
      if (mediaDurationSeconds !== null && mediaDurationSeconds > WHATSAPP_MAX_VOICE_NOTE_DURATION_SECONDS) {
        res.set('Content-Type', 'text/xml');
        res.status(200).send(xmlResponse('That voice note is too long. Please keep audio messages under 2 minutes or split into shorter notes.'));
        return;
      }

      if (twilioAuthHeader) {
        const { transcript, rejectedForLength } = await transcribeWhatsAppAudio({
          mediaUrl,
          contentType: mediaContentType,
          authHeader: twilioAuthHeader,
        });

        if (rejectedForLength) {
          res.set('Content-Type', 'text/xml');
          res.status(200).send(xmlResponse('That voice note is too large. Please keep audio messages under 2 minutes and send shorter clips.'));
          return;
        }

        if (transcript) {
          body = transcript;
          cameFromVoiceNote = true;
          storedVoiceNoteAudioUrl = await storeIncomingWhatsAppAudio({
            tenantId,
            channel: 'whatsapp',
            mediaUrl,
            mimeType: mediaContentType,
            authHeader: twilioAuthHeader,
          });
        }
      }
    }

    if (Number.parseInt(String(req.body?.NumMedia ?? '0'), 10) > 0 && imageUrls.length === 0 && !body && !isLikelyWhatsAppVoiceNote(req.body)) {
      res.set('Content-Type', 'text/xml');
      res.status(200).send(xmlResponse('We could not read that image. Please send JPG, PNG, WEBP, or GIF images up to 8MB each.'));
      return;
    }

    if (!body && imageUrls.length === 0) {
      res.set('Content-Type', 'text/xml');
      res.status(200).send(xmlResponse('We could not read that message yet. Please send text, an image, or a clearer voice note.'));
      return;
    }

    const conversationsRef = db.collection('conversations');
    const existingConversationSnap = await conversationsRef
      .where('tenantId', '==', tenantId)
      .where('channel', '==', 'whatsapp')
      .where('externalUserId', '==', identity.externalUserId)
      .where('status', 'in', ['open', 'handoff_requested', 'human_joined'])
      .orderBy('updatedAt', 'desc')
      .limit(1)
      .get();

    const conversationRef = existingConversationSnap.empty
      ? await conversationsRef.add({
        tenantId,
        userId: identity.scopedUserId,
        externalUserId: identity.externalUserId,
        channel: 'whatsapp',
        status: 'open',
        currentLanguageCode: DEFAULT_CONVERSATION_LANGUAGE_CODE,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      : existingConversationSnap.docs[0].ref;
    const replyContext = await resolveConversationReplyContext({
      conversationId: conversationRef.id,
      providerMessageId: repliedToMessageId,
    });

    const agentConfigDoc = await db.collection('agent_config').doc(tenantId).get();
    const agentConfigData = agentConfigDoc.data() as Record<string, unknown> | undefined;
    const languageDetectionProvider = resolveWhatsAppLanguageDetectionProvider(agentConfigData);
    const conversationDataBeforeMessage = (await conversationRef.get()).data() as Record<string, unknown> | undefined;
    const languageStateBeforeMessage = resolveConversationLanguageState(conversationDataBeforeMessage);
    const detectedIncomingLanguage = body
      ? await detectWhatsAppLanguage({ text: body, provider: languageDetectionProvider })
      : null;
    const languageSwitchAction = resolveLanguageSwitchPromptAction({
      body,
      currentLanguageCode: languageStateBeforeMessage.currentLanguageCode,
      currentLanguageName: languageStateBeforeMessage.currentLanguageName,
      pendingLanguageCode: languageStateBeforeMessage.pendingLanguageCode,
      pendingLanguageName: languageStateBeforeMessage.pendingLanguageName,
      detectedIncomingLanguage,
    });
    const isLanguageConfirmationMessage = languageSwitchAction.type === 'confirm';
    const inboundMessageMetadata = {
      ...(cameFromVoiceNote ? { source: 'voice_note' } : {}),
      ...(isLanguageConfirmationMessage ? { flow: LANGUAGE_SWITCH_CONFIRMATION_FLOW } : {}),
    };

    await db.collection('messages').add({
      conversationId: conversationRef.id,
      tenantId,
      role: 'user',
      content: body,
      imageUrls,
      ...(providerMessageId ? { providerMessageId } : {}),
      ...(cameFromVoiceNote && storedVoiceNoteAudioUrl ? { audioUrl: storedVoiceNoteAudioUrl } : {}),
      channel: 'whatsapp',
      inputType: cameFromVoiceNote ? 'voice' : 'text',
      ...(Object.keys({
        ...inboundMessageMetadata,
        ...(replyContext ? { replyContext } : {}),
      }).length > 0 ? {
        metadata: {
          ...inboundMessageMetadata,
          ...(replyContext ? { replyContext } : {}),
        },
      } : {}),
      createdAt: FieldValue.serverTimestamp(),
    });

    try {
      await upsertClinicalSnapshot({
        tenantId,
        conversationId: conversationRef.id,
        userId: identity.scopedUserId,
        externalUserId: identity.externalUserId,
        text: body,
        source: 'whatsapp',
      });
    } catch (snapshotError) {
      console.warn('[Integrations] Failed to upsert clinical snapshot (WhatsApp):', snapshotError);
    }

    if (languageSwitchAction.type === 'prompt') {
      await conversationRef.set({
        pendingLanguageCode: languageSwitchAction.nextLanguageCode,
        pendingLanguageOriginalMessage: body,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      await db.collection('messages').add({
        conversationId: conversationRef.id,
        tenantId,
        role: 'assistant',
        content: languageSwitchAction.prompt,
        channel: 'whatsapp',
        metadata: { flow: LANGUAGE_SWITCH_PROMPT_FLOW },
        createdAt: FieldValue.serverTimestamp(),
      });

      res.set('Content-Type', 'text/xml');
      res.status(200).send(xmlResponse(languageSwitchAction.prompt));
      return;
    }

    if (languageSwitchAction.type === 'confirm') {
      await conversationRef.set({
        currentLanguageCode: languageSwitchAction.accepted
          ? languageStateBeforeMessage.pendingLanguageCode ?? languageStateBeforeMessage.currentLanguageCode
          : languageStateBeforeMessage.currentLanguageCode,
        pendingLanguageCode: FieldValue.delete(),
        pendingLanguageOriginalMessage: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      if (!languageSwitchAction.accepted) {
        await db.collection('messages').add({
          conversationId: conversationRef.id,
          tenantId,
          role: 'assistant',
          content: languageSwitchAction.confirmation,
          channel: 'whatsapp',
          metadata: { flow: LANGUAGE_SWITCH_CONFIRMATION_FLOW },
          createdAt: FieldValue.serverTimestamp(),
        });

        res.set('Content-Type', 'text/xml');
        res.status(200).send(xmlResponse(languageSwitchAction.confirmation));
        return;
      }
    }

    void recordAgentActivity(tenantId, 'whatsapp-received');
    void recordAgentActivity(tenantId, 'twilio');

    try {
      const configData = agentConfigData;
      if (configData?.xPersonProfileEnabled === true) {
        const conversationDurationLastConversationSeconds = await getConversationDurationSeconds(conversationRef.id);
        const customFields = normalizeXPersonCustomFields(configData?.xPersonProfileCustomFields);
        const extractedAttributes = extractCustomProfileAttributes(body, customFields);
        await upsertXPersonProfile({
          tenantId,
          userId: identity.scopedUserId,
          externalUserId: identity.externalUserId,
          channel: 'whatsapp',
          conversationId: conversationRef.id,
          details: {
            ...extractDefaultProfileFields(body),
            ...(typeof conversationDurationLastConversationSeconds === 'number'
              ? { conversationDurationLastConversationSeconds }
              : {}),
          },
          ...(Object.keys(extractedAttributes).length > 0 ? { attributes: extractedAttributes } : {}),
        });
      }
    } catch (profileError) {
      console.warn('[Integrations] Failed to upsert XPersonProfile from WhatsApp webhook:', profileError);
    }

    const conversationData = (await conversationRef.get()).data() ?? {};
    const status = typeof conversationData.status === 'string' ? conversationData.status : 'open';
    const humanActive = status === 'human_joined';

    if (humanActive) {
      await conversationRef.update({ updatedAt: FieldValue.serverTimestamp() });
      res.set('Content-Type', 'text/xml');
      res.status(200).send(xmlEmptyResponse());
      return;
    }

    const wantsHumanAgain = isExplicitHumanRequest(body) || isUrgentHandoffSituation(body);

    if (wantsHumanAgain) {
      const alreadyRequestedHandoff = status === 'handoff_requested';
      await conversationRef.update({
        status: 'handoff_requested',
        updatedAt: FieldValue.serverTimestamp(),
      });
      const shortMessage = alreadyRequestedHandoff
        ? 'A care team member has already been notified and will join shortly.'
        : 'Thanks for your message. A care team member has been notified and will join shortly.';

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

    const pendingReplyText = WHATSAPP_PENDING_REPLY_TEXT;

    const protocol = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || req.protocol;
    const host = req.get('host');
    const processUrl = host
      ? `${protocol}://${host}/integrations/twilio/whatsapp/process/${encodeURIComponent(tenantId)}/${encodeURIComponent(conversationRef.id)}`
      : null;

    const asyncProcessorRequest = processUrl
      ? fetch(processUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(configuredSecret ? { 'x-webhook-secret': configuredSecret } : {}),
        },
        body: JSON.stringify({ from: identity.externalUserId }),
      }).catch((error) => {
        console.error('Failed to dispatch async WhatsApp processor request:', error);
        return null;
      })
      : Promise.resolve<globalThis.Response | null>(null);

    await conversationRef.update({ updatedAt: FieldValue.serverTimestamp() });

    const processorFinishedWithinDelay = await Promise.race([
      asyncProcessorRequest.then((processorResponse) => processorResponse?.ok ?? false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), WHATSAPP_PENDING_REPLY_DELAY_MS)),
    ]);

    if (processorFinishedWithinDelay) {
      res.set('Content-Type', 'text/xml');
      res.status(200).send(xmlEmptyResponse());
      return;
    }

    await db.collection('messages').add({
      conversationId: conversationRef.id,
      tenantId,
      role: 'assistant',
      content: pendingReplyText,
      channel: 'whatsapp',
      createdAt: FieldValue.serverTimestamp(),
    });

    res.set('Content-Type', 'text/xml');
    res.status(200).send(xmlResponse(pendingReplyText));
  } catch (error) {
    console.error('Twilio WhatsApp webhook error:', error);
    res.set('Content-Type', 'text/xml');
    res.status(200).send(xmlResponse('Sorry, something went wrong while processing your message.'));
  }
});

integrationsCallbackRouter.post('/twilio/whatsapp/process/:tenantId/:conversationId', async (req: Request, res: Response) => {
  const tenantId = req.params.tenantId;
  const conversationId = req.params.conversationId;
  const from = typeof req.body?.from === 'string' ? req.body.from.trim() : '';
  const identity = resolveConversationIdentity({ channel: 'whatsapp', externalUserId: from });

  if (!tenantId || !conversationId || !identity.externalUserId) {
    res.status(400).json({ error: 'Missing tenantId, conversationId, or from' });
    return;
  }

  const conversationRef = db.collection('conversations').doc(conversationId);
  const processingToken = randomUUID();

  try {
    const integrationDoc = await db.collection('tenant_integrations').doc(tenantId).get();
    const whatsapp = integrationDoc.data()?.whatsappTwilio;
    if (!whatsapp?.connected) {
      res.status(404).json({ error: 'WhatsApp integration not connected' });
      return;
    }

    const configuredSecret = typeof whatsapp.webhookSecret === 'string' ? whatsapp.webhookSecret.trim() : '';
    if (configuredSecret) {
      const suppliedSecret = typeof req.headers['x-webhook-secret'] === 'string' ? req.headers['x-webhook-secret'].trim() : '';
      if (suppliedSecret !== configuredSecret) {
        res.status(403).json({ error: 'Webhook secret mismatch' });
        return;
      }
    }

    const lockAcquired = await db.runTransaction(async (tx) => {
      const conversationSnap = await tx.get(conversationRef);
      const conversationData = conversationSnap.data() ?? {};

      if (conversationData.tenantId !== tenantId) {
        return { ok: false as const, reason: 'conversation_not_found' as const };
      }
      if (conversationData.status === 'human_joined') {
        return { ok: false as const, reason: 'human_joined' as const };
      }

      const lockUntil =
        conversationData.whatsappProcessingLockUntil
        && typeof (conversationData.whatsappProcessingLockUntil as { toMillis?: unknown }).toMillis === 'function'
          ? (conversationData.whatsappProcessingLockUntil as { toMillis: () => number }).toMillis()
          : null;

      if (typeof lockUntil === 'number' && lockUntil > Date.now()) {
        return { ok: false as const, reason: 'processing_in_progress' as const };
      }

      tx.update(conversationRef, {
        whatsappProcessingToken: processingToken,
        whatsappProcessingLockUntil: Timestamp.fromMillis(Date.now() + WHATSAPP_PROCESS_LOCK_TTL_MS),
      });

      return { ok: true as const };
    });

    if (!lockAcquired.ok) {
      const statusCode = lockAcquired.reason === 'conversation_not_found' ? 404 : 200;
      res.status(statusCode).json({ ok: true, skipped: lockAcquired.reason });
      return;
    }

    const conversationData = (await conversationRef.get()).data() ?? {};
    if (conversationData.tenantId !== tenantId) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    if (conversationData.status === 'human_joined') {
      res.status(200).json({ ok: true, skipped: 'human_joined' });
      return;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, WHATSAPP_PROCESS_COALESCE_DELAY_MS));

    const historySnap = await db
      .collection('messages')
      .where('conversationId', '==', conversationId)
      .orderBy('createdAt', 'desc')
      .limit(30)
      .get();

    const history = historySnap.docs.reverse().flatMap((doc) => {
      const data = doc.data();
      if (shouldFilterLanguageFlowMessage(data.metadata)) return [];
      return buildReplyAwareHistoryMessage(data);
    });

    const pendingReplyText = WHATSAPP_PENDING_REPLY_TEXT;
    let responseText = '';
    let requestHandoff = false;

    const agentConfigDoc = await db.collection('agent_config').doc(tenantId).get();
    const agentConfigData = agentConfigDoc.data() as Record<string, unknown> | undefined;
    const languageDetectionProvider = resolveWhatsAppLanguageDetectionProvider(agentConfigData);
    const { languageCode: googleLanguageCode, voiceName: googleVoiceName } = resolveGoogleCloudVoiceConfig(agentConfigData);
    const elevenLabsVoiceId = resolveElevenLabsVoiceId(agentConfigData);
    const rawVoiceThreshold = agentConfigData?.whatsappVoiceNoteCharThreshold;
    const rawForceVoiceReplies = agentConfigData?.whatsappForceVoiceReplies;
    const rawTtsProvider = agentConfigData?.whatsappTtsProvider;
    const rawSunbirdTemperature = agentConfigData?.whatsappSunbirdTemperature;
    const voiceThreshold = typeof rawVoiceThreshold === 'number' && Number.isFinite(rawVoiceThreshold)
      ? Math.max(0, Math.floor(rawVoiceThreshold))
      : 0;
    const forceVoiceReplies = rawForceVoiceReplies === true;
    const ttsProvider: WhatsAppTtsProvider = rawTtsProvider === 'gemini-2.5-flash-preview-tts' || rawTtsProvider === 'google-cloud-tts' || rawTtsProvider === 'elevenlabs'
      ? rawTtsProvider
      : 'sunbird';
    const sunbirdTemperature = typeof rawSunbirdTemperature === 'number' && Number.isFinite(rawSunbirdTemperature)
      ? Math.min(2, Math.max(0, rawSunbirdTemperature))
      : 0.7;
    const conversationState = resolveConversationLanguageState(conversationData);
    const latestUserMessage = [...history].reverse().find((message) => message.role === 'user')?.content ?? '';
    const latestDetectedUserLanguage = latestUserMessage
      ? await detectWhatsAppLanguage({ text: latestUserMessage, provider: languageDetectionProvider })
      : null;
    const detectedUserLanguage = getLanguagePreferenceInstructionTag(latestDetectedUserLanguage);

    try {
      const agentResponse = await runAgentWithRetry(tenantId, history, {
          userId: identity.scopedUserId,
          externalUserId: identity.externalUserId,
          conversationId,
          preferredResponseLanguage: detectedUserLanguage,
          conversationLanguageCode: conversationState.currentLanguageCode,
          conversationLanguageName: conversationState.currentLanguageName,
          channel: 'whatsapp',
        });
      responseText = agentResponse.text?.trim() ?? '';
      requestHandoff = agentResponse.requestHandoff ?? false;
    } catch (error) {
      console.error('WhatsApp async processor AI execution failed:', error);
      responseText = 'Sorry, I ran into a delay while checking that. Please send your message again in a moment.';
    }

    if (responseText.includes(pendingReplyText) && responseText !== pendingReplyText) {
      responseText = pendingReplyText;
    }

    if (!responseText || responseText === pendingReplyText) {
      res.status(200).json({ ok: true, skipped: 'empty_or_pending_response' });
      return;
    }

    const outboundTo = identity.externalUserId;
    const accountSid = typeof whatsapp.accountSid === 'string' ? whatsapp.accountSid.trim() : '';
    const authToken = typeof whatsapp.authToken === 'string' ? whatsapp.authToken.trim() : '';
    const messagingServiceSid = typeof whatsapp.messagingServiceSid === 'string' ? whatsapp.messagingServiceSid.trim() : '';
    const whatsappNumber = typeof whatsapp.whatsappNumber === 'string' ? whatsapp.whatsappNumber.trim() : '';

    const payload = new URLSearchParams({
      To: outboundTo,
    });
    const responseLanguage = conversationState.currentLanguageCode;
    const resolvedTtsProvider = resolveLanguageAwareTtsProvider({
      configuredProvider: ttsProvider,
      responseLanguage,
    });
    const exceedsVoiceThreshold = voiceThreshold > 0 && responseText.length >= voiceThreshold;
    const shouldTryVoiceReply = forceVoiceReplies || exceedsVoiceThreshold;
    const shouldCleanVoiceText = voiceThreshold <= 0 || exceedsVoiceThreshold;

    let hasVoiceReply = false;
    let voiceUrl: string | null = null;
    let assistantProviderMessageId: string | undefined;
    if (shouldTryVoiceReply) {
      try {
        voiceUrl = await generateVoiceMediaUrl({
          tenantId,
          text: responseText,
          provider: resolvedTtsProvider,
          sunbirdTemperature,
          sunbirdLanguageCode: conversationState.currentLanguageCode,
          configData: agentConfigData,
          shouldCleanText: shouldCleanVoiceText,
          googleLanguageCode,
          googleVoiceName,
          elevenLabsVoiceId,
        });
        if (voiceUrl) {
          payload.set('MediaUrl', voiceUrl);
          hasVoiceReply = true;
          void recordAgentActivity(tenantId, resolvedTtsProvider);
        }
      } catch (error) {
        console.warn('Failed to generate WhatsApp voice reply:', error);
      }
    }

    if (!hasVoiceReply) {
      payload.set('Body', responseText);
    }

    if (messagingServiceSid) {
      payload.set('MessagingServiceSid', messagingServiceSid);
    } else if (whatsappNumber) {
      payload.set('From', whatsappNumber.startsWith('whatsapp:') ? whatsappNumber : `whatsapp:${whatsappNumber}`);
    } else {
      throw new Error('Twilio outbound message requires either messagingServiceSid or from number');
    }

    const sendTwilioMessage = async (body: URLSearchParams) => fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: twilioBasicAuthHeader(accountSid, authToken),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(12_000),
    });

    let twilioRes = await sendTwilioMessage(payload);

    if (!twilioRes.ok && payload.has('MediaUrl')) {
      const mediaErrorText = await twilioRes.text().catch(() => '');
      console.warn('Twilio outbound send with voice media failed. Retrying as text-only message.', {
        status: twilioRes.status,
        response: mediaErrorText,
      });

      payload.delete('MediaUrl');
      twilioRes = await sendTwilioMessage(payload);
    }

    if (!twilioRes.ok) {
      const errorText = await twilioRes.text();
      throw new Error(`Twilio outbound send failed (${twilioRes.status}): ${errorText}`);
    }

    try {
      const twilioPayload = await twilioRes.json() as { sid?: unknown };
      assistantProviderMessageId = typeof twilioPayload.sid === 'string' ? twilioPayload.sid : undefined;
    } catch {
      assistantProviderMessageId = undefined;
    }

    await db.collection('messages').add({
      conversationId,
      tenantId,
      role: 'assistant',
      content: responseText,
      ...(assistantProviderMessageId ? { providerMessageId: assistantProviderMessageId } : {}),
      ...(voiceUrl ? { audioUrl: voiceUrl, inputType: 'voice', metadata: { source: 'voice_note' } } : {}),
      channel: 'whatsapp',
      createdAt: FieldValue.serverTimestamp(),
    });

    try {
      if (agentConfigData?.xPersonProfileEnabled === true) {
        await syncXPersonProfileConversationDuration({
          tenantId,
          conversationId: conversationRef.id,
          userId: identity.scopedUserId,
          externalUserId: identity.externalUserId,
          channel: 'whatsapp',
        });
      }
    } catch (profileError) {
      console.warn('[Integrations] Failed to sync XPersonProfile duration after Twilio WhatsApp reply:', profileError);
    }

    void recordAgentActivity(tenantId, 'whatsapp-sent');
    void recordAgentActivity(tenantId, 'twilio');

    const updates: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
      pendingLanguageOriginalMessage: FieldValue.delete(),
    };
    if (requestHandoff) {
      updates.status = 'handoff_requested';
    }
    await conversationRef.update(updates);

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Twilio WhatsApp async processing error:', error);
    res.status(500).json({ error: 'Failed to process async WhatsApp response' });
  } finally {
    try {
      await db.runTransaction(async (tx) => {
        const conversationSnap = await tx.get(conversationRef);
        const conversationData = conversationSnap.data() ?? {};
        if (conversationData.whatsappProcessingToken !== processingToken) {
          return;
        }
        tx.update(conversationRef, {
          whatsappProcessingToken: FieldValue.delete(),
          whatsappProcessingLockUntil: FieldValue.delete(),
        });
      });
    } catch (unlockError) {
      console.warn('Failed to release WhatsApp processing lock:', unlockError);
    }
  }
});

integrationsCallbackRouter.get('/meta/whatsapp/webhook/:tenantId', async (req: Request, res: Response) => {
  const tenantId = req.params.tenantId;
  const mode = typeof req.query['hub.mode'] === 'string' ? req.query['hub.mode'] : '';
  const token = typeof req.query['hub.verify_token'] === 'string' ? req.query['hub.verify_token'] : '';
  const challenge = typeof req.query['hub.challenge'] === 'string' ? req.query['hub.challenge'] : '';

  if (!tenantId || mode !== 'subscribe') {
    res.status(403).send('Forbidden');
    return;
  }

  try {
    const integrationDoc = await db.collection('tenant_integrations').doc(tenantId).get();
    const whatsapp = integrationDoc.data()?.whatsappMeta;
    const configuredToken = typeof whatsapp?.webhookVerifyToken === 'string' ? whatsapp.webhookVerifyToken.trim() : '';

    if (!whatsapp?.connected || !configuredToken || token !== configuredToken) {
      res.status(403).send('Forbidden');
      return;
    }

    res.status(200).send(challenge);
  } catch (error) {
    console.error('Meta WhatsApp webhook verification error:', error);
    res.status(500).send('Failed to verify webhook');
  }
});

integrationsCallbackRouter.post('/meta/whatsapp/webhook/:tenantId', async (req: Request, res: Response) => {
  const tenantId = req.params.tenantId;
  if (!tenantId) {
    res.status(400).json({ error: 'Missing tenant id' });
    return;
  }

  try {
    const integrationDoc = await db.collection('tenant_integrations').doc(tenantId).get();
    const whatsapp = integrationDoc.data()?.whatsappMeta;

    if (!whatsapp?.connected) {
      res.status(200).json({ ok: true, skipped: 'integration_not_connected' });
      return;
    }

    const phoneNumberId = String(whatsapp.phoneNumberId ?? '').trim();
    const accessToken = String(whatsapp.accessToken ?? '').trim();
    if (!phoneNumberId || !accessToken) {
      res.status(200).json({ ok: true, skipped: 'integration_credentials_incomplete' });
      return;
    }

    const agentConfigDoc = await db.collection('agent_config').doc(tenantId).get();
    const agentConfigData = agentConfigDoc.data() as Record<string, unknown> | undefined;
    const languageDetectionProvider = resolveWhatsAppLanguageDetectionProvider(agentConfigData);
    const { languageCode: googleLanguageCode, voiceName: googleVoiceName } = resolveGoogleCloudVoiceConfig(agentConfigData);
    const elevenLabsVoiceId = resolveElevenLabsVoiceId(agentConfigData);
    const rawVoiceThreshold = agentConfigData?.whatsappVoiceNoteCharThreshold;
    const rawForceVoiceReplies = agentConfigData?.whatsappForceVoiceReplies;
    const rawTtsProvider = agentConfigData?.whatsappTtsProvider;
    const rawSunbirdTemperature = agentConfigData?.whatsappSunbirdTemperature;
    const voiceThreshold = typeof rawVoiceThreshold === 'number' && Number.isFinite(rawVoiceThreshold)
      ? Math.max(0, Math.floor(rawVoiceThreshold))
      : 0;
    const forceVoiceReplies = rawForceVoiceReplies === true;
    const ttsProvider: WhatsAppTtsProvider = rawTtsProvider === 'gemini-2.5-flash-preview-tts' || rawTtsProvider === 'google-cloud-tts' || rawTtsProvider === 'elevenlabs'
      ? rawTtsProvider
      : 'sunbird';
    const sunbirdTemperature = typeof rawSunbirdTemperature === 'number' && Number.isFinite(rawSunbirdTemperature)
      ? Math.min(2, Math.max(0, rawSunbirdTemperature))
      : 0.7;

    const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        const value = change?.value;
        const messages = Array.isArray(value?.messages) ? value.messages : [];
        for (const incoming of messages) {
          const from = typeof incoming?.from === 'string' ? incoming.from.trim() : '';
          const messageId = typeof incoming?.id === 'string' ? incoming.id.trim() : null;
          const identity = resolveConversationIdentity({ channel: 'whatsapp_meta', externalUserId: from });
          if (!identity.externalUserId) continue;

          if (!messageId) {
            console.warn('Skipping Meta WhatsApp message without message id.', { tenantId, from });
            continue;
          }

          const claimedMessage = await claimMetaWebhookMessage(tenantId, messageId);
          if (!claimedMessage) {
            continue;
          }

          let body = '';
          let cameFromVoiceNote = false;
          let voiceNoteAudioUrl: string | null = null;
          const imageUrls: string[] = [];
          const repliedToMessageId = typeof incoming?.context?.id === 'string' ? incoming.context.id.trim() : '';

          if (incoming?.type === 'text' && typeof incoming?.text?.body === 'string') {
            body = incoming.text.body.trim();
          }

          if (!body && incoming?.type === 'audio' && typeof incoming?.audio?.id === 'string') {
            const mediaId = incoming.audio.id.trim();
            if (mediaId) {
              const mediaInfo = await getMetaWhatsAppMediaDownloadInfo({ mediaId, accessToken });
              if (mediaInfo?.url && mediaInfo.mimeType.startsWith('audio/')) {
                const { transcript, rejectedForLength } = await transcribeWhatsAppAudio({
                  mediaUrl: mediaInfo.url,
                  contentType: mediaInfo.mimeType,
                  authHeader: `Bearer ${accessToken}`,
                });

                if (rejectedForLength) {
                  await sendMetaWhatsAppTextMessage({
                    phoneNumberId,
                    accessToken,
                    to: identity.externalUserId,
                    body: 'That voice note is too large. Please keep audio messages under 2 minutes and send shorter clips.',
                  });
                  continue;
                }

                if (transcript) {
                  body = transcript;
                  cameFromVoiceNote = true;
                  voiceNoteAudioUrl = await storeIncomingWhatsAppAudio({
                    tenantId,
                    channel: 'whatsapp_meta',
                    mediaUrl: mediaInfo.url,
                    mimeType: mediaInfo.mimeType,
                    authHeader: `Bearer ${accessToken}`,
                  });
                } else {
                  await sendMetaWhatsAppTextMessage({
                    phoneNumberId,
                    accessToken,
                    to: identity.externalUserId,
                    body: 'We could not read that message yet. Please send text, an image, or a clearer voice note.',
                  });
                  continue;
                }
              } else {
                await sendMetaWhatsAppTextMessage({
                  phoneNumberId,
                  accessToken,
                  to: identity.externalUserId,
                  body: 'We could not read that message yet. Please send text, an image, or a clearer voice note.',
                });
                continue;
              }
            }
          }

          if (incoming?.type === 'image' && typeof incoming?.image?.id === 'string') {
            const mediaId = incoming.image.id.trim();
            if (mediaId) {
              const mediaInfo = await getMetaWhatsAppMediaDownloadInfo({ mediaId, accessToken });
              const mimeType = normalizeMimeType(mediaInfo?.mimeType);
              if (mediaInfo?.url && WHATSAPP_ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
                const storedImageUrl = await storeIncomingWhatsAppImage({
                  tenantId,
                  channel: 'whatsapp_meta',
                  mediaUrl: mediaInfo.url,
                  mimeType,
                  authHeader: `Bearer ${accessToken}`,
                });
                if (storedImageUrl) {
                  imageUrls.push(storedImageUrl);
                }
              }
            }

            if (typeof incoming?.image?.caption === 'string' && incoming.image.caption.trim().length > 0) {
              body = incoming.image.caption.trim();
            }

            if (imageUrls.length === 0 && !body) {
              await sendMetaWhatsAppTextMessage({
                phoneNumberId,
                accessToken,
                to: identity.externalUserId,
                body: 'We could not read that image. Please send JPG, PNG, WEBP, or GIF images up to 8MB each.',
              });
              continue;
            }
          }

          if (!body && imageUrls.length === 0) {
            continue;
          }

          const linkedRelayTicketId = repliedToMessageId
            ? await resolveRelayTicketIdFromReplyContext({
              tenantId,
              provider: 'meta',
              providerMessageId: repliedToMessageId,
              nokExternalUserId: identity.externalUserId,
            }) ?? undefined
            : undefined;
          const quotedOriginalMessage = repliedToMessageId
            ? await resolveRelayReplyQuotedContext({
              tenantId,
              provider: 'meta',
              providerMessageId: repliedToMessageId,
              nokExternalUserId: identity.externalUserId,
            }) ?? undefined
            : undefined;

          const relayRoute = await routeNokRelayReply({
            tenantId,
            nokExternalUserId: identity.externalUserId,
            inboundBody: body,
            preferredRelayTicketId: linkedRelayTicketId,
            requireExplicitSelection: !linkedRelayTicketId,
            allowGeneralChatFallback: true,
            quotedOriginalMessage,
          });

          if (relayRoute.type === 'routed') {
            await sendMetaWhatsAppTextMessage({
              phoneNumberId,
              accessToken,
              to: identity.externalUserId,
              body: 'Thanks. We have forwarded your reply',
            });
            continue;
          }

          if (relayRoute.type === 'ambiguous' || relayRoute.type === 'invalid_code') {
            await sendMetaWhatsAppTextMessage({
              phoneNumberId,
              accessToken,
              to: identity.externalUserId,
              body: relayRoute.prompt,
            });
            continue;
          }

          const conversationsRef = db.collection('conversations');
          const existingConversationSnap = await conversationsRef
            .where('tenantId', '==', tenantId)
            .where('channel', '==', 'whatsapp_meta')
            .where('externalUserId', '==', identity.externalUserId)
            .where('status', 'in', ['open', 'handoff_requested', 'human_joined'])
            .orderBy('updatedAt', 'desc')
            .limit(1)
            .get();

          const conversationRef = existingConversationSnap.empty
            ? await conversationsRef.add({
              tenantId,
              userId: identity.scopedUserId,
              externalUserId: identity.externalUserId,
              channel: 'whatsapp_meta',
              status: 'open',
              currentLanguageCode: DEFAULT_CONVERSATION_LANGUAGE_CODE,
              createdAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            })
            : existingConversationSnap.docs[0].ref;
          const replyContext = await resolveConversationReplyContext({
            conversationId: conversationRef.id,
            providerMessageId: repliedToMessageId,
          });

          const conversationDataBeforeMessage = (await conversationRef.get()).data() as Record<string, unknown> | undefined;
          const languageStateBeforeMessage = resolveConversationLanguageState(conversationDataBeforeMessage);
          const detectedIncomingLanguage = body
            ? await detectWhatsAppLanguage({ text: body, provider: languageDetectionProvider })
            : null;
          const languageSwitchAction = resolveLanguageSwitchPromptAction({
            body,
            currentLanguageCode: languageStateBeforeMessage.currentLanguageCode,
            currentLanguageName: languageStateBeforeMessage.currentLanguageName,
            pendingLanguageCode: languageStateBeforeMessage.pendingLanguageCode,
            pendingLanguageName: languageStateBeforeMessage.pendingLanguageName,
            detectedIncomingLanguage,
          });
          const isLanguageConfirmationMessage = languageSwitchAction.type === 'confirm';
          const inboundMessageMetadata = {
            ...(cameFromVoiceNote ? { source: 'voice_note' } : {}),
            ...(isLanguageConfirmationMessage ? { flow: LANGUAGE_SWITCH_CONFIRMATION_FLOW } : {}),
          };

          await db.collection('messages').add({
            conversationId: conversationRef.id,
            tenantId,
            role: 'user',
            content: body,
            imageUrls,
            ...(cameFromVoiceNote && voiceNoteAudioUrl ? { audioUrl: voiceNoteAudioUrl, inputType: 'voice' } : {}),
            channel: 'whatsapp_meta',
            providerMessageId: messageId,
            ...(Object.keys({
              ...inboundMessageMetadata,
              ...(replyContext ? { replyContext } : {}),
            }).length > 0 ? {
              metadata: {
                ...inboundMessageMetadata,
                ...(replyContext ? { replyContext } : {}),
              },
            } : {}),
            createdAt: FieldValue.serverTimestamp(),
          });

          try {
            await upsertClinicalSnapshot({
              tenantId,
              conversationId: conversationRef.id,
              userId: identity.scopedUserId,
              externalUserId: identity.externalUserId,
              text: body,
              source: 'whatsapp_meta',
            });
          } catch (snapshotError) {
            console.warn('[Integrations] Failed to upsert clinical snapshot (WhatsApp Meta):', snapshotError);
          }

          if (languageSwitchAction.type === 'prompt') {
            await conversationRef.set({
              pendingLanguageCode: languageSwitchAction.nextLanguageCode,
              pendingLanguageOriginalMessage: body,
              updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });

            await db.collection('messages').add({
              conversationId: conversationRef.id,
              tenantId,
              role: 'assistant',
              content: languageSwitchAction.prompt,
              channel: 'whatsapp_meta',
              metadata: { flow: LANGUAGE_SWITCH_PROMPT_FLOW },
              createdAt: FieldValue.serverTimestamp(),
            });

            await sendMetaWhatsAppTextMessage({
              phoneNumberId,
              accessToken,
              to: identity.externalUserId,
              body: languageSwitchAction.prompt,
            });
            continue;
          }

          if (languageSwitchAction.type === 'confirm') {
            await conversationRef.set({
              currentLanguageCode: languageSwitchAction.accepted
                ? languageStateBeforeMessage.pendingLanguageCode ?? languageStateBeforeMessage.currentLanguageCode
                : languageStateBeforeMessage.currentLanguageCode,
              pendingLanguageCode: FieldValue.delete(),
              pendingLanguageOriginalMessage: FieldValue.delete(),
              updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });

            if (!languageSwitchAction.accepted) {
              await db.collection('messages').add({
                conversationId: conversationRef.id,
                tenantId,
                role: 'assistant',
                content: languageSwitchAction.confirmation,
                channel: 'whatsapp_meta',
                metadata: { flow: LANGUAGE_SWITCH_CONFIRMATION_FLOW },
                createdAt: FieldValue.serverTimestamp(),
              });

              await sendMetaWhatsAppTextMessage({
                phoneNumberId,
                accessToken,
                to: identity.externalUserId,
                body: languageSwitchAction.confirmation,
              });
              continue;
            }
          }

          void recordAgentActivity(tenantId, 'whatsapp-meta-received');
          void recordAgentActivity(tenantId, 'whatsapp-received');
          void recordAgentActivity(tenantId, 'meta');

          try {
            if (agentConfigData?.xPersonProfileEnabled === true) {
              const conversationDurationLastConversationSeconds = await getConversationDurationSeconds(conversationRef.id);
              const customFields = normalizeXPersonCustomFields(agentConfigData?.xPersonProfileCustomFields);
              const extractedAttributes = extractCustomProfileAttributes(body, customFields);
              await upsertXPersonProfile({
                tenantId,
                userId: identity.scopedUserId,
                externalUserId: identity.externalUserId,
                channel: 'whatsapp',
                conversationId: conversationRef.id,
                details: {
                  ...extractDefaultProfileFields(body),
                  ...(typeof conversationDurationLastConversationSeconds === 'number'
                    ? { conversationDurationLastConversationSeconds }
                    : {}),
                },
                ...(Object.keys(extractedAttributes).length > 0 ? { attributes: extractedAttributes } : {}),
              });
            }
          } catch (profileError) {
            console.warn('[Integrations] Failed to upsert XPersonProfile from Meta WhatsApp webhook:', profileError);
          }

          const historySnap = await db.collection('messages')
            .where('conversationId', '==', conversationRef.id)
            .orderBy('createdAt', 'desc')
            .limit(25)
            .get();

          const history = historySnap.docs.reverse().flatMap((doc) => {
            const data = doc.data() as { role?: 'user' | 'assistant' | string; content?: string; imageUrls?: string[] };
            if (shouldFilterLanguageFlowMessage((data as { metadata?: unknown }).metadata)) return [];
            return buildReplyAwareHistoryMessage(data);
          });

          let responseText = '';
          let requestHandoff = false;
          const conversationState = resolveConversationLanguageState((await conversationRef.get()).data() as Record<string, unknown> | undefined);
          const latestUserMessage = [...history].reverse().find((message) => message.role === 'user')?.content ?? '';
          const latestDetectedUserLanguage = latestUserMessage
            ? await detectWhatsAppLanguage({ text: latestUserMessage, provider: languageDetectionProvider })
            : null;
          const detectedUserLanguage = getLanguagePreferenceInstructionTag(latestDetectedUserLanguage);

          try {
            const agentResponse = await runAgentWithRetry(tenantId, history, {
              userId: identity.scopedUserId,
              externalUserId: identity.externalUserId,
              conversationId: conversationRef.id,
              preferredResponseLanguage: detectedUserLanguage,
              conversationLanguageCode: conversationState.currentLanguageCode,
              conversationLanguageName: conversationState.currentLanguageName,
              channel: 'whatsapp_meta',
            });
            responseText = agentResponse.text?.trim() ?? '';
            requestHandoff = agentResponse.requestHandoff ?? false;
          } catch (error) {
            console.error('Meta WhatsApp AI execution failed:', error);
            responseText = 'Sorry, I ran into a delay while checking that. Please send your message again in a moment.';
          }

          if (!responseText) continue;

          const responseLanguage = conversationState.currentLanguageCode;
          const resolvedTtsProvider = resolveLanguageAwareTtsProvider({
            configuredProvider: ttsProvider,
            responseLanguage,
          });
          const exceedsVoiceThreshold = voiceThreshold > 0 && responseText.length >= voiceThreshold;
          const shouldTryVoiceReply = forceVoiceReplies || exceedsVoiceThreshold;
          const shouldCleanVoiceText = voiceThreshold <= 0 || exceedsVoiceThreshold;
          let voiceReplySent = false;
          let voiceUrl: string | null = null;
          let assistantProviderMessageId: string | undefined;

          if (shouldTryVoiceReply) {
            try {
              voiceUrl = await generateVoiceMediaUrl({
                tenantId,
                text: responseText,
                provider: resolvedTtsProvider,
                sunbirdTemperature,
                sunbirdLanguageCode: conversationState.currentLanguageCode,
                configData: agentConfigData,
                shouldCleanText: shouldCleanVoiceText,
                googleLanguageCode,
                googleVoiceName,
                elevenLabsVoiceId,
              });
              if (voiceUrl) {
                assistantProviderMessageId = await sendMetaWhatsAppAudioMessage({
                  phoneNumberId,
                  accessToken,
                  to: identity.externalUserId,
                  mediaUrl: voiceUrl,
                });
                voiceReplySent = true;
                void recordAgentActivity(tenantId, resolvedTtsProvider);
              }
            } catch (error) {
              console.warn('Failed to generate/send Meta WhatsApp voice reply:', error);
            }
          }

          if (!voiceReplySent) {
            assistantProviderMessageId = await sendMetaWhatsAppTextMessage({
              phoneNumberId,
              accessToken,
              to: identity.externalUserId,
              body: responseText,
            });
          }

          await db.collection('messages').add({
            conversationId: conversationRef.id,
            tenantId,
            role: 'assistant',
            content: responseText,
            ...(assistantProviderMessageId ? { providerMessageId: assistantProviderMessageId } : {}),
            ...(voiceReplySent && voiceUrl ? { audioUrl: voiceUrl, inputType: 'voice', metadata: { source: 'voice_note' } } : {}),
            channel: 'whatsapp_meta',
            createdAt: FieldValue.serverTimestamp(),
          });

          try {
            if (agentConfigData?.xPersonProfileEnabled === true) {
              await syncXPersonProfileConversationDuration({
                tenantId,
                conversationId: conversationRef.id,
                userId: identity.scopedUserId,
                externalUserId: identity.externalUserId,
                channel: 'whatsapp',
              });
            }
          } catch (profileError) {
            console.warn('[Integrations] Failed to sync XPersonProfile duration after Meta WhatsApp reply:', profileError);
          }

          void recordAgentActivity(tenantId, 'whatsapp-meta-sent');
          void recordAgentActivity(tenantId, 'whatsapp-sent');
          void recordAgentActivity(tenantId, 'meta');

          const updates: Record<string, unknown> = {
            updatedAt: FieldValue.serverTimestamp(),
            pendingLanguageOriginalMessage: FieldValue.delete(),
          };
          if (requestHandoff) {
            updates.status = 'handoff_requested';
          }
          await conversationRef.update(updates);
        }
      }
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Meta WhatsApp webhook processing error:', error);
    res.status(500).json({ error: 'Failed to process Meta WhatsApp webhook' });
  }
});



/** Tenant-scoped integration routes (auth, status, disconnect). */
export const tenantIntegrationsRouter: Router = Router({ mergeParams: true });

tenantIntegrationsRouter.use(requireTenantParam);

const updateWhatsAppTwilioBody = z.object({
  accountSid: z.string().min(1),
  authToken: z.string().min(1),
  whatsappNumber: z.string().min(1),
  messagingServiceSid: z.string().optional(),
  webhookSecret: z.string().optional(),
});

const updateWhatsAppMetaBody = z.object({
  phoneNumberId: z.string().min(1),
  accessToken: z.string().min(1),
  webhookVerifyToken: z.string().optional(),
});

const metaTemplateSendBody = z.object({
  to: z.string().min(1).optional(),
  recipients: z.array(z.string().min(1)).min(1).optional(),
  template: z.object({
    name: z.string().min(1),
    language: z.object({
      code: z.string().min(1),
    }),
    components: z.array(z.object({
      type: z.enum(['header', 'body', 'button']),
      sub_type: z.enum(['quick_reply', 'url']).optional(),
      index: z.string().optional(),
      parameters: z.array(z.object({
        type: z.string().min(1),
        text: z.string().optional(),
        payload: z.string().optional(),
        currency: z.object({
          fallback_value: z.string().min(1),
          code: z.string().min(1),
          amount_1000: z.number(),
        }).optional(),
        date_time: z.object({
          fallback_value: z.string().min(1),
        }).optional(),
        image: z.object({
          link: z.string().url(),
        }).optional(),
        video: z.object({
          link: z.string().url(),
        }).optional(),
        document: z.object({
          link: z.string().url(),
          filename: z.string().optional(),
        }).optional(),
      })).optional(),
    })).optional(),
  }),
}).superRefine((value, ctx) => {
  const hasTo = typeof value.to === 'string' && value.to.trim().length > 0;
  const hasRecipients = Array.isArray(value.recipients) && value.recipients.some((recipient) => recipient.trim().length > 0);
  if (!hasTo && !hasRecipients) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Either "to" or "recipients" is required.',
      path: ['to'],
    });
  }
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

tenantIntegrationsRouter.get('/whatsapp/twilio', requireAuth, requireAdmin, async (_req, res) => {
  const tenantId = res.locals.tenantId as string;
  try {
    const doc = await db.collection('tenant_integrations').doc(tenantId).get();
    const whatsapp = doc.data()?.whatsappTwilio;
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
    console.error('WhatsApp Twilio integration fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch WhatsApp Twilio integration' });
  }
});

tenantIntegrationsRouter.put('/whatsapp/twilio', requireAuth, requireAdmin, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const parsed = updateWhatsAppTwilioBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    return;
  }

  try {
    await db.collection('tenant_integrations').doc(tenantId).set({
      tenantId,
      whatsappTwilio: {
        ...parsed.data,
        connected: true,
        updatedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    res.json({ ok: true, connected: true });
  } catch (error) {
    console.error('WhatsApp Twilio integration update error:', error);
    res.status(500).json({ error: 'Failed to save WhatsApp Twilio integration' });
  }
});

tenantIntegrationsRouter.delete('/whatsapp/twilio', requireAuth, requireAdmin, async (_req, res) => {
  const tenantId = res.locals.tenantId as string;
  try {
    await db.collection('tenant_integrations').doc(tenantId).set({
      tenantId,
      whatsappTwilio: null,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    res.json({ ok: true });
  } catch (error) {
    console.error('WhatsApp Twilio integration disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect WhatsApp Twilio integration' });
  }
});

tenantIntegrationsRouter.get('/whatsapp/meta', requireAuth, requireAdmin, async (_req, res) => {
  const tenantId = res.locals.tenantId as string;
  try {
    const doc = await db.collection('tenant_integrations').doc(tenantId).get();
    const whatsapp = doc.data()?.whatsappMeta;
    if (!whatsapp) {
      res.json({ connected: false });
      return;
    }

    res.json({
      connected: true,
      phoneNumberId: whatsapp.phoneNumberId,
      accessTokenMasked: maskSecret(whatsapp.accessToken),
      webhookVerifyTokenMasked: whatsapp.webhookVerifyToken ? maskSecret(whatsapp.webhookVerifyToken) : '',
      updatedAt: whatsapp.updatedAt ?? null,
    });
  } catch (error) {
    console.error('WhatsApp Meta integration fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch WhatsApp Meta integration' });
  }
});

tenantIntegrationsRouter.put('/whatsapp/meta', requireAuth, requireAdmin, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const parsed = updateWhatsAppMetaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    return;
  }

  try {
    await db.collection('tenant_integrations').doc(tenantId).set({
      tenantId,
      whatsappMeta: {
        ...parsed.data,
        connected: true,
        updatedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    res.json({ ok: true, connected: true });
  } catch (error) {
    console.error('WhatsApp Meta integration update error:', error);
    res.status(500).json({ error: 'Failed to save WhatsApp Meta integration' });
  }
});

tenantIntegrationsRouter.post('/whatsapp/meta/send-template', requireAuth, requireAdmin, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const parsed = metaTemplateSendBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    return;
  }

  try {
    const integrationDoc = await db.collection('tenant_integrations').doc(tenantId).get();
    const meta = integrationDoc.data()?.whatsappMeta;
    const phoneNumberId = typeof meta?.phoneNumberId === 'string' ? meta.phoneNumberId.trim() : '';
    const accessToken = typeof meta?.accessToken === 'string' ? meta.accessToken.trim() : '';
    if (!phoneNumberId || !accessToken) {
      res.status(400).json({ error: 'Meta WhatsApp integration is not connected for this tenant.' });
      return;
    }

    const recipients = Array.from(
      new Set([
        ...(parsed.data.to ? [parsed.data.to] : []),
        ...(parsed.data.recipients ?? []),
      ].map((recipient) => recipient.trim()).filter(Boolean)),
    );
    if (!recipients.length) {
      res.status(400).json({ error: 'At least one valid recipient is required.' });
      return;
    }

    const results: Array<{ recipient: string; status: 'sent' | 'failed'; providerMessageId?: string; error?: string }> = [];
    for (const recipient of recipients) {
      try {
        const providerMessageId = await sendMetaWhatsAppTemplateMessage({
          phoneNumberId,
          accessToken,
          to: recipient,
          template: parsed.data.template,
        });
        results.push({
          recipient,
          status: 'sent',
          ...(providerMessageId ? { providerMessageId } : {}),
        });
      } catch (sendError) {
        results.push({
          recipient,
          status: 'failed',
          error: sendError instanceof Error ? sendError.message : 'Failed to send template',
        });
      }
    }

    const sentCount = results.filter((result) => result.status === 'sent').length;
    const failedCount = results.length - sentCount;
    res.status(failedCount > 0 ? 207 : 201).json({
      ok: failedCount === 0,
      sentCount,
      failedCount,
      results,
    });
  } catch (error) {
    console.error('Meta WhatsApp template send error:', error);
    const details = error instanceof Error ? error.message : 'Unknown send error';
    res.status(502).json({ error: 'Failed to send Meta WhatsApp template', details });
  }
});

tenantIntegrationsRouter.delete('/whatsapp/meta', requireAuth, requireAdmin, async (_req, res) => {
  const tenantId = res.locals.tenantId as string;
  try {
    await db.collection('tenant_integrations').doc(tenantId).set({
      tenantId,
      whatsappMeta: null,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    res.json({ ok: true });
  } catch (error) {
    console.error('WhatsApp Meta integration disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect WhatsApp Meta integration' });
  }
});
