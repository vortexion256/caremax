import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { useParams, Link } from 'react-router-dom';
import { collection, query, where, orderBy, limit, startAfter, getDocs, doc, getDoc, type DocumentSnapshot } from 'firebase/firestore';
import { firestore } from '../firebase';
import { useTenant } from '../TenantContext';
import { useIsMobile } from '../hooks/useIsMobile';

const PAGE_SIZE = 10;

type Message = {
  messageId: string;
  role: 'user' | 'assistant' | 'human_agent';
  content: string;
  imageUrls?: string[];
  createdAt: number | null;
};

function messageFromDoc(d: { id: string; data: () => Record<string, unknown> }): Message {
  const data = d.data();
  return {
    messageId: d.id,
    role: (data.role as Message['role']) ?? 'assistant',
    content: (data.content as string) ?? '',
    imageUrls: data.imageUrls as string[] | undefined,
    createdAt: data.createdAt && typeof (data.createdAt as { toMillis?: () => number }).toMillis === 'function'
      ? (data.createdAt as { toMillis: () => number }).toMillis()
      : null,
  };
}

export default function ConversationView() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const { tenantId } = useTenant();
  const { isMobile, isVerySmall } = useIsMobile();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('open');
  const [lastDoc, setLastDoc] = useState<DocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!conversationId || !tenantId) return;
    setLoading(true);
    setError(null);
    setLastDoc(null);
    setHasMore(true);

    getDoc(doc(firestore, 'conversations', conversationId))
      .then((convDoc) => {
        if (convDoc.exists()) {
          setStatus(convDoc.data().status ?? 'open');
        }
      })
      .catch(() => {});

    const messagesRef = collection(firestore, 'messages');
    const q = query(
      messagesRef,
      where('conversationId', '==', conversationId),
      orderBy('createdAt', 'desc'),
      limit(PAGE_SIZE)
    );
    getDocs(q)
      .then((snap) => {
        const docs = snap.docs;
        const list = docs.map((d) => messageFromDoc(d)).reverse();
        setMessages(list);
        setHasMore(docs.length === PAGE_SIZE);
        setLastDoc(docs.length > 0 ? docs[docs.length - 1] : null);
      })
      .catch((err) => {
        setError(err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [conversationId, tenantId]);

  const loadOlder = () => {
    if (!conversationId || !lastDoc || loadingMore || !hasMore) return;
    setLoadingMore(true);
    const messagesRef = collection(firestore, 'messages');
    const q = query(
      messagesRef,
      where('conversationId', '==', conversationId),
      orderBy('createdAt', 'desc'),
      limit(PAGE_SIZE),
      startAfter(lastDoc)
    );
    getDocs(q)
      .then((snap) => {
        const docs = snap.docs;
        const older = docs.map((d) => messageFromDoc(d)).reverse();
        setMessages((prev) => [...older, ...prev]);
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

  useEffect(() => {
    listRef.current?.scrollTo(0, listRef.current.scrollHeight);
  }, [messages]);

  if (loading) return <div style={{ color: '#64748b', padding: 20 }}>Loading conversation...</div>;
  if (error) return <div style={{ color: '#ef4444', padding: 20 }}>{error}</div>;

  const getStatusBadge = (status: string) => {
    const styles: Record<string, { bg: string; color: string; label: string }> = {
      open: { bg: '#eff6ff', color: '#2563eb', label: 'AI Only' },
      handoff_requested: { bg: '#fffbeb', color: '#d97706', label: 'Handoff' },
      human_joined: { bg: '#f0fdf4', color: '#166534', label: 'Human Agent' },
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

  return (
    <div style={{ width: '100%', maxWidth: '100%', display: 'flex', flexDirection: 'column', height: isMobile ? 'calc(100vh - 100px)' : 'calc(100vh - 120px)' }}>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link
            to="/conversations"
            style={{
              color: '#64748b',
              textDecoration: 'none',
              fontSize: 14,
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}
          >
            ← {!isMobile && 'Back'}
          </Link>
          <h2 style={{ margin: 0, fontSize: isMobile ? 18 : 22 }}>Conversation</h2>
          {getStatusBadge(status)}
        </div>
        
        {(status === 'handoff_requested' || status === 'human_joined') && (
          <Link
            to={`/handoffs/${conversationId}`}
            style={{
              background: '#2563eb',
              color: '#fff',
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: 600,
              padding: '8px 16px',
              borderRadius: 8,
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
            }}
          >
            Join Chat
          </Link>
        )}
      </div>

      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16, fontFamily: 'monospace' }}>
        ID: {conversationId}
      </div>

      <div
        ref={listRef}
        style={{
          flex: 1,
          border: '1px solid #e2e8f0',
          borderRadius: 16,
          padding: isMobile ? 12 : 20,
          overflowY: 'auto',
          background: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {hasMore && messages.length > 0 && (
          <div style={{ textAlign: 'center' }}>
            <button
              onClick={loadOlder}
              disabled={loadingMore}
              style={{
                padding: '8px 16px',
                fontSize: 13,
                backgroundColor: '#fff',
                color: '#64748b',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                cursor: loadingMore ? 'not-allowed' : 'pointer',
                fontWeight: 500
              }}
            >
              {loadingMore ? 'Loading...' : 'Load older messages'}
            </button>
          </div>
        )}
        
        {messages.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>No messages yet.</div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === 'user';
            return (
              <div
                key={msg.messageId}
                style={{
                  alignSelf: isUser ? 'flex-start' : 'flex-end',
                  maxWidth: isMobile ? '90%' : '75%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: isUser ? 'flex-start' : 'flex-end',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, padding: '0 4px' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b' }}>
                    {msg.role === 'user' ? 'User' : msg.role === 'human_agent' ? 'Human Agent' : 'AI Assistant'}
                  </span>
                  {msg.createdAt && (
                    <span style={{ fontSize: 10, color: '#cbd5e1' }}>
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    padding: '8px 12px',
                    borderRadius: 16,
                    borderTopLeftRadius: isUser ? 4 : 16,
                    borderTopRightRadius: isUser ? 16 : 4,
                    background: isUser ? '#fff' : msg.role === 'human_agent' ? '#2563eb' : '#e2e8f0',
                    color: msg.role === 'human_agent' ? '#fff' : '#1e293b',
                    fontSize: 14,
                    lineHeight: 1.5,
                    boxShadow: isUser ? '0 1px 2px 0 rgb(0 0 0 / 0.05)' : 'none',
                    border: isUser ? '1px solid #e2e8f0' : 'none'
                  }}
                >
                  <ReactMarkdown
                    components={{
                      p: ({ children }) => <p style={{ margin: 0 }}>{children}</p>,
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                  {msg.imageUrls && msg.imageUrls.length > 0 && (
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {msg.imageUrls.map((url, idx) => (
                        <img
                          key={idx}
                          src={url}
                          alt=""
                          style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 12, objectFit: 'cover' }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
