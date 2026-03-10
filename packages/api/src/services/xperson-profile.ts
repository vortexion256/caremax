import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';

export type XPersonProfileData = {
  tenantId: string;
  profileId: string;
  userId?: string;
  externalUserId?: string;
  channel?: 'widget' | 'whatsapp' | 'unknown';
  name?: string;
  phone?: string;
  location?: string;
  conversationDurationLastConversationSeconds?: number;
  attributes?: Record<string, string>;
  lastConversationId?: string;
  updatedAt?: number | null;
  createdAt?: number | null;
};

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const out = value.trim();
  return out || undefined;
}

function normalizePhone(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const hasPlus = value.trim().startsWith('+');
  const digits = value.replace(/[^\d]/g, '');
  if (!digits) return undefined;
  return `${hasPlus ? '+' : ''}${digits}`;
}

export function buildProfileId(params: { userId?: string; externalUserId?: string }): string {
  const userId = clean(params.userId);
  const externalUserId = clean(params.externalUserId);
  if (userId) return userId;
  if (externalUserId) return externalUserId;
  return `anonymous-${Date.now()}`;
}

export function extractDefaultProfileFields(text: string): Pick<XPersonProfileData, 'name' | 'phone' | 'location'> {
  const input = text.trim();
  if (!input) return {};

  const phoneMatch = input.match(/(?:\+?\d[\d\s().-]{6,}\d)/);
  const phone = normalizePhone(phoneMatch?.[0]);

  const nameMatch = input.match(/(?:my\s+name\s+is|i\s+am|i'm)\s+([a-z][a-z\s'-]{1,60})/i);
  const name = clean(nameMatch?.[1]);

  const locationMatch = input.match(/(?:i\s+am\s+in|i\s+live\s+in|from)\s+([a-z][a-z\s,'-]{1,80})/i);
  const location = clean(locationMatch?.[1]);

  return {
    ...(name ? { name } : {}),
    ...(phone ? { phone } : {}),
    ...(location ? { location } : {}),
  };
}


export async function getConversationDurationSeconds(conversationId: string): Promise<number | undefined> {
  if (!clean(conversationId)) return undefined;

  const snap = await db
    .collection('messages')
    .where('conversationId', '==', conversationId)
    .orderBy('createdAt', 'asc')
    .limitToLast(500)
    .get();

  if (snap.empty) return 0;

  const first = snap.docs[0]?.data()?.createdAt?.toMillis?.();
  const last = snap.docs[snap.docs.length - 1]?.data()?.createdAt?.toMillis?.();
  if (typeof first !== 'number' || typeof last !== 'number') return undefined;
  return Math.max(0, Math.round((last - first) / 1000));
}

export async function upsertXPersonProfile(params: {
  tenantId: string;
  userId?: string;
  externalUserId?: string;
  channel?: 'widget' | 'whatsapp' | 'unknown';
  conversationId?: string;
  details?: Partial<Pick<XPersonProfileData, 'name' | 'phone' | 'location' | 'conversationDurationLastConversationSeconds'>>;
  attributes?: Record<string, string>;
}): Promise<{ profileId: string; created: boolean }> {
  const profileId = buildProfileId({ userId: params.userId, externalUserId: params.externalUserId });
  const ref = db.collection('xperson_profiles').doc(`${params.tenantId}__${profileId}`);
  const existing = await ref.get();

  await ref.set({
    tenantId: params.tenantId,
    profileId,
    userId: clean(params.userId) ?? null,
    externalUserId: clean(params.externalUserId) ?? null,
    channel: params.channel ?? 'unknown',
    ...(params.details?.name ? { name: params.details.name } : {}),
    ...(params.details?.phone ? { phone: normalizePhone(params.details.phone) } : {}),
    ...(params.details?.location ? { location: params.details.location } : {}),
    ...(typeof params.details?.conversationDurationLastConversationSeconds === 'number'
      ? { conversationDurationLastConversationSeconds: Math.max(0, Math.trunc(params.details.conversationDurationLastConversationSeconds)) }
      : {}),
    ...(params.attributes ? { attributes: params.attributes } : {}),
    ...(params.conversationId ? { lastConversationId: params.conversationId } : {}),
    updatedAt: FieldValue.serverTimestamp(),
    ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
  }, { merge: true });

  return { profileId, created: !existing.exists };
}

export async function getXPersonProfile(params: {
  tenantId: string;
  userId?: string;
  externalUserId?: string;
}): Promise<XPersonProfileData | null> {
  const profileId = buildProfileId({ userId: params.userId, externalUserId: params.externalUserId });
  const doc = await db.collection('xperson_profiles').doc(`${params.tenantId}__${profileId}`).get();
  if (!doc.exists) return null;
  const data = doc.data() ?? {};
  return {
    tenantId: data.tenantId,
    profileId: data.profileId,
    userId: data.userId ?? undefined,
    externalUserId: data.externalUserId ?? undefined,
    channel: data.channel ?? 'unknown',
    name: data.name ?? undefined,
    phone: data.phone ?? undefined,
    location: data.location ?? undefined,
    conversationDurationLastConversationSeconds:
      typeof data.conversationDurationLastConversationSeconds === 'number' ? data.conversationDurationLastConversationSeconds : undefined,
    attributes: data.attributes ?? {},
    lastConversationId: data.lastConversationId ?? undefined,
    updatedAt: data.updatedAt?.toMillis?.() ?? null,
    createdAt: data.createdAt?.toMillis?.() ?? null,
  };
}

export async function listXPersonProfiles(tenantId: string, limit = 200): Promise<XPersonProfileData[]> {
  const snap = await db
    .collection('xperson_profiles')
    .where('tenantId', '==', tenantId)
    .orderBy('updatedAt', 'desc')
    .limit(Math.max(1, Math.min(500, limit)))
    .get();

  return snap.docs.map((d) => {
    const data = d.data();
    return {
      tenantId: data.tenantId,
      profileId: data.profileId,
      userId: data.userId ?? undefined,
      externalUserId: data.externalUserId ?? undefined,
      channel: data.channel ?? 'unknown',
      name: data.name ?? undefined,
      phone: data.phone ?? undefined,
      location: data.location ?? undefined,
      conversationDurationLastConversationSeconds:
        typeof data.conversationDurationLastConversationSeconds === 'number' ? data.conversationDurationLastConversationSeconds : undefined,
      attributes: data.attributes ?? {},
      lastConversationId: data.lastConversationId ?? undefined,
      updatedAt: data.updatedAt?.toMillis?.() ?? null,
      createdAt: data.createdAt?.toMillis?.() ?? null,
    } satisfies XPersonProfileData;
  });
}
