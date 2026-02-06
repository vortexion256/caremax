import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { firestore } from '../firebase';
import { useTenant } from '../TenantContext';

type ConversationItem = {
  conversationId: string;
  tenantId: string;
  userId: string;
  status: 'open' | 'handoff_requested' | 'human_joined';
  createdAt: number | null;
  updatedAt: number | null;
};

export default function Conversations() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [list, setList] = useState<ConversationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'open' | 'handoff_requested' | 'human_joined'>('all');

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    
    // Build query based on filter
    let q;
    if (filter === 'all') {
      // For 'all', we need an index on tenantId + updatedAt
      // If index doesn't exist, we'll fetch all and sort client-side
      q = query(
        collection(firestore, 'conversations'),
        where('tenantId', '==', tenantId),
        orderBy('updatedAt', 'desc'),
        limit(100)
      );
    } else {
      // For specific status, use the existing index
      q = query(
        collection(firestore, 'conversations'),
        where('tenantId', '==', tenantId),
        where('status', '==', filter),
        orderBy('updatedAt', 'desc'),
        limit(100)
      );
    }

    const unsub = onSnapshot(
      q,
      (snap) => {
        const conversations: ConversationItem[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            conversationId: d.id,
            tenantId: data.tenantId ?? '',
            userId: data.userId ?? '',
            status: (data.status ?? 'open') as ConversationItem['status'],
            createdAt: data.createdAt?.toMillis?.() ?? null,
            updatedAt: data.updatedAt?.toMillis?.() ?? null,
          };
        });
        setList(conversations);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [tenantId, filter]);

  const getStatusBadge = (status: string) => {
    const styles: Record<string, { bg: string; color: string; label: string }> = {
      open: { bg: '#e8f5e9', color: '#2e7d32', label: 'AI Only' },
      handoff_requested: { bg: '#fff3e0', color: '#e65100', label: 'Handoff Requested' },
      human_joined: { bg: '#e3f2fd', color: '#1565c0', label: 'Care Team Active' },
    };
    const style = styles[status] || styles.open;
    return (
      <span
        style={{
          padding: '4px 8px',
          borderRadius: 4,
          fontSize: 12,
          fontWeight: 500,
          background: style.bg,
          color: style.color,
        }}
      >
        {style.label}
      </span>
    );
  };

  if (loading) return <p>Loading...</p>;
  if (error) return <p style={{ color: '#c62828' }}>{error}</p>;

  const counts = {
    all: list.length,
    open: list.filter((c) => c.status === 'open').length,
    handoff_requested: list.filter((c) => c.status === 'handoff_requested').length,
    human_joined: list.filter((c) => c.status === 'human_joined').length,
  };

  return (
    <div>
      <h1 style={{ margin: '0 0 16px 0' }}>All Conversations</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>
        View all conversations to monitor AI performance and user interactions. Click &quot;View chat&quot; to see the full conversation.
      </p>

      <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setFilter('all')}
          style={{
            padding: '6px 12px',
            border: '1px solid #ddd',
            borderRadius: 4,
            background: filter === 'all' ? '#0d47a1' : 'white',
            color: filter === 'all' ? 'white' : '#333',
            cursor: 'pointer',
          }}
        >
          All ({counts.all})
        </button>
        <button
          type="button"
          onClick={() => setFilter('open')}
          style={{
            padding: '6px 12px',
            border: '1px solid #ddd',
            borderRadius: 4,
            background: filter === 'open' ? '#0d47a1' : 'white',
            color: filter === 'open' ? 'white' : '#333',
            cursor: 'pointer',
          }}
        >
          AI Only ({counts.open})
        </button>
        <button
          type="button"
          onClick={() => setFilter('handoff_requested')}
          style={{
            padding: '6px 12px',
            border: '1px solid #ddd',
            borderRadius: 4,
            background: filter === 'handoff_requested' ? '#0d47a1' : 'white',
            color: filter === 'handoff_requested' ? 'white' : '#333',
            cursor: 'pointer',
          }}
        >
          Handoff Requested ({counts.handoff_requested})
        </button>
        <button
          type="button"
          onClick={() => setFilter('human_joined')}
          style={{
            padding: '6px 12px',
            border: '1px solid #ddd',
            borderRadius: 4,
            background: filter === 'human_joined' ? '#0d47a1' : 'white',
            color: filter === 'human_joined' ? 'white' : '#333',
            cursor: 'pointer',
          }}
        >
          Care Team Active ({counts.human_joined})
        </button>
      </div>

      {list.length === 0 ? (
        <p>No conversations found.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
              <th style={{ textAlign: 'left', padding: 8 }}>Conversation ID</th>
              <th style={{ textAlign: 'left', padding: 8 }}>User</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Status</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Created</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Last Updated</th>
              <th style={{ textAlign: 'left', padding: 8 }}></th>
            </tr>
          </thead>
          <tbody>
            {list.map((conv) => (
              <tr key={conv.conversationId} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 12 }}>
                  {conv.conversationId.slice(0, 12)}...
                </td>
                <td style={{ padding: 8 }}>{conv.userId}</td>
                <td style={{ padding: 8 }}>{getStatusBadge(conv.status)}</td>
                <td style={{ padding: 8, fontSize: 13 }}>
                  {conv.createdAt ? new Date(conv.createdAt).toLocaleString() : '-'}
                </td>
                <td style={{ padding: 8, fontSize: 13 }}>
                  {conv.updatedAt ? new Date(conv.updatedAt).toLocaleString() : '-'}
                </td>
                <td style={{ padding: 8 }}>
                  <Link
                    to={`/conversations/${conv.conversationId}`}
                    style={{ color: '#0d47a1', textDecoration: 'none', fontSize: 14 }}
                  >
                    View chat
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
