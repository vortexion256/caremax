import { useEffect, useState } from 'react';
import { useTenant } from '../TenantContext';
import { api } from '../api';
import TenantDetailsModal from './TenantDetailsModal';

type PlatformTenant = {
  tenantId: string;
  name: string;
  allowedDomains: string[];
  createdAt: number | null;
  createdBy: string | null;
};

export default function PlatformTenants() {
  const { isPlatformAdmin } = useTenant();
  const [list, setList] = useState<PlatformTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);

  useEffect(() => {
    if (!isPlatformAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    api<{ tenants: PlatformTenant[] }>('/platform/tenants')
      .then((r) => setList(r.tenants))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [isPlatformAdmin]);

  if (!isPlatformAdmin) {
    return <p style={{ color: '#c62828' }}>Platform admin access required.</p>;
  }

  if (loading) return <p>Loading tenants…</p>;
  if (error) return <p style={{ color: '#c62828' }}>{error}</p>;

  return (
    <div>
      <h1 style={{ margin: '0 0 16px 0' }}>All tenants (platform)</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>
        This view is only for SaaS owners. It shows all registered tenants across the platform.
      </p>
      {list.length === 0 ? (
        <p>No tenants registered yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
              <th style={{ textAlign: 'left', padding: 8 }}>Tenant ID</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Name</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Allowed domains</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Created by</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Created at</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map((t) => (
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
                <td style={{ padding: 8 }}>
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {selectedTenantId && (
        <TenantDetailsModal tenantId={selectedTenantId} onClose={() => setSelectedTenantId(null)} />
      )}
    </div>
  );
}

