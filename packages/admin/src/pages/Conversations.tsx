import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { collection, query, where, orderBy, limit, startAfter, getDocs, type DocumentSnapshot } from 'firebase/firestore';
import { firestore } from '../firebase';
import { api } from '../api';
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
  lastMessage?: string;
  hasHumanParticipant?: boolean;
};

export default function Conversations() {
  const { tenantId } = useTenant();
  const { isMobile } = useIsMobile();
  const [list, setList] = useState<ConversationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'ai_only' | 'ai_human'>('all');
  const [lastDoc, setLastDoc] = useState<DocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    setLastDoc(null);
    setHasMore(true);
    
    const q = query(
      collection(firestore, 'conversations'),
      where('tenantId', '==', tenantId),
      orderBy('updatedAt', 'desc'),
      limit(PAGE_SIZE)
    );

    getDocs(q)
      .then(async (snap) => {
        const docs = snap.docs;
        const conversations: ConversationItem[] = await Promise.all(docs.map(async (d) => {
          const data = d.data();
          
          // Fetch last message and check for human participation
          const messagesRef = collection(firestore, 'messages');
          const lastMsgQuery = query(
            messagesRef,
            where('conversationId', '==', d.id),
            orderBy('createdAt', 'desc'),
            limit(1)
          );
          const lastMsgSnap = await getDocs(lastMsgQuery);
          const lastMessage = lastMsgSnap.docs[0]?.data()?.content ?? 'No messages yet';

          const humanMsgQuery = query(
            messagesRef,
            where('conversationId', '==', d.id),
            where('role', '==', 'human_agent'),
            limit(1)
          );
          const humanMsgSnap = await getDocs(humanMsgQuery);
          const hasHumanParticipant = !humanMsgSnap.empty;

          return {
            conversationId: d.id,
            tenantId: data.tenantId ?? '',
            userId: data.userId ?? '',
            status: (data.status ?? 'open') as ConversationItem['status'],
            createdAt: data.createdAt?.toMillis?.() ?? null,
            updatedAt: data.updatedAt?.toMillis?.() ?? null,
            lastMessage,
            hasHumanParticipant,
          };
        }));
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
  }, [tenantId]);

  const filteredList = list.filter((conv) => {
    if (filter === 'ai_only') return !conv.hasHumanParticipant;
    if (filter === 'ai_human') return !!conv.hasHumanParticipant;
    return true;
  });

  const loadMore = () => {
    if (!tenantId || !lastDoc || loadingMore || !hasMore) return;
    setLoadingMore(true);
    
    const q = query(
      collection(firestore, 'conversations'),
      where('tenantId', '==', tenantId),
      orderBy('updatedAt', 'desc'),
      limit(PAGE_SIZE),
      startAfter(lastDoc)
    );

    getDocs(q)
      .then(async (snap) => {
        const docs = snap.docs;
        const moreConversations: ConversationItem[] = await Promise.all(docs.map(async (d) => {
          const data = d.data();
          
          // Fetch last message and check for human participation
          const messagesRef = collection(firestore, 'messages');
          const lastMsgQuery = query(
            messagesRef,
            where('conversationId', '==', d.id),
            orderBy('createdAt', 'desc'),
            limit(1)
          );
          const lastMsgSnap = await getDocs(lastMsgQuery);
          const lastMessage = lastMsgSnap.docs[0]?.data()?.content ?? 'No messages yet';

          const humanMsgQuery = query(
            messagesRef,
            where('conversationId', '==', d.id),
            where('role', '==', 'human_agent'),
            limit(1)
          );
          const humanMsgSnap = await getDocs(humanMsgQuery);
          const hasHumanParticipant = !humanMsgSnap.empty;

          return {
            conversationId: d.id,
            tenantId: data.tenantId ?? '',
            userId: data.userId ?? '',
            status: (data.status ?? 'open') as ConversationItem['status'],
            createdAt: data.createdAt?.toMillis?.() ?? null,
            updatedAt: data.updatedAt?.toMillis?.() ?? null,
            lastMessage,
            hasHumanParticipant,
          };
        }));
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

  const getStatusBadge = (conv: ConversationItem) => {
    const label = conv.hasHumanParticipant ? 'AI + HUMAN' : 'AI ONLY';
    const isHuman = conv.hasHumanParticipant;
    
    return (
      <span
        style={{
          padding: '4px 10px',
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 600,
          background: isHuman ? '#f0fdf4' : '#eff6ff',
          color: isHuman ? '#166534' : '#2563eb',
          textTransform: 'uppercase',
          letterSpacing: '0.02em'
        }}
      >
        {label}
      </span>
    );
  };

  const deleteConversation = async (id: string) => {
    if (!confirm('Are you sure you want to delete this conversation? This will remove all messages and cannot be undone.')) return;
    try {
      await api(`/tenants/${tenantId}/conversations/${id}`, { method: 'DELETE' });
      setList((prev) => prev.filter((c) => c.conversationId !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete conversation');
    }
  };

  if (loading) return <div style={{ color: '#64748b' }}>Loading conversations...</div>;

  return (
    <div style={{ padding: isMobile ? '16px 0' : 0 }}>
      <h1 style={{ margin: '0 0 8px 0', fontSize: isMobile ? 24 : 32 }}>Conversations</h1>
      <p style={{ color: '#64748b', marginBottom: 32, maxWidth: 800 }}>
        Monitor all user interactions and oversee AI performance.
      </p>

      <div style={{ marginBottom: 24 }}>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          style={{
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid #e2e8f0',
            background: '#fff',
            color: '#334155',
            fontSize: 14,
            fontWeight: 500,
            minWidth: 180,
            cursor: 'pointer'
          }}
          aria-label="Filter conversations"
        >
          <option value="all">All</option>
          <option value="ai_only">AI Only</option>
          <option value="ai_human">AI + Human</option>
        </select>
      </div>

      {error && (
        <div style={{ padding: 12, background: '#fef2f2', color: '#991b1b', borderRadius: 8, marginBottom: 24, fontSize: 14 }}>
          {error}
        </div>
      )}

      {filteredList.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', background: '#f8fafc', borderRadius: 12, border: '1px dashed #e2e8f0', color: '#94a3b8' }}>
          No conversations found.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filteredList.map((conv) => (
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
                  {getStatusBadge(conv)}
                  <span style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'monospace' }}>#{conv.conversationId.slice(0, 8)}</span>
                </div>
                <div style={{ fontSize: 14, color: '#1e293b', fontWeight: 500, marginBottom: 4 }}>
                  {conv.lastMessage && conv.lastMessage.length > 100 ? `${conv.lastMessage.slice(0, 100)}...` : conv.lastMessage}
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  User: {conv.userId.slice(0, 8)}... • {conv.updatedAt ? new Date(conv.updatedAt).toLocaleString() : '-'}
                </div>
              </div>
              
              <div style={{ display: 'flex', gap: 8, width: isMobile ? '100%' : 'auto' }}>
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
                    flex: 1,
                    minWidth: isMobile ? 0 : 100
                  }}
                >
                  View
                </Link>
                <button
                  onClick={() => deleteConversation(conv.conversationId)}
                  style={{
                    padding: '8px 16px',
                    background: '#fff',
                    color: '#ef4444',
                    border: '1px solid #fee2e2',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    flex: 1,
                    minWidth: isMobile ? 0 : 100
                  }}
                >
                  Delete
                </button>
              </div>
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
