import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { collection, query, where, orderBy, limit, startAfter, getDocs, type DocumentSnapshot } from 'firebase/firestore';
import { firestore } from '../firebase';
import { api } from '../api';
import { useTenant } from '../TenantContext';
import { useIsMobile } from '../hooks/useIsMobile';
import AppDialog from '../components/AppDialog';
import AppNotification from '../components/AppNotification';

const PAGE_SIZE = 10;
const ACTIVE_WINDOW_MS = 60 * 1000;

type ConversationItem = {
  conversationId: string;
  tenantId: string;
  userId: string;
  status: 'open' | 'handoff_requested' | 'human_joined';
  channel?: 'widget' | 'whatsapp' | 'whatsapp_meta';
  externalUserId?: string;
  createdAt: number | null;
  updatedAt: number | null;
  lastMessage?: string;
  hasHumanParticipant?: boolean;
};


function formatConversationIdentifier(conv: ConversationItem): string {
  const externalUserId = conv.externalUserId?.trim();

  if ((conv.channel === 'whatsapp' || conv.channel === 'whatsapp_meta') && externalUserId) {
    return externalUserId.replace(/^whatsapp:/i, '');
  }

  if (conv.channel === 'widget' && externalUserId) {
    return externalUserId;
  }

  return `#${conv.conversationId.slice(0, 8)}`;
}

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
  const [pendingDeleteConversationId, setPendingDeleteConversationId] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 10000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

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
            channel: (data.channel ?? 'widget') as ConversationItem['channel'],
            externalUserId: typeof data.externalUserId === 'string' ? data.externalUserId : undefined,
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

  const filterOptions: Array<{ value: 'all' | 'ai_only' | 'ai_human'; label: string }> = [
    { value: 'all', label: 'All conversations' },
    { value: 'ai_only', label: 'AI only' },
    { value: 'ai_human', label: 'AI + human' },
  ];

  const truncateText = (value: string | undefined, maxLength: number) => {
    if (!value) return 'No messages yet';
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
  };

  const formatRelativeTime = (timestamp: number | null) => {
    if (!timestamp) return 'No recent activity';

    const diffMs = Math.max(0, nowMs - timestamp);
    const diffMinutes = Math.floor(diffMs / 60000);

    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  const activeCount = list.filter((conv) => conv.updatedAt && nowMs - conv.updatedAt <= ACTIVE_WINDOW_MS).length;
  const whatsappCount = list.filter((conv) => conv.channel === 'whatsapp').length;
  const humanAssistedCount = list.filter((conv) => conv.hasHumanParticipant).length;

  const isConversationActive = (conv: ConversationItem) => {
    if (!conv.updatedAt) return false;
    return nowMs - conv.updatedAt <= ACTIVE_WINDOW_MS;
  };

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
            channel: (data.channel ?? 'widget') as ConversationItem['channel'],
            externalUserId: typeof data.externalUserId === 'string' ? data.externalUserId : undefined,
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

  const getChannelBadge = (conv: ConversationItem) => {
    if (conv.channel !== 'whatsapp' && conv.channel !== 'whatsapp_meta') return null;

    return (
      <span
        style={{
          padding: '4px 10px',
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 600,
          background: '#dcfce7',
          color: '#166534',
          textTransform: 'uppercase',
          letterSpacing: '0.02em'
        }}
      >
        WhatsApp
      </span>
    );
  };

  const deleteConversation = async (id: string) => {
    try {
      await api(`/tenants/${tenantId}/conversations/${id}`, { method: 'DELETE' });
      setList((prev) => prev.filter((c) => c.conversationId !== id));
    } catch (err) {
      setNotification(err instanceof Error ? err.message : 'Failed to delete conversation');
    }
  };

  if (loading) return <div style={{ color: '#64748b' }}>Loading conversations...</div>;

  return (
    <div style={{ padding: isMobile ? '16px 0' : 0 }}>
      {notification && <AppNotification message={notification} type="error" onClose={() => setNotification(null)} />}
      <AppDialog
        open={Boolean(pendingDeleteConversationId)}
        title="Delete conversation"
        description="This will remove all messages and cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        onCancel={() => setPendingDeleteConversationId(null)}
        onConfirm={async () => {
          if (!pendingDeleteConversationId) return;
          await deleteConversation(pendingDeleteConversationId);
          setPendingDeleteConversationId(null);
        }}
      />

      <section
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1d4ed8 58%, #38bdf8 100%)',
          color: '#fff',
          borderRadius: 24,
          padding: isMobile ? 20 : 28,
          marginBottom: 24,
          boxShadow: '0 24px 60px rgba(15, 23, 42, 0.16)'
        }}
      >
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 24, justifyContent: 'space-between' }}>
          <div style={{ maxWidth: 720 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 999, background: 'rgba(255,255,255,0.14)', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>
              Inbox
            </div>
            <h1 style={{ margin: '0 0 8px 0', fontSize: isMobile ? 28 : 36, lineHeight: 1.1 }}>Conversations</h1>
            <p style={{ color: 'rgba(255,255,255,0.8)', margin: 0, fontSize: 15, lineHeight: 1.6 }}>
              Monitor every customer thread with a cleaner chat-style inbox, faster scan patterns, and clearer handoff visibility.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(140px, 1fr))', gap: 12, width: isMobile ? '100%' : 'min(420px, 100%)' }}>
            {[
              { label: 'Active now', value: activeCount, tone: 'rgba(34, 197, 94, 0.18)' },
              { label: 'WhatsApp', value: whatsappCount, tone: 'rgba(16, 185, 129, 0.18)' },
              { label: 'Human assisted', value: humanAssistedCount, tone: 'rgba(255, 255, 255, 0.16)' },
            ].map((stat) => (
              <div
                key={stat.label}
                style={{
                  padding: '16px 18px',
                  borderRadius: 18,
                  background: stat.tone,
                  border: '1px solid rgba(255,255,255,0.16)',
                  backdropFilter: 'blur(12px)'
                }}
              >
                <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.72)', marginBottom: 8 }}>
                  {stat.label}
                </div>
                <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1 }}>{stat.value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div
        style={{
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 24,
          padding: isMobile ? 16 : 20,
          boxShadow: '0 18px 48px rgba(15, 23, 42, 0.08)'
        }}
      >
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 16, justifyContent: 'space-between', alignItems: isMobile ? 'stretch' : 'center', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>Chat inbox</div>
            <div style={{ fontSize: 14, color: '#64748b' }}>
              {filteredList.length} conversation{filteredList.length === 1 ? '' : 's'} shown, sorted by most recent activity.
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {filterOptions.map((option) => {
              const active = filter === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFilter(option.value)}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 999,
                    border: active ? '1px solid #2563eb' : '1px solid #cbd5e1',
                    background: active ? '#eff6ff' : '#fff',
                    color: active ? '#1d4ed8' : '#475569',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                    boxShadow: active ? '0 8px 24px rgba(37, 99, 235, 0.12)' : 'none'
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <div style={{ padding: 12, background: '#fef2f2', color: '#991b1b', borderRadius: 12, marginBottom: 24, fontSize: 14 }}>
            {error}
          </div>
        )}

        {filteredList.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', background: '#f8fafc', borderRadius: 18, border: '1px dashed #cbd5e1', color: '#94a3b8' }}>
            No conversations found.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filteredList.map((conv) => {
              const isActive = isConversationActive(conv);
              const hasHuman = !!conv.hasHumanParticipant;
              const initials = hasHuman ? 'AH' : 'AI';

              return (
                <div
                  key={conv.conversationId}
                  style={{
                    border: isActive ? '1px solid #93c5fd' : '1px solid #e2e8f0',
                    borderRadius: 20,
                    padding: isMobile ? 16 : 18,
                    background: isActive ? 'linear-gradient(180deg, #f8fbff 0%, #ffffff 100%)' : '#fff',
                    display: 'flex',
                    flexDirection: isMobile ? 'column' : 'row',
                    alignItems: isMobile ? 'stretch' : 'center',
                    gap: 16,
                    boxShadow: isActive ? '0 16px 38px rgba(59, 130, 246, 0.10)' : '0 10px 24px rgba(15, 23, 42, 0.04)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        width: 54,
                        height: 54,
                        minWidth: 54,
                        borderRadius: 18,
                        background: hasHuman ? 'linear-gradient(135deg, #16a34a 0%, #22c55e 100%)' : 'linear-gradient(135deg, #2563eb 0%, #38bdf8 100%)',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 15,
                        fontWeight: 800,
                        letterSpacing: '0.04em'
                      }}
                    >
                      {initials}
                    </div>

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>#{conv.conversationId.slice(0, 8)}</span>
                        <span style={{ padding: '5px 10px', borderRadius: 999, background: hasHuman ? '#ecfdf5' : '#eff6ff', color: hasHuman ? '#15803d' : '#2563eb', fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                          {hasHuman ? 'AI + Human' : 'AI Only'}
                        </span>
                        {conv.channel === 'whatsapp' && (
                          <span style={{ padding: '5px 10px', borderRadius: 999, background: '#dcfce7', color: '#166534', fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                            WhatsApp
                          </span>
                        )}
                        {isActive && (
                          <span style={{ padding: '5px 10px', borderRadius: 999, background: '#dbeafe', color: '#1d4ed8', fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                            Active now
                          </span>
                        )}
                      </div>

                      <div style={{ fontSize: 15, color: '#0f172a', fontWeight: 600, marginBottom: 6, lineHeight: 1.5 }}>
                        {truncateText(conv.lastMessage, isMobile ? 72 : 120)}
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 12, color: '#64748b' }}>
                        <span>User {truncateText(conv.userId, 14)}</span>
                        <span>•</span>
                        <span>{formatRelativeTime(conv.updatedAt)}</span>
                        <span>•</span>
                        <span>{conv.updatedAt ? new Date(conv.updatedAt).toLocaleString() : '-'}</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: isMobile ? 'row' : 'column', gap: 10, width: isMobile ? '100%' : 'auto' }}>
                    <Link
                      to={`/conversations/${conv.conversationId}`}
                      style={{
                        padding: '10px 16px',
                        background: '#0f172a',
                        color: '#fff',
                        textDecoration: 'none',
                        fontSize: 13,
                        fontWeight: 700,
                        borderRadius: 12,
                        textAlign: 'center',
                        minWidth: isMobile ? 0 : 132,
                        flex: isMobile ? 1 : undefined,
                        boxShadow: '0 12px 24px rgba(15, 23, 42, 0.16)'
                      }}
                    >
                      Open chat
                    </Link>
                    <button
                      type="button"
                      onClick={() => setPendingDeleteConversationId(conv.conversationId)}
                      style={{
                        padding: '10px 16px',
                        background: '#fff',
                        color: '#ef4444',
                        border: '1px solid #fecaca',
                        borderRadius: 12,
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: 'pointer',
                        minWidth: isMobile ? 0 : 132,
                        flex: isMobile ? 1 : undefined
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}

            {hasMore && (
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                style={{
                  marginTop: 8,
                  padding: '14px 18px',
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: 14,
                  color: '#334155',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 700
                }}
              >
                {loadingMore ? 'Loading more...' : 'Load more conversations'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
