import { useEffect, useMemo, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { useTenant } from './TenantContext';
import { auth, firestore } from './firebase';
import { useIsMobile } from './hooks/useIsMobile';

type NavItem = { path: string; label: string };
type NavGroup = { key: string; label: string; items: NavItem[] };

export default function Layout() {
  const location = useLocation();
  const { tenantId, name, email, isPlatformAdmin } = useTenant();
  const { isMobile } = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [handoffCount, setHandoffCount] = useState(0);
  const [activeConversationCount, setActiveConversationCount] = useState(0);
  const [recentConversationCount, setRecentConversationCount] = useState(0);

  useEffect(() => {
    if (!tenantId) {
      setHandoffCount(0);
      return;
    }

    const handoffQuery = query(
      collection(firestore, 'conversations'),
      where('tenantId', '==', tenantId),
      where('status', '==', 'handoff_requested')
    );

    const unsub = onSnapshot(handoffQuery, (snap) => {
      setHandoffCount(snap.size);
    });

    return () => unsub();
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) {
      setActiveConversationCount(0);
      setRecentConversationCount(0);
      return;
    }

    let conversations: Array<{ updatedAt?: { toMillis?: () => number } | number | null }> = [];

    const activeConversationQuery = query(
      collection(firestore, 'conversations'),
      where('tenantId', '==', tenantId),
      where('status', 'in', ['open', 'handoff_requested', 'human_joined'])
    );

    const updateConversationCounts = () => {
      const now = Date.now();
      const oneMinuteAgoMs = now - 60 * 1000;
      const recentCount = conversations.reduce((count, conversation) => {
        const updatedAt = conversation.updatedAt;
        if (!updatedAt) return count;
        const updatedAtMs = typeof updatedAt === 'number' ? updatedAt : updatedAt.toMillis?.() ?? 0;
        return updatedAtMs > oneMinuteAgoMs ? count + 1 : count;
      }, 0);

      setActiveConversationCount(conversations.length);
      setRecentConversationCount(recentCount);
    };

    const unsubscribe = onSnapshot(activeConversationQuery, (snap) => {
      conversations = snap.docs.map((doc) => doc.data() as { updatedAt?: { toMillis?: () => number } | number | null });
      updateConversationCounts();
    });

    const intervalId = setInterval(updateConversationCounts, 5000);

    return () => {
      unsubscribe();
      clearInterval(intervalId);
    };
  }, [tenantId]);

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
        { path: '/rag', label: 'Knowledge Base' },
        { path: '/agent-brain', label: 'Auto Brain' },
        { path: '/integrations', label: 'Integrations' },
        { path: '/whatsapp', label: 'WhatsApp Agent' },
        { path: '/whatsapp-patient-activity', label: 'WhatsApp Patient Activity' },
        { path: '/patient-profile', label: 'Patient Profile' },
        { path: '/special-messages', label: 'Special Messages' },
        { path: '/agent-learning', label: 'Agent Learning Hub' },
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

  const activeGroupKeys = useMemo(() => new Set(
    navGroups.filter((group) => group.items.some((item) => location.pathname === item.path)).map((group) => group.key)
  ), [location.pathname, isPlatformAdmin]);

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => navGroups.reduce<Record<string, boolean>>((acc, group) => {
    acc[group.key] = activeGroupKeys.has(group.key);
    return acc;
  }, {}));

  useEffect(() => {
    setExpandedGroups((prev) => {
      const next = { ...prev };
      let changed = false;

      activeGroupKeys.forEach((groupKey) => {
        if (!prev[groupKey]) {
          next[groupKey] = true;
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [activeGroupKeys]);

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };

  const sidebarWidth = isMobile ? 304 : 272;

  const renderNavLink = ({ path, label }: NavItem, isSubItem = false) => {
    const active = location.pathname === path;
    const showHandoffBadge = path === '/handoffs' && handoffCount > 0;
    const showConversationsBadge = path === '/conversations' && activeConversationCount > 0;
    const badgeStyle = {
      color: '#fff',
      borderRadius: 999,
      minWidth: 20,
      height: 20,
      padding: '0 6px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 11,
      fontWeight: 700,
      lineHeight: 1,
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
    } as const;
    return (
      <Link
        key={path}
        to={path}
        onClick={() => isMobile && setMenuOpen(false)}
        style={{
          padding: isSubItem ? '7px 10px 7px 12px' : '9px 10px',
          borderRadius: 10,
          textDecoration: 'none',
          color: active ? '#1d4ed8' : '#334155',
          fontWeight: active ? 700 : 500,
          background: active ? '#dbeafe' : 'transparent',
          fontSize: isSubItem ? 12 : 13,
          border: active ? '1px solid #bfdbfe' : '1px solid transparent',
          boxShadow: active ? '0 1px 2px rgba(37, 99, 235, 0.12)' : 'none'
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span>{label}</span>
          {showConversationsBadge && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  ...badgeStyle,
                  background: '#2563eb'
                }}
                aria-label={`${activeConversationCount} active conversations`}
                title={`Active conversations: ${activeConversationCount}`}
              >
                {activeConversationCount}
              </span>
              <span
                style={{
                  ...badgeStyle,
                  background: '#0ea5e9',
                  minWidth: 38
                }}
                aria-label={`${recentConversationCount} active in the last 1 minute`}
                title={`Active in the last 1 minute: ${recentConversationCount}`}
              >
                1m {recentConversationCount}
              </span>
            </span>
          )}
          {showHandoffBadge && (
            <span
              style={{
                ...badgeStyle,
                background: '#ef4444'
              }}
              aria-label={`${handoffCount} pending handoffs`}
            >
              {handoffCount}
            </span>
          )}
        </span>
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
            marginBottom: 10,
            borderRadius: 12,
            padding: '10px 12px',
            background: '#fff',
            border: '1px solid #e2e8f0'
          }}>
            <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Organization</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#334155', marginTop: 2, wordBreak: 'break-word' }}>{name || tenantId}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, wordBreak: 'break-all' }}>{email || '—'}</div>
          </div>
        )}

        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            background: '#fff',
            padding: '5px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2
          }}>
            <div style={{ padding: '2px 8px 4px', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: '#94a3b8', textTransform: 'uppercase' }}>
              Workspace
            </div>
            {primaryNav.map((item) => renderNavLink(item))}
          </div>

          {navGroups.map((group) => {
            const isExpanded = expandedGroups[group.key];

            return (
              <div key={group.key} style={{ border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff', overflow: 'hidden' }}>
                <button
                  onClick={() => toggleGroup(group.key)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '9px 10px',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#334155',
                    fontSize: 12,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em'
                  }}
                >
                  <span>{group.label}</span>
                  <span style={{ color: '#64748b', fontSize: 14 }}>{isExpanded ? '−' : '+'}</span>
                </button>

                {isExpanded && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 5px 6px' }}>
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
          {!isMobile && (
            <div style={{
              padding: '10px 12px',
              marginBottom: 2,
              background: '#fff',
              borderRadius: 10,
              border: '1px solid #e2e8f0'
            }}>
              <div style={{ fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Organization</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#334155', marginTop: 2, wordBreak: 'break-word' }}>{name || tenantId}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, wordBreak: 'break-all' }}>{email || '—'}</div>
            </div>
          )}

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
