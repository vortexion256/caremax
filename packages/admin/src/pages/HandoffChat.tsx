import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { firestore } from '../firebase';
import { api } from '../api';
import { useTenant } from '../TenantContext';
import { useIsMobile } from '../hooks/useIsMobile';

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
  const { isMobile } = useIsMobile();
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
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      height: isMobile ? 'calc(100vh - 100px)' : 'calc(100vh - 120px)', 
      maxHeight: isMobile ? 'none' : 800,
      backgroundColor: '#fff',
      borderRadius: isMobile ? 0 : 16,
      boxShadow: isMobile ? 'none' : '0 4px 6px -1px rgb(0 0 0 / 0.1)',
      overflow: 'hidden'
    }}>
      <div style={{ 
        padding: '16px 20px', 
        borderBottom: '1px solid #f1f5f9',
        display: 'flex', 
        alignItems: 'center', 
        gap: 12, 
        flexWrap: 'wrap',
        background: '#fff'
      }}>
        <Link to="/handoffs" style={{ color: '#64748b', textDecoration: 'none', fontSize: 14, display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>←</span> {!isMobile && 'Back'}
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ color: '#0f172a', fontWeight: 600, fontSize: 15 }}>Chat {conversationId.slice(0, 8)}</span>
        </div>
        <button
          type="button"
          onClick={returnToAgent}
          style={{ 
            padding: '6px 12px', 
            fontSize: 13, 
            background: '#f8fafc', 
            border: '1px solid #e2e8f0', 
            color: '#475569', 
            borderRadius: 8, 
            cursor: 'pointer',
            fontWeight: 500,
            transition: 'all 0.2s'
          }}
        >
          Return to AI
        </button>
      </div>
      
      <div
        ref={listRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '20px',
          backgroundColor: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {messages.map((m) => (
          <div
            key={m.messageId}
            style={{
              alignSelf: m.role === 'user' ? 'flex-start' : 'flex-end',
              maxWidth: isMobile ? '90%' : '75%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: m.role === 'user' ? 'flex-start' : 'flex-end',
            }}
          >
            <span style={{ 
              fontSize: 11, 
              fontWeight: 500, 
              color: '#64748b', 
              marginBottom: 4, 
              marginLeft: m.role === 'user' ? 4 : 0,
              marginRight: m.role === 'user' ? 0 : 4
            }}>
              {m.role === 'user' ? 'User' : m.role === 'human_agent' ? 'You (Agent)' : 'AI Assistant'}
            </span>
            <div
              style={{
                padding: '12px 16px',
                borderRadius: 16,
                borderTopLeftRadius: m.role === 'user' ? 4 : 16,
                borderTopRightRadius: m.role === 'user' ? 16 : 4,
                backgroundColor: m.role === 'user' ? '#fff' : m.role === 'human_agent' ? '#2563eb' : '#e2e8f0',
                color: m.role === 'human_agent' ? '#fff' : '#1e293b',
                fontSize: 14,
                lineHeight: 1.5,
                boxShadow: m.role === 'user' ? '0 1px 2px 0 rgb(0 0 0 / 0.05)' : 'none',
                border: m.role === 'user' ? '1px solid #e2e8f0' : 'none'
              }}
            >
              <ReactMarkdown>{m.content}</ReactMarkdown>
              {m.imageUrls?.length ? (
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {m.imageUrls.map((url) => (
                    <img
                      key={url}
                      src={url}
                      alt=""
                      style={{ maxWidth: '100%', borderRadius: 8, maxHeight: 200, objectFit: 'cover' }}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: '16px 20px', background: '#fff', borderTop: '1px solid #f1f5f9' }}>
        <form onSubmit={sendReply} style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
                  e.preventDefault();
                  sendReply(e);
                }
              }}
              placeholder="Type your message..."
              rows={1}
              style={{ 
                width: '100%', 
                padding: '12px 14px', 
                border: '1px solid #e2e8f0', 
                borderRadius: 12, 
                fontSize: 15,
                resize: 'none',
                maxHeight: 120,
                outline: 'none',
                transition: 'border-color 0.2s',
                backgroundColor: '#f8fafc'
              }}
              disabled={sending}
            />
          </div>
          <button 
            type="submit" 
            disabled={sending || !reply.trim()} 
            style={{ 
              height: 44,
              padding: '0 20px', 
              background: '#2563eb', 
              color: '#fff', 
              border: 'none', 
              borderRadius: 12, 
              cursor: sending || !reply.trim() ? 'not-allowed' : 'pointer',
              fontWeight: 600,
              fontSize: 14,
              transition: 'all 0.2s',
              opacity: sending || !reply.trim() ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            {sending ? '...' : 'Send'}
          </button>
        </form>
        {error && <p style={{ color: '#ef4444', fontSize: 12, marginTop: 8, marginBottom: 0 }}>{error}</p>}
      </div>
    </div>
  );
}
