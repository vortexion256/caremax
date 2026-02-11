import { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useTenant } from './TenantContext';
import { auth } from './firebase';
import { useIsMobile } from './hooks/useIsMobile';

export default function Layout() {
  const location = useLocation();
  const { tenantId, isPlatformAdmin } = useTenant();
  const { isMobile, isVerySmall } = useIsMobile();
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
    <div style={{ display: 'flex', minHeight: '100vh', position: 'relative', width: '100%', overflowX: 'hidden' }}>
      {/* Mobile menu button - hamburger icon when closed */}
      {isMobile && !menuOpen && (
        <button
          onClick={() => setMenuOpen(true)}
          style={{
            position: 'fixed',
            top: isVerySmall ? 8 : 16,
            left: isVerySmall ? 8 : 16,
            zIndex: 1001,
            padding: isVerySmall ? '6px 10px' : '8px 12px',
            background: '#0d47a1',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: isVerySmall ? 18 : 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            minWidth: isVerySmall ? 36 : 44,
            minHeight: isVerySmall ? 36 : 44
          }}
          aria-label="Open menu"
        >
          ☰
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
          width: isVerySmall ? '100vw' : isMobile ? 280 : 220,
          borderRight: '1px solid #e0e0e0',
          padding: isVerySmall ? 12 : isMobile ? 16 : 24,
          background: '#fafafa',
          position: isMobile ? 'fixed' : 'relative',
          top: 0,
          left: isMobile ? (menuOpen ? 0 : (isVerySmall ? '-100vw' : -280)) : 0,
          bottom: 0,
          zIndex: 1000,
          transition: 'left 0.3s ease',
          overflowY: 'auto',
          overflowX: 'hidden',
          flexShrink: 0,
          maxWidth: '100vw'
        }}
      >
        {/* Mobile close button - positioned on the right */}
        {isMobile && menuOpen && (
          <button
            onClick={() => setMenuOpen(false)}
            style={{
              position: 'absolute',
              top: isVerySmall ? 8 : 16,
              right: isVerySmall ? 8 : 16,
              zIndex: 1002,
              padding: isVerySmall ? '6px 10px' : '8px 12px',
              background: '#0d47a1',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: isVerySmall ? 18 : 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
              minWidth: isVerySmall ? 36 : 44,
              minHeight: isVerySmall ? 36 : 44
            }}
            aria-label="Close menu"
          >
            ✕
          </button>
        )}
        <h2 style={{ margin: '0 0 20px 0', fontSize: isVerySmall ? 14 : isMobile ? 16 : 18, wordBreak: 'break-word', paddingRight: isMobile && menuOpen ? (isVerySmall ? 50 : 60) : 0 }}>CareMax Admin</h2>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {nav.map(({ path, label }) => (
            <Link
              key={path}
              to={path}
              onClick={() => isMobile && setMenuOpen(false)}
              style={{
                padding: isVerySmall ? '5px 8px' : isMobile ? '6px 10px' : '8px 12px',
                borderRadius: 8,
                textDecoration: 'none',
                color: location.pathname === path ? '#0d47a1' : '#333',
                fontWeight: location.pathname === path ? 600 : 400,
                background: location.pathname === path ? '#e3f2fd' : 'transparent',
                fontSize: isVerySmall ? 12 : isMobile ? 13 : 14,
                wordWrap: 'break-word',
                overflowWrap: 'break-word',
                whiteSpace: 'normal',
                lineHeight: 1.4
              }}
            >
              {label}
            </Link>
          ))}
        </nav>
        <p style={{ marginTop: 20, fontSize: isVerySmall ? 10 : 11, color: '#666', wordBreak: 'break-word', overflowWrap: 'break-word' }}>
          Tenant: {tenantId}
          {isPlatformAdmin && ' · Platform admin'}
        </p>
        {isPlatformAdmin && (
          <p style={{ marginTop: 4, fontSize: isVerySmall ? 10 : 11, wordBreak: 'break-word' }}>
            <Link 
              to="/platform" 
              style={{ color: '#0d47a1', textDecoration: 'none', wordBreak: 'break-word', overflowWrap: 'break-word' }} 
              onClick={() => isMobile && setMenuOpen(false)}
            >
              Open platform console
            </Link>
          </p>
        )}
        <button
          type="button"
          onClick={() => auth.signOut().catch(() => {})}
          style={{
            marginTop: 12,
            padding: isVerySmall ? '5px 8px' : '6px 10px',
            fontSize: isVerySmall ? 11 : 12,
            borderRadius: 6,
            border: '1px solid #ddd',
            background: '#fff',
            cursor: 'pointer',
            width: '100%',
            wordBreak: 'break-word'
          }}
        >
          Logout
        </button>
      </aside>
      <main style={{ 
        flex: 1, 
        padding: isVerySmall ? '50px 8px 16px' : isMobile ? '60px 12px 24px' : 24, 
        width: '100%', 
        minWidth: 0,
        maxWidth: '100%',
        overflowX: 'hidden'
      }}>
        <Outlet />
      </main>
    </div>
  );
}
