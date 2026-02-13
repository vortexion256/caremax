import { useState } from 'react';
import { useTenant } from '../TenantContext';
import { useIsMobile } from '../hooks/useIsMobile';

const WIDGET_BASE =
  (typeof import.meta.env !== 'undefined' && (import.meta.env.VITE_WIDGET_URL ?? '').trim()) ||
  (typeof window !== 'undefined' ? window.location.origin.replace(/:\d+$/, ':5173') : 'https://your-widget-url.com');

export default function Embed() {
  const { tenantId } = useTenant();
  const { isMobile } = useIsMobile();
  const snippet = `<script src="${WIDGET_BASE}/loader.js" data-tenant="${tenantId}" data-theme="light"><\/script>`;
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    window.navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div style={{ padding: isMobile ? '16px 0' : 0 }}>
      <h1 style={{ margin: '0 0 8px 0', fontSize: isMobile ? 24 : 32 }}>Embed Widget</h1>
      <p style={{ color: '#64748b', marginBottom: 32, maxWidth: 600 }}>
        Integrate the CareMax chat widget into your website by adding this small script snippet.
      </p>

      <div style={{ 
        background: '#f8fafc', 
        border: '1px solid #e2e8f0', 
        borderRadius: 12, 
        padding: 24,
        marginBottom: 32
      }}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: 16, color: '#0f172a' }}>Installation Script</h3>
        <p style={{ fontSize: 14, color: '#64748b', marginBottom: 16, lineHeight: 1.5 }}>
          Paste this script into your website's <strong>&lt;body&gt;</strong> section. 
          A chat icon will appear in the bottom-right corner.
        </p>
        
        <div style={{ position: 'relative' }}>
          <pre
            style={{
              background: '#0f172a',
              color: '#e2e8f0',
              padding: '20px',
              paddingRight: 80,
              borderRadius: 8,
              overflow: 'auto',
              fontSize: 13,
              margin: 0,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              lineHeight: 1.6
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
              padding: '6px 12px',
              borderRadius: 6,
              border: 'none',
              background: copied ? '#22c55e' : '#334155',
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        
        <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, color: '#64748b' }}>
            <span style={{ fontWeight: 600, color: '#475569' }}>Pro tip:</span> Change <code>data-theme="light"</code> to <code>"dark"</code> for dark mode.
          </div>
        </div>
      </div>

      <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 32 }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: 18, color: '#0f172a' }}>Testing & Preview</h3>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <a 
            href={`${WIDGET_BASE}/embed.html?tenant=${tenantId}&theme=light`} 
            target="_blank" 
            rel="noopener noreferrer"
            style={{
              padding: '10px 16px',
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              color: '#2563eb',
              textDecoration: 'none',
              fontSize: 14,
              fontWeight: 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            Preview Widget ↗
          </a>
          <a 
            href={`${WIDGET_BASE}/?tenant=${tenantId}`} 
            target="_blank" 
            rel="noopener noreferrer"
            style={{
              padding: '10px 16px',
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              color: '#64748b',
              textDecoration: 'none',
              fontSize: 14,
              fontWeight: 500
            }}
          >
            Dev Environment
          </a>
        </div>
      </div>
    </div>
  );
}
