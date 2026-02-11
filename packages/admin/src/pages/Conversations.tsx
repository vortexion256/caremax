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
      open: { bg: '#eff6ff', color: '#2563eb', label: 'AI Only' },
      handoff_requested: { bg: '#fffbeb', color: '#d97706', label: 'Handoff' },
      human_joined: { bg: '#f0fdf4', color: '#166534', label: 'Care Team' },
    };
    const style = styles[status] || styles.open;
    return (
      <span
        style={{
          padding: '4px 10px',
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 600,
          background: style.bg,
          color: style.color,
          textTransform: 'uppercase',
          letterSpacing: '0.02em'
        }}
      >
        {style.label}
      </span>
    );
  };

  if (loading) return <div style={{ color: '#64748b' }}>Loading conversations...</div>;

  return (
    <div>
      <h1 style={{ margin: '0 0 8px 0', fontSize: isMobile ? 24 : 32 }}>Conversations</h1>
      <p style={{ color: '#64748b', marginBottom: 32, maxWidth: 800 }}>
        Monitor all user interactions and oversee AI performance.
      </p>

      <div style={{ marginBottom: 24, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {['all', 'open', 'handoff_requested', 'human_joined'].map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f as any)}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid #e2e8f0',
              background: filter === f ? '#0f172a' : '#fff',
              color: filter === f ? '#fff' : '#475569',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              transition: 'all 0.2s'
            }}
          >
            {f === 'all' ? 'All' : f === 'open' ? 'AI Only' : f === 'handoff_requested' ? 'Handoff' : 'Care Team'}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ padding: 12, background: '#fef2f2', color: '#991b1b', borderRadius: 8, marginBottom: 24, fontSize: 14 }}>
          {error}
        </div>
      )}

      {list.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', background: '#f8fafc', borderRadius: 12, border: '1px dashed #e2e8f0', color: '#94a3b8' }}>
          No conversations found.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {list.map((conv) => (
            <div
              key={conv.conversationId}
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: 12,
                padding: 20,
                background: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 20,
                flexWrap: isMobile ? 'wrap' : 'nowrap'
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  {getStatusBadge(conv.status)}
                  <span style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'monospace' }}>#{conv.conversationId.slice(0, 8)}</span>
                </div>
                <div style={{ fontSize: 14, color: '#1e293b', fontWeight: 500 }}>
                  User: <span style={{ color: '#475569' }}>{conv.userId}</span>
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                  Updated {conv.updatedAt ? new Date(conv.updatedAt).toLocaleString() : '-'}
                </div>
              </div>
              
              <Link
                to={`/conversations/${conv.conversationId}`}
                style={{
                  padding: '8px 16px',
                  background: '#f8fafc',
                  color: '#2563eb',
                  textDecoration: 'none',
                  fontSize: 13,
                  fontWeight: 600,
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  textAlign: 'center',
                  minWidth: isMobile ? '100%' : 120
                }}
              >
                View Chat
              </Link>
            </div>
          ))}
          
          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              style={{
                marginTop: 12,
                padding: '12px',
                background: 'transparent',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                color: '#64748b',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 500
              }}
            >
              {loadingMore ? 'Loading more...' : 'Load more conversations'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
