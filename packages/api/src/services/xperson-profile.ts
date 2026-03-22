import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { sendWhatsAppOutboundMessage } from './whatsapp-outbound.js';

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

export type ActiveWhatsAppProfile = XPersonProfileData & {
  whatsappContact: string;
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

function buildPhoneLookupCandidates(value: string | undefined): string[] {
  const normalized = normalizePhone(value);
  if (!normalized) return [];

  const withoutPlus = normalized.startsWith('+') ? normalized.slice(1) : normalized;
  const withPlus = withoutPlus ? `+${withoutPlus}` : normalized;

  return Array.from(new Set([
    normalized,
    withPlus,
    withoutPlus,
  ].filter((candidate) => candidate.length > 0)));
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
    for (const phoneCandidate of buildPhoneLookupCandidates(normalizedPhone)) {
      const byPhoneSnap = await db
        .collection('xperson_profiles')
        .where('tenantId', '==', params.tenantId)
        .where('phone', '==', phoneCandidate)
        .limit(1)
        .get();

      if (!byPhoneSnap.empty) {
        ref = byPhoneSnap.docs[0].ref;
        existing = byPhoneSnap.docs[0];
        break;
      }
    }
  }
  const existingAttributes = (existing.data()?.attributes && typeof existing.data()?.attributes === 'object')
    ? Object.fromEntries(
      Object.entries(existing.data()?.attributes as Record<string, unknown>)
        .map(([key, value]) => [clean(key), clean(value)] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[0] && entry[1])),
    ) as Record<string, string>
    : {};
  const incomingAttributes = params.attributes
    ? Object.fromEntries(
      Object.entries(params.attributes)
        .map(([key, value]) => [clean(key), clean(value)] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[0] && entry[1])),
    )
    : undefined;
  const mergedAttributes = incomingAttributes
    ? { ...existingAttributes, ...incomingAttributes }
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

  const incomingAttributes = params.attributes !== undefined
    ? Object.fromEntries(
      Object.entries(params.attributes)
        .map(([key, value]) => [clean(key), clean(value)] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[0] && entry[1])),
    )
    : undefined;

  await ref.set({
    ...(params.details?.name !== undefined ? { name: clean(params.details.name) ?? null } : {}),
    ...(params.details?.phone !== undefined ? { phone: normalizePhone(params.details.phone) ?? null } : {}),
    ...(params.details?.location !== undefined ? { location: clean(params.details.location) ?? null } : {}),
    ...(incomingAttributes !== undefined ? { attributes: incomingAttributes } : {}),
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
  conversationId?: string;
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
      for (const phoneCandidate of buildPhoneLookupCandidates(normalizedPhone)) {
        const byPhoneSnap = await db
          .collection('xperson_profiles')
          .where('tenantId', '==', params.tenantId)
          .where('phone', '==', phoneCandidate)
          .limit(1)
          .get();

        if (!byPhoneSnap.empty) {
          profileData = byPhoneSnap.docs[0].data();
          break;
        }
      }
    }
  }

  if (!profileData) {
    const conversationId = clean(params.conversationId);
    if (conversationId) {
      const byConversationSnap = await db
        .collection('xperson_profiles')
        .where('tenantId', '==', params.tenantId)
        .where('lastConversationId', '==', conversationId)
        .limit(1)
        .get();

      if (!byConversationSnap.empty) {
        profileData = byConversationSnap.docs[0].data();
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

export async function listRecentlyActiveWhatsAppProfiles(params: {
  tenantId: string;
  activeWithinHours?: number;
  limit?: number;
}): Promise<ActiveWhatsAppProfile[]> {
  const activeWithinHours = Number.isFinite(params.activeWithinHours) ? Math.max(1, Math.min(168, Math.trunc(params.activeWithinHours ?? 22))) : 22;
  const limit = Number.isFinite(params.limit) ? Math.max(1, Math.min(1000, Math.trunc(params.limit ?? 500))) : 500;
  const cutoffMs = Date.now() - activeWithinHours * 60 * 60 * 1000;

  const mapProfile = (data: FirebaseFirestore.DocumentData): XPersonProfileData => ({
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
  });

  const attachWhatsappContact = (profile: XPersonProfileData): ActiveWhatsAppProfile | null => {
    const externalUserId = clean(profile.externalUserId);
    const phone = normalizePhone(profile.phone);
    const whatsappContact = externalUserId?.toLowerCase().startsWith('whatsapp:')
      ? externalUserId
      : (phone ? `whatsapp:${phone}` : undefined);
    if (!whatsappContact) return null;
    return { ...profile, phone, whatsappContact };
  };

  const dedupeProfiles = (profiles: XPersonProfileData[]): ActiveWhatsAppProfile[] => {
    const seenContacts = new Set<string>();
    return profiles
      .filter((profile) => (profile.updatedAt ?? 0) >= cutoffMs)
      .filter((profile) => profile.channel === 'whatsapp')
      .map(attachWhatsappContact)
      .filter((profile): profile is ActiveWhatsAppProfile => Boolean(profile))
      .filter((profile) => {
        const key = profile.whatsappContact.toLowerCase();
        if (seenContacts.has(key)) return false;
        seenContacts.add(key);
        return true;
      })
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, limit);
  };

  try {
    const snap = await db
      .collection('xperson_profiles')
      .where('tenantId', '==', params.tenantId)
      .where('channel', '==', 'whatsapp')
      .where('updatedAt', '>=', new Date(cutoffMs))
      .orderBy('updatedAt', 'desc')
      .limit(limit)
      .get();

    return dedupeProfiles(snap.docs.map((doc) => mapProfile(doc.data())));
  } catch (error) {
    console.warn('Falling back to broad profile scan for recently active WhatsApp contacts:', error);
    const fallbackSnap = await db
      .collection('xperson_profiles')
      .where('tenantId', '==', params.tenantId)
      .orderBy('updatedAt', 'desc')
      .limit(Math.max(limit * 3, limit))
      .get();
    return dedupeProfiles(fallbackSnap.docs.map((doc) => mapProfile(doc.data())));
  }
}

export async function sendWhatsAppNotificationToProfiles(params: {
  tenantId: string;
  message: string;
  profileIds?: string[];
  selectAllActive?: boolean;
  activeWithinHours?: number;
  requestedBy?: string;
}): Promise<{
  matchedProfiles: number;
  sentCount: number;
  failedCount: number;
  results: Array<{ profileId: string; status: 'sent' | 'failed'; recipient: string; error?: string }>;
}> {
  const message = clean(params.message);
  if (!message || message.length < 3) {
    throw new Error('Notification message must be at least 3 characters long.');
  }

  const activeProfiles = await listRecentlyActiveWhatsAppProfiles({
    tenantId: params.tenantId,
    activeWithinHours: params.activeWithinHours ?? 22,
    limit: 1000,
  });

  const requestedProfileIds = new Set((params.profileIds ?? []).map((value) => clean(value)).filter((value): value is string => Boolean(value)));
  const targetProfiles = params.selectAllActive
    ? activeProfiles
    : activeProfiles.filter((profile) => requestedProfileIds.has(profile.profileId));

  if (targetProfiles.length === 0) {
    throw new Error('No active WhatsApp contacts matched the selected recipients.');
  }

  const results: Array<{ profileId: string; status: 'sent' | 'failed'; recipient: string; error?: string }> = [];
  for (const profile of targetProfiles) {
    try {
      await sendWhatsAppOutboundMessage({
        tenantId: params.tenantId,
        to: profile.whatsappContact,
        body: message,
      });
      results.push({ profileId: profile.profileId, status: 'sent', recipient: profile.whatsappContact });
    } catch (error) {
      results.push({
        profileId: profile.profileId,
        status: 'failed',
        recipient: profile.whatsappContact,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  await db.collection('tenant_special_notifications').add({
    tenantId: params.tenantId,
    message,
    profileIds: targetProfiles.map((profile) => profile.profileId),
    requestedBy: params.requestedBy ?? null,
    activeWithinHours: params.activeWithinHours ?? 22,
    sentCount: results.filter((result) => result.status === 'sent').length,
    failedCount: results.filter((result) => result.status === 'failed').length,
    createdAt: FieldValue.serverTimestamp(),
    results,
  });

  return {
    matchedProfiles: targetProfiles.length,
    sentCount: results.filter((result) => result.status === 'sent').length,
    failedCount: results.filter((result) => result.status === 'failed').length,
    results,
  };
}
