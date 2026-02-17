import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
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

type WidgetConfig = { chatTitle: string; agentName: string; welcomeText: string; suggestedQuestions: string[]; widgetColor: string };

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
      .then((data: WidgetConfig) => setWidgetConfig({ 
        chatTitle: data.chatTitle ?? '', 
        agentName: data.agentName ?? 'CareMax Assistant',
        welcomeText: data.welcomeText ?? 'Hello, how can I be of service?',
        suggestedQuestions: data.suggestedQuestions ?? [],
        widgetColor: data.widgetColor ?? '#2563eb'
      }))
      .catch(() => setWidgetConfig({ 
        chatTitle: '', 
        agentName: 'CareMax Assistant',
        welcomeText: 'Hello, how can I be of service?',
        suggestedQuestions: [],
        widgetColor: '#2563eb'
      }));
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
    if (!text) return;
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
  const primaryColor = widgetConfig?.widgetColor || '#2563eb';

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
            {humanJoined ? '🟢 Care team online' : '⚡ Online'}
          </div>
        </div>
      </div>

      <div
        ref={listRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          padding: '16px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          backgroundColor: isDark ? '#111827' : '#f9fafb',
        }}
      >
        {messages.length === 0 && !loading && (
          <div
            style={{
              alignSelf: 'flex-start',
              maxWidth: '85%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 600, color: secondaryText, marginBottom: 4, marginLeft: 4 }}>
              {widgetConfig?.agentName || 'AI'}
            </span>
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 12,
                borderTopRightRadius: 12,
                borderTopLeftRadius: 4,
                backgroundColor: isDark ? '#374151' : '#ffffff',
                color: text,
                fontSize: 14,
                lineHeight: 1.5,
                boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)',
                border: `1px solid ${border}`,
              }}
            >
              <div className="caremax-markdown"><ReactMarkdown>{widgetConfig?.welcomeText || 'Hello, how can I be of service?'}</ReactMarkdown></div>
            </div>
          </div>
        )}
        {messages.length === 0 && !loading && (widgetConfig?.suggestedQuestions?.length ?? 0) > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {widgetConfig?.suggestedQuestions.map((q, i) => (
              <button
                key={i}
                onClick={() => {
                  setInput(q);
                  // Trigger send next tick to allow state update if needed, 
                  // or just call sendMessage with q
                  const inputEv = { target: { value: q, style: { height: 'auto' } } } as any;
                  setInput(q);
                  setTimeout(() => {
                    const btn = document.querySelector('button[data-send-btn]') as HTMLButtonElement;
                    btn?.click();
                  }, 0);
                }}
                style={{
                  padding: '10px 14px',
                  borderRadius: 18,
                  backgroundColor: isDark ? '#1f2937' : '#ffffff',
                  color: primaryColor,
                  border: `1px solid ${border}`,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s',
                  width: 'fit-content',
                  maxWidth: '100%',
                }}
              >
                {q}
              </button>
            ))}
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
                  padding: '8px 12px',
                  borderRadius: 12,
                  borderTopRightRadius: isUser ? 4 : 12,
                  borderTopLeftRadius: isUser ? 12 : 4,
                  backgroundColor: isUser ? primaryColor : (isDark ? '#374151' : '#ffffff'),
                  color: isUser ? '#ffffff' : text,
                  fontSize: 14,
                  lineHeight: 1.5,
                  boxShadow: isUser ? 'none' : '0 1px 2px 0 rgba(0,0,0,0.05)',
                  border: isUser ? 'none' : `1px solid ${border}`,
                }}
              >
                <div className="caremax-markdown"><ReactMarkdown>{m.content}</ReactMarkdown></div>
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
            <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: secondaryText, animation: 'pulse 1.5s infinite', animationDelay: '0.2s' }}></span>
            <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: secondaryText, animation: 'pulse 1.5s infinite', animationDelay: '0.4s' }}></span>
          </div>
        )}
      </div>

      <div
        ref={inputContainerRef}
        style={{
          padding: '16px 12px',
          borderTop: `1px solid ${border}`,
          backgroundColor: isDark ? '#111827' : '#ffffff',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <textarea
              ref={inputRef}
              rows={1}
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
              placeholder="Type your message..."
              style={{
                width: '100%',
                padding: '10px 14px',
                paddingRight: 40,
                borderRadius: 20,
                border: `1px solid ${border}`,
                backgroundColor: isDark ? '#1f2937' : '#f9fafb',
                color: text,
                fontSize: 14,
                outline: 'none',
                resize: 'none',
                maxHeight: 120,
                lineHeight: 1.5,
              }}
            />
            {/* Image upload temporarily removed */}
          </div>
          <button
            data-send-btn
            onClick={sendMessage}
            disabled={!input.trim()}
            style={{
              padding: '10px',
              borderRadius: '50%',
              backgroundColor: primaryColor,
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 0.2s',
              opacity: !input.trim() ? 0.5 : 1,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
        {images.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {images.map((f, i) => (
              <div key={i} style={{ position: 'relative' }}>
                <img
                  src={URL.createObjectURL(f)}
                  alt=""
                  style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', border: `1px solid ${border}` }}
                />
                <button
                  onClick={() => setImages(images.filter((_, idx) => idx !== i))}
                  style={{
                    position: 'absolute',
                    top: -6,
                    right: -6,
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    backgroundColor: '#ef4444',
                    color: '#ffffff',
                    border: 'none',
                    fontSize: 10,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <style>{`
        @keyframes pulse {
          0% { opacity: 0.4; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
          100% { opacity: 0.4; transform: scale(0.8); }
        }
        .caremax-markdown p {
          margin: 0 !important;
          padding: 0 !important;
        }
        .caremax-markdown p + p {
          margin-top: 8px !important;
        }
      `}</style>
    </div>
  );
}
