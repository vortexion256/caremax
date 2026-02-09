import { useState } from 'react';
import { useTenant } from '../TenantContext';

// In production set VITE_WIDGET_URL (e.g. https://caremax-widget.vercel.app). In dev, defaults to same host with port 5173.
const WIDGET_BASE =
  (typeof import.meta.env !== 'undefined' && (import.meta.env.VITE_WIDGET_URL ?? '').trim()) ||
  (typeof window !== 'undefined' ? window.location.origin.replace(/:\d+$/, ':5173') : 'https://your-widget-url.com');

export default function Embed() {
  const { tenantId } = useTenant();
  const snippet = `<script src="${WIDGET_BASE}/loader.js" data-tenant="${tenantId}" data-theme="light"><\/script>`;
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    window.navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div>
      <h1 style={{ margin: '0 0 16px 0' }}>Embed</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>
        Paste this script into your website’s <strong>&lt;body&gt;</strong> (or just before <strong>&lt;/body&gt;</strong>).
        It will show a <strong>chat icon in the bottom-right corner</strong>; when visitors tap it, the chat widget opens.
      </p>
      <div style={{ position: 'relative' }}>
        <pre
          style={{
            background: '#f5f5f5',
            padding: 16,
            paddingRight: 100,
            borderRadius: 8,
            overflow: 'auto',
            fontSize: 14,
            margin: 0,
          }}
        >
          {snippet}
        </pre>
        <button
          type="button"
          onClick={handleCopy}
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            padding: '8px 14px',
            borderRadius: 6,
            border: '1px solid #1976d2',
            background: copied ? '#e8f5e9' : '#fff',
            color: copied ? '#2e7d32' : '#1976d2',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <p style={{ fontSize: 14, color: '#666', marginTop: 12 }}>
        Optional: <code>data-theme="dark"</code> for dark mode.
      </p>
      <p style={{ fontSize: 14, color: '#666', marginTop: 16 }}>
        <strong>Test:</strong>{' '}
        <a href={`${WIDGET_BASE}/embed.html?tenant=${tenantId}&theme=light`} target="_blank" rel="noopener noreferrer">
          Open widget in new tab
        </a>
        {' · '}
        <a href={`${WIDGET_BASE}/?tenant=${tenantId}`} target="_blank" rel="noopener noreferrer">
          Dev widget ({tenantId})
        </a>
      </p>
    </div>
  );
}
