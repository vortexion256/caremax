import { useState, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
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

export default function Layout() {
  const location = useLocation();
  const { tenantId, isPlatformAdmin } = useTenant();
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);

  const nav = [
    { path: '/', label: 'Dashboard' },
    { path: '/agent', label: 'Agent settings' },
    { path: '/advanced-prompts', label: 'Advanced Prompts' },
    { path: '/conversations', label: 'All conversations' },
    { path: '/handoffs', label: 'Handoff queue' },
    { path: '/agent-notes', label: 'Notes' },
    { path: '/rag', label: 'RAG documents' },
    { path: '/agent-brain', label: 'Auto Agent Brain' },
    { path: '/integrations', label: 'Integrations' },
    { path: '/embed', label: 'Embed' },
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
          width: isMobile ? 280 : 220,
          borderRight: '1px solid #e0e0e0',
          padding: 24,
          background: '#fafafa',
          position: isMobile ? 'fixed' : 'relative',
          top: 0,
          left: isMobile ? (menuOpen ? 0 : -280) : 0,
          bottom: 0,
          zIndex: 1000,
          transition: 'left 0.3s ease',
          overflowY: 'auto'
        }}
      >
        <h2 style={{ margin: '0 0 24px 0', fontSize: 18 }}>CareMax Admin</h2>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {nav.map(({ path, label }) => (
            <Link
              key={path}
              to={path}
              onClick={() => isMobile && setMenuOpen(false)}
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
            <Link to="/platform" style={{ color: '#0d47a1', textDecoration: 'none' }} onClick={() => isMobile && setMenuOpen(false)}>
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
            width: '100%'
          }}
        >
          Logout
        </button>
      </aside>
      <main style={{ flex: 1, padding: isMobile ? '60px 16px 24px' : 24, width: '100%', minWidth: 0 }}>
        <Outlet />
      </main>
    </div>
  );
}
