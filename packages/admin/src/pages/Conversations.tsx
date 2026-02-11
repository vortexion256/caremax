import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { collection, query, where, orderBy, limit, startAfter, getDocs, type DocumentSnapshot } from 'firebase/firestore';
import { firestore } from '../firebase';
import { useTenant } from '../TenantContext';
import { useIsMobile } from '../hooks/useIsMobile';

const PAGE_SIZE = 10;

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
  const { isMobile, isVerySmall } = useIsMobile();
  const [list, setList] = useState<ConversationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'open' | 'handoff_requested' | 'human_joined'>('all');
  const [lastDoc, setLastDoc] = useState<DocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    setLastDoc(null);
    setHasMore(true);
    
    // Build query based on filter
    let q;
    if (filter === 'all') {
      q = query(
        collection(firestore, 'conversations'),
        where('tenantId', '==', tenantId),
        orderBy('updatedAt', 'desc'),
        limit(PAGE_SIZE)
      );
    } else {
      q = query(
        collection(firestore, 'conversations'),
        where('tenantId', '==', tenantId),
        where('status', '==', filter),
        orderBy('updatedAt', 'desc'),
        limit(PAGE_SIZE)
      );
    }

    getDocs(q)
      .then((snap) => {
        const docs = snap.docs;
        const conversations: ConversationItem[] = docs.map((d) => {
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
        setHasMore(docs.length === PAGE_SIZE);
        setLastDoc(docs.length > 0 ? docs[docs.length - 1] : null);
      })
      .catch((err) => {
        setError(err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [tenantId, filter]);

  const loadMore = () => {
    if (!tenantId || !lastDoc || loadingMore || !hasMore) return;
    setLoadingMore(true);
    
    let q;
    if (filter === 'all') {
      q = query(
        collection(firestore, 'conversations'),
        where('tenantId', '==', tenantId),
        orderBy('updatedAt', 'desc'),
        limit(PAGE_SIZE),
        startAfter(lastDoc)
      );
    } else {
      q = query(
        collection(firestore, 'conversations'),
        where('tenantId', '==', tenantId),
        where('status', '==', filter),
        orderBy('updatedAt', 'desc'),
        limit(PAGE_SIZE),
        startAfter(lastDoc)
      );
    }

    getDocs(q)
      .then((snap) => {
        const docs = snap.docs;
        const moreConversations: ConversationItem[] = docs.map((d) => {
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
        setList((prev) => [...prev, ...moreConversations]);
        setHasMore(docs.length === PAGE_SIZE);
        setLastDoc(docs.length > 0 ? docs[docs.length - 1] : null);
      })
      .catch((err) => {
        setError(err.message);
      })
      .finally(() => {
        setLoadingMore(false);
      });
  };

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

  // Note: counts are approximate since we're paginating
  const counts = {
    all: list.length,
    open: list.filter((c) => c.status === 'open').length,
    handoff_requested: list.filter((c) => c.status === 'handoff_requested').length,
    human_joined: list.filter((c) => c.status === 'human_joined').length,
  };

  return (
    <div style={{ width: '100%', maxWidth: '100%', overflowX: 'hidden' }}>
      <h1 style={{ margin: '0 0 16px 0', fontSize: isMobile ? 20 : 24 }}>All Conversations</h1>
      <p style={{ color: '#666', marginBottom: 16, fontSize: isMobile ? 13 : 14 }}>
        View all conversations to monitor AI performance and user interactions. Click &quot;View chat&quot; to see the full conversation.
      </p>

      <div style={{ marginBottom: 16, display: 'flex', gap: isVerySmall ? 4 : 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setFilter('all')}
          style={{
            padding: isVerySmall ? '8px 10px' : '6px 12px',
            border: '1px solid #ddd',
            borderRadius: 4,
            background: filter === 'all' ? '#0d47a1' : 'white',
            color: filter === 'all' ? 'white' : '#333',
            cursor: 'pointer',
            fontSize: isVerySmall ? 11 : 13,
            minHeight: 36,
            touchAction: 'manipulation',
          }}
        >
          All ({counts.all})
        </button>
        <button
          type="button"
          onClick={() => setFilter('open')}
          style={{
            padding: isVerySmall ? '8px 10px' : '6px 12px',
            border: '1px solid #ddd',
            borderRadius: 4,
            background: filter === 'open' ? '#0d47a1' : 'white',
            color: filter === 'open' ? 'white' : '#333',
            cursor: 'pointer',
            fontSize: isVerySmall ? 11 : 13,
            minHeight: 36,
            touchAction: 'manipulation',
          }}
        >
          AI Only ({counts.open})
        </button>
        <button
          type="button"
          onClick={() => setFilter('handoff_requested')}
          style={{
            padding: isVerySmall ? '8px 10px' : '6px 12px',
            border: '1px solid #ddd',
            borderRadius: 4,
            background: filter === 'handoff_requested' ? '#0d47a1' : 'white',
            color: filter === 'handoff_requested' ? 'white' : '#333',
            cursor: 'pointer',
            fontSize: isVerySmall ? 11 : 13,
            minHeight: 36,
            touchAction: 'manipulation',
          }}
        >
          Handoff ({counts.handoff_requested})
        </button>
        <button
          type="button"
          onClick={() => setFilter('human_joined')}
          style={{
            padding: isVerySmall ? '8px 10px' : '6px 12px',
            border: '1px solid #ddd',
            borderRadius: 4,
            background: filter === 'human_joined' ? '#0d47a1' : 'white',
            color: filter === 'human_joined' ? 'white' : '#333',
            cursor: 'pointer',
            fontSize: isVerySmall ? 11 : 13,
            minHeight: 36,
            touchAction: 'manipulation',
          }}
        >
          Care Team ({counts.human_joined})
        </button>
      </div>

      {list.length === 0 && !loading ? (
        <p>No conversations found.</p>
      ) : (
        <>
          {isMobile ? (
            // Mobile: Card layout
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {list.map((conv) => (
                <div
                  key={conv.conversationId}
                  style={{
                    border: '1px solid #e0e0e0',
                    borderRadius: 8,
                    padding: 12,
                    background: 'white',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>Conversation ID</div>
                      <div style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>
                        {conv.conversationId}
                      </div>
                    </div>
                    {getStatusBadge(conv.status)}
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>User</div>
                    <div style={{ fontSize: 13, wordBreak: 'break-word' }}>{conv.userId}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div>
                      <div style={{ fontSize: 11, color: '#666', marginBottom: 2 }}>Created</div>
                      <div style={{ fontSize: 12 }}>
                        {conv.createdAt ? new Date(conv.createdAt).toLocaleString() : '-'}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: '#666', marginBottom: 2 }}>Last Updated</div>
                      <div style={{ fontSize: 12 }}>
                        {conv.updatedAt ? new Date(conv.updatedAt).toLocaleString() : '-'}
                      </div>
                    </div>
                  </div>
                  <Link
                    to={`/conversations/${conv.conversationId}`}
                    style={{
                      display: 'inline-block',
                      padding: '8px 16px',
                      color: '#0d47a1',
                      textDecoration: 'none',
                      fontSize: 13,
                      fontWeight: 500,
                      border: '1px solid #0d47a1',
                      borderRadius: 4,
                      textAlign: 'center',
                      marginTop: 4,
                      minHeight: 36,
                      touchAction: 'manipulation',
                    }}
                  >
                    View chat →
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            // Desktop: Table layout
            <div style={{ width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                    <th style={{ textAlign: 'left', padding: 8, fontSize: 13 }}>Conversation ID</th>
                    <th style={{ textAlign: 'left', padding: 8, fontSize: 13 }}>User</th>
                    <th style={{ textAlign: 'left', padding: 8, fontSize: 13 }}>Status</th>
                    <th style={{ textAlign: 'left', padding: 8, fontSize: 13 }}>Created</th>
                    <th style={{ textAlign: 'left', padding: 8, fontSize: 13 }}>Last Updated</th>
                    <th style={{ textAlign: 'left', padding: 8, fontSize: 13 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((conv) => (
                    <tr key={conv.conversationId} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap' }}>
                        {conv.conversationId.slice(0, 12)}...
                      </td>
                      <td style={{ padding: 8, fontSize: 13, wordBreak: 'break-word' }}>{conv.userId}</td>
                      <td style={{ padding: 8 }}>{getStatusBadge(conv.status)}</td>
                      <td style={{ padding: 8, fontSize: 12, whiteSpace: 'nowrap' }}>
                        {conv.createdAt ? new Date(conv.createdAt).toLocaleString() : '-'}
                      </td>
                      <td style={{ padding: 8, fontSize: 12, whiteSpace: 'nowrap' }}>
                        {conv.updatedAt ? new Date(conv.updatedAt).toLocaleString() : '-'}
                      </td>
                      <td style={{ padding: 8 }}>
                        <Link
                          to={`/conversations/${conv.conversationId}`}
                          style={{ color: '#0d47a1', textDecoration: 'none', fontSize: 13 }}
                        >
                          View chat
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {hasMore && list.length > 0 && (
            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <button
                onClick={loadMore}
                disabled={loadingMore}
                style={{
                  padding: isMobile ? '10px 20px' : '8px 16px',
                  fontSize: isMobile ? 15 : 14,
                  backgroundColor: loadingMore ? '#ccc' : '#0d47a1',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: loadingMore ? 'not-allowed' : 'pointer',
                  minHeight: 44,
                  touchAction: 'manipulation',
                }}
              >
                {loadingMore ? 'Loading...' : 'Load more conversations'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
