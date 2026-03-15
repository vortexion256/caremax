import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { sendWhatsAppOutboundMessage, type WhatsAppChannel } from './whatsapp-outbound.js';

export type ReminderStatus = 'pending' | 'sent' | 'failed' | 'cancelled';

export type ReminderSafeView = {
  reminderId: string;
  dueAtIso: string;
  message: string;
  status: ReminderStatus;
};

export type ReminderRecord = {
  tenantId: string;
  conversationId?: string;
  userId?: string;
  ownerExternalUserId?: string;
  externalUserId: string;
  targetExternalUserId?: string;
  targetType?: 'self' | 'next_of_kin';
  channel: WhatsAppChannel;
  message: string;
  dueAt: Timestamp;
  timezone: string;
  status: ReminderStatus;
  createdAt?: FirebaseFirestore.FieldValue;
  updatedAt?: FirebaseFirestore.FieldValue;
  sentAt?: FirebaseFirestore.FieldValue;
  failedAt?: FirebaseFirestore.FieldValue;
  ownerNotifiedAt?: FirebaseFirestore.FieldValue;
  ownerNotifyError?: string;
  error?: string;
};

function parseReminderDateTime(input: string): Date | null {
  const parsed = new Date(input);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }
  return null;
}

export async function createWhatsAppReminder(params: {
  tenantId: string;
  message: string;
  remindAtIso: string;
  timezone?: string;
  externalUserId?: string;
  targetExternalUserId?: string;
  targetType?: 'self' | 'next_of_kin';
  userId?: string;
  conversationId?: string;
  channel?: WhatsAppChannel;
}): Promise<{ reminderId: string; dueAtIso: string }> {
  if (!params.externalUserId) {
    throw new Error('Missing externalUserId for WhatsApp reminder.');
  }

  const dueAtDate = parseReminderDateTime(params.remindAtIso);
  if (!dueAtDate) {
    throw new Error('Invalid remindAtIso date. Provide an ISO datetime string.');
  }

  if (dueAtDate.getTime() <= Date.now()) {
    throw new Error('Reminder time must be in the future.');
  }

  const reminderPayload: ReminderRecord = {
    tenantId: params.tenantId,
    conversationId: params.conversationId,
    userId: params.userId,
    ownerExternalUserId: params.externalUserId,
    externalUserId: params.externalUserId,
    targetExternalUserId: params.targetExternalUserId?.trim() || params.externalUserId,
    targetType: params.targetType === 'next_of_kin' ? 'next_of_kin' : 'self',
    channel: params.channel ?? 'whatsapp',
    message: params.message.trim(),
    dueAt: Timestamp.fromDate(dueAtDate),
    timezone: params.timezone?.trim() || 'UTC',
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const ref = await db.collection('reminders').add(reminderPayload);
  return { reminderId: ref.id, dueAtIso: dueAtDate.toISOString() };
}

export async function dispatchDueReminders(options?: {
  now?: Date;
  limit?: number;
}): Promise<{ processed: number; sent: number; failed: number; ownerNotified: number; ownerNotifyFailed: number }> {
  const now = options?.now ?? new Date();
  const limit = options?.limit ?? 25;
  const dueSnap = await db
    .collection('reminders')
    .where('status', '==', 'pending')
    .where('dueAt', '<=', Timestamp.fromDate(now))
    .orderBy('dueAt', 'asc')
    .limit(limit)
    .get();

  let sent = 0;
  let failed = 0;
  let ownerNotified = 0;
  let ownerNotifyFailed = 0;

  for (const doc of dueSnap.docs) {
    const data = doc.data() as Partial<ReminderRecord>;
    const channel = data.channel === 'whatsapp_meta' ? 'whatsapp_meta' : 'whatsapp';

    try {
      const recipientExternalUserId = typeof data.targetExternalUserId === 'string' && data.targetExternalUserId.trim()
        ? data.targetExternalUserId.trim()
        : data.externalUserId;

      if (!data.tenantId || !recipientExternalUserId || !data.message) {
        throw new Error('Reminder data is incomplete.');
      }

      await sendWhatsAppOutboundMessage({
        tenantId: data.tenantId,
        to: recipientExternalUserId,
        body: data.message,
        preferredChannel: channel,
      });

      const shouldNotifyOwner =
        data.targetType === 'next_of_kin'
        && typeof data.ownerExternalUserId === 'string'
        && data.ownerExternalUserId.trim().length > 0
        && data.ownerExternalUserId.trim() !== recipientExternalUserId;

      if (shouldNotifyOwner) {
        try {
          await sendWhatsAppOutboundMessage({
            tenantId: data.tenantId,
            to: data.ownerExternalUserId!.trim(),
            body: `✅ Your reminder to your next of kin has been sent: "${data.message}"`,
            preferredChannel: channel,
          });
          ownerNotified += 1;
          await doc.ref.update({
            ownerNotifiedAt: FieldValue.serverTimestamp(),
            ownerNotifyError: FieldValue.delete(),
          });
        } catch (ownerNotifyError) {
          ownerNotifyFailed += 1;
          await doc.ref.update({
            ownerNotifyError: ownerNotifyError instanceof Error ? ownerNotifyError.message : 'Unknown owner notify error',
          });
        }
      }

      await doc.ref.update({
        status: 'sent',
        sentAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        error: FieldValue.delete(),
      });
      sent += 1;
    } catch (error) {
      await doc.ref.update({
        status: 'failed',
        failedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        error: error instanceof Error ? error.message : 'Unknown reminder dispatch error',
      });
      failed += 1;
    }
  }

  return {
    processed: dueSnap.size,
    sent,
    failed,
    ownerNotified,
    ownerNotifyFailed,
  };
}

function toSafeReminderView(doc: FirebaseFirestore.DocumentSnapshot): ReminderSafeView {
  const data = (doc.data() ?? {}) as Partial<ReminderRecord>;
  const dueAtDate = data.dueAt instanceof Timestamp ? data.dueAt.toDate() : new Date(0);
  const safeStatus: ReminderStatus = data.status === 'sent' || data.status === 'failed' || data.status === 'cancelled' ? data.status : 'pending';
  return {
    reminderId: doc.id,
    dueAtIso: dueAtDate.toISOString(),
    message: typeof data.message === 'string' ? data.message : '',
    status: safeStatus,
  };
}

export async function listUserReminders(params: {
  tenantId: string;
  externalUserId?: string;
  now?: Date;
  limit?: number;
  upcomingOnly?: boolean;
}): Promise<ReminderSafeView[]> {
  if (!params.externalUserId) {
    throw new Error('Missing externalUserId for reminder lookup.');
  }

  const now = params.now ?? new Date();
  const limit = params.limit && params.limit > 0 ? Math.min(params.limit, 50) : 10;

  let query: FirebaseFirestore.Query = db
    .collection('reminders')
    .where('tenantId', '==', params.tenantId)
    .where('externalUserId', '==', params.externalUserId);

  if (params.upcomingOnly) {
    query = query
      .where('status', '==', 'pending')
      .where('dueAt', '>=', Timestamp.fromDate(now))
      .orderBy('dueAt', 'asc');
  } else {
    query = query.orderBy('dueAt', 'desc');
  }

  const snap = await query.limit(limit).get();
  return snap.docs.map(toSafeReminderView);
}

export async function editUserReminder(params: {
  tenantId: string;
  externalUserId?: string;
  reminderId: string;
  message?: string;
  remindAtIso?: string;
  timezone?: string;
}): Promise<ReminderSafeView> {
  if (!params.externalUserId) {
    throw new Error('Missing externalUserId for reminder edit.');
  }

  const reminderRef = db.collection('reminders').doc(params.reminderId);
  const reminderSnap = await reminderRef.get();
  if (!reminderSnap.exists) {
    throw new Error('Reminder not found.');
  }

  const reminder = reminderSnap.data() as ReminderRecord;
  if (reminder.tenantId !== params.tenantId || reminder.externalUserId !== params.externalUserId) {
    throw new Error('Reminder not found for this user.');
  }
  if (reminder.status !== 'pending') {
    throw new Error('Only pending reminders can be edited.');
  }

  const updates: Partial<ReminderRecord> & { updatedAt: FirebaseFirestore.FieldValue } = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (typeof params.message === 'string') {
    const trimmedMessage = params.message.trim();
    if (!trimmedMessage) throw new Error('Reminder message cannot be empty.');
    updates.message = trimmedMessage;
  }

  if (typeof params.remindAtIso === 'string') {
    const dueAtDate = parseReminderDateTime(params.remindAtIso);
    if (!dueAtDate) throw new Error('Invalid remindAtIso date. Provide an ISO datetime string.');
    if (dueAtDate.getTime() <= Date.now()) throw new Error('Reminder time must be in the future.');
    updates.dueAt = Timestamp.fromDate(dueAtDate);
  }

  if (typeof params.timezone === 'string') {
    updates.timezone = params.timezone.trim() || 'UTC';
  }

  if (!updates.message && !updates.dueAt && !updates.timezone) {
    throw new Error('No editable fields provided.');
  }

  await reminderRef.update(updates);
  const refreshed = await reminderRef.get();
  return toSafeReminderView(refreshed);
}

export async function deleteUserReminder(params: {
  tenantId: string;
  externalUserId?: string;
  reminderId: string;
}): Promise<ReminderSafeView> {
  if (!params.externalUserId) {
    throw new Error('Missing externalUserId for reminder deletion.');
  }

  const reminderRef = db.collection('reminders').doc(params.reminderId);
  const reminderSnap = await reminderRef.get();
  if (!reminderSnap.exists) {
    throw new Error('Reminder not found.');
  }

  const reminder = reminderSnap.data() as ReminderRecord;
  if (reminder.tenantId !== params.tenantId || reminder.externalUserId !== params.externalUserId) {
    throw new Error('Reminder not found for this user.');
  }
  if (reminder.status !== 'pending') {
    throw new Error('Only pending reminders can be deleted.');
  }

  await reminderRef.update({
    status: 'cancelled',
    updatedAt: FieldValue.serverTimestamp(),
  });

  const refreshed = await reminderRef.get();
  return toSafeReminderView(refreshed);
}
