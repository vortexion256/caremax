import { useTenant } from '../TenantContext';

const WIDGET_BASE = typeof window !== 'undefined' ? window.location.origin.replace(/:\d+$/, ':5173') : 'https://your-widget-url.com';

export default function Embed() {
  const { tenantId } = useTenant();
  const snippet = `<script src="${WIDGET_BASE}/loader.js" data-tenant="${tenantId}" data-theme="light"><\/script>`;

  return (
    <div>
      <h1 style={{ margin: '0 0 16px 0' }}>Embed</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>
        Add this script to your website to show the CareMax chat widget. Replace the widget URL and tenant ID for production.
      </p>
      <pre
        style={{
          background: '#f5f5f5',
          padding: 16,
          borderRadius: 8,
          overflow: 'auto',
          fontSize: 14,
        }}
      >
        {snippet}
      </pre>
      <p style={{ fontSize: 14, color: '#666' }}>
        Optional: <code>data-theme="dark"</code> for dark mode.
      </p>
      <p style={{ fontSize: 14, color: '#666', marginTop: 16 }}>
        <strong>Test your agent:</strong>{' '}
        <a href={`${WIDGET_BASE}/embed.html?tenant=${tenantId}&theme=light`} target="_blank" rel="noopener noreferrer">
          Open widget (embed)
        </a>
        {' · '}
        <a href={`${WIDGET_BASE}/?tenant=${tenantId}`} target="_blank" rel="noopener noreferrer">
          Open dev widget with your tenant ({tenantId})
        </a>
        . Use one of these links so the agent uses your name and handoffs appear in the queue.
      </p>
    </div>
  );
}
