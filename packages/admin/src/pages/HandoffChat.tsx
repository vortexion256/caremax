import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { firestore } from '../firebase';
import { api } from '../api';
import { useTenant } from '../TenantContext';

type Message = {
  messageId: string;
  role: 'user' | 'assistant' | 'human_agent';
  content: string;
  imageUrls?: string[];
  createdAt: number | null;
};

export default function HandoffChat() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!conversationId || !tenantId) return;
    setLoading(true);
    setError(null);
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

  const returnToAgent = async () => {
    if (!conversationId || !tenantId) return;
    try {
      await api(`/tenants/${tenantId}/conversations/${conversationId}/return-to-agent`, { method: 'POST' });
      navigate('/handoffs');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to return to AI');
    }
  };

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = reply.trim();
    if (!text || !conversationId || !tenantId) return;
    setSending(true);
    setError(null);
    try {
      await api(`/tenants/${tenantId}/conversations/${conversationId}/agent-message`, {
        method: 'POST',
        body: JSON.stringify({ content: text }),
      });
      setReply('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  if (!conversationId) return <p>Missing conversation.</p>;
  if (loading && messages.length === 0) return <p>Loading conversation...</p>;
  if (error && messages.length === 0) return <p style={{ color: '#c62828' }}>{error}</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', maxHeight: 600 }}>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Link to="/handoffs" style={{ color: '#0d47a1', textDecoration: 'none', fontSize: 14 }}>
          ← Back to handoff queue
        </Link>
        <span style={{ color: '#666', fontSize: 14 }}>Conversation {conversationId.slice(0, 8)}…</span>
        <button
          type="button"
          onClick={returnToAgent}
          style={{ marginLeft: 'auto', padding: '6px 12px', fontSize: 13, background: '#fff', border: '1px solid #0d47a1', color: '#0d47a1', borderRadius: 6, cursor: 'pointer' }}
        >
          Return to AI
        </button>
      </div>
      <div
        ref={listRef}
        style={{
          flex: 1,
          overflow: 'auto',
          border: '1px solid #e0e0e0',
          borderRadius: 8,
          padding: 16,
          backgroundColor: '#fafafa',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {messages.map((m) => (
          <div
            key={m.messageId}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              padding: '10px 14px',
              borderRadius: 12,
              backgroundColor:
                m.role === 'user' ? '#0d47a1' : m.role === 'human_agent' ? '#1b5e20' : '#e8e8e8',
              color: m.role === 'user' ? '#fff' : '#111',
              fontSize: 14,
              whiteSpace: 'pre-wrap',
            }}
          >
            {m.role === 'human_agent' && (
              <span style={{ fontSize: 11, opacity: 0.9, display: 'block', marginBottom: 4, color: '#fff' }}>
                You (care team)
              </span>
            )}
            {m.role === 'assistant' && (
              <span style={{ fontSize: 11, opacity: 0.8, display: 'block', marginBottom: 4, color: '#666' }}>
                AI
              </span>
            )}
            {m.content}
          </div>
        ))}
      </div>
      <form onSubmit={sendReply} style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <input
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Reply as care team..."
          style={{ flex: 1, padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }}
          disabled={sending}
        />
        <button type="submit" disabled={sending || !reply.trim()} style={{ padding: '10px 20px', background: '#1b5e20', color: '#fff', border: 'none', borderRadius: 8, cursor: sending ? 'not-allowed' : 'pointer' }}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
      {error && <p style={{ color: '#c62828', fontSize: 14, marginTop: 8 }}>{error}</p>}
    </div>
  );
}
