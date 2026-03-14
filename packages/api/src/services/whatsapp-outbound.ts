import { db } from '../config/firebase.js';

export type WhatsAppChannel = 'whatsapp' | 'whatsapp_meta';

function toTwilioWhatsAppAddress(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith('whatsapp:') ? trimmed : `whatsapp:${trimmed}`;
}

function toMetaWhatsAppAddress(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith('whatsapp:') ? trimmed.slice('whatsapp:'.length) : trimmed;
}

async function sendTwilioMessage(params: {
  accountSid: string;
  authToken: string;
  messagingServiceSid?: string;
  whatsappNumber?: string;
  to: string;
  body: string;
}): Promise<void> {
  const payload = new URLSearchParams({
    To: toTwilioWhatsAppAddress(params.to),
    Body: params.body,
  });

  if (params.messagingServiceSid) {
    payload.set('MessagingServiceSid', params.messagingServiceSid);
  } else if (params.whatsappNumber) {
    payload.set('From', toTwilioWhatsAppAddress(params.whatsappNumber));
  } else {
    throw new Error('Twilio outbound message requires either Messaging Service SID or WhatsApp number.');
  }

  const auth = Buffer.from(`${params.accountSid}:${params.authToken}`).toString('base64');
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(params.accountSid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: payload,
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Twilio send failed (${response.status}): ${details}`);
  }
}

async function sendMetaMessage(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  body: string;
}): Promise<void> {
  const response = await fetch(`https://graph.facebook.com/v22.0/${encodeURIComponent(params.phoneNumberId)}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: toMetaWhatsAppAddress(params.to),
      type: 'text',
      text: { body: params.body },
    }),
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Meta WhatsApp send failed (${response.status}): ${details}`);
  }
}

export async function sendWhatsAppOutboundMessage(params: {
  tenantId: string;
  to: string;
  body: string;
  preferredChannel?: WhatsAppChannel;
}): Promise<WhatsAppChannel> {
  const integrationDoc = await db.collection('tenant_integrations').doc(params.tenantId).get();
  const data = integrationDoc.data() ?? {};

  const twilio = data.whatsappTwilio;
  const meta = data.whatsappMeta;

  const twilioConnected = Boolean(twilio?.connected);
  const metaConnected = Boolean(meta?.connected);

  const tryTwilio = async () => {
    const accountSid = typeof twilio?.accountSid === 'string' ? twilio.accountSid.trim() : '';
    const authToken = typeof twilio?.authToken === 'string' ? twilio.authToken.trim() : '';
    const messagingServiceSid = typeof twilio?.messagingServiceSid === 'string' ? twilio.messagingServiceSid.trim() : '';
    const whatsappNumber = typeof twilio?.whatsappNumber === 'string' ? twilio.whatsappNumber.trim() : '';

    if (!accountSid || !authToken) {
      throw new Error('Twilio credentials are incomplete.');
    }

    await sendTwilioMessage({
      accountSid,
      authToken,
      messagingServiceSid: messagingServiceSid || undefined,
      whatsappNumber: whatsappNumber || undefined,
      to: params.to,
      body: params.body,
    });

    return 'whatsapp' as const;
  };

  const tryMeta = async () => {
    const phoneNumberId = typeof meta?.phoneNumberId === 'string' ? meta.phoneNumberId.trim() : '';
    const accessToken = typeof meta?.accessToken === 'string' ? meta.accessToken.trim() : '';
    if (!phoneNumberId || !accessToken) {
      throw new Error('Meta WhatsApp credentials are incomplete.');
    }

    await sendMetaMessage({ phoneNumberId, accessToken, to: params.to, body: params.body });
    return 'whatsapp_meta' as const;
  };

  if (params.preferredChannel === 'whatsapp_meta' && metaConnected) return tryMeta();
  if (params.preferredChannel === 'whatsapp' && twilioConnected) return tryTwilio();

  if (twilioConnected) return tryTwilio();
  if (metaConnected) return tryMeta();

  throw new Error('No connected WhatsApp integration found for tenant.');
}
