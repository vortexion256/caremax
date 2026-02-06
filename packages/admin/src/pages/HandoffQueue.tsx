import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { firestore } from '../firebase';
import { api, type HandoffItem } from '../api';
import { useTenant } from '../TenantContext';

export default function HandoffQueue() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
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

  if (loading) return <p>Loading...</p>;
  if (error) return <p style={{ color: '#c62828' }}>{error}</p>;

  return (
    <div>
      <h1 style={{ margin: '0 0 16px 0' }}>Handoff queue</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>
        Conversations where the AI requested a human. Click &quot;Join chat&quot; to participate.
      </p>
      {list.length === 0 ? (
        <p>No handoffs right now.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
              <th style={{ textAlign: 'left', padding: 8 }}>Conversation</th>
              <th style={{ textAlign: 'left', padding: 8 }}>User</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Status</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Updated</th>
              <th style={{ textAlign: 'left', padding: 8 }}></th>
            </tr>
          </thead>
          <tbody>
            {list.map((h) => (
              <tr key={h.conversationId} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: 8 }}>{h.conversationId.slice(0, 8)}...</td>
                <td style={{ padding: 8 }}>{h.userId}</td>
                <td style={{ padding: 8 }}>{h.status}</td>
                <td style={{ padding: 8 }}>{h.updatedAt ? new Date(h.updatedAt).toLocaleString() : '-'}</td>
                <td style={{ padding: 8 }}>
                  {h.status === 'handoff_requested' && (
                    <button type="button" onClick={() => join(h.conversationId)}>
                      Join chat
                    </button>
                  )}
                  {h.status === 'human_joined' && (
                    <Link to={`/handoffs/${h.conversationId}`} style={{ color: '#0d47a1', textDecoration: 'none', fontSize: 14 }}>
                      View chat
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
