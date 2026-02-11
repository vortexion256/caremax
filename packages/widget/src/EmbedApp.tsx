import React, { useState, useRef, useEffect } from 'react';
import { firestore, auth, ensureAnonymousAuth, collection, query, where, orderBy, onSnapshot, doc } from './firebase';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

type Message = {
  messageId: string;
  role: 'user' | 'assistant' | 'human_agent';
  content: string;
  imageUrls?: string[];
  createdAt: number | null;
};

type EmbedAppProps = { tenantId: string; theme: string };

type WidgetConfig = { chatTitle: string; agentName: string };

export default function EmbedApp({ tenantId, theme }: EmbedAppProps) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [humanJoined, setHumanJoined] = useState(false);
  const [images, setImages] = useState<File[]>([]);
  const [firestoreReady, setFirestoreReady] = useState(false);
  const [widgetConfig, setWidgetConfig] = useState<WidgetConfig | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo(0, listRef.current.scrollHeight);
  }, [messages, loading]);

  useEffect(() => {
    ensureAnonymousAuth().then(() => setFirestoreReady(true)).catch(() => setFirestoreReady(true));
  }, []);

  useEffect(() => {
    fetch(`${API_URL}/tenants/${tenantId}/agent-config/widget`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed to load'))))
      .then((data: WidgetConfig) => setWidgetConfig({ chatTitle: data.chatTitle ?? '', agentName: data.agentName ?? 'CareMax Assistant' }))
      .catch(() => setWidgetConfig({ chatTitle: '', agentName: 'CareMax Assistant' }));
  }, [tenantId]);

  const createConversation = async () => {
    const uid = await ensureAnonymousAuth();
    const res = await fetch(`${API_URL}/tenants/${tenantId}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: uid }),
    });
    if (!res.ok) throw new Error('Failed to create conversation');
    const data = await res.json();
    setConversationId(data.conversationId);
    setMessages([]);
    return data.conversationId;
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text && images.length === 0) return;
    setInput('');
    setImages([]);
    
    // Auto-resize textarea back to original
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    let cid = conversationId;
    if (!cid) cid = await createConversation();

    const imageUrls: string[] = [];
    for (const file of images) {
      const form = new FormData();
      form.append('file', file);
      const up = await fetch(`${API_URL}/tenants/${tenantId}/upload`, {
        method: 'POST',
        body: form,
      });
      if (up.ok) {
        const u = await up.json();
        imageUrls.push(u.url);
      }
    }

    setMessages((prev) => [
      ...prev,
      {
        messageId: `u-${Date.now()}`,
        role: 'user',
        content: text,
        imageUrls: imageUrls.length ? imageUrls : undefined,
        createdAt: Date.now(),
      },
    ]);
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/tenants/${tenantId}/conversations/${cid}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, imageUrls: imageUrls.length ? imageUrls : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (data as { details?: string; error?: string }).details ?? (data as { error?: string }).error ?? 'Send failed';
        throw new Error(msg);
      }
      if (data.assistantMessageId != null || (data.assistantContent && data.assistantContent.trim())) {
        const newMsg = {
          messageId: data.assistantMessageId ?? `temp-${Date.now()}`,
          role: 'assistant' as const,
          content: data.assistantContent ?? '',
          createdAt: Date.now(),
        };
        setMessages((prev) =>
          prev.some((m) => m.messageId === newMsg.messageId) ? prev : [...prev, newMsg]
        );
      }
      if (data.requestHandoff) setHumanJoined(true);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Sorry, something went wrong. Please try again.';
      setMessages((prev) => [
        ...prev,
        {
          messageId: `e-${Date.now()}`,
          role: 'assistant',
          content: errMsg,
          createdAt: Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!conversationId || !firestoreReady) return;
    const q = query(
      collection(firestore, 'messages'),
      where('conversationId', '==', conversationId),
      orderBy('createdAt', 'asc')
    );
    const unsubMessages = onSnapshot(q, (snap) => {
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
    });
    const unsubConv = onSnapshot(doc(firestore, 'conversations', conversationId), (snap) => {
      if (snap.exists()) setHumanJoined(snap.data()?.status === 'human_joined');
    });
    return () => {
      unsubMessages();
      unsubConv();
    };
  }, [conversationId, firestoreReady]);

  const isDark = theme === 'dark';
  const card = isDark ? '#1e1e1e' : '#ffffff';
  const text = isDark ? '#f3f4f6' : '#1f2937';
  const border = isDark ? '#374151' : '#e5e7eb';
  const secondaryText = isDark ? '#9ca3af' : '#6b7280';

  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 480;
  
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: isMobile ? '100%' : 400,
        maxHeight: '100%',
        width: '100%',
        maxWidth: isMobile ? '100%' : 400,
        margin: '0 auto',
        backgroundColor: card,
        borderRadius: isMobile ? 0 : 16,
        boxShadow: isMobile ? 'none' : '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
        overflow: 'hidden',
        color: text,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      }}
    >
      <div
        style={{
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `1px solid ${border}`,
          backgroundColor: isDark ? '#111827' : '#ffffff',
          flexShrink: 0,
          zIndex: 10,
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: isDark ? '#ffffff' : '#111827' }}>
            {widgetConfig?.chatTitle?.trim() || 'CareMax'}
          </div>
          <div style={{ fontSize: 11, color: secondaryText, marginTop: 2 }}>
            {humanJoined ? '🟢 Care team online' : '⚡ AI Assistant'}
          </div>
        </div>
      </div>

      <div
        ref={listRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          padding: '20px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          backgroundColor: isDark ? '#111827' : '#f9fafb',
        }}
      >
        {messages.length === 0 && !loading && (
          <div style={{ 
            padding: 20, 
            textAlign: 'center', 
            color: secondaryText, 
            fontSize: 14,
            backgroundColor: isDark ? '#1f2937' : '#ffffff',
            borderRadius: 12,
            border: `1px dashed ${border}`,
            margin: '20px 0'
          }}>
            👋 How can we help you today? Ask about symptoms or medical advice.
          </div>
        )}
        {messages.map((m, index) => {
          const isUser = m.role === 'user';
          return (
            <div
              key={m.messageId}
              style={{
                alignSelf: isUser ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: isUser ? 'flex-end' : 'flex-start',
              }}
            >
              {!isUser && (
                <span style={{ fontSize: 11, fontWeight: 600, color: secondaryText, marginBottom: 4, marginLeft: 4 }}>
                  {m.role === 'human_agent' ? 'Care Team' : widgetConfig?.agentName || 'AI'}
                </span>
              )}
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 18,
                  borderTopRightRadius: isUser ? 4 : 18,
                  borderTopLeftRadius: isUser ? 18 : 4,
                  backgroundColor: isUser ? '#2563eb' : (isDark ? '#374151' : '#ffffff'),
                  color: isUser ? '#ffffff' : text,
                  fontSize: 14,
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  boxShadow: isUser ? 'none' : '0 1px 2px 0 rgba(0,0,0,0.05)',
                  border: isUser ? 'none' : `1px solid ${border}`,
                }}
              >
                {m.content}
                {m.imageUrls?.length ? (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {m.imageUrls.map((url) => (
                      <img
                        key={url}
                        src={url}
                        alt=""
                        style={{ maxWidth: '100%', borderRadius: 12, maxHeight: 240, objectFit: 'cover' }}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
        {loading && (
          <div style={{ alignSelf: 'flex-start', display: 'flex', gap: 4, padding: '8px 12px' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: secondaryText, animation: 'pulse 1.5s infinite' }}></span>
            <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: secondaryText, animation: 'pulse 1.5s infinite 0.2s' }}></span>
            <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: secondaryText, animation: 'pulse 1.5s infinite 0.4s' }}></span>
          </div>
        )}
      </div>

      <div
        className="caremax-input-area"
        style={{
          padding: '12px 16px 24px',
          borderTop: `1px solid ${border}`,
          backgroundColor: card,
          flexShrink: 0,
        }}
      >
        {images.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {images.map((f, i) => (
              <div
                key={i}
                style={{
                  position: 'relative',
                  width: 50,
                  height: 50,
                  borderRadius: 8,
                  overflow: 'hidden',
                  border: `1px solid ${border}`
                }}
              >
                <div style={{ width: '100%', height: '100%', background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>IMG</div>
                <button
                  type="button"
                  onClick={() => setImages((p) => p.filter((_, j) => j !== i))}
                  style={{ 
                    position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: '50%', 
                    background: 'rgba(0,0,0,0.5)', color: '#fff', border: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        
        <div style={{ 
          display: 'flex', 
          gap: 8, 
          alignItems: 'flex-end',
          backgroundColor: isDark ? '#374151' : '#f3f4f6',
          borderRadius: 24,
          padding: '4px 4px 4px 12px',
          border: `1px solid ${border}`
        }}>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setImages((p) => [...p, ...Array.from(e.target.files ?? [])])}
            style={{ display: 'none' }}
            id="caremax-file"
          />
          <label
            htmlFor="caremax-file"
            style={{
              padding: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: secondaryText,
              transition: 'color 0.2s'
            }}
            title="Attach images"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
            </svg>
          </label>
          
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Type a message..."
            rows={1}
            style={{
              flex: 1,
              padding: '10px 0',
              border: 'none',
              background: 'transparent',
              color: text,
              fontSize: 15,
              outline: 'none',
              resize: 'none',
              maxHeight: 120,
              fontFamily: 'inherit'
            }}
          />
          
          <button
            type="button"
            onClick={sendMessage}
            disabled={loading || (!input.trim() && images.length === 0)}
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: (loading || (!input.trim() && images.length === 0)) ? 'transparent' : '#2563eb',
              color: (loading || (!input.trim() && images.length === 0)) ? secondaryText : '#ffffff',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s',
              flexShrink: 0,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        .caremax-input-area textarea::-webkit-scrollbar {
          width: 4px;
        }
        .caremax-input-area textarea::-webkit-scrollbar-thumb {
          background-color: ${border};
          border-radius: 4px;
        }
      `}</style>
    </div>
  );
}
