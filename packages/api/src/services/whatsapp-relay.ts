import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { normalizeWhatsAppExternalUserId } from './user-identity.js';

const RELAY_CODE_PREFIX = 'CMX-';
const RELAY_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RELAY_TICKET_TTL_HOURS = 24;

export type RelayReason = 'emergency' | 'user_request';
export type RelayMessageProvider = 'meta' | 'twilio';

export type RelayTicket = {
  id: string;
  relayTicketId: string;
  tenantId: string;
  patientConversationId?: string;
  patientUserId?: string;
  patientExternalUserId?: string;
  nokExternalUserId: string;
  reason: RelayReason;
  status: 'open' | 'closed' | 'expired' | 'send_failed';
  expiresAt?: Timestamp | null;
};

function generateRelayTicketId(): string {
  let code = '';
  for (let i = 0; i < 4; i += 1) {
    code += RELAY_CODE_CHARS[Math.floor(Math.random() * RELAY_CODE_CHARS.length)];
  }
  return `${RELAY_CODE_PREFIX}${code}`;
}

function extractRelayCode(text: string): string | null {
  const match = text.toUpperCase().match(/\bCMX-[A-Z0-9]{4,8}\b/);
  return match?.[0] ?? null;
}

function timestampToMillis(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  if (typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

export async function createRelayTicket(params: {
  tenantId: string;
  patientConversationId?: string;
  patientUserId?: string;
  patientExternalUserId?: string;
  nokPhone: string;
  reason: RelayReason;
}): Promise<RelayTicket> {
  const nokExternalUserId = normalizeWhatsAppExternalUserId(params.nokPhone);
  if (!nokExternalUserId) {
    throw new Error('Invalid next-of-kin phone number for relay routing.');
  }

  const ticketRef = db.collection('relay_tickets').doc();
  const relayTicketId = generateRelayTicketId();
  const now = Date.now();
  const expiresAt = Timestamp.fromMillis(now + RELAY_TICKET_TTL_HOURS * 60 * 60 * 1000);

  await ticketRef.set({
    relayTicketId,
    tenantId: params.tenantId,
    patientConversationId: params.patientConversationId ?? null,
    patientUserId: params.patientUserId ?? null,
    patientExternalUserId: params.patientExternalUserId ?? null,
    nokExternalUserId,
    reason: params.reason,
    status: 'open',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    expiresAt,
    lastActivityAt: FieldValue.serverTimestamp(),
  });

  return {
    id: ticketRef.id,
    relayTicketId,
    tenantId: params.tenantId,
    patientConversationId: params.patientConversationId,
    patientUserId: params.patientUserId,
    patientExternalUserId: params.patientExternalUserId,
    nokExternalUserId,
    reason: params.reason,
    status: 'open',
    expiresAt,
  };
}

export async function markRelayTicketSendFailed(params: { ticketId: string; errorMessage: string }): Promise<void> {
  await db.collection('relay_tickets').doc(params.ticketId).set({
    status: 'send_failed',
    sendError: params.errorMessage.slice(0, 500),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

function buildRelayMessageLinkId(params: { tenantId: string; provider: RelayMessageProvider; providerMessageId: string }): string {
  return `${params.tenantId}:${params.provider}:${params.providerMessageId}`;
}

export async function storeRelayTicketOutboundMessageLink(params: {
  tenantId: string;
  relayTicketId: string;
  provider: RelayMessageProvider;
  providerMessageId: string;
  nokExternalUserId: string;
}): Promise<void> {
  const normalizedMessageId = params.providerMessageId.trim();
  if (!normalizedMessageId) return;

  const linkRef = db.collection('relay_ticket_message_links').doc(buildRelayMessageLinkId({
    tenantId: params.tenantId,
    provider: params.provider,
    providerMessageId: normalizedMessageId,
  }));

  await linkRef.set({
    tenantId: params.tenantId,
    relayTicketId: params.relayTicketId,
    provider: params.provider,
    providerMessageId: normalizedMessageId,
    nokExternalUserId: params.nokExternalUserId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

export async function resolveRelayTicketIdFromReplyContext(params: {
  tenantId: string;
  provider: RelayMessageProvider;
  providerMessageId: string;
  nokExternalUserId: string;
}): Promise<string | null> {
  const normalizedMessageId = params.providerMessageId.trim();
  if (!normalizedMessageId) return null;

  const linkRef = db.collection('relay_ticket_message_links').doc(buildRelayMessageLinkId({
    tenantId: params.tenantId,
    provider: params.provider,
    providerMessageId: normalizedMessageId,
  }));
  const linkDoc = await linkRef.get();
  if (!linkDoc.exists) return null;

  const linkData = linkDoc.data() ?? {};
  const relayTicketId = typeof linkData.relayTicketId === 'string' ? linkData.relayTicketId : '';
  const linkedNokExternalUserId = typeof linkData.nokExternalUserId === 'string' ? linkData.nokExternalUserId : '';
  if (!relayTicketId || (linkedNokExternalUserId && linkedNokExternalUserId !== params.nokExternalUserId)) {
    return null;
  }

  return relayTicketId;
}

export async function claimTwilioWebhookMessage(tenantId: string, messageId: string): Promise<boolean> {
  const dedupRef = db.collection('twilio_whatsapp_webhook_events').doc(`${tenantId}:${messageId}`);
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

async function listActiveRelayTickets(tenantId: string, nokExternalUserId: string): Promise<RelayTicket[]> {
  const snap = await db.collection('relay_tickets')
    .where('tenantId', '==', tenantId)
    .where('nokExternalUserId', '==', nokExternalUserId)
    .where('status', '==', 'open')
    .limit(10)
    .get();

  const now = Date.now();
  const tickets: RelayTicket[] = [];
  for (const doc of snap.docs) {
    const data = doc.data() ?? {};
    const expiresAtRaw = data.expiresAt;
    const expiresAtMillis = timestampToMillis(expiresAtRaw);
    if (typeof expiresAtMillis === 'number' && expiresAtMillis <= now) {
      await doc.ref.set({ status: 'expired', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      continue;
    }

    tickets.push({
      id: doc.id,
      relayTicketId: typeof data.relayTicketId === 'string' ? data.relayTicketId : '',
      tenantId: typeof data.tenantId === 'string' ? data.tenantId : tenantId,
      patientConversationId: typeof data.patientConversationId === 'string' ? data.patientConversationId : undefined,
      patientUserId: typeof data.patientUserId === 'string' ? data.patientUserId : undefined,
      patientExternalUserId: typeof data.patientExternalUserId === 'string' ? data.patientExternalUserId : undefined,
      nokExternalUserId: typeof data.nokExternalUserId === 'string' ? data.nokExternalUserId : nokExternalUserId,
      reason: (data.reason === 'emergency' ? 'emergency' : 'user_request'),
      status: 'open',
      expiresAt: expiresAtRaw && typeof expiresAtRaw === 'object' ? expiresAtRaw as Timestamp : null,
    });
  }

  return tickets.filter((ticket) => ticket.relayTicketId);
}

export async function routeNokRelayReply(params: {
  tenantId: string;
  nokExternalUserId: string;
  inboundBody: string;
  preferredRelayTicketId?: string;
  requireExplicitSelection?: boolean;
  allowGeneralChatFallback?: boolean;
}): Promise<
{ type: 'no_ticket' }
| { type: 'ambiguous'; prompt: string }
| { type: 'invalid_code'; prompt: string }
| { type: 'routed'; relayTicketId: string; patientConversationId: string }
> {
  const tickets = await listActiveRelayTickets(params.tenantId, params.nokExternalUserId);
  if (tickets.length === 0) return { type: 'no_ticket' };

  const providedCode = extractRelayCode(params.inboundBody);
  let selected: RelayTicket | null = null;

  if (params.preferredRelayTicketId) {
    selected = tickets.find((ticket) => ticket.relayTicketId === params.preferredRelayTicketId) ?? null;
    if (!selected) {
      return {
        type: 'invalid_code',
        prompt: 'That reply is linked to an inactive CareMax request. Please reply with the current reference code from the latest alert.',
      };
    }
  } else if (providedCode) {
    selected = tickets.find((ticket) => ticket.relayTicketId.toUpperCase() === providedCode) ?? null;
    if (!selected) {
      return {
        type: 'invalid_code',
        prompt: 'We could not match that reference code. Please reply with a valid code like CMX-7KQ2 from the alert message.',
      };
    }
  } else if (tickets.length === 1 && !params.requireExplicitSelection) {
    selected = tickets[0];
  } else {
    if (params.allowGeneralChatFallback) {
      return { type: 'no_ticket' };
    }

    return {
      type: 'ambiguous',
      prompt: 'We found multiple active CareMax requests tied to this number. Please reply with your reference code (e.g., CMX-7KQ2).',
    };
  }

  if (!selected?.patientConversationId) {
    return {
      type: 'invalid_code',
      prompt: 'We could not find an active patient conversation for that request. Please contact CareMax support.',
    };
  }

  await db.collection('messages').add({
    conversationId: selected.patientConversationId,
    tenantId: params.tenantId,
    role: 'assistant',
    content: `Reply from your next of kin: ${params.inboundBody}`,
    channel: 'whatsapp',
    inputType: 'text',
    metadata: {
      source: 'nok_relay',
      relayTicketId: selected.relayTicketId,
      nokExternalUserId: params.nokExternalUserId,
      relayedContent: params.inboundBody,
    },
    createdAt: FieldValue.serverTimestamp(),
  });

  await db.collection('relay_tickets').doc(selected.id).set({
    lastActivityAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  await db.collection('conversations').doc(selected.patientConversationId).set({
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { type: 'routed', relayTicketId: selected.relayTicketId, patientConversationId: selected.patientConversationId };
}

export function buildNokRelayOutboundMessage(params: { patientLabel?: string | null; relayTicketId: string; message: string }): string {
  const patientPart = params.patientLabel?.trim() ? ` on behalf of ${params.patientLabel.trim()}` : '';
  return `CareMax alert${patientPart}. Reference code: ${params.relayTicketId}. Reply in this thread and include the code so we can route your response correctly.\n\n${params.message.trim()}`;
}
