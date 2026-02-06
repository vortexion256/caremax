import { useEffect, useState } from 'react';
import { api } from '../api';
import { useTenant } from '../TenantContext';

type PlatformTenant = {
  tenantId: string;
  name: string;
  createdAt: number | null;
};

export default function PlatformDashboard() {
  const { isPlatformAdmin } = useTenant();
  const [tenants, setTenants] = useState<PlatformTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPlatformAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    api<{ tenants: PlatformTenant[] }>('/platform/tenants')
      .then((r) => setTenants(r.tenants))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [isPlatformAdmin]);

  if (!isPlatformAdmin) {
    return null;
  }

  return (
    <div>
      <h1 style={{ margin: '0 0 16px 0' }}>Platform dashboard</h1>
      <p style={{ color: '#555', marginBottom: 24, maxWidth: 600 }}>
        High-level overview of your CareMax SaaS. This is visible only to platform admins.
      </p>
      {loading ? (
        <p>Loading...</p>
      ) : error ? (
        <p style={{ color: '#c62828' }}>{error}</p>
      ) : (
        <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
          <div
            style={{
              flex: '0 0 200px',
              padding: 16,
              borderRadius: 8,
              background: '#ffffff',
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            }}
          >
            <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Total tenants</div>
            <div style={{ fontSize: 28, fontWeight: 600 }}>{tenants.length}</div>
          </div>
          <div
            style={{
              flex: '0 0 260px',
              padding: 16,
              borderRadius: 8,
              background: '#ffffff',
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            }}
          >
            <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Most recent tenant</div>
            {tenants.length === 0 ? (
              <div style={{ fontSize: 14, color: '#999' }}>None yet</div>
            ) : (
              <div style={{ fontSize: 14 }}>
                <div style={{ fontWeight: 500 }}>{tenants[0].name || tenants[0].tenantId}</div>
                <div style={{ fontSize: 12, color: '#777' }}>
                  {tenants[0].createdAt
                    ? new Date(tenants[0].createdAt).toLocaleString()
                    : 'Created date unknown'}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

