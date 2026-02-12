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
    { path: '/platform', label: 'Platform Dashboard' },
    { path: '/platform/tenants', label: 'All Tenants' },
    { path: '/platform/usage', label: 'Usage & Billing' },
  ];

  const sidebarWidth = isMobile ? 280 : 260;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', width: '100%', background: '#f8fafc' }}>
      {/* Mobile Header */}
      {isMobile && (
        <header style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 56,
          background: '#1e293b',
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          zIndex: 1001,
          justifyContent: 'space-between',
          color: '#fff'
        }}>
          <span style={{ fontWeight: 600 }}>Platform Console</span>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 24,
              cursor: 'pointer',
              color: '#fff'
            }}
          >
            {menuOpen ? '✕' : '☰'}
          </button>
        </header>
      )}

      {/* Sidebar */}
      <aside
        style={{
          width: sidebarWidth,
          background: '#0f172a',
          color: '#fff',
          position: 'fixed',
          top: 0,
          height: '100vh',
          left: isMobile ? (menuOpen ? 0 : -sidebarWidth) : 0,
          zIndex: 1000,
          transition: 'left 0.2s ease-in-out',
          display: 'flex',
          flexDirection: 'column',
          padding: '24px 16px',
          overflowY: 'auto'
        }}
      >
        <div style={{ padding: '0 12px 4px', fontWeight: 700, fontSize: 18 }}>
          CareMax
        </div>
        <div style={{ padding: '0 12px 24px', fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Platform Console
        </div>
        
        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {nav.map(({ path, label }) => {
            const active = location.pathname === path;
            return (
              <Link
                key={path}
                to={path}
                onClick={() => isMobile && setMenuOpen(false)}
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  textDecoration: 'none',
                  color: active ? '#fff' : '#94a3b8',
                  fontWeight: active ? 600 : 500,
                  background: active ? '#1e293b' : 'transparent',
                  fontSize: 14,
                  transition: 'all 0.2s'
                }}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        <div style={{ marginTop: 'auto', paddingTop: 20, borderTop: '1px solid #1e293b' }}>
          <div style={{ padding: '0 12px', marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: '#64748b' }}>Admin</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#cbd5e1', marginTop: 2, wordBreak: 'break-all' }}>{email}</div>
          </div>
          
          <Link 
            to="/" 
            style={{ 
              display: 'block',
              padding: '8px 12px',
              fontSize: 13,
              color: '#38bdf8',
              textDecoration: 'none',
              fontWeight: 500
            }} 
            onClick={() => isMobile && setMenuOpen(false)}
          >
            ← Tenant Admin
          </Link>
          
          <button
            onClick={() => auth.signOut()}
            style={{
              marginTop: 8,
              padding: '10px 12px',
              fontSize: 13,
              borderRadius: 8,
              border: '1px solid #1e293b',
              background: 'transparent',
              color: '#94a3b8',
              cursor: 'pointer',
              width: '100%',
              textAlign: 'left',
              fontWeight: 500
            }}
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* Overlay */}
      {isMobile && menuOpen && (
        <div
          onClick={() => setMenuOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.4)',
            zIndex: 999
          }}
        />
      )}

      <main style={{ 
        flex: 1, 
        padding: isMobile ? '80px 20px 40px' : '40px 60px', 
        minWidth: 0,
        marginLeft: isMobile ? 0 : sidebarWidth
      }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
