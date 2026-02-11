import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { firestore } from '../firebase';
import { api, type HandoffItem } from '../api';
import { useTenant } from '../TenantContext';
import { useIsMobile } from '../hooks/useIsMobile';

export default function HandoffQueue() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const { isMobile } = useIsMobile();
  const [list, setList] = useState<HandoffItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    const q = query(
      collection(firestore, 'conversations'),
      where('tenantId', '==', tenantId),
      where('status', 'in', ['handoff_requested', 'human_joined']),
      orderBy('updatedAt', 'desc'),
      limit(50)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const handoffs: HandoffItem[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            conversationId: d.id,
            tenantId: data.tenantId ?? '',
            userId: data.userId ?? '',
            status: data.status ?? 'handoff_requested',
            updatedAt: data.updatedAt?.toMillis?.() ?? null,
          };
        });
        setList(handoffs);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [tenantId]);

  const join = async (conversationId: string) => {
    try {
      await api(`/tenants/${tenantId}/conversations/${conversationId}/join`, { method: 'POST' });
      setList((prev) =>
        prev.map((h) => (h.conversationId === conversationId ? { ...h, status: 'human_joined' } : h))
      );
      navigate(`/handoffs/${conversationId}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to join');
    }
  };

  if (loading) return <div style={{ color: '#64748b' }}>Loading queue...</div>;

  return (
    <div>
      <h1 style={{ margin: '0 0 8px 0', fontSize: isMobile ? 24 : 32 }}>Handoff Queue</h1>
      <p style={{ color: '#64748b', marginBottom: 32, maxWidth: 800 }}>
        Conversations waiting for a human agent. Active requests are prioritized.
      </p>

      {error && (
        <div style={{ padding: 12, background: '#fef2f2', color: '#991b1b', borderRadius: 8, marginBottom: 24, fontSize: 14 }}>
          {error}
        </div>
      )}

      {list.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', background: '#f8fafc', borderRadius: 12, border: '1px dashed #e2e8f0', color: '#94a3b8' }}>
          No pending handoff requests at the moment.
        </div>
      ) : (
        <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                <th style={{ textAlign: 'left', padding: '16px 20px', color: '#64748b', fontWeight: 600 }}>Conversation</th>
                <th style={{ textAlign: 'left', padding: '16px 20px', color: '#64748b', fontWeight: 600 }}>User</th>
                <th style={{ textAlign: 'left', padding: '16px 20px', color: '#64748b', fontWeight: 600 }}>Status</th>
                <th style={{ textAlign: 'left', padding: '16px 20px', color: '#64748b', fontWeight: 600 }}>Last Updated</th>
                <th style={{ textAlign: 'right', padding: '16px 20px', color: '#64748b', fontWeight: 600 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {list.map((h) => (
                <tr key={h.conversationId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '16px 20px', fontFamily: 'monospace', color: '#64748b' }}>{h.conversationId.slice(0, 8)}...</td>
                  <td style={{ padding: '16px 20px', color: '#1e293b', fontWeight: 500 }}>{h.userId}</td>
                  <td style={{ padding: '16px 20px' }}>
                    <span style={{ 
                      padding: '4px 8px', 
                      borderRadius: 6, 
                      fontSize: 12, 
                      fontWeight: 600, 
                      background: h.status === 'handoff_requested' ? '#fffbeb' : '#f0fdf4', 
                      color: h.status === 'handoff_requested' ? '#d97706' : '#166534',
                      textTransform: 'capitalize'
                    }}>
                      {h.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td style={{ padding: '16px 20px', color: '#64748b' }}>{h.updatedAt ? new Date(h.updatedAt).toLocaleString() : '-'}</td>
                  <td style={{ padding: '16px 20px', textAlign: 'right' }}>
                    {h.status === 'handoff_requested' ? (
                      <button 
                        type="button" 
                        onClick={() => join(h.conversationId)}
                        style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}
                      >
                        Join Chat
                      </button>
                    ) : (
                      <Link 
                        to={`/handoffs/${h.conversationId}`} 
                        style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 600, fontSize: 13 }}
                      >
                        View Chat →
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
