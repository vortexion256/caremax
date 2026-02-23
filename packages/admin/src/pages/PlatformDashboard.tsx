import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useTenant } from '../TenantContext';
import { useIsMobile } from '../hooks/useIsMobile';

type PlatformTenant = {
  tenantId: string;
  name: string;
  createdAt: number | null;
};

type UsageSummary = {
  tenantId: string;
  totalTokens: number;
  totalCostUsd: number;
  calls: number;
  lastUsed: number | null;
};

const UGX_PER_USD = 3800;
const formatUgx = (amount: number) => `UGX ${Math.round(amount).toLocaleString()}`;

export default function PlatformDashboard() {
  const { isPlatformAdmin } = useTenant();
  const { isMobile } = useIsMobile();
  const [tenants, setTenants] = useState<PlatformTenant[]>([]);
  const [usage, setUsage] = useState<UsageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPlatformAdmin) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    Promise.all([
      api<{ tenants: PlatformTenant[] }>('/platform/tenants'),
      api<{ usage: UsageSummary[] }>('/platform/usage'),
    ])
      .then(([tenantResponse, usageResponse]) => {
        setTenants(tenantResponse.tenants);
        setUsage(usageResponse.usage);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load platform overview'))
      .finally(() => setLoading(false));
  }, [isPlatformAdmin]);

  const sortedTenants = useMemo(
    () => [...tenants].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
    [tenants],
  );

  const usageByTenant = useMemo(() => {
    const table = new Map<string, UsageSummary>();
    usage.forEach((entry) => table.set(entry.tenantId, entry));
    return table;
  }, [usage]);

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
  const knownCreatedAt = sortedTenants.filter((tenant) => tenant.createdAt != null).map((tenant) => tenant.createdAt as number);
  const newTenantsThisMonth = knownCreatedAt.filter((createdAt) => createdAt >= startOfMonth).length;
  const newTenantsLastMonth = knownCreatedAt.filter((createdAt) => createdAt >= startOfLastMonth && createdAt < startOfMonth).length;
  const monthlyGrowth = newTenantsLastMonth === 0
    ? (newTenantsThisMonth > 0 ? 100 : 0)
    : Math.round(((newTenantsThisMonth - newTenantsLastMonth) / newTenantsLastMonth) * 100);

  const activeTenantIds = new Set(usage.filter((entry) => entry.calls > 0).map((entry) => entry.tenantId));
  const totalCostUgx = usage.reduce((sum, entry) => sum + entry.totalCostUsd * UGX_PER_USD, 0);
  const totalCalls = usage.reduce((sum, entry) => sum + entry.calls, 0);
  const totalTokens = usage.reduce((sum, entry) => sum + entry.totalTokens, 0);

  const topTenants = [...sortedTenants]
    .sort((a, b) => (usageByTenant.get(b.tenantId)?.totalTokens ?? 0) - (usageByTenant.get(a.tenantId)?.totalTokens ?? 0))
    .slice(0, 5);

  if (!isPlatformAdmin) return null;

  const cardStyle = {
    flex: isMobile ? '1 1 100%' : '1 1 220px',
    padding: '20px',
    borderRadius: 12,
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
  };

  return (
    <div>
      <h1 style={{ margin: '0 0 8px 0', fontSize: isMobile ? 24 : 32 }}>SaaS Control Center</h1>
      <p style={{ color: '#64748b', marginBottom: 24, maxWidth: 780 }}>
        Single-pane platform oversight across every tenant. Use this view to monitor growth, activity, spend, and jump into tenant-level administration.
      </p>

      {loading ? (
        <div style={{ color: '#64748b' }}>Loading platform overview...</div>
      ) : error ? (
        <div style={{ padding: 12, background: '#fef2f2', color: '#991b1b', borderRadius: 8, fontSize: 14 }}>{error}</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
            <div style={cardStyle}>
              <div style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Total Tenants</div>
              <div style={{ fontSize: 30, fontWeight: 700, color: '#0f172a' }}>{tenants.length}</div>
              <div style={{ fontSize: 13, color: '#64748b' }}>{newTenantsThisMonth} onboarded this month</div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Active Tenants</div>
              <div style={{ fontSize: 30, fontWeight: 700, color: '#0f172a' }}>{activeTenantIds.size}</div>
              <div style={{ fontSize: 13, color: '#64748b' }}>Tenants with metered activity</div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Platform Usage</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#0f172a' }}>{totalTokens.toLocaleString()} tokens</div>
              <div style={{ fontSize: 13, color: '#64748b' }}>{totalCalls.toLocaleString()} calls recorded</div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Estimated Spend</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#b91c1c' }}>{formatUgx(totalCostUgx)}</div>
              <div style={{ fontSize: 13, color: monthlyGrowth >= 0 ? '#166534' : '#b91c1c' }}>
                {monthlyGrowth >= 0 ? '+' : ''}{monthlyGrowth}% tenant growth vs last month
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.3fr 1fr', gap: 20 }}>
            <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <h2 style={{ margin: 0, fontSize: 18 }}>Tenant activity leaderboard</h2>
                <Link to="/platform/usage" style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}>
                  Open analytics →
                </Link>
              </div>
              {topTenants.length === 0 ? (
                <p style={{ color: '#94a3b8', margin: 0 }}>No tenants available yet.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ textAlign: 'left', padding: '8px 6px', fontSize: 12, color: '#64748b' }}>Tenant</th>
                      <th style={{ textAlign: 'right', padding: '8px 6px', fontSize: 12, color: '#64748b' }}>Calls</th>
                      <th style={{ textAlign: 'right', padding: '8px 6px', fontSize: 12, color: '#64748b' }}>Tokens</th>
                      <th style={{ textAlign: 'right', padding: '8px 6px', fontSize: 12, color: '#64748b' }}>Last Used</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topTenants.map((tenant) => {
                      const usageItem = usageByTenant.get(tenant.tenantId);
                      return (
                        <tr key={tenant.tenantId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '10px 6px', fontSize: 13, fontWeight: 600 }}>{tenant.name || tenant.tenantId}</td>
                          <td style={{ padding: '10px 6px', fontSize: 13, textAlign: 'right' }}>{(usageItem?.calls ?? 0).toLocaleString()}</td>
                          <td style={{ padding: '10px 6px', fontSize: 13, textAlign: 'right' }}>{(usageItem?.totalTokens ?? 0).toLocaleString()}</td>
                          <td style={{ padding: '10px 6px', fontSize: 12, textAlign: 'right', color: '#64748b' }}>
                            {usageItem?.lastUsed ? new Date(usageItem.lastUsed).toLocaleDateString() : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>

            <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
              <h2 style={{ margin: '0 0 12px 0', fontSize: 18 }}>Platform admin actions</h2>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 10, color: '#334155' }}>
                <li><Link to="/platform/tenants">Review all tenant details and lifecycle status</Link></li>
                <li><Link to="/platform/usage">Audit API usage, costs, and reset metering data</Link></li>
                <li><Link to="/platform/billing">Manage package plans and limits for the entire SaaS</Link></li>
                <li><Link to="/platform/payments">Track global payment operations</Link></li>
                <li><Link to="/platform/advanced-prompts">Update global prompt controls</Link></li>
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
