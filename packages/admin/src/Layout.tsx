import { Outlet, Link, useLocation } from 'react-router-dom';
import { useTenant } from './TenantContext';

export default function Layout() {
  const location = useLocation();
  const { tenantId } = useTenant();

  const nav = [
    { path: '/', label: 'Dashboard' },
    { path: '/agent', label: 'Agent settings' },
    { path: '/conversations', label: 'All conversations' },
    { path: '/handoffs', label: 'Handoff queue' },
    { path: '/rag', label: 'RAG documents' },
    { path: '/embed', label: 'Embed' },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside
        style={{
          width: 220,
          borderRight: '1px solid #e0e0e0',
          padding: 24,
          background: '#fafafa',
        }}
      >
        <h2 style={{ margin: '0 0 24px 0', fontSize: 18 }}>CareMax Admin</h2>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {nav.map(({ path, label }) => (
            <Link
              key={path}
              to={path}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                textDecoration: 'none',
                color: location.pathname === path ? '#0d47a1' : '#333',
                fontWeight: location.pathname === path ? 600 : 400,
                background: location.pathname === path ? '#e3f2fd' : 'transparent',
              }}
            >
              {label}
            </Link>
          ))}
        </nav>
        <p style={{ marginTop: 24, fontSize: 12, color: '#666' }}>Tenant: {tenantId}</p>
      </aside>
      <main style={{ flex: 1, padding: 24 }}>
        <Outlet />
      </main>
    </div>
  );
}
