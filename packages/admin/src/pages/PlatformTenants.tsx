import { useEffect, useState } from 'react';
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

export default function PlatformTenants() {
  const { isPlatformAdmin } = useTenant();
  const [list, setList] = useState<PlatformTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [deleteConfirmTenantId, setDeleteConfirmTenantId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadTenants = () => {
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
  };

  useEffect(() => {
    loadTenants();
  }, [isPlatformAdmin]);

  const handleDelete = async () => {
    if (!deleteConfirmTenantId) return;
    
    setDeleting(true);
    setError(null);
    try {
      await api(`/platform/tenants/${deleteConfirmTenantId}`, {
        method: 'DELETE',
      });
      setDeleteConfirmTenantId(null);
      
      // Refresh token in case custom claims were updated
      const newToken = await refreshIdToken();
      if (newToken) {
        setAuthToken(newToken);
      }
      
      loadTenants(); // Reload the list
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
            ))}
          </tbody>
        </table>
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

