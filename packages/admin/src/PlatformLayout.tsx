import { useState, useEffect } from 'react';
import { Outlet, Link, useLocation, Navigate } from 'react-router-dom';
import { useTenant } from './TenantContext';
import { auth } from './firebase';

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  return isMobile;
}

export default function PlatformLayout() {
  const location = useLocation();
  const { isPlatformAdmin, email } = useTenant();
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);

  if (!isPlatformAdmin) {
    return <Navigate to="/" replace />;
  }

  const nav = [
    { path: '/platform', label: 'Platform dashboard' },
    { path: '/platform/tenants', label: 'All tenants' },
    { path: '/platform/usage', label: 'Usage & Billing' },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', position: 'relative' }}>
      {/* Mobile menu button */}
      {isMobile && (
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          style={{
            position: 'fixed',
            top: 16,
            left: 16,
            zIndex: 1001,
            padding: '8px 12px',
            background: '#0d47a1',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
          }}
          aria-label="Toggle menu"
        >
          {menuOpen ? '✕' : '☰'}
        </button>
      )}

      {/* Overlay for mobile */}
      {isMobile && menuOpen && (
        <div
          onClick={() => setMenuOpen(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 999
          }}
        />
      )}

      {/* Sidebar */}
      <aside
        style={{
          width: isMobile ? 280 : 260,
          borderRight: '1px solid #e0e0e0',
          padding: 24,
          background: '#0d47a1',
          color: '#fff',
          position: isMobile ? 'fixed' : 'relative',
          top: 0,
          left: isMobile ? (menuOpen ? 0 : -280) : 0,
          bottom: 0,
          zIndex: 1000,
          transition: 'left 0.3s ease',
          overflowY: 'auto'
        }}
      >
        <h2 style={{ margin: '0 0 8px 0', fontSize: isMobile ? 18 : 20 }}>CareMax Platform</h2>
        <p style={{ margin: '0 0 16px 0', fontSize: 12, opacity: 0.9 }}>SaaS owner console</p>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
          {nav.map(({ path, label }) => {
            const active = location.pathname === path;
            return (
              <Link
                key={path}
                to={path}
                onClick={() => isMobile && setMenuOpen(false)}
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
            width: '100%'
          }}
        >
          Logout
        </button>
        <div style={{ marginTop: 16, fontSize: 11 }}>
          <Link to="/" style={{ color: '#bbdefb', textDecoration: 'none' }} onClick={() => isMobile && setMenuOpen(false)}>
            ← Go to tenant admin
          </Link>
        </div>
      </aside>
      <main style={{ flex: 1, padding: isMobile ? '60px 16px 24px' : 24, background: '#fafafa', width: '100%', minWidth: 0 }}>
        <Outlet />
      </main>
    </div>
  );
}

