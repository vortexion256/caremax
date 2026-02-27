import { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useTenant } from './TenantContext';
import { auth } from './firebase';
import { useIsMobile } from './hooks/useIsMobile';

type NavItem = { path: string; label: string };
type NavGroup = { key: string; label: string; items: NavItem[] };

export default function Layout() {
  const location = useLocation();
  const { tenantId, isPlatformAdmin } = useTenant();
  const { isMobile } = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);

  const primaryNav: NavItem[] = [
    { path: '/', label: 'Dashboard' },
    { path: '/visual-diagram', label: 'Visual Diagram' },
    { path: '/conversations', label: 'Conversations' },
    { path: '/handoffs', label: 'Handoff Queue' },
  ];

  const navGroups: NavGroup[] = [
    {
      key: 'agent',
      label: 'Agent Config',
      items: [
        { path: '/agent', label: 'Agent Settings' },
        { path: '/agent-notes', label: 'Agent Notebook' },
        { path: '/rag', label: 'Knowledge Base' },
        { path: '/agent-brain', label: 'Auto Brain' },
        { path: '/integrations', label: 'Integrations' },
        { path: '/whatsapp', label: 'WhatsApp Agent' },
        { path: '/embed', label: 'Embed Widget' },
        ...(isPlatformAdmin ? [{ path: '/advanced-prompts', label: 'Advanced Prompts' }] : []),
      ],
    },
    {
      key: 'account',
      label: 'Account',
      items: [
        { path: '/account', label: 'Account Settings' },
        { path: '/billing', label: 'Billing' },
      ],
    },
  ];

  const initialExpandedState = navGroups.reduce<Record<string, boolean>>((acc, group) => {
    acc[group.key] = group.items.some((item) => location.pathname === item.path);
    return acc;
  }, {});

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(initialExpandedState);

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };

  const sidebarWidth = isMobile ? 304 : 272;

  const renderNavLink = ({ path, label }: NavItem, isSubItem = false) => {
    const active = location.pathname === path;
    return (
      <Link
        key={path}
        to={path}
        onClick={() => isMobile && setMenuOpen(false)}
        style={{
          padding: isSubItem ? '9px 12px 9px 14px' : '11px 12px',
          borderRadius: 10,
          textDecoration: 'none',
          color: active ? '#1d4ed8' : '#334155',
          fontWeight: active ? 700 : 500,
          background: active ? '#dbeafe' : 'transparent',
          fontSize: isSubItem ? 13 : 14,
          border: active ? '1px solid #bfdbfe' : '1px solid transparent',
          boxShadow: active ? '0 1px 2px rgba(37, 99, 235, 0.12)' : 'none'
        }}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className={menuOpen ? 'mobile-menu-open' : ''} style={{ display: 'flex', minHeight: '100vh', width: '100%', background: '#f1f5f9' }}>
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
          <span style={{ fontWeight: 700, color: '#0f172a', letterSpacing: '-0.01em' }}>CareMax</span>
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
          padding: isMobile ? '16px 14px 18px' : '24px 16px',
          overflowY: 'auto'
        }}
      >
        {!isMobile && (
          <div style={{ padding: '0 8px 20px' }}>
            <div style={{
              borderRadius: 14,
              padding: '12px 14px',
              background: 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 45%, #3b82f6 100%)',
              color: '#fff',
              boxShadow: '0 8px 20px rgba(37, 99, 235, 0.25)'
            }}>
              <div style={{ fontWeight: 700, fontSize: 20 }}>CareMax</div>
              <div style={{ marginTop: 2, fontSize: 12, opacity: 0.95 }}>Operations Console</div>
            </div>
          </div>
        )}

        {isMobile && (
          <div style={{
            marginBottom: 14,
            borderRadius: 12,
            padding: '10px 12px',
            background: '#fff',
            border: '1px solid #e2e8f0'
          }}>
            <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tenant</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#334155', marginTop: 2 }}>{tenantId}</div>
          </div>
        )}

        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            background: '#fff',
            padding: '6px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4
          }}>
            <div style={{ padding: '2px 8px 4px', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: '#94a3b8', textTransform: 'uppercase' }}>
              Workspace
            </div>
            {primaryNav.map((item) => renderNavLink(item))}
          </div>

          {navGroups.map((group) => {
            const hasActiveItem = group.items.some((item) => location.pathname === item.path);
            const isExpanded = expandedGroups[group.key] || hasActiveItem;

            return (
              <div key={group.key} style={{ border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff', overflow: 'hidden' }}>
                <button
                  onClick={() => toggleGroup(group.key)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '11px 12px',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#334155',
                    fontSize: 13,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em'
                  }}
                >
                  <span>{group.label}</span>
                  <span style={{ color: '#64748b', fontSize: 14 }}>{isExpanded ? '−' : '+'}</span>
                </button>

                {isExpanded && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '0 6px 8px' }}>
                    {group.items.map((item) => renderNavLink(item, true))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="logout-container" style={{
          marginTop: 'auto',
          paddingTop: 14,
          borderTop: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          gap: 6
        }}>
          <div style={{
            padding: '10px 12px',
            marginBottom: 2,
            background: '#fff',
            borderRadius: 10,
            border: '1px solid #e2e8f0'
          }}>
            <div style={{ fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tenant</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#334155', marginTop: 2, wordBreak: 'break-all' }}>{tenantId}</div>
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
                fontWeight: 600,
                background: '#eff6ff',
                borderRadius: 8,
                border: '1px solid #bfdbfe'
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
              fontWeight: 600
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
        padding: isMobile ? '76px 10px 20px' : '28px 44px',
        minWidth: 0,
        marginLeft: isMobile ? 0 : sidebarWidth,
        background: 'transparent'
      }}>
        <div className="main-content-container" style={{
          maxWidth: 1060,
          margin: '0 auto',
          background: '#fff',
          padding: isMobile ? '20px' : '40px',
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
