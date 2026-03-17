import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { api } from '../api';
import { firestore } from '../firebase';
import { useTenant } from '../TenantContext';
import { useIsMobile } from '../hooks/useIsMobile';

type XPersonProfile = {
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
};

type VitalLog = {
  id: string;
  type: string;
  value: number;
  unit: string | null;
  recordedAt: number | null;
};

const metricCardStyle: CSSProperties = {
  padding: '12px 14px',
  background: '#f8fafc',
  borderRadius: 10,
  border: '1px solid #e2e8f0',
  display: 'grid',
  gap: 4,
};

export default function XPersonProfilePage() {
  const { tenantId } = useTenant();
  const { isMobile } = useIsMobile();
  const [profiles, setProfiles] = useState<XPersonProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSlowLoad, setIsSlowLoad] = useState(false);
  const [expandedProfileId, setExpandedProfileId] = useState<string | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [savingProfileId, setSavingProfileId] = useState<string | null>(null);
  const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', phone: '', location: '', attributesText: '' });
  const [vitalsByProfileId, setVitalsByProfileId] = useState<Record<string, VitalLog[]>>({});
  const [vitalsLoadingByProfileId, setVitalsLoadingByProfileId] = useState<Record<string, boolean>>({});

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
    const withNames = profiles.filter((profile) => Boolean(profile.name?.trim())).length;
    const whatsappProfiles = profiles.filter((profile) => profile.channel === 'whatsapp').length;
    const widgetProfiles = profiles.filter((profile) => profile.channel === 'widget').length;
    const withCustomFields = profiles.filter((profile) => profile.attributes && Object.keys(profile.attributes).length > 0).length;
    return { total: profiles.length, withNames, whatsappProfiles, widgetProfiles, withCustomFields };
  }, [profiles]);

  const widgetProfiles = useMemo(() => profiles.filter((profile) => profile.channel === 'widget'), [profiles]);
  const whatsappProfiles = useMemo(() => profiles.filter((profile) => profile.channel === 'whatsapp'), [profiles]);
  const otherProfiles = useMemo(
    () => profiles.filter((profile) => profile.channel !== 'widget' && profile.channel !== 'whatsapp'),
    [profiles],
  );

  const deriveProfileName = (profile: XPersonProfile) => {
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

  const startEdit = (profile: XPersonProfile) => {
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



  const resolveVitalsUserId = (profile: XPersonProfile) => {
    const direct = profile.userId?.trim();
    if (direct) return direct;
    const external = profile.externalUserId?.trim();
    if (external) return external;
    return '';
  };

  const loadVitalsForProfile = async (profile: XPersonProfile) => {
    const lookupUserId = resolveVitalsUserId(profile);
    if (!lookupUserId) {
      setVitalsByProfileId((current) => ({ ...current, [profile.profileId]: [] }));
      return;
    }
    if (vitalsLoadingByProfileId[profile.profileId]) return;
    if (vitalsByProfileId[profile.profileId]) return;

    setVitalsLoadingByProfileId((current) => ({ ...current, [profile.profileId]: true }));
    try {
      const snap = await getDocs(query(
        collection(firestore, 'vitals'),
        where('userId', '==', lookupUserId),
        orderBy('recordedAt', 'desc'),
        limit(20),
      ));

      const logs = snap.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          type: typeof data.type === 'string' ? data.type : 'unknown',
          value: typeof data.value === 'number' ? data.value : Number(data.value ?? 0),
          unit: typeof data.unit === 'string' ? data.unit : null,
          recordedAt: data.recordedAt && typeof (data.recordedAt as { toMillis?: () => number }).toMillis === 'function'
            ? (data.recordedAt as { toMillis: () => number }).toMillis()
            : null,
        } satisfies VitalLog;
      });
      setVitalsByProfileId((current) => ({ ...current, [profile.profileId]: logs }));
    } catch {
      setVitalsByProfileId((current) => ({ ...current, [profile.profileId]: [] }));
    } finally {
      setVitalsLoadingByProfileId((current) => ({ ...current, [profile.profileId]: false }));
    }
  };

  const deleteProfile = async (profile: XPersonProfile) => {
    if (!tenantId) return;
    const ok = window.confirm(`Delete profile ${deriveProfileName(profile)}? This action cannot be undone.`);
    if (!ok) return;
    setDeletingProfileId(profile.profileId);
    setError(null);
    try {
      await api(`/tenants/${tenantId}/xperson-profile/${encodeURIComponent(profile.profileId)}`, { method: 'DELETE' });
      setProfiles((current) => current.filter((entry) => entry.profileId !== profile.profileId));
      if (expandedProfileId === profile.profileId) setExpandedProfileId(null);
      if (editingProfileId === profile.profileId) setEditingProfileId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete profile');
    } finally {
      setDeletingProfileId(null);
    }
  };

  const renderProfileCard = (profile: XPersonProfile) => {
    const customAttributes = profile.attributes ? Object.entries(profile.attributes) : [];
    const isExpanded = expandedProfileId === profile.profileId;
    const isEditing = editingProfileId === profile.profileId;

    return (
      <article key={profile.profileId} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
        <button
          type="button"
          onClick={() => {
            const willExpand = expandedProfileId !== profile.profileId;
            setExpandedProfileId((current) => (current === profile.profileId ? null : profile.profileId));
            if (willExpand) {
              void loadVitalsForProfile(profile);
            }
          }}
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
        </button>

        {isExpanded && (
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


            <div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Vitals logs</div>
              {vitalsLoadingByProfileId[profile.profileId] ? (
                <div style={{ color: '#64748b' }}>Loading vitals...</div>
              ) : (vitalsByProfileId[profile.profileId] ?? []).length === 0 ? (
                <div style={{ color: '#64748b' }}>No vitals saved for this user yet.</div>
              ) : (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
                  {(vitalsByProfileId[profile.profileId] ?? []).map((vital, index) => (
                    <div
                      key={vital.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: isMobile ? '1fr' : '160px 1fr 180px',
                        gap: 8,
                        padding: '8px 10px',
                        background: index % 2 === 0 ? '#fff' : '#f8fafc',
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ color: '#64748b', fontWeight: 600 }}>{vital.type.replace(/_/g, ' ')}</span>
                      <span style={{ color: '#0f172a', fontWeight: 600 }}>{Number.isFinite(vital.value) ? vital.value : '—'} {vital.unit ?? ''}</span>
                      <span style={{ color: '#475569', fontSize: 12 }}>{vital.recordedAt ? new Date(vital.recordedAt).toLocaleString() : 'Timestamp unavailable'}</span>
                    </div>
                  ))}
                </div>
              )}
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
                  <div style={{ color: '#64748b' }}>No custom profile attributes captured yet.</div>
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
        )}
      </article>
    );
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

    api<{ profiles: XPersonProfile[] }>(`/tenants/${tenantId}/xperson-profile?limit=200`)
      .then((res) => setProfiles(res.profiles ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load XPersonProfile records'))
      .finally(() => {
        window.clearTimeout(slowLoadTimer);
        setLoading(false);
      });
  }, [tenantId]);

  return (
    <div style={{ padding: isMobile ? '16px 0' : 0, display: 'grid', gap: 16 }}>
      <div>
        <h1 style={{ margin: '0 0 8px 0', fontSize: isMobile ? 24 : 32 }}>XPersonProfile</h1>
        <p style={{ color: '#64748b', marginBottom: 0, maxWidth: 920 }}>
          Profiles captured by Persons (Pipo) from widget and WhatsApp conversations. Widget users and WhatsApp users are grouped separately below, and details update continuously as conversations progress.
        </p>
      </div>

      <section style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(5, minmax(0, 1fr))', gap: 10 }}>
        <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>Total profiles</span><strong>{summary.total}</strong></div>
        <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>Named profiles</span><strong>{summary.withNames}</strong></div>
        <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>WhatsApp</span><strong>{summary.whatsappProfiles}</strong></div>
        <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>Widget</span><strong>{summary.widgetProfiles}</strong></div>
        <div style={metricCardStyle}><span style={{ fontSize: 12, color: '#64748b' }}>With custom fields</span><strong>{summary.withCustomFields}</strong></div>
      </section>

      {error && <div style={{ padding: 12, borderRadius: 8, background: '#fef2f2', color: '#991b1b' }}>{error}</div>}
      {loading ? (
        <div style={{ color: '#64748b', display: 'grid', gap: 8 }}>
          <div>Loading XPersonProfile data...</div>
          {isSlowLoad ? <div style={{ fontSize: 13 }}>Still working — if no records exist yet, an empty state will appear shortly.</div> : null}
        </div>
      ) : null}

      {!loading && profiles.length === 0 ? (
        <div style={{ padding: 24, border: '1px dashed #cbd5e1', borderRadius: 10, background: '#f8fafc', color: '#64748b' }}>
          No profiled users yet. Enable the Persons (Pipo) tool in Agent Settings and continue conversations.
        </div>
      ) : null}

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
    </div>
  );
}
