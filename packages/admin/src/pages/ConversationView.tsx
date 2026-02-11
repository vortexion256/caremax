import { useState, useEffect, useRef } from 'react';
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

  if (loading) return <p>Loading...</p>;
  if (error) return <p style={{ color: '#c62828' }}>{error}</p>;

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

  return (
    <div style={{ width: '100%', maxWidth: '100%', overflowX: 'hidden' }}>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: isVerySmall ? 8 : 12, flexWrap: 'wrap' }}>
        <Link
          to="/conversations"
          style={{
            color: '#0d47a1',
            textDecoration: 'none',
            fontSize: isMobile ? 13 : 14,
            padding: isMobile ? '8px 0' : 0,
            minHeight: 44,
            display: 'flex',
            alignItems: 'center',
            touchAction: 'manipulation',
          }}
        >
          ← Back to conversations
        </Link>
        {getStatusBadge(status)}
        {(status === 'handoff_requested' || status === 'human_joined') && (
          <Link
            to={`/handoffs/${conversationId}`}
            style={{
              color: '#0d47a1',
              textDecoration: 'none',
              fontSize: isMobile ? 13 : 14,
              padding: isMobile ? '8px 0' : 0,
              minHeight: 44,
              display: 'flex',
              alignItems: 'center',
              touchAction: 'manipulation',
            }}
          >
            Open in handoff chat
          </Link>
        )}
      </div>

      <h2 style={{ margin: '0 0 16px 0', fontSize: isMobile ? 20 : 24 }}>Conversation</h2>
      <p style={{ fontSize: isMobile ? 11 : 12, color: '#666', marginBottom: 16, wordBreak: 'break-word' }}>
        Conversation ID: <code style={{ fontSize: isMobile ? 10 : 12, wordBreak: 'break-all' }}>{conversationId}</code>
      </p>

      <div
        ref={listRef}
        style={{
          border: '1px solid #e0e0e0',
          borderRadius: 8,
          padding: isMobile ? 12 : 16,
          maxHeight: isMobile ? '50vh' : '60vh',
          overflowY: 'auto',
          overflowX: 'hidden',
          background: '#fafafa',
          marginBottom: 16,
          width: '100%',
        }}
      >
        {hasMore && messages.length > 0 && (
          <div style={{ marginBottom: 16, textAlign: 'center' }}>
            <button
              onClick={loadOlder}
              disabled={loadingMore}
              style={{
                padding: isMobile ? '10px 20px' : '8px 16px',
                fontSize: isMobile ? 15 : 13,
                backgroundColor: loadingMore ? '#ccc' : '#0d47a1',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: loadingMore ? 'not-allowed' : 'pointer',
                minHeight: 44,
                touchAction: 'manipulation',
              }}
            >
              {loadingMore ? 'Loading...' : 'Load older messages'}
            </button>
          </div>
        )}
        {messages.length === 0 && !loading ? (
          <p style={{ color: '#666' }}>No messages yet.</p>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.messageId}
              style={{
                marginBottom: 16,
                padding: 12,
                borderRadius: 8,
                background: msg.role === 'user' ? '#e3f2fd' : msg.role === 'human_agent' ? '#fff3e0' : '#ffffff',
                borderLeft: `4px solid ${
                  msg.role === 'user' ? '#2196f3' : msg.role === 'human_agent' ? '#ff9800' : '#4caf50'
                }`,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, flexWrap: 'wrap', gap: 4 }}>
                <strong style={{ fontSize: isMobile ? 14 : 13, color: '#666' }}>
                  {msg.role === 'user'
                    ? 'User'
                    : msg.role === 'human_agent'
                      ? 'Care Team'
                      : 'AI Assistant'}
                </strong>
                {msg.createdAt && (
                  <span style={{ fontSize: isMobile ? 10 : 11, color: '#999' }}>
                    {new Date(msg.createdAt).toLocaleString()}
                  </span>
                )}
              </div>
              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: isMobile ? 14 : 13, lineHeight: 1.5 }}>{msg.content}</div>
              {msg.imageUrls && msg.imageUrls.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {msg.imageUrls.map((url, idx) => (
                    <img
                      key={idx}
                      src={url}
                      alt={`Attachment ${idx + 1}`}
                      style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 4, marginRight: 8 }}
                    />
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
