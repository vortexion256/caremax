import { useEffect, useMemo, useState, type CSSProperties } from 'react';
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
  conversationDurationLastConversationSeconds?: number;
  attributes?: Record<string, string>;
  lastConversationId?: string;
  updatedAt?: number | null;
  createdAt?: number | null;
};

type ViewMode = 'card' | 'table';
type SortMode = 'updated_desc' | 'name_asc' | 'custom_fields_desc' | 'duration_desc';
type ProfileFilter = 'all' | 'missing_name' | 'missing_phone' | 'with_custom_fields';

const metricCardStyle: CSSProperties = {
  padding: '12px 14px',
  background: '#f8fafc',
  borderRadius: 10,
  border: '1px solid #e2e8f0',
  display: 'grid',
  gap: 4,
};

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
  const [viewMode, setViewMode] = useState<ViewMode>('card');
  const [searchText, setSearchText] = useState('');
  const [channelFilter, setChannelFilter] = useState<'all' | 'widget' | 'whatsapp' | 'unknown'>('all');
  const [profileFilter, setProfileFilter] = useState<ProfileFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('updated_desc');
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', phone: '', location: '', attributesText: '' });
  const [editForm, setEditForm] = useState({ name: '', phone: '', location: '', attributesText: '' });

  const inferChannel = (profile: PatientProfile): PatientProfile['channel'] => {
    if (profile.channel === 'widget' || profile.channel === 'whatsapp') return profile.channel;
    const valuesToInspect = [profile.externalUserId, profile.userId, profile.profileId].filter(Boolean).join(' ').toLowerCase();
    if (valuesToInspect.includes('whatsapp')) return 'whatsapp';
    if (valuesToInspect.includes('widget')) return 'widget';
    return 'unknown';
  };

  const normalizedProfiles = useMemo(
    () => profiles.map((profile) => ({ ...profile, channel: inferChannel(profile) })),
    [profiles],
  );

  const selectedProfile = useMemo(
    () => normalizedProfiles.find((profile) => profile.profileId === expandedProfileId) ?? null,
    [normalizedProfiles, expandedProfileId],
  );

  const formatDuration = (seconds?: number) => {
    if (typeof seconds !== 'number' || Number.isNaN(seconds)) return '—';
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const remSeconds = seconds % 60;
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
    const withCustomFields = normalizedProfiles.filter((profile) => profile.attributes && Object.keys(profile.attributes).length > 0).length;
    return { total: normalizedProfiles.length, withNames, whatsappProfiles, widgetProfiles, withCustomFields };
  }, [normalizedProfiles]);

  const deriveProfileName = (profile: PatientProfile) => {
    const attributeName = profile.attributes?.full_name || profile.attributes?.name;
    const directName = profile.name?.trim();
    const fallbackName = typeof attributeName === 'string' ? attributeName.trim() : '';
    if (directName) return directName;
    if (fallbackName) return fallbackName;
    if (profile.phone?.trim()) return profile.phone.trim();
    if (profile.externalUserId?.trim()) {
      return profile.externalUserId.replace(/^whatsapp:/i, '').replace(/^widget-device:/i, 'widget-user:').trim();
    }
    return 'Unnamed profile';
  };

  const filteredProfiles = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    const matchesQuery = (profile: PatientProfile) => {
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
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    };

    const matchesProfileFilter = (profile: PatientProfile) => {
      switch (profileFilter) {
        case 'missing_name':
          return !profile.name?.trim();
        case 'missing_phone':
          return !profile.phone?.trim();
        case 'with_custom_fields':
          return Object.keys(profile.attributes ?? {}).length > 0;
        default:
          return true;
      }
    };

    return normalizedProfiles
      .filter((profile) => (channelFilter === 'all' ? true : profile.channel === channelFilter))
      .filter(matchesProfileFilter)
      .filter(matchesQuery)
      .sort((a, b) => {
        switch (sortMode) {
          case 'name_asc':
            return deriveProfileName(a).localeCompare(deriveProfileName(b));
          case 'custom_fields_desc':
            return Object.keys(b.attributes ?? {}).length - Object.keys(a.attributes ?? {}).length;
          case 'duration_desc':
            return (b.conversationDurationLastConversationSeconds ?? -1) - (a.conversationDurationLastConversationSeconds ?? -1);
          case 'updated_desc':
          default:
            return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
        }
      });
  }, [normalizedProfiles, channelFilter, profileFilter, searchText, sortMode]);

  const filteredSummary = useMemo(() => ({
    total: filteredProfiles.length,
    missingName: filteredProfiles.filter((profile) => !profile.name?.trim()).length,
    missingPhone: filteredProfiles.filter((profile) => !profile.phone?.trim()).length,
    withCustomFields: filteredProfiles.filter((profile) => Object.keys(profile.attributes ?? {}).length > 0).length,
  }), [filteredProfiles]);

  const widgetProfiles = useMemo(() => filteredProfiles.filter((profile) => profile.channel === 'widget'), [filteredProfiles]);
  const whatsappProfiles = useMemo(() => filteredProfiles.filter((profile) => profile.channel === 'whatsapp'), [filteredProfiles]);
  const otherProfiles = useMemo(
    () => filteredProfiles.filter((profile) => profile.channel !== 'widget' && profile.channel !== 'whatsapp'),
    [filteredProfiles],
  );

  const startEdit = (profile: PatientProfile) => {
    setEditingProfileId(profile.profileId);
    setExpandedProfileId(profile.profileId);
    setEditForm({
      name: profile.name ?? '',
      phone: profile.phone ?? '',
      location: profile.location ?? '',
      attributesText: Object.entries(profile.attributes ?? {})
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n'),
    });
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

  const saveProfile = async (profileId: string) => {
    if (!tenantId) return;
    setSavingProfileId(profileId);
    setError(null);
    try {
      await api(`/tenants/${tenantId}/xperson-profile/${encodeURIComponent(profileId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          details: {
            name: editForm.name,
            phone: editForm.phone,
            location: editForm.location,
          },
          attributes: parseAttributesText(editForm.attributesText),
        }),
      });

      setProfiles((current) => current.map((profile) => (
        profile.profileId === profileId
          ? {
            ...profile,
            name: editForm.name.trim() || undefined,
            phone: editForm.phone.trim() || undefined,
            location: editForm.location.trim() || undefined,
            attributes: parseAttributesText(editForm.attributesText),
            updatedAt: Date.now(),
          }
          : profile
      )));
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
          details: {
            name: createForm.name,
            phone: createForm.phone,
            location: createForm.location,
          },
          attributes: parseAttributesText(createForm.attributesText),
        }),
      });

      const res = await api<{ profiles: PatientProfile[] }>(`/tenants/${tenantId}/xperson-profile?limit=200`);
      setProfiles(res.profiles ?? []);
      setCreateForm({ name: '', phone: '', location: '', attributesText: '' });
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
      await api(`/tenants/${tenantId}/xperson-profile/${encodeURIComponent(profile.profileId)}`, {
        method: 'DELETE',
      });
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
      <div style={{ borderTop: '1px solid #e2e8f0', padding: 16, color: '#334155', fontSize: 14, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {isEditing ? (
            <>
              <button type="button" onClick={() => setEditingProfileId(null)} style={{ border: '1px solid #cbd5e1', background: '#fff', borderRadius: 8, padding: '6px 10px' }}>Cancel</button>
              <button type="button" onClick={() => saveProfile(profile.profileId)} disabled={savingProfileId === profile.profileId} style={{ border: '1px solid #2563eb', background: '#2563eb', color: '#fff', borderRadius: 8, padding: '6px 10px' }}>
                {savingProfileId === profile.profileId ? 'Saving...' : 'Save changes'}
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => startEdit(profile)} style={{ border: '1px solid #cbd5e1', background: '#fff', borderRadius: 8, padding: '6px 10px' }}>Edit</button>
              <button type="button" onClick={() => deleteProfile(profile)} disabled={deletingProfileId === profile.profileId} style={{ border: '1px solid #b91c1c', background: '#fff', color: '#b91c1c', borderRadius: 8, padding: '6px 10px' }}>
                {deletingProfileId === profile.profileId ? 'Deleting...' : 'Delete'}
              </button>
            </>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          <div><strong>Profile ID:</strong> {profile.profileId}</div>
          <div><strong>Last updated:</strong> {formatUpdatedAt(profile.updatedAt)}</div>
          <div><strong>External ID:</strong> {profile.externalUserId || '—'}</div>
          <div><strong>User/Device ID:</strong> {profile.userId || '—'}</div>
          <div><strong>Conversation ID:</strong> {profile.lastConversationId || '—'}</div>
        </div>

        {isEditing ? (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
              <label style={{ display: 'grid', gap: 4 }}><span>Name</span><input value={editForm.name} onChange={(e) => setEditForm((v) => ({ ...v, name: e.target.value }))} style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px' }} /></label>
              <label style={{ display: 'grid', gap: 4 }}><span>Phone</span><input value={editForm.phone} onChange={(e) => setEditForm((v) => ({ ...v, phone: e.target.value }))} style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px' }} /></label>
              <label style={{ display: 'grid', gap: 4 }}><span>Location</span><input value={editForm.location} onChange={(e) => setEditForm((v) => ({ ...v, location: e.target.value }))} style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px' }} /></label>
            </div>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>Custom fields (one per line: key: value)</span>
              <textarea value={editForm.attributesText} onChange={(e) => setEditForm((v) => ({ ...v, attributesText: e.target.value }))} rows={6} style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px', fontFamily: 'monospace' }} />
            </label>
          </div>
        ) : (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Custom fields</div>
            {customAttributes.length === 0 ? (
              <div style={{ color: '#64748b' }}>No custom patient attributes captured yet.</div>
            ) : (
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
                {customAttributes.map(([key, value], index) => (
                  <div
                    key={key}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: isMobile ? '1fr' : '220px 1fr',
                      gap: 8,
                      padding: '8px 10px',
                      background: index % 2 === 0 ? '#fff' : '#f8fafc',
                    }}
                  >
                    <span style={{ color: '#64748b', fontWeight: 600 }}>{key}</span>
                    <span style={{ color: '#0f172a' }}>{value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderProfileCard = (profile: PatientProfile) => {
    const isExpanded = expandedProfileId === profile.profileId;
    const customAttributes = Object.entries(profile.attributes ?? {});

    return (
      <article key={profile.profileId} style={{ border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff', overflow: 'hidden' }}>
        <button
          type="button"
          onClick={() => setExpandedProfileId((current) => (current === profile.profileId ? null : profile.profileId))}
          style={{
            width: '100%',
            border: 'none',
            background: 'transparent',
            textAlign: 'left',
            padding: 16,
            cursor: 'pointer',
            display: 'grid',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <strong style={{ fontSize: 16, color: '#0f172a' }}>{deriveProfileName(profile)}</strong>
            <span style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase' }}>{profile.channel ?? 'unknown'}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
            <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>Phone</span><span style={{ color: '#0f172a' }}>{profile.phone || '—'}</span></div>
            <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>Location</span><span style={{ color: '#0f172a' }}>{profile.location || '—'}</span></div>
            <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>Last duration</span><span style={{ color: '#0f172a' }}>{formatDuration(profile.conversationDurationLastConversationSeconds)}</span></div>
            <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>Custom fields</span><span style={{ color: '#0f172a' }}>{customAttributes.length}</span></div>
          </div>

          {customAttributes.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {customAttributes.slice(0, 3).map(([key, value]) => (
                <span key={key} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 999, border: '1px solid #dbeafe', background: '#eff6ff', color: '#1e40af' }}>
                  {key}: {value}
                </span>
              ))}
            </div>
          ) : null}
        </button>

        {isExpanded ? renderProfileDetails(profile) : null}
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
    const csv = [
      headers.join(','),
      ...rows.map((row) => headers.map((header) => `"${String(row[header as keyof typeof row] ?? '').replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

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

    api<{ profiles: PatientProfile[] }>(`/tenants/${tenantId}/xperson-profile?limit=200`)
      .then((res) => setProfiles(res.profiles ?? []))
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

      <section style={{ border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff', padding: 14, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, color: '#0f172a' }}>Find and review profiles</h2>
            <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 13 }}>
              Search identities, filter incomplete records, and export the current result set for outreach or cleanup work.
            </p>
          </div>
          <button type="button" onClick={exportCsv} disabled={filteredProfiles.length === 0} style={{ border: '1px solid #cbd5e1', background: '#fff', borderRadius: 8, padding: '8px 12px' }}>
            Export CSV
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 2fr) repeat(3, minmax(0, 1fr))', gap: 8 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span>Search</span>
            <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search name, phone, location, IDs, or custom fields" style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px' }} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span>Channel</span>
            <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value as typeof channelFilter)} style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px' }}>
              <option value="all">All channels</option>
              <option value="widget">Widget</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span>Profile health</span>
            <select value={profileFilter} onChange={(e) => setProfileFilter(e.target.value as ProfileFilter)} style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px' }}>
              <option value="all">All profiles</option>
              <option value="missing_name">Missing name</option>
              <option value="missing_phone">Missing phone</option>
              <option value="with_custom_fields">Has custom fields</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span>Sort</span>
            <select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)} style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px' }}>
              <option value="updated_desc">Most recently updated</option>
              <option value="name_asc">Name A–Z</option>
              <option value="custom_fields_desc">Most custom fields</option>
              <option value="duration_desc">Longest recent conversation</option>
            </select>
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
          <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>Matching profiles</span><strong>{filteredSummary.total}</strong></div>
          <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>Missing name</span><strong>{filteredSummary.missingName}</strong></div>
          <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>Missing phone</span><strong>{filteredSummary.missingPhone}</strong></div>
          <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>With custom fields</span><strong>{filteredSummary.withCustomFields}</strong></div>
        </div>
      </section>

      <section style={{ border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff', padding: 14, display: 'grid', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, color: '#0f172a' }}>Add patient</h2>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 13 }}>
            Add a patient profile manually. If a user later chats with the same phone number, AI will attach chat activity to this profile.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          <label style={{ display: 'grid', gap: 4 }}><span>Name</span><input value={createForm.name} onChange={(e) => setCreateForm((v) => ({ ...v, name: e.target.value }))} style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px' }} /></label>
          <label style={{ display: 'grid', gap: 4 }}><span>Phone</span><input value={createForm.phone} onChange={(e) => setCreateForm((v) => ({ ...v, phone: e.target.value }))} style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px' }} /></label>
          <label style={{ display: 'grid', gap: 4 }}><span>Location</span><input value={createForm.location} onChange={(e) => setCreateForm((v) => ({ ...v, location: e.target.value }))} style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px' }} /></label>
        </div>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>Additional details (one per line: key: value)</span>
          <textarea value={createForm.attributesText} onChange={(e) => setCreateForm((v) => ({ ...v, attributesText: e.target.value }))} rows={4} style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px', fontFamily: 'monospace' }} />
        </label>
        <div>
          <button type="button" onClick={createProfile} disabled={creating} style={{ border: '1px solid #2563eb', background: '#2563eb', color: '#fff', borderRadius: 8, padding: '8px 12px' }}>
            {creating ? 'Creating...' : 'Create patient profile'}
          </button>
        </div>
      </section>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: '#475569', fontWeight: 600 }}>View:</span>
        <button
          type="button"
          onClick={() => setViewMode('card')}
          style={{ border: '1px solid #cbd5e1', background: viewMode === 'card' ? '#2563eb' : '#fff', color: viewMode === 'card' ? '#fff' : '#0f172a', borderRadius: 8, padding: '6px 10px' }}
        >
          Card view
        </button>
        <button
          type="button"
          onClick={() => setViewMode('table')}
          style={{ border: '1px solid #cbd5e1', background: viewMode === 'table' ? '#2563eb' : '#fff', color: viewMode === 'table' ? '#fff' : '#0f172a', borderRadius: 8, padding: '6px 10px' }}
        >
          Table view
        </button>
      </div>

      {error && <div style={{ padding: 12, borderRadius: 8, background: '#fef2f2', color: '#991b1b' }}>{error}</div>}
      {loading ? (
        <div style={{ color: '#64748b', display: 'grid', gap: 8 }}>
          <div>Loading Patient Profile data...</div>
          {isSlowLoad ? <div style={{ fontSize: 13 }}>Still working — if no records exist yet, an empty state will appear shortly.</div> : null}
        </div>
      ) : null}

      {!loading && normalizedProfiles.length === 0 ? (
        <div style={{ padding: 24, border: '1px dashed #cbd5e1', borderRadius: 10, background: '#f8fafc', color: '#64748b' }}>
          No patient profiles yet. Add one manually below or enable the Patient Profile tool in Agent Settings to capture profiles from conversations.
        </div>
      ) : null}

      {!loading && normalizedProfiles.length > 0 && filteredProfiles.length === 0 ? (
        <div style={{ padding: 24, border: '1px dashed #cbd5e1', borderRadius: 10, background: '#f8fafc', color: '#64748b' }}>
          No patient profiles match the current search and filter settings.
        </div>
      ) : null}

      {!loading && filteredProfiles.length > 0 && viewMode === 'table' ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr style={{ background: '#f8fafc', color: '#334155', textAlign: 'left' }}>
                  <th style={{ padding: '10px 12px' }}>Name</th>
                  <th style={{ padding: '10px 12px' }}>Channel</th>
                  <th style={{ padding: '10px 12px' }}>Phone</th>
                  <th style={{ padding: '10px 12px' }}>Location</th>
                  <th style={{ padding: '10px 12px' }}>Last duration</th>
                  <th style={{ padding: '10px 12px' }}>Custom fields</th>
                  <th style={{ padding: '10px 12px' }}>Updated</th>
                  <th style={{ padding: '10px 12px' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredProfiles.map((profile) => (
                  <tr key={profile.profileId} style={{ borderTop: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '10px 12px' }}>{deriveProfileName(profile)}</td>
                    <td style={{ padding: '10px 12px', textTransform: 'uppercase', fontSize: 12 }}>{profile.channel}</td>
                    <td style={{ padding: '10px 12px' }}>{profile.phone || '—'}</td>
                    <td style={{ padding: '10px 12px' }}>{profile.location || '—'}</td>
                    <td style={{ padding: '10px 12px' }}>{formatDuration(profile.conversationDurationLastConversationSeconds)}</td>
                    <td style={{ padding: '10px 12px' }}>{Object.keys(profile.attributes ?? {}).length}</td>
                    <td style={{ padding: '10px 12px' }}>{formatUpdatedAt(profile.updatedAt)}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedProfileId(profile.profileId);
                          setEditingProfileId(null);
                        }}
                        style={{ border: '1px solid #cbd5e1', background: '#fff', borderRadius: 8, padding: '4px 8px' }}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selectedProfile ? (
            <article style={{ border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff', overflow: 'hidden' }}>
              <div style={{ padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0' }}>
                <strong style={{ color: '#0f172a' }}>{deriveProfileName(selectedProfile)}</strong>
                <span style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase' }}>{selectedProfile.channel}</span>
              </div>
              {renderProfileDetails(selectedProfile)}
            </article>
          ) : null}
        </div>
      ) : null}

      {!loading && filteredProfiles.length > 0 && viewMode === 'card' ? (
        <div style={{ display: 'grid', gap: 18 }}>
          {widgetProfiles.length > 0 ? (
            <section style={{ display: 'grid', gap: 12 }}>
              <h2 style={{ margin: 0, fontSize: 18, color: '#0f172a' }}>Widget users</h2>
              {widgetProfiles.map((profile) => renderProfileCard(profile))}
            </section>
          ) : null}

          {whatsappProfiles.length > 0 ? (
            <section style={{ display: 'grid', gap: 12 }}>
              <h2 style={{ margin: 0, fontSize: 18, color: '#0f172a' }}>WhatsApp users</h2>
              {whatsappProfiles.map((profile) => renderProfileCard(profile))}
            </section>
          ) : null}

          {otherProfiles.length > 0 ? (
            <section style={{ display: 'grid', gap: 12 }}>
              <h2 style={{ margin: 0, fontSize: 18, color: '#0f172a' }}>Other channels</h2>
              {otherProfiles.map((profile) => renderProfileCard(profile))}
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
