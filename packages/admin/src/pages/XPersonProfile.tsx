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

  useEffect(() => {
    api<{ profiles: XPersonProfile[] }>(`/tenants/${tenantId}/xperson-profile?limit=200`)
      .then((res) => setProfiles(res.profiles ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load XPersonProfile records'))
      .finally(() => setLoading(false));
  }, [tenantId]);

  return (
    <div style={{ padding: isMobile ? '16px 0' : 0 }}>
      <h1 style={{ margin: '0 0 8px 0', fontSize: isMobile ? 24 : 32 }}>XPersonProfile</h1>
      <p style={{ color: '#64748b', marginBottom: 24, maxWidth: 880 }}>
        Profiles captured by the Persons (Pipo) tool using identifiers from widget and WhatsApp conversations (phone, external ID, and device/user ID).
      </p>

      {error && <div style={{ padding: 12, borderRadius: 8, background: '#fef2f2', color: '#991b1b', marginBottom: 16 }}>{error}</div>}
      {loading ? <div style={{ color: '#64748b' }}>Loading XPersonProfile data...</div> : null}

      {!loading && profiles.length === 0 ? (
        <div style={{ padding: 24, border: '1px dashed #cbd5e1', borderRadius: 10, background: '#f8fafc', color: '#64748b' }}>
          No profiled users yet. Enable the Persons (Pipo) tool in Agent Settings and continue conversations.
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: 12 }}>
        {profiles.map((profile) => (
          <article key={profile.profileId} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <strong>{profile.name || profile.profileId}</strong>
              <span style={{ fontSize: 12, color: '#64748b' }}>{profile.channel ?? 'unknown'}</span>
            </div>
            <div style={{ color: '#334155', fontSize: 14, marginTop: 8 }}>
              <div>Phone: {profile.phone || '—'}</div>
              <div>Location: {profile.location || '—'}</div>
              <div>External ID: {profile.externalUserId || '—'}</div>
              <div>User/Device ID: {profile.userId || '—'}</div>
              <div>Conversation: {profile.lastConversationId || '—'}</div>
              {profile.attributes && Object.keys(profile.attributes).length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontWeight: 600 }}>Custom fields</div>
                  {Object.entries(profile.attributes).map(([key, value]) => (
                    <div key={key}>{key}: {value}</div>
                  ))}
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
