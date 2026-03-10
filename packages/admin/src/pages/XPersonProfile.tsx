import { useEffect, useState } from 'react';
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
    <div style={{ padding: isMobile ? '16px 0' : 0 }}>
      <h1 style={{ margin: '0 0 8px 0', fontSize: isMobile ? 24 : 32 }}>XPersonProfile</h1>
      <p style={{ color: '#64748b', marginBottom: 24, maxWidth: 880 }}>
        Profiles captured by the Persons (Pipo) tool using identifiers from widget and WhatsApp conversations (phone, external ID, and device/user ID).
      </p>

      {error && <div style={{ padding: 12, borderRadius: 8, background: '#fef2f2', color: '#991b1b', marginBottom: 16 }}>{error}</div>}
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
        {profiles.map((profile) => (
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
                <span style={{ fontSize: 12, color: '#64748b' }}>{profile.channel ?? 'unknown'}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
                <div style={{ padding: '10px 12px', background: '#f8fafc', borderRadius: 8 }}>
                  <div style={{ fontSize: 12, color: '#64748b' }}>Phone</div>
                  <div style={{ color: '#0f172a' }}>{profile.phone || '—'}</div>
                </div>
                <div style={{ padding: '10px 12px', background: '#f8fafc', borderRadius: 8 }}>
                  <div style={{ fontSize: 12, color: '#64748b' }}>Duration</div>
                  <div style={{ color: '#0f172a' }}>{formatDuration(profile.conversationDurationLastConversationSeconds)}</div>
                </div>
                <div style={{ padding: '10px 12px', background: '#f8fafc', borderRadius: 8 }}>
                  <div style={{ fontSize: 12, color: '#64748b' }}>Location</div>
                  <div style={{ color: '#0f172a' }}>{profile.location || '—'}</div>
                </div>
                <div style={{ padding: '10px 12px', background: '#f8fafc', borderRadius: 8 }}>
                  <div style={{ fontSize: 12, color: '#64748b' }}>Status</div>
                  <div style={{ color: '#0f172a' }}>{expandedProfileId === profile.profileId ? 'Hide details' : 'View details'}</div>
                </div>
              </div>
            </button>

            {expandedProfileId === profile.profileId && (
              <div style={{ borderTop: '1px solid #e2e8f0', padding: 16, color: '#334155', fontSize: 14, display: 'grid', gap: 6 }}>
                <div>Profile ID: {profile.profileId}</div>
                <div>External ID: {profile.externalUserId || '—'}</div>
                <div>User/Device ID: {profile.userId || '—'}</div>
                <div>Conversation: {profile.lastConversationId || '—'}</div>
                <div>Last conversation duration: {formatDuration(profile.conversationDurationLastConversationSeconds)}</div>
                <div>Updated: {formatUpdatedAt(profile.updatedAt)}</div>
                {profile.attributes && Object.keys(profile.attributes).length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontWeight: 600 }}>Custom fields</div>
                    {Object.entries(profile.attributes).map(([key, value]) => (
                      <div key={key}>{key}: {value}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
