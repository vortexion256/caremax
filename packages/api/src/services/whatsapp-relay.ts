import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { buildScopedUserId, normalizeWhatsAppExternalUserId } from './user-identity.js';
import { sendWhatsAppOutboundMessage } from './whatsapp-outbound.js';
import { getXPersonProfile } from './xperson-profile.js';

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
  createdAtMillis?: number | null;
  lastActivityAtMillis?: number | null;
};

function normalizeWhatsAppDigits(raw: string | undefined | null): string | null {
  const normalized = normalizeWhatsAppExternalUserId(raw);
  if (!normalized) return null;
  const digits = normalized.replace(/[^\d]/g, '');
  return digits || null;
}

function buildNormalizedWhatsAppIdCandidates(raw: string | undefined | null): string[] {
  const normalized = normalizeWhatsAppExternalUserId(raw);
  if (!normalized) return [];

  const withoutPrefix = normalized.replace(/^whatsapp:/i, '');
  const withPlus = withoutPrefix.startsWith('+') ? withoutPrefix : `+${withoutPrefix}`;
  const withoutPlus = withoutPrefix.replace(/^\+/, '');

  return Array.from(new Set([
    normalized,
    `whatsapp:${withPlus}`,
    `whatsapp:${withoutPlus}`,
  ]));
}

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
  supersedeOpenTicketsForPair?: boolean;
}): Promise<RelayTicket> {
  const nokExternalUserId = normalizeWhatsAppExternalUserId(params.nokPhone);
  if (!nokExternalUserId) {
    throw new Error('Invalid next-of-kin phone number for relay routing.');
  }

  const ticketRef = db.collection('relay_tickets').doc();
  const relayTicketId = generateRelayTicketId();
  const now = Date.now();
  const expiresAt = Timestamp.fromMillis(now + RELAY_TICKET_TTL_HOURS * 60 * 60 * 1000);

  if (params.supersedeOpenTicketsForPair && params.patientExternalUserId) {
    const existingOpenTickets = await db.collection('relay_tickets')
      .where('tenantId', '==', params.tenantId)
      .where('nokExternalUserId', '==', nokExternalUserId)
      .where('patientExternalUserId', '==', params.patientExternalUserId)
      .where('status', '==', 'open')
      .limit(20)
      .get();

    if (!existingOpenTickets.empty) {
      const batch = db.batch();
      for (const existingTicketDoc of existingOpenTickets.docs) {
        batch.set(existingTicketDoc.ref, {
          status: 'closed',
          closedReason: 'superseded',
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      await batch.commit();
    }
  }

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
  outboundBody?: string;
}): Promise<void> {
  const normalizedMessageId = params.providerMessageId.trim();
  if (!normalizedMessageId) return;
  const normalizedNokExternalUserId = normalizeWhatsAppExternalUserId(params.nokExternalUserId) ?? params.nokExternalUserId.trim();

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
    nokExternalUserId: normalizedNokExternalUserId,
    ...(typeof params.outboundBody === 'string' && params.outboundBody.trim()
      ? { outboundBody: params.outboundBody.trim().slice(0, 500) }
      : {}),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

export async function resolveRelayReplyQuotedContext(params: {
  tenantId: string;
  provider: RelayMessageProvider;
  providerMessageId: string;
  nokExternalUserId: string;
}): Promise<string | null> {
  const normalizedMessageId = params.providerMessageId.trim();
  if (!normalizedMessageId) return null;
  const normalizedNokExternalUserId = normalizeWhatsAppExternalUserId(params.nokExternalUserId) ?? params.nokExternalUserId.trim();

  const linkRef = db.collection('relay_ticket_message_links').doc(buildRelayMessageLinkId({
    tenantId: params.tenantId,
    provider: params.provider,
    providerMessageId: normalizedMessageId,
  }));
  const linkDoc = await linkRef.get();
  if (!linkDoc.exists) return null;

  const linkData = linkDoc.data() ?? {};
  const linkedNokExternalUserId = typeof linkData.nokExternalUserId === 'string' ? linkData.nokExternalUserId : '';
  const linkedNokDigits = normalizeWhatsAppDigits(linkedNokExternalUserId);
  const incomingNokDigits = normalizeWhatsAppDigits(normalizedNokExternalUserId);
  const nokMatches = !linkedNokExternalUserId
    || linkedNokExternalUserId === normalizedNokExternalUserId
    || (linkedNokDigits !== null && incomingNokDigits !== null && linkedNokDigits === incomingNokDigits);
  if (!nokMatches) return null;

  const outboundBody = typeof linkData.outboundBody === 'string' ? linkData.outboundBody.trim() : '';
  return outboundBody || null;
}

function formatRelayResponderLabel(params: { profileName?: string; externalUserId: string }): string {
  const preferredName = params.profileName?.trim();
  if (preferredName) return preferredName;
  return params.externalUserId.replace(/^whatsapp:/i, '');
}

export async function resolveRelayTicketIdFromReplyContext(params: {
  tenantId: string;
  provider: RelayMessageProvider;
  providerMessageId: string;
  nokExternalUserId: string;
}): Promise<string | null> {
  const normalizedMessageId = params.providerMessageId.trim();
  if (!normalizedMessageId) return null;
  const normalizedNokExternalUserId = normalizeWhatsAppExternalUserId(params.nokExternalUserId) ?? params.nokExternalUserId.trim();

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
  const linkedNokDigits = normalizeWhatsAppDigits(linkedNokExternalUserId);
  const incomingNokDigits = normalizeWhatsAppDigits(normalizedNokExternalUserId);
  const nokMatches = !linkedNokExternalUserId
    || linkedNokExternalUserId === normalizedNokExternalUserId
    || (linkedNokDigits !== null && incomingNokDigits !== null && linkedNokDigits === incomingNokDigits);

  if (!relayTicketId || !nokMatches) {
    return null;
  }

  return relayTicketId;
}

async function resolvePatientConversationForRelay(params: {
  tenantId: string;
  ticket: RelayTicket;
}): Promise<{ conversationId: string; channel: 'whatsapp' | 'whatsapp_meta'; externalUserId: string } | null> {
  if (params.ticket.patientConversationId) {
    const conversationDoc = await db.collection('conversations').doc(params.ticket.patientConversationId).get();
    if (conversationDoc.exists) {
      const data = conversationDoc.data() ?? {};
      const channel = data.channel === 'whatsapp_meta' ? 'whatsapp_meta' : 'whatsapp';
      const externalUserId = typeof data.externalUserId === 'string' && data.externalUserId.trim().length > 0
        ? data.externalUserId.trim()
        : params.ticket.patientExternalUserId?.trim() ?? '';
      if (externalUserId) {
        return { conversationId: conversationDoc.id, channel, externalUserId };
      }
    }
  }

  const normalizedPatientExternalUserId = normalizeWhatsAppExternalUserId(params.ticket.patientExternalUserId);
  if (!normalizedPatientExternalUserId) return null;

  for (const channel of ['whatsapp_meta', 'whatsapp'] as const) {
    const existingConversationSnap = await db.collection('conversations')
      .where('tenantId', '==', params.tenantId)
      .where('channel', '==', channel)
      .where('externalUserId', '==', normalizedPatientExternalUserId)
      .where('status', 'in', ['open', 'handoff_requested', 'human_joined'])
      .orderBy('updatedAt', 'desc')
      .limit(1)
      .get();

    if (!existingConversationSnap.empty) {
      return {
        conversationId: existingConversationSnap.docs[0].id,
        channel,
        externalUserId: normalizedPatientExternalUserId,
      };
    }
  }

  const conversationRef = await db.collection('conversations').add({
    tenantId: params.tenantId,
    userId: buildScopedUserId('whatsapp', normalizedPatientExternalUserId),
    externalUserId: normalizedPatientExternalUserId,
    channel: 'whatsapp',
    status: 'open',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {
    conversationId: conversationRef.id,
    channel: 'whatsapp',
    externalUserId: normalizedPatientExternalUserId,
  };
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
  const nokCandidates = buildNormalizedWhatsAppIdCandidates(nokExternalUserId);
  const querySnapshots = await Promise.all((nokCandidates.length > 0 ? nokCandidates : [nokExternalUserId])
    .slice(0, 3)
    .map((candidate) => db.collection('relay_tickets')
      .where('tenantId', '==', tenantId)
      .where('nokExternalUserId', '==', candidate)
      .where('status', '==', 'open')
      .limit(10)
      .get()));

  const docsById = new Map<string, FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>>();
  for (const snap of querySnapshots) {
    for (const doc of snap.docs) docsById.set(doc.id, doc);
  }

  const now = Date.now();
  const tickets: RelayTicket[] = [];
  for (const doc of docsById.values()) {
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
      createdAtMillis: timestampToMillis(data.createdAt),
      lastActivityAtMillis: timestampToMillis(data.lastActivityAt),
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
  quotedOriginalMessage?: string;
}): Promise<
{ type: 'no_ticket' }
| { type: 'ambiguous'; prompt: string }
| { type: 'invalid_code'; prompt: string }
| { type: 'routed'; relayTicketId: string; patientConversationId: string; relayedToPatient: boolean }
> {
  const normalizedNokExternalUserId = normalizeWhatsAppExternalUserId(params.nokExternalUserId) ?? params.nokExternalUserId.trim();
  const tickets = await listActiveRelayTickets(params.tenantId, normalizedNokExternalUserId);
  if (tickets.length === 0) return { type: 'no_ticket' };

  const providedCode = extractRelayCode(params.inboundBody);
  let selected: RelayTicket | null = null;

  if (params.preferredRelayTicketId) {
    selected = tickets.find((ticket) => ticket.relayTicketId === params.preferredRelayTicketId) ?? null;
    if (!selected) {
      if (tickets.length === 1 && !params.requireExplicitSelection) {
        selected = tickets[0];
      } else {
        return {
          type: 'invalid_code',
          prompt: 'That reply is linked to an inactive CareMax request. Please reply with the current reference code from the latest alert.',
        };
      }
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
    const allTicketsForSamePatient = tickets.length > 1 && tickets.every((ticket) => {
      const baseline = tickets[0]?.patientExternalUserId ?? tickets[0]?.patientConversationId ?? null;
      const current = ticket.patientExternalUserId ?? ticket.patientConversationId ?? null;
      return baseline !== null && current === baseline;
    });

    if (allTicketsForSamePatient && !params.requireExplicitSelection) {
      selected = [...tickets].sort((a, b) => {
        const aScore = a.lastActivityAtMillis ?? a.createdAtMillis ?? 0;
        const bScore = b.lastActivityAtMillis ?? b.createdAtMillis ?? 0;
        return bScore - aScore;
      })[0] ?? null;
    }

    if (selected) {
      // Selected using same-patient heuristic.
    } else if (params.allowGeneralChatFallback) {
      return { type: 'no_ticket' };
    } else {
      return {
        type: 'ambiguous',
        prompt: 'We found multiple active CareMax requests tied to this number. Please reply with your reference code (e.g., CMX-7KQ2).',
      };
    }
  }

  const patientConversation = selected
    ? await resolvePatientConversationForRelay({ tenantId: params.tenantId, ticket: selected })
    : null;

  if (!patientConversation) {
    return {
      type: 'invalid_code',
      prompt: 'We could not find an active patient contact for that request. Please contact CareMax support.',
    };
  }

  const normalizedInboundBody = params.inboundBody.trim();
  const responderProfile = await getXPersonProfile({
    tenantId: params.tenantId,
    externalUserId: normalizedNokExternalUserId,
  });
  const responderLabel = formatRelayResponderLabel({
    profileName: responderProfile?.name,
    externalUserId: normalizedNokExternalUserId,
  });
  const quotedOriginalMessage = params.quotedOriginalMessage?.trim();
  const contextSuffix = quotedOriginalMessage ? ` (in reply to: "${quotedOriginalMessage.slice(0, 200)}")` : '';
  const relayNarration = `${responderLabel} replied: "${normalizedInboundBody}"${contextSuffix}`;

  await db.collection('messages').add({
    conversationId: patientConversation.conversationId,
    tenantId: params.tenantId,
    role: 'assistant',
    content: relayNarration,
    channel: patientConversation.channel,
    inputType: 'text',
    metadata: {
      source: 'nok_relay',
      relayTicketId: selected.relayTicketId,
      nokExternalUserId: normalizedNokExternalUserId,
      responderLabel,
      relayedContent: normalizedInboundBody,
      quotedOriginalMessage: quotedOriginalMessage ?? null,
    },
    createdAt: FieldValue.serverTimestamp(),
  });

  await db.collection('relay_tickets').doc(selected.id).set({
    patientConversationId: patientConversation.conversationId,
    lastActivityAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  await db.collection('conversations').doc(patientConversation.conversationId).set({
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  let relayedToPatient = false;
  try {
    if (patientConversation.externalUserId) {
      const preferredChannel = patientConversation.channel === 'whatsapp_meta' ? 'whatsapp_meta' : 'whatsapp';
      await sendWhatsAppOutboundMessage({
        tenantId: params.tenantId,
        to: patientConversation.externalUserId,
        body: relayNarration,
        preferredChannel,
      });
      relayedToPatient = true;
    }
  } catch (error) {
    console.warn('Failed to mirror next-of-kin relay reply to patient WhatsApp:', error);
  }

  return {
    type: 'routed',
    relayTicketId: selected.relayTicketId,
    patientConversationId: patientConversation.conversationId,
    relayedToPatient,
  };
}

export function buildNokRelayOutboundMessage(params: { senderLabel?: string | null; relayTicketId: string; message: string }): string {
  const sender = params.senderLabel?.trim() || 'Name/phone No.';
  return `Msg from ${sender}. Ref: ${params.relayTicketId}. Comment in this thread to reply.\n\n${params.message.trim()}`;
}

export function buildAutoTimedReminderRelayMessage(params: { senderLabel?: string | null; relayTicketId: string; message: string }): string {
  const sender = params.senderLabel?.trim() || 'Name/phone No.';
  const reminderMessage = params.message.trim();
  return `Auto Msg from : "${sender}" Comment to this thread to reply.\n\n"${reminderMessage}"`;
}
