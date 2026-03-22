import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { buildScopedUserId } from './user-identity.js';
import type { WhatsAppChannel } from './whatsapp-outbound.js';

type OutboundConversationLogMetadata = Record<string, unknown>;

function normalizeExternalUserId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed.toLowerCase().startsWith('whatsapp:') ? trimmed : `whatsapp:${trimmed}`;
}

export async function resolveOrCreateWhatsAppConversation(params: {
  tenantId: string;
  externalUserId: string;
  preferredChannel?: WhatsAppChannel;
  fallbackUserId?: string;
}): Promise<{ conversationId: string; userId: string; channel: WhatsAppChannel }> {
  const externalUserId = normalizeExternalUserId(params.externalUserId);
  const preferredChannel = params.preferredChannel === 'whatsapp_meta' ? 'whatsapp_meta' : 'whatsapp';

  for (const channel of [preferredChannel, preferredChannel === 'whatsapp_meta' ? 'whatsapp' : 'whatsapp_meta'] as const) {
    const existingConversationSnap = await db.collection('conversations')
      .where('tenantId', '==', params.tenantId)
      .where('channel', '==', channel)
      .where('externalUserId', '==', externalUserId)
      .where('status', 'in', ['open', 'handoff_requested', 'human_joined'])
      .orderBy('updatedAt', 'desc')
      .limit(1)
      .get();

    if (!existingConversationSnap.empty) {
      const doc = existingConversationSnap.docs[0];
      const data = doc.data() ?? {};
      return {
        conversationId: doc.id,
        userId: typeof data.userId === 'string' && data.userId.trim()
          ? data.userId
          : (params.fallbackUserId?.trim() || buildScopedUserId(channel, externalUserId)),
        channel,
      };
    }
  }

  const userId = params.fallbackUserId?.trim() || buildScopedUserId(preferredChannel, externalUserId);
  const createdRef = await db.collection('conversations').add({
    tenantId: params.tenantId,
    userId,
    externalUserId,
    channel: preferredChannel,
    status: 'open',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {
    conversationId: createdRef.id,
    userId,
    channel: preferredChannel,
  };
}

export async function logOutgoingWhatsAppMessageToConversation(params: {
  tenantId: string;
  externalUserId: string;
  content: string;
  role?: 'assistant' | 'human_agent';
  preferredChannel?: WhatsAppChannel;
  conversationId?: string;
  fallbackUserId?: string;
  metadata?: OutboundConversationLogMetadata;
}): Promise<{ conversationId: string; channel: WhatsAppChannel }> {
  const role = params.role === 'human_agent' ? 'human_agent' : 'assistant';
  const providedConversationId = typeof params.conversationId === 'string' ? params.conversationId.trim() : '';

  const conversation = providedConversationId
    ? Promise.resolve({
        conversationId: providedConversationId,
        channel: (params.preferredChannel === 'whatsapp_meta' ? 'whatsapp_meta' : 'whatsapp') as WhatsAppChannel,
      })
    : resolveOrCreateWhatsAppConversation({
        tenantId: params.tenantId,
        externalUserId: params.externalUserId,
        preferredChannel: params.preferredChannel,
        fallbackUserId: params.fallbackUserId,
      });

  const resolvedConversation = await conversation;

  await db.collection('messages').add({
    conversationId: resolvedConversation.conversationId,
    tenantId: params.tenantId,
    role,
    content: params.content,
    channel: resolvedConversation.channel,
    inputType: 'text',
    ...(params.metadata ? { metadata: params.metadata } : {}),
    createdAt: FieldValue.serverTimestamp(),
  });

  await db.collection('conversations').doc(resolvedConversation.conversationId).set({
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return resolvedConversation;
}
