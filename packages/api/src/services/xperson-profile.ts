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

export type XPersonCustomField = {
  field: string;
  description?: string;
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

function extractPhoneFromExternalUserId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith('whatsapp:')) {
    return normalizePhone(value.slice('whatsapp:'.length));
  }
  return normalizePhone(value);
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

export function normalizeXPersonCustomFields(value: unknown): XPersonCustomField[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      if (typeof entry === 'string') {
        const field = clean(entry);
        return field ? { field } : null;
      }
      if (!entry || typeof entry !== 'object') return null;
      const field = clean((entry as { field?: unknown }).field);
      if (!field) return null;
      const description = clean((entry as { description?: unknown }).description);
      return { field, ...(description ? { description } : {}) };
    })
    .filter((entry): entry is XPersonCustomField => entry !== null);
}

function toProfileKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildFieldAliases(customField: XPersonCustomField): string[] {
  const aliasSegments = [customField.field, customField.description ?? '']
    .flatMap((segment) => segment.split(/[;,|/]/g))
    .map((segment) => segment.trim().toLowerCase())
    .filter((segment) => segment.length >= 3);

  return [...new Set(aliasSegments)];
}

export function extractCustomProfileAttributes(text: string, customFields: XPersonCustomField[]): Record<string, string> {
  const input = text.trim();
  if (!input || customFields.length === 0) return {};

  const extracted: Record<string, string> = {};

  for (const customField of customFields) {
    const key = toProfileKey(customField.field);
    if (!key) continue;

    const aliases = buildFieldAliases(customField);
    const aliasPattern = aliases.map(escapeRegex).join('|');

    const explicitPattern = aliasPattern
      ? new RegExp(`(?:my\\s+)?(?:${aliasPattern})\\s*(?:is|are|=|:|means)?\\s*([a-z0-9][a-z0-9\\s,.'\\-/]{1,80})`, 'i')
      : null;
    const reversePattern = aliasPattern
      ? new RegExp(`([a-z0-9][a-z0-9\\s,.'\\-/]{1,80})\\s*(?:is|are|=|:)\\s*(?:my\\s+)?(?:${aliasPattern})`, 'i')
      : null;

    const explicitMatch = explicitPattern ? input.match(explicitPattern) : null;
    if (explicitMatch?.[1]) {
      const value = clean(explicitMatch[1]);
      if (value) {
        extracted[key] = value;
        continue;
      }
    }

    const reverseMatch = reversePattern ? input.match(reversePattern) : null;
    if (reverseMatch?.[1]) {
      const value = clean(reverseMatch[1]);
      if (value) {
        extracted[key] = value;
        continue;
      }
    }

    const directPattern = new RegExp(
      `(?:my\\s+)?${key.replace(/_/g, '[\\s_-]+')}\\s*(?:is|are|=|:|means)?\\s*([a-z0-9][a-z0-9\\s,.'\\-/]{1,80})`,
      'i',
    );
    const directMatch = input.match(directPattern);
    if (directMatch?.[1]) {
      const value = clean(directMatch[1]);
      if (value) {
        extracted[key] = value;
        continue;
      }
    }
  }

  return extracted;
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
  const defaultRef = db.collection('xperson_profiles').doc(`${params.tenantId}__${profileId}`);
  const defaultExisting = await defaultRef.get();

  const normalizedPhone = normalizePhone(params.details?.phone) ?? extractPhoneFromExternalUserId(params.externalUserId);
  let ref = defaultRef;
  let existing = defaultExisting;

  if (!existing.exists && normalizedPhone) {
    const byPhoneSnap = await db
      .collection('xperson_profiles')
      .where('tenantId', '==', params.tenantId)
      .where('phone', '==', normalizedPhone)
      .limit(1)
      .get();

    if (!byPhoneSnap.empty) {
      ref = byPhoneSnap.docs[0].ref;
      existing = byPhoneSnap.docs[0];
    }
  }
  const existingAttributes = (existing.data()?.attributes && typeof existing.data()?.attributes === 'object')
    ? Object.fromEntries(
      Object.entries(existing.data()?.attributes as Record<string, unknown>).filter(([, value]) => typeof value === 'string'),
    ) as Record<string, string>
    : {};
  const mergedAttributes = params.attributes
    ? { ...existingAttributes, ...params.attributes }
    : undefined;

  await ref.set({
    tenantId: params.tenantId,
    profileId: existing.data()?.profileId ?? profileId,
    userId: clean(params.userId) ?? null,
    externalUserId: clean(params.externalUserId) ?? null,
    channel: params.channel ?? 'unknown',
    ...(params.details?.name ? { name: params.details.name } : {}),
    ...(normalizedPhone ? { phone: normalizedPhone } : {}),
    ...(params.details?.location ? { location: params.details.location } : {}),
    ...(typeof params.details?.conversationDurationLastConversationSeconds === 'number'
      ? { conversationDurationLastConversationSeconds: Math.max(0, Math.trunc(params.details.conversationDurationLastConversationSeconds)) }
      : {}),
    ...(mergedAttributes ? { attributes: mergedAttributes } : {}),
    ...(params.conversationId ? { lastConversationId: params.conversationId } : {}),
    updatedAt: FieldValue.serverTimestamp(),
    ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
  }, { merge: true });

  return {
    profileId: (existing.data()?.profileId as string | undefined) ?? profileId,
    created: !existing.exists,
  };
}



export async function updateXPersonProfileById(params: {
  tenantId: string;
  profileId: string;
  details?: Partial<Pick<XPersonProfileData, 'name' | 'phone' | 'location'>>;
  attributes?: Record<string, string>;
}): Promise<{ updated: boolean }> {
  const profileId = clean(params.profileId);
  if (!profileId) return { updated: false };

  const ref = db.collection('xperson_profiles').doc(`${params.tenantId}__${profileId}`);
  const existing = await ref.get();
  if (!existing.exists) return { updated: false };

  const existingAttributes = (existing.data()?.attributes && typeof existing.data()?.attributes === 'object')
    ? Object.fromEntries(
      Object.entries(existing.data()?.attributes as Record<string, unknown>).filter(([, value]) => typeof value === 'string'),
    ) as Record<string, string>
    : {};

  const incomingAttributes = params.attributes
    ? Object.fromEntries(Object.entries(params.attributes).filter(([, value]) => typeof value === 'string'))
    : undefined;

  const mergedAttributes = incomingAttributes
    ? { ...existingAttributes, ...incomingAttributes }
    : undefined;

  await ref.set({
    ...(params.details?.name !== undefined ? { name: clean(params.details.name) ?? null } : {}),
    ...(params.details?.phone !== undefined ? { phone: normalizePhone(params.details.phone) ?? null } : {}),
    ...(params.details?.location !== undefined ? { location: clean(params.details.location) ?? null } : {}),
    ...(mergedAttributes ? { attributes: mergedAttributes } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { updated: true };
}

export async function deleteXPersonProfileById(params: { tenantId: string; profileId: string }): Promise<{ deleted: boolean }> {
  const profileId = clean(params.profileId);
  if (!profileId) return { deleted: false };

  const ref = db.collection('xperson_profiles').doc(`${params.tenantId}__${profileId}`);
  const existing = await ref.get();
  if (!existing.exists) return { deleted: false };

  await ref.delete();
  return { deleted: true };
}
export async function getXPersonProfile(params: {
  tenantId: string;
  userId?: string;
  externalUserId?: string;
}): Promise<XPersonProfileData | null> {
  const candidateProfileIds = [
    clean(params.userId),
    clean(params.externalUserId),
  ].filter((value): value is string => !!value);

  let profileData: FirebaseFirestore.DocumentData | null = null;
  for (const profileId of candidateProfileIds) {
    const attempt = await db.collection('xperson_profiles').doc(`${params.tenantId}__${profileId}`).get();
    if (attempt.exists) {
      profileData = attempt.data() ?? null;
      break;
    }
  }

  if (!profileData && params.externalUserId) {
    const normalizedPhone = extractPhoneFromExternalUserId(params.externalUserId);
    if (normalizedPhone) {
      const byPhoneSnap = await db
        .collection('xperson_profiles')
        .where('tenantId', '==', params.tenantId)
        .where('phone', '==', normalizedPhone)
        .limit(1)
        .get();

      if (!byPhoneSnap.empty) {
        profileData = byPhoneSnap.docs[0].data();
      }
    }
  }

  if (!profileData) return null;

  const data = profileData;
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
