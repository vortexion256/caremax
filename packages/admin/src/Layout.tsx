import { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useTenant } from './TenantContext';
import { auth } from './firebase';
import { useIsMobile } from './hooks/useIsMobile';

export default function Layout() {
  const location = useLocation();
  const { tenantId, isPlatformAdmin } = useTenant();
  const { isMobile } = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);

  const nav = [
    { path: '/', label: 'Dashboard' },
    { path: '/agent', label: 'Agent Settings' },
    { path: '/advanced-prompts', label: 'Advanced Prompts' },
    { path: '/conversations', label: 'Conversations' },
    { path: '/handoffs', label: 'Handoff Queue' },
    { path: '/agent-notes', label: 'Notes' },
    { path: '/rag', label: 'Knowledge Base' },
    { path: '/agent-brain', label: 'Auto Brain' },
    { path: '/integrations', label: 'Integrations' },
    { path: '/embed', label: 'Embed Widget' },
  ];

  const sidebarWidth = isMobile ? 280 : 240;

  return (
    <div className={menuOpen ? 'mobile-menu-open' : ''} style={{ display: 'flex', minHeight: '100vh', width: '100%', background: '#f8fafc' }}>
      {/* Mobile Header */}
      {isMobile && (
        <header style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 56,
          background: '#fff',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          zIndex: 1001,
          justifyContent: 'space-between'
        }}>
          <span style={{ fontWeight: 600, color: '#0f172a' }}>CareMax</span>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 24,
              cursor: 'pointer',
              padding: 4,
              color: '#475569'
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
          borderRight: '1px solid #e2e8f0',
          background: '#f8fafc',
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
        {!isMobile && (
          <div style={{ padding: '0 12px 24px', fontWeight: 700, fontSize: 20, color: '#2563eb' }}>
            CareMax
          </div>
        )}
        
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
                  color: active ? '#2563eb' : '#475569',
                  fontWeight: active ? 600 : 500,
                  background: active ? '#eff6ff' : 'transparent',
                  fontSize: 14,
                  transition: 'all 0.2s'
                }}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="logout-container" style={{ marginTop: 'auto', paddingTop: 20, borderTop: '1px solid #e2e8f0' }}>
          <div style={{ padding: '0 12px', marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tenant</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#475569', marginTop: 2 }}>{tenantId}</div>
          </div>
          
          {isPlatformAdmin && (
            <Link 
              to="/platform" 
              style={{ 
                display: 'block',
                padding: '8px 12px',
                fontSize: 13,
                color: '#2563eb',
                textDecoration: 'none',
                fontWeight: 500
              }} 
              onClick={() => isMobile && setMenuOpen(false)}
            >
              Platform Console
            </Link>
          )}
          
          <button
            onClick={() => auth.signOut()}
            style={{
              marginTop: 8,
              padding: '10px 12px',
              fontSize: 13,
              borderRadius: 8,
              border: '1px solid #e2e8f0',
              background: '#fff',
              color: '#64748b',
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
            background: 'rgba(15, 23, 42, 0.3)',
            backdropFilter: 'blur(2px)',
            zIndex: 999
          }}
        />
      )}

      <main style={{ 
        flex: 1, 
        padding: isMobile ? '80px 20px 40px' : '40px 60px', 
        minWidth: 0,
        marginLeft: isMobile ? 0 : sidebarWidth,
        background: 'transparent'
      }}>
        <div style={{ 
          maxWidth: 1000, 
          margin: '0 auto',
          background: '#fff',
          padding: isMobile ? '0' : '40px',
          borderRadius: isMobile ? '0' : '16px',
          boxShadow: isMobile ? 'none' : '0 4px 24px rgba(0, 0, 0, 0.05)',
          minHeight: isMobile ? 'auto' : 'calc(100vh - 80px)'
        }}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
