import { useEffect, useState } from 'react';
import { api } from '../api';

type TenantDetails = {
  tenantId: string;
  name: string;
  allowedDomains: string[];
  createdAt: number | null;
  createdBy: string | null;
  createdByEmail: string | null;
  agentConfig: {
    agentName: string | null;
    model: string | null;
    ragEnabled: boolean;
    createdAt: number | null;
  } | null;
};

type Props = {
  tenantId: string;
  onClose: () => void;
};

export default function TenantDetailsModal({ tenantId, onClose }: Props) {
  const [details, setDetails] = useState<TenantDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api<TenantDetails>(`/platform/tenants/${tenantId}`)
      .then(setDetails)
      .catch((e) => setError(e.message || 'Failed to load tenant details'))
      .finally(() => setLoading(false));
  }, [tenantId]);

  return (
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
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: 8,
          padding: 24,
          maxWidth: 600,
          width: '90%',
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0 }}>Tenant Details</h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 24,
              cursor: 'pointer',
              color: '#666',
              padding: 0,
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>

        {loading && <p>Loading tenant details...</p>}
        {error && <p style={{ color: '#c62828' }}>{error}</p>}
        {details && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Tenant ID</div>
              <div style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 500 }}>{details.tenantId}</div>
            </div>

            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Company/Organization Name</div>
              <div style={{ fontSize: 16, fontWeight: 500 }}>{details.name}</div>
            </div>

            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Allowed Domains</div>
              <div style={{ fontSize: 14 }}>
                {details.allowedDomains && details.allowedDomains.length > 0 ? (
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {details.allowedDomains.map((domain, i) => (
                      <li key={i}>{domain}</li>
                    ))}
                  </ul>
                ) : (
                  <span style={{ color: '#999' }}>No domains configured</span>
                )}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Created At</div>
              <div style={{ fontSize: 14 }}>
                {details.createdAt ? new Date(details.createdAt).toLocaleString() : 'Unknown'}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Created By</div>
              <div style={{ fontSize: 14 }}>
                {details.createdByEmail ? (
                  <>
                    <div>{details.createdByEmail}</div>
                    {details.createdBy && (
                      <div style={{ fontSize: 12, color: '#999', fontFamily: 'monospace', marginTop: 2 }}>
                        UID: {details.createdBy}
                      </div>
                    )}
                  </>
                ) : details.createdBy ? (
                  <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{details.createdBy}</div>
                ) : (
                  <span style={{ color: '#999' }}>Unknown</span>
                )}
              </div>
            </div>

            {details.agentConfig && (
              <div style={{ marginTop: 8, paddingTop: 16, borderTop: '1px solid #e0e0e0' }}>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>Agent Configuration</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>Agent Name</div>
                    <div style={{ fontSize: 14 }}>{details.agentConfig.agentName || '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>Model</div>
                    <div style={{ fontSize: 14 }}>{details.agentConfig.model || '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>RAG Enabled</div>
                    <div style={{ fontSize: 14 }}>{details.agentConfig.ragEnabled ? 'Yes' : 'No'}</div>
                  </div>
                  {details.agentConfig.createdAt && (
                    <div>
                      <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>Agent Config Created</div>
                      <div style={{ fontSize: 14 }}>{new Date(details.agentConfig.createdAt).toLocaleString()}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={onClose}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#1976d2',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
