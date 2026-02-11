import { useEffect, useState } from 'react';
import { api } from '../api';
import { useTenant } from '../TenantContext';
import { useIsMobile } from '../hooks/useIsMobile';

type PlatformTenant = {
  tenantId: string;
  name: string;
  createdAt: number | null;
};

export default function PlatformDashboard() {
  const { isPlatformAdmin } = useTenant();
  const { isMobile } = useIsMobile();
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

  if (!isPlatformAdmin) return null;

  const cardStyle = {
    flex: isMobile ? '1 1 100%' : '1 1 0px',
    padding: '24px',
    borderRadius: 12,
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
  };

  const labelStyle = { 
    fontSize: 12, 
    fontWeight: 600, 
    color: '#64748b', 
    textTransform: 'uppercase' as const, 
    letterSpacing: '0.05em', 
    marginBottom: 8 
  };

  return (
    <div>
      <h1 style={{ margin: '0 0 8px 0', fontSize: isMobile ? 24 : 32 }}>Platform Dashboard</h1>
      <p style={{ color: '#64748b', marginBottom: 32, maxWidth: 600 }}>
        High-level overview of your CareMax SaaS. Monitor system health and tenant growth.
      </p>

      {loading ? (
        <div style={{ color: '#64748b' }}>Loading metrics...</div>
      ) : error ? (
        <div style={{ padding: 12, background: '#fef2f2', color: '#991b1b', borderRadius: 8, fontSize: 14 }}>{error}</div>
      ) : (
        <div style={{ display: 'flex', gap: 20, marginBottom: 32, flexWrap: 'wrap' }}>
          <div style={cardStyle}>
            <div style={labelStyle}>Total Tenants</div>
            <div style={{ fontSize: 32, fontWeight: 700, color: '#0f172a' }}>{tenants.length}</div>
          </div>
          
          <div style={cardStyle}>
            <div style={labelStyle}>Most Recent Tenant</div>
            {tenants.length === 0 ? (
              <div style={{ fontSize: 14, color: '#94a3b8', marginTop: 8 }}>No tenants yet</div>
            ) : (
              <div style={{ marginTop: 4 }}>
                <div style={{ fontWeight: 600, color: '#0f172a', fontSize: 18 }}>{tenants[0].name || tenants[0].tenantId}</div>
                <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
                  {tenants[0].createdAt
                    ? new Date(tenants[0].createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })
                    : 'Date unknown'}
                </div>
              </div>
            )}
          </div>

          <div style={cardStyle}>
            <div style={labelStyle}>System Status</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e' }}></div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#166534' }}>All Systems Operational</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
