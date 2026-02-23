import { useEffect, useMemo, useState } from 'react';
import { useTenant } from '../TenantContext';
import { api, setAuthToken } from '../api';
import { refreshIdToken } from '../firebase';
import TenantDetailsModal from './TenantDetailsModal';

type PlatformTenant = {
  tenantId: string;
  name: string;
  allowedDomains: string[];
  createdAt: number | null;
  createdBy: string | null;
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

export default function PlatformTenants() {
  const { isPlatformAdmin } = useTenant();
  const [list, setList] = useState<PlatformTenant[]>([]);
  const [usage, setUsage] = useState<UsageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [deleteConfirmTenantId, setDeleteConfirmTenantId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [searchText, setSearchText] = useState('');

  const loadTenants = () => {
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
        setList(tenantResponse.tenants);
        setUsage(usageResponse.usage);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load tenant data'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadTenants();
  }, [isPlatformAdmin]);

  const usageByTenant = useMemo(() => {
    const map = new Map<string, UsageSummary>();
    usage.forEach((u) => map.set(u.tenantId, u));
    return map;
  }, [usage]);

  const filteredTenants = useMemo(() => {
    const query = searchText.toLowerCase().trim();
    if (!query) return list;
    return list.filter((tenant) => (
      tenant.tenantId.toLowerCase().includes(query)
      || tenant.name.toLowerCase().includes(query)
      || (tenant.createdBy ?? '').toLowerCase().includes(query)
      || tenant.allowedDomains.join(', ').toLowerCase().includes(query)
    ));
  }, [list, searchText]);

  const handleDelete = async () => {
    if (!deleteConfirmTenantId) return;

    setDeleting(true);
    setError(null);
    try {
      await api(`/platform/tenants/${deleteConfirmTenantId}`, {
        method: 'DELETE',
      });
      setDeleteConfirmTenantId(null);

      const newToken = await refreshIdToken();
      if (newToken) {
        setAuthToken(newToken);
      }

      loadTenants();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete tenant');
    } finally {
      setDeleting(false);
    }
  };

  if (!isPlatformAdmin) {
    return <p style={{ color: '#c62828' }}>Platform admin access required.</p>;
  }

  if (loading) return <p>Loading tenants…</p>;
  if (error) return <p style={{ color: '#c62828' }}>{error}</p>;

  const activeTenants = list.filter((tenant) => (usageByTenant.get(tenant.tenantId)?.calls ?? 0) > 0).length;
  const totalCalls = usage.reduce((sum, entry) => sum + entry.calls, 0);
  const totalCostUgx = usage.reduce((sum, entry) => sum + entry.totalCostUsd * UGX_PER_USD, 0);

  return (
    <div>
      <h1 style={{ margin: '0 0 12px 0' }}>Tenants Directory</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>
        Platform-wide tenant management and governance. Review each customer, inspect details, and perform global admin actions.
      </p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <MetricCard label="Total tenants" value={list.length.toLocaleString()} />
        <MetricCard label="Active tenants" value={activeTenants.toLocaleString()} />
        <MetricCard label="Total platform calls" value={totalCalls.toLocaleString()} />
        <MetricCard label="Platform spend" value={formatUgx(totalCostUgx)} />
      </div>

      <input
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        placeholder="Search by tenant id, name, owner, or domain"
        style={{
          width: '100%',
          maxWidth: 420,
          marginBottom: 16,
          padding: '10px 12px',
          border: '1px solid #cbd5e1',
          borderRadius: 8,
          fontSize: 14,
        }}
      />

      {filteredTenants.length === 0 ? (
        <p>{list.length === 0 ? 'No tenants registered yet.' : 'No tenants match your search.'}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                <th style={{ textAlign: 'left', padding: 8 }}>Tenant ID</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Name</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Allowed domains</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Created by</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Created at</th>
                <th style={{ textAlign: 'right', padding: 8 }}>Calls</th>
                <th style={{ textAlign: 'right', padding: 8 }}>Tokens</th>
                <th style={{ textAlign: 'right', padding: 8 }}>Cost</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Last activity</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTenants.map((t) => {
                const tenantUsage = usageByTenant.get(t.tenantId);
                return (
                  <tr key={t.tenantId} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 12 }}>{t.tenantId}</td>
                    <td style={{ padding: 8 }}>{t.name}</td>
                    <td style={{ padding: 8, fontSize: 13 }}>
                      {t.allowedDomains && t.allowedDomains.length > 0 ? t.allowedDomains.join(', ') : '—'}
                    </td>
                    <td style={{ padding: 8, fontSize: 13 }}>{t.createdBy ?? '—'}</td>
                    <td style={{ padding: 8, fontSize: 13 }}>
                      {t.createdAt ? new Date(t.createdAt).toLocaleString() : '—'}
                    </td>
                    <td style={{ padding: 8, textAlign: 'right', fontSize: 13 }}>{(tenantUsage?.calls ?? 0).toLocaleString()}</td>
                    <td style={{ padding: 8, textAlign: 'right', fontSize: 13 }}>{(tenantUsage?.totalTokens ?? 0).toLocaleString()}</td>
                    <td style={{ padding: 8, textAlign: 'right', fontSize: 13, color: '#b91c1c' }}>
                      {formatUgx((tenantUsage?.totalCostUsd ?? 0) * UGX_PER_USD)}
                    </td>
                    <td style={{ padding: 8, fontSize: 13, color: '#666' }}>
                      {tenantUsage?.lastUsed ? new Date(tenantUsage.lastUsed).toLocaleString() : '—'}
                    </td>
                    <td style={{ padding: 8 }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => setSelectedTenantId(t.tenantId)}
                          style={{
                            padding: '4px 12px',
                            fontSize: 13,
                            backgroundColor: '#1976d2',
                            color: 'white',
                            border: 'none',
                            borderRadius: 4,
                            cursor: 'pointer',
                          }}
                        >
                          View Details
                        </button>
                        <button
                          onClick={() => setDeleteConfirmTenantId(t.tenantId)}
                          style={{
                            padding: '4px 12px',
                            fontSize: 13,
                            backgroundColor: '#d32f2f',
                            color: 'white',
                            border: 'none',
                            borderRadius: 4,
                            cursor: 'pointer',
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {selectedTenantId && (
        <TenantDetailsModal tenantId={selectedTenantId} onClose={() => setSelectedTenantId(null)} />
      )}

      {deleteConfirmTenantId && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setDeleteConfirmTenantId(null)}
        >
          <div
            style={{
              backgroundColor: 'white',
              borderRadius: 8,
              padding: 24,
              maxWidth: 500,
              width: '90%',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: '0 0 16px 0', color: '#d32f2f' }}>⚠️ Delete Tenant</h2>
            <p style={{ marginBottom: 8, fontSize: 16, lineHeight: 1.5 }}>
              <strong>Are you sure you want to delete this tenant?</strong>
            </p>
            <p style={{ marginBottom: 16, fontSize: 14, color: '#666', lineHeight: 1.5 }}>
              This will permanently delete:
            </p>
            <ul style={{ marginBottom: 24, paddingLeft: 20, color: '#666', fontSize: 14 }}>
              <li>Tenant configuration and settings</li>
              <li>All conversations and messages</li>
              <li>All RAG documents and knowledge base</li>
              <li>Agent configuration</li>
              <li>All uploaded files</li>
              <li>User access permissions</li>
            </ul>
            <p style={{ marginBottom: 24, fontSize: 14, color: '#d32f2f', fontWeight: 600 }}>
              This action cannot be undone!
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDeleteConfirmTenantId(null)}
                disabled={deleting}
                style={{
                  padding: '10px 20px',
                  fontSize: 14,
                  backgroundColor: '#f5f5f5',
                  color: '#333',
                  border: '1px solid #ddd',
                  borderRadius: 4,
                  cursor: deleting ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                style={{
                  padding: '10px 20px',
                  fontSize: 14,
                  backgroundColor: '#d32f2f',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  cursor: deleting ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                }}
              >
                {deleting ? 'Deleting...' : 'Yes, Delete Tenant'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, background: 'white', padding: '12px 14px', minWidth: 170 }}>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a' }}>{value}</div>
    </div>
  );
}
