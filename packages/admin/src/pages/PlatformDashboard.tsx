import { useEffect, useMemo, useState } from 'react';
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

  const sortedTenants = useMemo(
    () => [...tenants].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
    [tenants],
  );

  const knownCreatedAt = sortedTenants.filter((tenant) => tenant.createdAt != null).map((tenant) => tenant.createdAt as number);
  const newestTenant = sortedTenants[0] ?? null;
  const oldestTenant = [...sortedTenants].reverse().find((tenant) => tenant.createdAt != null) ?? null;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();

  const newTenantsThisMonth = knownCreatedAt.filter((createdAt) => createdAt >= startOfMonth).length;
  const newTenantsLastMonth = knownCreatedAt.filter((createdAt) => createdAt >= startOfLastMonth && createdAt < startOfMonth).length;

  const monthlyGrowth = newTenantsLastMonth === 0
    ? (newTenantsThisMonth > 0 ? 100 : 0)
    : Math.round(((newTenantsThisMonth - newTenantsLastMonth) / newTenantsLastMonth) * 100);

  if (!isPlatformAdmin) return null;

  const cardStyle = {
    flex: isMobile ? '1 1 100%' : '1 1 220px',
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
    marginBottom: 8,
  };

  return (
    <div>
      <h1 style={{ margin: '0 0 8px 0', fontSize: isMobile ? 24 : 32 }}>Platform Dashboard</h1>
      <p style={{ color: '#64748b', marginBottom: 32, maxWidth: 700 }}>
        Portfolio-level analytics for all tenants, including active footprint, monthly acquisition, and overall tenant lifecycle trends.
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
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 6 }}>All onboarded organizations in your SaaS</div>
          </div>

          <div style={cardStyle}>
            <div style={labelStyle}>New This Month</div>
            <div style={{ fontSize: 32, fontWeight: 700, color: '#0f172a' }}>{newTenantsThisMonth}</div>
            <div style={{ fontSize: 13, color: monthlyGrowth >= 0 ? '#166534' : '#b91c1c', marginTop: 6 }}>
              {monthlyGrowth >= 0 ? '+' : ''}{monthlyGrowth}% vs last month
            </div>
          </div>

          <div style={cardStyle}>
            <div style={labelStyle}>Most Recent Tenant</div>
            {newestTenant ? (
              <>
                <div style={{ fontWeight: 600, color: '#0f172a', fontSize: 18 }}>{newestTenant.name || newestTenant.tenantId}</div>
                <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
                  {newestTenant.createdAt
                    ? `Joined ${new Date(newestTenant.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}`
                    : 'Join date unknown'}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 14, color: '#94a3b8', marginTop: 8 }}>No tenants yet</div>
            )}
          </div>

          <div style={cardStyle}>
            <div style={labelStyle}>Tenant Lifecycle Span</div>
            {oldestTenant?.createdAt ? (
              <>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#0f172a' }}>
                  Since {new Date(oldestTenant.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                </div>
                <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
                  Earliest tenant: {oldestTenant.name || oldestTenant.tenantId}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 14, color: '#94a3b8', marginTop: 8 }}>Not enough data yet</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
