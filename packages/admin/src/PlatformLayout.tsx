import { Outlet, Link, useLocation, Navigate } from 'react-router-dom';
import { useTenant } from './TenantContext';
import { auth } from './firebase';

export default function PlatformLayout() {
  const location = useLocation();
  const { isPlatformAdmin, email } = useTenant();

  if (!isPlatformAdmin) {
    return <Navigate to="/" replace />;
  }

  const nav = [
    { path: '/platform', label: 'Platform dashboard' },
    { path: '/platform/tenants', label: 'All tenants' },
    { path: '/platform/usage', label: 'Usage & Billing' },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside
        style={{
          width: 260,
          borderRight: '1px solid #e0e0e0',
          padding: 24,
          background: '#0d47a1',
          color: '#fff',
        }}
      >
        <h2 style={{ margin: '0 0 8px 0', fontSize: 20 }}>CareMax Platform</h2>
        <p style={{ margin: '0 0 16px 0', fontSize: 12, opacity: 0.9 }}>SaaS owner console</p>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
          {nav.map(({ path, label }) => {
            const active = location.pathname === path;
            return (
              <Link
                key={path}
                to={path}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  textDecoration: 'none',
                  color: active ? '#0d47a1' : '#fff',
                  fontWeight: active ? 600 : 400,
                  background: active ? '#e3f2fd' : 'rgba(255,255,255,0.06)',
                }}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        <div style={{ fontSize: 11, opacity: 0.9 }}>
          <div>Signed in as:</div>
          <div style={{ fontWeight: 500 }}>{email ?? 'Platform admin'}</div>
        </div>
        <button
          type="button"
          onClick={() => auth.signOut().catch(() => {})}
          style={{
            marginTop: 16,
            padding: '6px 10px',
            fontSize: 12,
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.4)',
            background: 'transparent',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          Logout
        </button>
        <div style={{ marginTop: 16, fontSize: 11 }}>
          <Link to="/" style={{ color: '#bbdefb', textDecoration: 'none' }}>
            ← Go to tenant admin
          </Link>
        </div>
      </aside>
      <main style={{ flex: 1, padding: 24, background: '#fafafa' }}>
        <Outlet />
      </main>
    </div>
  );
}

