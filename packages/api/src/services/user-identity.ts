const WHATSAPP_PREFIX = 'whatsapp:';

function cleanValue(value: string | undefined | null): string {
  return (value ?? '').trim();
}

export function normalizeWhatsAppExternalUserId(raw: string | undefined | null): string | null {
  const trimmed = cleanValue(raw);
  if (!trimmed) return null;
  const withoutPrefix = trimmed.toLowerCase().startsWith(WHATSAPP_PREFIX)
    ? trimmed.slice(WHATSAPP_PREFIX.length)
    : trimmed;

  const sanitized = withoutPrefix.replace(/[\s()-]/g, '');
  const hasPlus = sanitized.startsWith('+');
  const digitsOnly = sanitized.replace(/[^\d]/g, '');
  if (!digitsOnly) return null;

  return `${WHATSAPP_PREFIX}${hasPlus ? '+' : ''}${digitsOnly}`;
}

export function normalizeWidgetExternalUserId(raw: string | undefined | null): string | null {
  const trimmed = cleanValue(raw);
  if (!trimmed) return null;
  return trimmed.replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 120) || null;
}

export function buildScopedUserId(channel: 'widget' | 'whatsapp', externalUserId: string): string {
  return `${channel}:${externalUserId}`;
}

export function resolveConversationIdentity(params: {
  channel: 'widget' | 'whatsapp';
  externalUserId?: string | null;
  fallbackUserId?: string | null;
}): { externalUserId: string; scopedUserId: string } {
  const normalizedExternal = params.channel === 'whatsapp'
    ? normalizeWhatsAppExternalUserId(params.externalUserId)
    : normalizeWidgetExternalUserId(params.externalUserId);

  const normalizedFallback = params.channel === 'whatsapp'
    ? normalizeWhatsAppExternalUserId(params.fallbackUserId)
    : normalizeWidgetExternalUserId(params.fallbackUserId);

  const effectiveExternal = normalizedExternal ?? normalizedFallback ?? `${params.channel}-anon-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return {
    externalUserId: effectiveExternal,
    scopedUserId: buildScopedUserId(params.channel, effectiveExternal),
  };
}
