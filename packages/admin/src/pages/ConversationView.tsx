import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { collection, query, where, orderBy, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { firestore } from '../firebase';
import { useTenant } from '../TenantContext';

type Message = {
  messageId: string;
  role: 'user' | 'assistant' | 'human_agent';
  content: string;
  imageUrls?: string[];
  createdAt: number | null;
};

export default function ConversationView() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const { tenantId } = useTenant();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('open');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!conversationId || !tenantId) return;
    setLoading(true);
    setError(null);

    // Get conversation status
    getDoc(doc(firestore, 'conversations', conversationId))
      .then((convDoc) => {
        if (convDoc.exists()) {
          setStatus(convDoc.data().status ?? 'open');
        }
      })
      .catch(() => {});

    // Listen to messages
    const q = query(
      collection(firestore, 'messages'),
      where('conversationId', '==', conversationId),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => {
          const data = d.data();
          return {
            messageId: d.id,
            role: data.role as Message['role'],
            content: data.content ?? '',
            imageUrls: data.imageUrls,
            createdAt: data.createdAt?.toMillis?.() ?? null,
          };
        });
        setMessages(list);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [conversationId, tenantId]);

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
    <div>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
        <Link to="/conversations" style={{ color: '#0d47a1', textDecoration: 'none' }}>
          ← Back to conversations
        </Link>
        {getStatusBadge(status)}
        {(status === 'handoff_requested' || status === 'human_joined') && (
          <Link
            to={`/handoffs/${conversationId}`}
            style={{ color: '#0d47a1', textDecoration: 'none', fontSize: 14 }}
          >
            Open in handoff chat
          </Link>
        )}
      </div>

      <h2 style={{ margin: '0 0 16px 0' }}>Conversation</h2>
      <p style={{ fontSize: 12, color: '#666', marginBottom: 16 }}>
        Conversation ID: <code>{conversationId}</code>
      </p>

      <div
        ref={listRef}
        style={{
          border: '1px solid #e0e0e0',
          borderRadius: 8,
          padding: 16,
          maxHeight: '60vh',
          overflowY: 'auto',
          background: '#fafafa',
          marginBottom: 16,
        }}
      >
        {messages.length === 0 ? (
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
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <strong style={{ fontSize: 13, color: '#666' }}>
                  {msg.role === 'user'
                    ? 'User'
                    : msg.role === 'human_agent'
                      ? 'Care Team'
                      : 'AI Assistant'}
                </strong>
                {msg.createdAt && (
                  <span style={{ fontSize: 11, color: '#999' }}>
                    {new Date(msg.createdAt).toLocaleString()}
                  </span>
                )}
              </div>
              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content}</div>
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
