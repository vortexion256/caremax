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
import { FieldValue } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import { google } from 'googleapis';

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

const WHATSAPP_PENDING_REPLY_TEXT = 'Thanks for your message. I am checking and will reply shortly.';
const WHATSAPP_PENDING_REPLY_DELAY_MS = 10_000;
const WHATSAPP_MAX_VOICE_NOTE_DURATION_SECONDS = 120;
const WHATSAPP_MAX_AUDIO_BYTES = 6 * 1024 * 1024;
const WHATSAPP_TRANSCRIPTION_DOWNLOAD_TIMEOUT_MS = 35_000;
const WHATSAPP_TRANSCRIPTION_REQUEST_TIMEOUT_MS = 45_000;
const WHATSAPP_AI_RESPONSE_TIMEOUT_MS = 45_000;
const WHATSAPP_TTS_REQUEST_TIMEOUT_MS = 120_000;
const WHATSAPP_TTS_AUDIO_DOWNLOAD_TIMEOUT_MS = 40_000;
const WHATSAPP_LUGANDA_TTS_CLEAN_TIMEOUT_MS = 20_000;

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
    console.warn('Failed to clean Luganda text for Sunbird TTS via AI:', error);
    return normalized;
  }
}
const WHATSAPP_LANGUAGE_DETECT_TIMEOUT_MS = 12_000;

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
}): Promise<{ transcript: string | null; rejectedForLength: boolean }> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) return { transcript: null, rejectedForLength: false };

  try {
    const audioRes = await fetch(params.mediaUrl, {
      headers: {
        Authorization: twilioBasicAuthHeader(params.accountSid, params.authToken),
      },
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

async function runAgentWithRetry(
  tenantId: string,
  history: Array<{ role: string; content: string; imageUrls?: string[] }>,
  context: { userId: string; externalUserId: string; conversationId: string },
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

type WhatsAppTtsProvider = 'sunbird' | 'google-cloud-tts' | 'gemini-2.5-flash-preview-tts';

async function generateVoiceMediaUrl(params: { tenantId: string; text: string; provider: WhatsAppTtsProvider }): Promise<string | null> {
  if (params.provider === 'google-cloud-tts' || params.provider === 'gemini-2.5-flash-preview-tts') {
    return generateVoiceMediaUrlWithGoogleCloud(params);
  }
  return generateVoiceMediaUrlWithSunbird(params);
}

async function generateVoiceMediaUrlWithSunbird(params: { tenantId: string; text: string }): Promise<string | null> {
  const ttsUrl = process.env.SUNBIRD_TTS_URL ?? process.env.TTS_URL;
  const apiKey = process.env.SUNBIRD_TTS_API_KEY ?? process.env.SUNBIRD_API_KEY;
  if (!ttsUrl) return null;

  const speakerIdRaw = process.env.SUNBIRD_LUGANDA_SPEAKER_ID ?? '248';
  const parsedSpeakerId = Number.parseInt(speakerIdRaw, 10);
  const speakerId = Number.isFinite(parsedSpeakerId) ? parsedSpeakerId : 248;

  const headerJson = process.env.SUNBIRD_TTS_HEADERS_JSON ?? '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...parseExtraHeaders(headerJson),
  };
  if (apiKey && !headers.Authorization) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const cleanedText = await cleanLugandaTextForSunbirdTts(params.text);
  if (!cleanedText) return null;

  const ttsRes = await fetch(ttsUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ text: cleanedText, speaker_id: speakerId, temperature: 0.7 }),
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

  const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
  const path = `tenants/${params.tenantId}/whatsapp-voice-replies/${randomUUID()}.mp3`;
  const fileRef = bucket.file(path);

  try {
    await fileRef.save(audioBuffer, {
      metadata: {
        contentType: 'audio/mpeg',
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

async function generateVoiceMediaUrlWithGoogleCloud(params: { tenantId: string; text: string }): Promise<string | null> {
  const authClient = await getGoogleCloudTtsAccessTokenClient();
  if (!authClient || !bucket) return null;

  const accessTokenResponse = await authClient.getAccessToken();
  const accessToken = typeof accessTokenResponse === 'string'
    ? accessTokenResponse
    : accessTokenResponse?.token;
  if (!accessToken) return null;

  const ttsRes = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: {
        text: params.text,
      },
      voice: {
        languageCode: process.env.GOOGLE_CLOUD_TTS_LANGUAGE_CODE ?? 'en-US',
        name: process.env.GOOGLE_CLOUD_TTS_VOICE_NAME ?? 'en-US-Neural2-F',
      },
      audioConfig: {
        audioEncoding: process.env.GOOGLE_CLOUD_TTS_AUDIO_ENCODING ?? 'MP3',
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

  const audioBuffer = Buffer.from(audioBase64, 'base64');
  const path = `tenants/${params.tenantId}/whatsapp-voice-replies/${randomUUID()}.mp3`;
  const fileRef = bucket.file(path);
  await fileRef.save(audioBuffer, { metadata: { contentType: 'audio/mpeg' } });

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

function resolveLanguageAwareTtsProvider(params: {
  configuredProvider: WhatsAppTtsProvider;
  responseLanguage: string | null;
}): WhatsAppTtsProvider {
  if (!params.responseLanguage) return params.configuredProvider;
  if (isLugandaLanguageTag(params.responseLanguage)) return 'sunbird';
  if (isEnglishLanguageTag(params.responseLanguage)) return 'google-cloud-tts';
  return params.configuredProvider;
}

async function detectResponseLanguageWithAi(text: string): Promise<string | null> {
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
    console.warn('Failed to detect WhatsApp response language via AI:', error);
    return null;
  }
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

    const incomingBody = typeof req.body?.Body === 'string' ? req.body.Body.trim() : '';
    const mediaUrl = typeof req.body?.MediaUrl0 === 'string' ? req.body.MediaUrl0.trim() : '';
    const mediaContentType = typeof req.body?.MediaContentType0 === 'string' ? req.body.MediaContentType0.trim() : '';

    let body = incomingBody;
    let cameFromVoiceNote = false;
    if (!body && isLikelyWhatsAppVoiceNote(req.body) && mediaUrl && mediaContentType) {
      const mediaDurationSeconds = getWhatsAppAudioDurationSeconds(req.body);
      if (mediaDurationSeconds !== null && mediaDurationSeconds > WHATSAPP_MAX_VOICE_NOTE_DURATION_SECONDS) {
        res.set('Content-Type', 'text/xml');
        res.status(200).send(xmlResponse('That voice note is too long. Please keep audio messages under 2 minutes or split into shorter notes.'));
        return;
      }

      const accountSid = typeof whatsapp.accountSid === 'string' ? whatsapp.accountSid.trim() : '';
      const authToken = typeof whatsapp.authToken === 'string' ? whatsapp.authToken.trim() : '';

      if (accountSid && authToken) {
        const { transcript, rejectedForLength } = await transcribeWhatsAppAudio({
          mediaUrl,
          contentType: mediaContentType,
          accountSid,
          authToken,
        });

        if (rejectedForLength) {
          res.set('Content-Type', 'text/xml');
          res.status(200).send(xmlResponse('That voice note is too large. Please keep audio messages under 2 minutes and send shorter clips.'));
          return;
        }

        if (transcript) {
          body = transcript;
          cameFromVoiceNote = true;
        }
      }
    }

    if (!body) {
      res.set('Content-Type', 'text/xml');
      res.status(200).send(xmlResponse('We could not read that message yet. Please send text or a clearer voice note.'));
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
      inputType: cameFromVoiceNote ? 'voice' : 'text',
      createdAt: FieldValue.serverTimestamp(),
    });

    const conversationData = (await conversationRef.get()).data() ?? {};
    const status = typeof conversationData.status === 'string' ? conversationData.status : 'open';
    const humanActive = status === 'human_joined';

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

  try {
    const integrationDoc = await db.collection('tenant_integrations').doc(tenantId).get();
    const whatsapp = integrationDoc.data()?.whatsapp;
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

    const conversationRef = db.collection('conversations').doc(conversationId);
    const conversationData = (await conversationRef.get()).data() ?? {};
    if (conversationData.tenantId !== tenantId) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    if (conversationData.status === 'human_joined') {
      res.status(200).json({ ok: true, skipped: 'human_joined' });
      return;
    }

    const historySnap = await db
      .collection('messages')
      .where('conversationId', '==', conversationId)
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

    const pendingReplyText = WHATSAPP_PENDING_REPLY_TEXT;
    let responseText = '';
    let requestHandoff = false;

    const agentConfigDoc = await db.collection('agent_config').doc(tenantId).get();
    const rawVoiceThreshold = agentConfigDoc.data()?.whatsappVoiceNoteCharThreshold;
    const rawForceVoiceReplies = agentConfigDoc.data()?.whatsappForceVoiceReplies;
    const rawTtsProvider = agentConfigDoc.data()?.whatsappTtsProvider;
    const voiceThreshold = typeof rawVoiceThreshold === 'number' && Number.isFinite(rawVoiceThreshold)
      ? Math.max(0, Math.floor(rawVoiceThreshold))
      : 0;
    const forceVoiceReplies = rawForceVoiceReplies === true;
    const ttsProvider: WhatsAppTtsProvider = rawTtsProvider === 'gemini-2.5-flash-preview-tts' || rawTtsProvider === 'google-cloud-tts'
      ? rawTtsProvider
      : 'sunbird';

    try {
      const agentResponse = await runAgentWithRetry(tenantId, history, {
          userId: identity.scopedUserId,
          externalUserId: identity.externalUserId,
          conversationId,
        });
      responseText = agentResponse.text?.trim() ?? '';
      requestHandoff = agentResponse.requestHandoff ?? false;
    } catch (error) {
      console.error('WhatsApp async processor AI execution failed:', error);
      responseText = 'Sorry, I ran into a delay while checking that. Please send your message again in a moment.';
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
      Body: responseText,
    });
    const responseLanguage = await detectResponseLanguageWithAi(responseText);
    const isLugandaReply = responseLanguage ? isLugandaLanguageTag(responseLanguage) : false;
    const resolvedTtsProvider = resolveLanguageAwareTtsProvider({
      configuredProvider: ttsProvider,
      responseLanguage,
    });
    const exceedsVoiceThreshold = voiceThreshold > 0 && responseText.length >= voiceThreshold;
    const shouldTryVoiceReply = isLugandaReply || forceVoiceReplies || exceedsVoiceThreshold;

    if (shouldTryVoiceReply) {
      try {
        const voiceUrl = await generateVoiceMediaUrl({ tenantId, text: responseText, provider: resolvedTtsProvider });
        if (voiceUrl) {
          payload.set('MediaUrl', voiceUrl);
        }
      } catch (error) {
        console.warn('Failed to generate WhatsApp voice reply:', error);
      }
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

    await db.collection('messages').add({
      conversationId,
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

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Twilio WhatsApp async processing error:', error);
    res.status(500).json({ error: 'Failed to process async WhatsApp response' });
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
