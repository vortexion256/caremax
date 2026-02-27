import EmbedApp from './EmbedApp';

function getTenantFromUrl(): string {
  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  return params.get('tenant')?.trim() || 'demo';
}

export default function App() {
  const tenantId = getTenantFromUrl();

  return (
    <div style={{ padding: 24 }}>
      <h1>CareMax Widget (dev)</h1>
      <p style={{ fontSize: 14, color: '#666', marginBottom: 16 }}>
        Using tenant: <strong>{tenantId}</strong>. Agent name and handoff queue use this tenant. To see handoffs in Admin, open the widget with your tenant ID, e.g.{' '}
        <a href="/?tenant=YOUR_TENANT_ID">/?tenant=YOUR_TENANT_ID</a> (get it from Admin → Embed).
      </p>
      <EmbedApp tenantId={tenantId} theme="light" debugMode />
    </div>
  );
}
