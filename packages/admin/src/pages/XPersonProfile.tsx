import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { api } from '../api';
import { useTenant } from '../TenantContext';
import { useIsMobile } from '../hooks/useIsMobile';

type PatientProfile = {
  profileId: string;
  userId?: string;
  externalUserId?: string;
  channel?: 'widget' | 'whatsapp' | 'unknown';
  name?: string;
  phone?: string;
  location?: string;
  conversationDurationLastConversationSeconds?: number | string | null;
  attributes?: Record<string, string>;
  lastConversationId?: string;
  updatedAt?: number | null;
  createdAt?: number | null;
};

type ViewMode = 'card' | 'table';
type ProfileFormState = { name: string; phone: string; location: string; attributesText: string };

const metricCardStyle: CSSProperties = {
  padding: '12px 14px',
  background: '#f8fafc',
  borderRadius: 10,
  border: '1px solid #e2e8f0',
  display: 'grid',
  gap: 4,
  minWidth: 0,
};

const inputStyle: CSSProperties = {
  border: '1px solid #cbd5e1',
  borderRadius: 10,
  padding: '10px 12px',
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  background: '#fff',
};

const primaryButtonStyle: CSSProperties = {
  border: '1px solid #2563eb',
  background: '#2563eb',
  color: '#fff',
  borderRadius: 10,
  padding: '9px 14px',
};

const secondaryButtonStyle: CSSProperties = {
  border: '1px solid #cbd5e1',
  background: '#fff',
  borderRadius: 10,
  padding: '9px 14px',
};

function Modal({
  title,
  subtitle,
  onClose,
  children,
  isMobile,
  maxHeight,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  isMobile: boolean;
  maxHeight?: string;
}) {
  const mobileTopClearance = 'calc(env(safe-area-inset-top, 0px) + 80px)';
  const mobileBottomClearance = 'calc(env(safe-area-inset-bottom, 0px) + 72px)';
  const mobileVerticalPadding = isMobile ? `${mobileTopClearance} 12px ${mobileBottomClearance}` : '24px';
  const mobileMaxHeight = `calc(100dvh - ${mobileTopClearance} - ${mobileBottomClearance})`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.48)',
        display: 'grid',
        placeItems: isMobile ? 'start center' : 'center',
        padding: mobileVerticalPadding,
        zIndex: 1000,
        overflowY: 'auto',
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 980,
          maxHeight: isMobile ? mobileMaxHeight : (maxHeight ?? '90vh'),
          marginTop: 0,
          marginBottom: isMobile ? 'calc(env(safe-area-inset-bottom, 0px) + 24px)' : 0,
          overflow: 'auto',
          borderRadius: 20,
          background: '#fff',
          boxShadow: '0 24px 80px rgba(15, 23, 42, 0.2)',
          border: '1px solid #e2e8f0',
        }}
      >
        <div style={{ padding: isMobile ? 16 : 20, borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: isMobile ? 20 : 24, color: '#0f172a' }}>{title}</h2>
            {subtitle ? <p style={{ margin: '6px 0 0', color: '#64748b' }}>{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} style={{ ...secondaryButtonStyle, padding: '8px 12px' }}>Close</button>
        </div>
        <div style={{ padding: isMobile ? 16 : 20 }}>{children}</div>
      </div>
    </div>
  );
}

export default function PatientProfilePage() {
  const { tenantId } = useTenant();
  const { isMobile } = useIsMobile();
  const [profiles, setProfiles] = useState<PatientProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSlowLoad, setIsSlowLoad] = useState(false);
  const [expandedProfileId, setExpandedProfileId] = useState<string | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [savingProfileId, setSavingProfileId] = useState<string | null>(null);
  const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [searchText, setSearchText] = useState('');
  const [creating, setCreating] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [createForm, setCreateForm] = useState<ProfileFormState>({ name: '', phone: '', location: '', attributesText: '' });
  const [editForm, setEditForm] = useState<ProfileFormState>({ name: '', phone: '', location: '', attributesText: '' });

  const inferChannel = (profile: PatientProfile): PatientProfile['channel'] => {
    if (profile.channel === 'widget' || profile.channel === 'whatsapp') return profile.channel;
    const valuesToInspect = [profile.externalUserId, profile.userId, profile.profileId].filter(Boolean).join(' ').toLowerCase();
    if (valuesToInspect.includes('whatsapp')) return 'whatsapp';
    if (valuesToInspect.includes('widget')) return 'widget';
    return 'unknown';
  };

  const normalizeDurationSeconds = (value: PatientProfile['conversationDurationLastConversationSeconds']) => {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return Math.max(0, Math.trunc(parsed));
    }
    return undefined;
  };

  const normalizedProfiles = useMemo(() => profiles.map((profile) => ({
    ...profile,
    channel: inferChannel(profile),
    conversationDurationLastConversationSeconds: normalizeDurationSeconds(profile.conversationDurationLastConversationSeconds),
  })), [profiles]);
  const selectedProfile = useMemo(() => normalizedProfiles.find((profile) => profile.profileId === expandedProfileId) ?? null, [normalizedProfiles, expandedProfileId]);

  const formatDuration = (seconds?: number | string | null) => {
    const normalizedSeconds = normalizeDurationSeconds(seconds);
    if (typeof normalizedSeconds !== 'number' || Number.isNaN(normalizedSeconds)) return '0s';
    if (normalizedSeconds < 60) return `${normalizedSeconds}s`;
    const mins = Math.floor(normalizedSeconds / 60);
    const remSeconds = normalizedSeconds % 60;
    return remSeconds === 0 ? `${mins}m` : `${mins}m ${remSeconds}s`;
  };

  const formatUpdatedAt = (timestamp?: number | null) => {
    if (!timestamp) return '—';
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return '—';
    }
  };

  const summary = useMemo(() => {
    const withNames = normalizedProfiles.filter((profile) => Boolean(profile.name?.trim())).length;
    const whatsappProfiles = normalizedProfiles.filter((profile) => profile.channel === 'whatsapp').length;
    const widgetProfiles = normalizedProfiles.filter((profile) => profile.channel === 'widget').length;
    const withCustomFields = normalizedProfiles.filter((profile) => Object.keys(profile.attributes ?? {}).length > 0).length;
    return { total: normalizedProfiles.length, withNames, whatsappProfiles, widgetProfiles, withCustomFields };
  }, [normalizedProfiles]);

  const deriveProfileName = (profile: PatientProfile) => {
    const attributeName = profile.attributes?.full_name || profile.attributes?.name;
    const directName = profile.name?.trim();
    const fallbackName = typeof attributeName === 'string' ? attributeName.trim() : '';
    if (directName) return directName;
    if (fallbackName) return fallbackName;
    if (profile.phone?.trim()) return profile.phone.trim();
    if (profile.externalUserId?.trim()) return profile.externalUserId.replace(/^whatsapp:/i, '').replace(/^widget-device:/i, 'widget-user:').trim();
    return 'Unnamed profile';
  };

  const filteredProfiles = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return normalizedProfiles
      .filter((profile) => {
        if (!query) return true;
        const haystack = [
          profile.profileId,
          profile.userId,
          profile.externalUserId,
          profile.name,
          profile.phone,
          profile.location,
          profile.lastConversationId,
          ...Object.entries(profile.attributes ?? {}).flatMap(([key, value]) => [key, value]),
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }, [normalizedProfiles, searchText]);

  const widgetProfiles = useMemo(() => filteredProfiles.filter((profile) => profile.channel === 'widget'), [filteredProfiles]);
  const whatsappProfiles = useMemo(() => filteredProfiles.filter((profile) => profile.channel === 'whatsapp'), [filteredProfiles]);
  const otherProfiles = useMemo(() => filteredProfiles.filter((profile) => profile.channel !== 'widget' && profile.channel !== 'whatsapp'), [filteredProfiles]);

  const buildFormState = (profile: PatientProfile): ProfileFormState => ({
    name: profile.name ?? '',
    phone: profile.phone ?? '',
    location: profile.location ?? '',
    attributesText: Object.entries(profile.attributes ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n'),
  });

  const startEdit = (profile: PatientProfile) => {
    setEditingProfileId(profile.profileId);
    setExpandedProfileId(profile.profileId);
    setEditForm(buildFormState(profile));
  };

  const parseAttributesText = (value: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const line of value.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const separatorIndex = trimmed.indexOf(':');
      if (separatorIndex <= 0) continue;
      const key = trimmed.slice(0, separatorIndex).trim();
      const val = trimmed.slice(separatorIndex + 1).trim();
      if (key && val) out[key] = val;
    }
    return out;
  };

  const syncProfiles = async () => {
    if (!tenantId) return;
    const res = await api<{ profiles: PatientProfile[] }>(`/tenants/${tenantId}/xperson-profile?limit=200`);
    setProfiles(res.profiles ?? []);
  };

  const saveProfile = async (profileId: string) => {
    if (!tenantId) return;
    const parsedAttributes = parseAttributesText(editForm.attributesText);
    setSavingProfileId(profileId);
    setError(null);
    try {
      await api(`/tenants/${tenantId}/xperson-profile/${encodeURIComponent(profileId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          details: { name: editForm.name, phone: editForm.phone, location: editForm.location },
          attributes: parsedAttributes,
        }),
      });
      await syncProfiles();
      setEditingProfileId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save profile changes');
    } finally {
      setSavingProfileId(null);
    }
  };

  const createProfile = async () => {
    if (!tenantId) return;
    if (!createForm.phone.trim() && !createForm.name.trim()) {
      setError('Name or phone is required to create a patient profile.');
      return;
    }

    setCreating(true);
    setError(null);

    try {
      await api(`/tenants/${tenantId}/xperson-profile/upsert`, {
        method: 'POST',
        body: JSON.stringify({
          details: { name: createForm.name, phone: createForm.phone, location: createForm.location },
          attributes: parseAttributesText(createForm.attributesText),
        }),
      });
      await syncProfiles();
      setCreateForm({ name: '', phone: '', location: '', attributesText: '' });
      setIsCreateDialogOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create patient profile');
    } finally {
      setCreating(false);
    }
  };

  const deleteProfile = async (profile: PatientProfile) => {
    if (!tenantId) return;
    const ok = window.confirm(`Delete profile ${deriveProfileName(profile)}? This action cannot be undone.`);
    if (!ok) return;
    setDeletingProfileId(profile.profileId);
    setError(null);
    try {
      await api(`/tenants/${tenantId}/xperson-profile/${encodeURIComponent(profile.profileId)}`, { method: 'DELETE' });
      setProfiles((current) => current.filter((item) => item.profileId !== profile.profileId));
      setExpandedProfileId((current) => (current === profile.profileId ? null : current));
      setEditingProfileId((current) => (current === profile.profileId ? null : current));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete profile');
    } finally {
      setDeletingProfileId(null);
    }
  };

  const renderProfileDetails = (profile: PatientProfile) => {
    const isEditing = editingProfileId === profile.profileId;
    const customAttributes = Object.entries(profile.attributes ?? {});

    return (
      <div style={{ color: '#334155', fontSize: 14, display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: '#475569', padding: '6px 10px', background: '#eff6ff', borderRadius: 999 }}>{profile.channel ?? 'unknown'}</span>
            <span style={{ fontSize: 12, color: '#475569', padding: '6px 10px', background: '#f8fafc', borderRadius: 999 }}>Updated {formatUpdatedAt(profile.updatedAt)}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {isEditing ? (
              <>
                <button type="button" onClick={() => { setEditingProfileId(null); setEditForm(buildFormState(profile)); }} style={secondaryButtonStyle}>Cancel</button>
                <button type="button" onClick={() => saveProfile(profile.profileId)} disabled={savingProfileId === profile.profileId} style={primaryButtonStyle}>
                  {savingProfileId === profile.profileId ? 'Saving...' : 'Save changes'}
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => startEdit(profile)} style={secondaryButtonStyle}>Edit patient</button>
                <button type="button" onClick={() => deleteProfile(profile)} disabled={deletingProfileId === profile.profileId} style={{ ...secondaryButtonStyle, color: '#b91c1c', borderColor: '#fecaca' }}>
                  {deletingProfileId === profile.profileId ? 'Deleting...' : 'Delete'}
                </button>
              </>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
          <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>Profile ID</span><strong style={{ overflowWrap: 'anywhere' }}>{profile.profileId}</strong></div>
          <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>External ID</span><strong style={{ overflowWrap: 'anywhere' }}>{profile.externalUserId || '—'}</strong></div>
          <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>User / device ID</span><strong style={{ overflowWrap: 'anywhere' }}>{profile.userId || '—'}</strong></div>
          <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>Phone</span><strong>{profile.phone || '—'}</strong></div>
          <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>Location</span><strong>{profile.location || '—'}</strong></div>
          <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>Last conversation</span><strong style={{ overflowWrap: 'anywhere' }}>{profile.lastConversationId || '—'}</strong></div>
        </div>

        {isEditing ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
              <label style={{ display: 'grid', gap: 6 }}><span>Name</span><input value={editForm.name} onChange={(e) => setEditForm((v) => ({ ...v, name: e.target.value }))} style={inputStyle} /></label>
              <label style={{ display: 'grid', gap: 6 }}><span>Phone</span><input value={editForm.phone} onChange={(e) => setEditForm((v) => ({ ...v, phone: e.target.value }))} style={inputStyle} /></label>
              <label style={{ display: 'grid', gap: 6 }}><span>Location</span><input value={editForm.location} onChange={(e) => setEditForm((v) => ({ ...v, location: e.target.value }))} style={inputStyle} /></label>
            </div>
            <label style={{ display: 'grid', gap: 6 }}>
              <span>Custom fields (one per line: key: value)</span>
              <textarea value={editForm.attributesText} onChange={(e) => setEditForm((v) => ({ ...v, attributesText: e.target.value }))} rows={8} style={{ ...inputStyle, fontFamily: 'monospace', resize: 'vertical' }} />
            </label>
            <div style={{ fontSize: 12, color: '#64748b' }}>Saving replaces the editable custom field list with exactly what is shown here, so removing a line will remove that custom field.</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
              <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>Display name</span><strong>{deriveProfileName(profile)}</strong></div>
              <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>Conversation duration</span><strong>{formatDuration(profile.conversationDurationLastConversationSeconds)}</strong></div>
              <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>Custom fields</span><strong>{customAttributes.length}</strong></div>
              <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>Created</span><strong>{formatUpdatedAt(profile.createdAt)}</strong></div>
            </div>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Custom fields</div>
              {customAttributes.length === 0 ? (
                <div style={{ color: '#64748b' }}>No custom patient attributes captured yet.</div>
              ) : (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }}>
                  {customAttributes.map(([key, value], index) => (
                    <div key={key} style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '240px 1fr', gap: 8, padding: '10px 12px', background: index % 2 === 0 ? '#fff' : '#f8fafc' }}>
                      <span style={{ color: '#64748b', fontWeight: 600, overflowWrap: 'anywhere' }}>{key}</span>
                      <span style={{ color: '#0f172a', overflowWrap: 'anywhere' }}>{value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderProfileCard = (profile: PatientProfile) => {
    const customAttributes = Object.entries(profile.attributes ?? {});
    return (
      <article key={profile.profileId} style={{ border: '1px solid #dbeafe', borderRadius: 18, background: 'linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)', overflow: 'hidden', boxShadow: '0 12px 30px rgba(37, 99, 235, 0.08)' }}>
        <div style={{ padding: 18, display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ display: 'grid', gap: 6 }}>
              <strong style={{ fontSize: 18, color: '#0f172a' }}>{deriveProfileName(profile)}</strong>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <span style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: '#1d4ed8', background: '#dbeafe', padding: '5px 9px', borderRadius: 999 }}>{profile.channel ?? 'unknown'}</span>
                <span style={{ fontSize: 12, color: '#475569', background: '#fff', padding: '5px 9px', borderRadius: 999, border: '1px solid #e2e8f0' }}>Updated {formatUpdatedAt(profile.updatedAt)}</span>
              </div>
            </div>
            <button type="button" onClick={() => { setExpandedProfileId(profile.profileId); setEditingProfileId(null); }} style={primaryButtonStyle}>View patient</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
            <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>Phone</span><span>{profile.phone || '—'}</span></div>
            <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>Location</span><span>{profile.location || '—'}</span></div>
            <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>Conversation duration</span><span>{formatDuration(profile.conversationDurationLastConversationSeconds)}</span></div>
            <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>Custom fields</span><span>{customAttributes.length}</span></div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {customAttributes.length > 0 ? customAttributes.slice(0, 4).map(([key, value]) => (
              <span key={key} style={{ fontSize: 12, padding: '6px 10px', borderRadius: 999, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1e40af', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {key}: {value}
              </span>
            )) : <span style={{ fontSize: 13, color: '#64748b' }}>No custom fields yet.</span>}
          </div>
        </div>
      </article>
    );
  };

  const exportCsv = () => {
    const rows = filteredProfiles.map((profile) => ({
      profileId: profile.profileId,
      channel: profile.channel ?? 'unknown',
      name: deriveProfileName(profile),
      phone: profile.phone ?? '',
      location: profile.location ?? '',
      updatedAt: formatUpdatedAt(profile.updatedAt),
      createdAt: formatUpdatedAt(profile.createdAt),
      lastConversationId: profile.lastConversationId ?? '',
      customFields: Object.entries(profile.attributes ?? {}).map(([key, value]) => `${key}=${value}`).join('; '),
    }));

    const headers = ['profileId', 'channel', 'name', 'phone', 'location', 'updatedAt', 'createdAt', 'lastConversationId', 'customFields'];
    const csv = [headers.join(','), ...rows.map((row) => headers.map((header) => `"${String(row[header as keyof typeof row] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `patient-profiles-${tenantId ?? 'tenant'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (!tenantId) {
      setLoading(false);
      setProfiles([]);
      setError('Tenant context is not ready yet. Please refresh or switch tenants.');
      return;
    }

    setLoading(true);
    setError(null);
    setIsSlowLoad(false);
    const slowLoadTimer = window.setTimeout(() => setIsSlowLoad(true), 6000);

    syncProfiles()
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load Patient Profile records'))
      .finally(() => {
        window.clearTimeout(slowLoadTimer);
        setLoading(false);
      });
  }, [tenantId]);

  return (
    <div style={{ padding: isMobile ? '16px 0' : 0, display: 'grid', gap: 16 }}>
      <div>
        <h1 style={{ margin: '0 0 8px 0', fontSize: isMobile ? 24 : 32 }}>Patient Profile</h1>
        <p style={{ color: '#64748b', marginBottom: 0, maxWidth: 920 }}>
          Profiles captured by Persons (Pipo) from widget and WhatsApp conversations. Channels are inferred from IDs when legacy records are missing explicit channel metadata.
        </p>
      </div>

      <section style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(5, minmax(0, 1fr))', gap: 10 }}>
        <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>Total profiles</span><strong>{summary.total}</strong></div>
        <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>Named profiles</span><strong>{summary.withNames}</strong></div>
        <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>WhatsApp</span><strong>{summary.whatsappProfiles}</strong></div>
        <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>Widget</span><strong>{summary.widgetProfiles}</strong></div>
        <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>With custom fields</span><strong>{summary.withCustomFields}</strong></div>
      </section>

      <section style={{ border: '1px solid #e2e8f0', borderRadius: 18, background: '#fff', padding: 16, display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, color: '#0f172a' }}>Find and review profiles</h2>
            <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 13 }}>
              Search identities, filter incomplete records, choose the best layout for review, and export the current result set for outreach or cleanup work.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => setIsCreateDialogOpen(true)} style={primaryButtonStyle}>Add patient</button>
            <button type="button" onClick={exportCsv} disabled={filteredProfiles.length === 0} style={secondaryButtonStyle}>Export CSV</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
          <label style={{ display: 'grid', gap: 6, minWidth: 0 }}>
            <span>Search</span>
            <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search name, phone, location, IDs, or custom fields" style={inputStyle} />
          </label>
        </div>

        <div style={{ display: 'flex', alignItems: isMobile ? 'stretch' : 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', flexDirection: isMobile ? 'column' : 'row' }}>
          <span style={{ color: '#475569', fontWeight: 600 }}>
            {filteredProfiles.length} profile{filteredProfiles.length === 1 ? '' : 's'} found
          </span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', width: isMobile ? '100%' : 'auto' }}>
            <button type="button" onClick={() => setViewMode('table')} style={{ ...secondaryButtonStyle, flex: isMobile ? 1 : undefined, background: viewMode === 'table' ? '#2563eb' : '#fff', color: viewMode === 'table' ? '#fff' : '#0f172a', borderColor: viewMode === 'table' ? '#2563eb' : '#cbd5e1' }}>Table</button>
            <button type="button" onClick={() => setViewMode('card')} style={{ ...secondaryButtonStyle, flex: isMobile ? 1 : undefined, background: viewMode === 'card' ? '#2563eb' : '#fff', color: viewMode === 'card' ? '#fff' : '#0f172a', borderColor: viewMode === 'card' ? '#2563eb' : '#cbd5e1' }}>Card</button>
          </div>
        </div>
      </section>

      {error ? <div style={{ padding: 12, borderRadius: 8, background: '#fef2f2', color: '#991b1b' }}>{error}</div> : null}
      {loading ? (
        <div style={{ color: '#64748b', display: 'grid', gap: 8 }}>
          <div>Loading Patient Profile data...</div>
          {isSlowLoad ? <div style={{ fontSize: 13 }}>Still working — if no records exist yet, an empty state will appear shortly.</div> : null}
        </div>
      ) : null}

      {!loading && normalizedProfiles.length === 0 ? (
        <div style={{ padding: 24, border: '1px dashed #cbd5e1', borderRadius: 10, background: '#f8fafc', color: '#64748b' }}>
          No patient profiles yet. Use the Add patient button or enable the Patient Profile tool in Agent Settings to capture profiles from conversations.
        </div>
      ) : null}

      {!loading && normalizedProfiles.length > 0 && filteredProfiles.length === 0 ? (
        <div style={{ padding: 24, border: '1px dashed #cbd5e1', borderRadius: 10, background: '#f8fafc', color: '#64748b' }}>
          No patient profiles match the current search and filter settings.
        </div>
      ) : null}

      {!loading && filteredProfiles.length > 0 && viewMode === 'table' ? (
        <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 18, background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
            <thead>
              <tr style={{ background: '#f8fafc', color: '#334155', textAlign: 'left' }}>
                <th style={{ padding: '12px 14px' }}>Name</th>
                <th style={{ padding: '12px 14px' }}>Channel</th>
                <th style={{ padding: '12px 14px' }}>Phone</th>
                <th style={{ padding: '12px 14px' }}>Location</th>
                <th style={{ padding: '12px 14px' }}>Conversation duration</th>
                <th style={{ padding: '12px 14px' }}>Custom fields</th>
                <th style={{ padding: '12px 14px' }}>Updated</th>
                <th style={{ padding: '12px 14px' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredProfiles.map((profile) => (
                <tr key={profile.profileId} style={{ borderTop: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '12px 14px' }}>{deriveProfileName(profile)}</td>
                  <td style={{ padding: '12px 14px' }}><span style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: '#1d4ed8', background: '#dbeafe', padding: '5px 8px', borderRadius: 999 }}>{profile.channel}</span></td>
                  <td style={{ padding: '12px 14px' }}>{profile.phone || '—'}</td>
                  <td style={{ padding: '12px 14px' }}>{profile.location || '—'}</td>
                  <td style={{ padding: '12px 14px' }}>{formatDuration(profile.conversationDurationLastConversationSeconds)}</td>
                  <td style={{ padding: '12px 14px' }}>{Object.keys(profile.attributes ?? {}).length}</td>
                  <td style={{ padding: '12px 14px' }}>{formatUpdatedAt(profile.updatedAt)}</td>
                  <td style={{ padding: '12px 14px' }}><button type="button" onClick={() => { setExpandedProfileId(profile.profileId); setEditingProfileId(null); }} style={secondaryButtonStyle}>View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {!loading && filteredProfiles.length > 0 && viewMode === 'card' ? (
        <div style={{ display: 'grid', gap: 18 }}>
          {widgetProfiles.length > 0 ? <section style={{ display: 'grid', gap: 12 }}><h2 style={{ margin: 0, fontSize: 18, color: '#0f172a' }}>Widget users</h2>{widgetProfiles.map((profile) => renderProfileCard(profile))}</section> : null}
          {whatsappProfiles.length > 0 ? <section style={{ display: 'grid', gap: 12 }}><h2 style={{ margin: 0, fontSize: 18, color: '#0f172a' }}>WhatsApp users</h2>{whatsappProfiles.map((profile) => renderProfileCard(profile))}</section> : null}
          {otherProfiles.length > 0 ? <section style={{ display: 'grid', gap: 12 }}><h2 style={{ margin: 0, fontSize: 18, color: '#0f172a' }}>Other channels</h2>{otherProfiles.map((profile) => renderProfileCard(profile))}</section> : null}
        </div>
      ) : null}

      {isCreateDialogOpen ? (
        <Modal
          title="Add patient"
          subtitle="Create a profile manually. When the same person later chats with the same phone number, activity can be attached to this profile."
          onClose={() => setIsCreateDialogOpen(false)}
          isMobile={isMobile}
        >
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
              <label style={{ display: 'grid', gap: 6 }}><span>Name</span><input value={createForm.name} onChange={(e) => setCreateForm((v) => ({ ...v, name: e.target.value }))} style={inputStyle} /></label>
              <label style={{ display: 'grid', gap: 6 }}><span>Phone</span><input value={createForm.phone} onChange={(e) => setCreateForm((v) => ({ ...v, phone: e.target.value }))} style={inputStyle} /></label>
              <label style={{ display: 'grid', gap: 6 }}><span>Location</span><input value={createForm.location} onChange={(e) => setCreateForm((v) => ({ ...v, location: e.target.value }))} style={inputStyle} /></label>
            </div>
            <label style={{ display: 'grid', gap: 6 }}>
              <span>Additional details (one per line: key: value)</span>
              <textarea value={createForm.attributesText} onChange={(e) => setCreateForm((v) => ({ ...v, attributesText: e.target.value }))} rows={6} style={{ ...inputStyle, fontFamily: 'monospace', resize: 'vertical' }} />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setIsCreateDialogOpen(false)} style={secondaryButtonStyle}>Cancel</button>
              <button type="button" onClick={createProfile} disabled={creating} style={primaryButtonStyle}>{creating ? 'Creating...' : 'Create patient profile'}</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {selectedProfile ? (
        <Modal
          title={deriveProfileName(selectedProfile)}
          subtitle="Review patient details, edit core fields, and manage custom profile attributes in one focused dialog."
          onClose={() => { setExpandedProfileId(null); setEditingProfileId(null); }}
          isMobile={isMobile}
          maxHeight="80vh"
        >
          {renderProfileDetails(selectedProfile)}
        </Modal>
      ) : null}
    </div>
  );
}
