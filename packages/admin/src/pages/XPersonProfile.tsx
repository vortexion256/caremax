import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { api } from '../api';
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
          Profiles captured by Persons (Pipo) from widget and WhatsApp conversations. Details update continuously as conversations progress.
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

      <div style={{ display: 'grid', gap: 12 }}>
        {profiles.map((profile) => {
          const customAttributes = profile.attributes ? Object.entries(profile.attributes) : [];
          const isExpanded = expandedProfileId === profile.profileId;
          return (
            <article key={profile.profileId} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
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
                  <strong style={{ fontSize: 16, color: '#0f172a' }}>{profile.name || 'Unnamed profile'}</strong>
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
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                    <div><strong>Profile ID:</strong> {profile.profileId}</div>
                    <div><strong>Last updated:</strong> {formatUpdatedAt(profile.updatedAt)}</div>
                    <div><strong>External ID:</strong> {profile.externalUserId || '—'}</div>
                    <div><strong>User/Device ID:</strong> {profile.userId || '—'}</div>
                    <div><strong>Conversation ID:</strong> {profile.lastConversationId || '—'}</div>
                  </div>

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
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
