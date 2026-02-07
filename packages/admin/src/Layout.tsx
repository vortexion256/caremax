import { Outlet, Link, useLocation } from 'react-router-dom';
import { useTenant } from './TenantContext';
import { auth } from './firebase';

export default function Layout() {
  const location = useLocation();
  const { tenantId, isPlatformAdmin } = useTenant();

  const nav = [
    { path: '/', label: 'Dashboard' },
    { path: '/agent', label: 'Agent settings' },
    { path: '/conversations', label: 'All conversations' },
    { path: '/handoffs', label: 'Handoff queue' },
    { path: '/rag', label: 'RAG documents' },
    { path: '/agent-brain', label: 'Auto Agent Brain' },
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
        <p style={{ marginTop: 24, fontSize: 12, color: '#666' }}>
          Tenant: {tenantId}
          {isPlatformAdmin && ' · Platform admin'}
        </p>
        {isPlatformAdmin && (
          <p style={{ marginTop: 4, fontSize: 12 }}>
            <Link to="/platform" style={{ color: '#0d47a1', textDecoration: 'none' }}>
              Open platform console
            </Link>
          </p>
        )}
        <button
          type="button"
          onClick={() => auth.signOut().catch(() => {})}
          style={{
            marginTop: 12,
            padding: '6px 10px',
            fontSize: 12,
            borderRadius: 6,
            border: '1px solid #ddd',
            background: '#fff',
            cursor: 'pointer',
          }}
        >
          Logout
        </button>
      </aside>
      <main style={{ flex: 1, padding: 24 }}>
        <Outlet />
      </main>
    </div>
  );
}
