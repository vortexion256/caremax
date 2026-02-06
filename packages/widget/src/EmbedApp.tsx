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

export default function EmbedApp({ tenantId, theme }: EmbedAppProps) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [humanJoined, setHumanJoined] = useState(false);
  const [images, setImages] = useState<File[]>([]);
  const [firestoreReady, setFirestoreReady] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo(0, listRef.current.scrollHeight);
  }, [messages, loading]);

  useEffect(() => {
    ensureAnonymousAuth().then(() => setFirestoreReady(true)).catch(() => setFirestoreReady(true));
  }, []);

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
  const bg = isDark ? '#1a1a1a' : '#f5f5f5';
  const card = isDark ? '#2d2d2d' : '#fff';
  const text = isDark ? '#e0e0e0' : '#111';
  const border = isDark ? '#444' : '#ddd';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 400,
        maxHeight: '80vh',
        width: 360,
        maxWidth: '100%',
        backgroundColor: card,
        borderRadius: 12,
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        overflow: 'hidden',
        color: text,
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${border}`,
          backgroundColor: isDark ? '#252525' : '#fafafa',
          fontWeight: 600,
        }}
      >
        CareMax
        {humanJoined && (
          <span style={{ marginLeft: 8, fontSize: 12, color: '#0a7c42', fontWeight: 500 }}>
            Care team joined
          </span>
        )}
      </div>
      <div
        ref={listRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {messages.length === 0 && !loading && (
          <div style={{ color: text, opacity: 0.8, fontSize: 14 }}>
            Describe your symptoms or ask a question. You can attach images if needed.
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.messageId}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              padding: '8px 12px',
              borderRadius: 12,
              backgroundColor:
                m.role === 'user'
                  ? '#0d47a1'
                  : m.role === 'human_agent'
                    ? '#1b5e20'
                    : isDark
                      ? '#3d3d3d'
                      : '#e8e8e8',
              color: m.role === 'user' ? '#fff' : text,
              fontSize: 14,
              whiteSpace: 'pre-wrap',
            }}
          >
            {m.role === 'human_agent' && (
              <span style={{ fontSize: 11, opacity: 0.9, display: 'block', marginBottom: 4 }}>
                Care team
              </span>
            )}
            {m.content}
            {m.imageUrls?.length ? (
              <div style={{ marginTop: 8 }}>
                {m.imageUrls.map((url) => (
                  <img
                    key={url}
                    src={url}
                    alt=""
                    style={{ maxWidth: '100%', borderRadius: 8, maxHeight: 120 }}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf: 'flex-start', padding: '8px 12px', color: text, fontSize: 14 }}>
            ...
          </div>
        )}
      </div>
      <div style={{ padding: 12, borderTop: `1px solid ${border}` }}>
        {images.length > 0 && (
          <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
            {images.map((f, i) => (
              <span
                key={i}
                style={{
                  fontSize: 12,
                  padding: '4px 8px',
                  background: border,
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {f.name}
                <button
                  type="button"
                  onClick={() => setImages((p) => p.filter((_, j) => j !== i))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
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
              padding: '8px 12px',
              background: border,
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            Image
          </label>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="Type your message..."
            style={{
              flex: 1,
              padding: '10px 12px',
              border: `1px solid ${border}`,
              borderRadius: 8,
              fontSize: 14,
              background: isDark ? '#2d2d2d' : '#fff',
              color: text,
            }}
          />
          <button
            type="button"
            onClick={sendMessage}
            disabled={loading}
            style={{
              padding: '10px 16px',
              background: '#0d47a1',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 600,
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
