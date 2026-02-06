import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged } from './firebase';
import { setAuthToken, clearAuthToken, api } from './api';
import { TenantProvider, type TenantProfile } from './TenantContext';
import Layout from './Layout';
import PlatformLayout from './PlatformLayout';
import Landing from './pages/Landing';
import Login from './pages/Login';
import SignUp from './pages/SignUp';
import RegisterOrg from './pages/RegisterOrg';
import Dashboard from './pages/Dashboard';
import AgentSettings from './pages/AgentSettings';
import HandoffQueue from './pages/HandoffQueue';
import HandoffChat from './pages/HandoffChat';
import Conversations from './pages/Conversations';
import ConversationView from './pages/ConversationView';
import PlatformTenants from './pages/PlatformTenants';
import PlatformDashboard from './pages/PlatformDashboard';
import RAG from './pages/RAG';
import Embed from './pages/Embed';

type MeResponse = { uid: string; email?: string; tenantId?: string; isAdmin?: boolean; isPlatformAdmin?: boolean };

export default function App() {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [userProfile, setUserProfile] = useState<TenantProfile | null | 'loading'>('loading');
  const [lastKnownPlatformAdmin, setLastKnownPlatformAdmin] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged((token) => {
      if (token) {
        setAuthToken(token);
        setAuthenticated(true);
      } else {
        clearAuthToken();
        setAuthenticated(false);
        setUserProfile('loading');
        setLastKnownPlatformAdmin(false);
      }
      setReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    api<MeResponse>('/auth/me')
      .then((me) => {
        if (me.tenantId && me.isAdmin) {
          const profile = {
            tenantId: me.tenantId,
            isAdmin: true,
            isPlatformAdmin: me.isPlatformAdmin === true,
            uid: me.uid,
            email: me.email,
          };
          setUserProfile(profile);
          if (me.isPlatformAdmin) setLastKnownPlatformAdmin(true);
        } else if (me.isPlatformAdmin) {
          // Platform admin without a specific tenant – can still use platform views.
          const profile = {
            tenantId: 'platform',
            isAdmin: false,
            isPlatformAdmin: true,
            uid: me.uid,
            email: me.email,
          };
          setUserProfile(profile);
          setLastKnownPlatformAdmin(true);
        } else {
          setUserProfile(null);
          setLastKnownPlatformAdmin(false);
        }
      })
      .catch((e) => {
        // If user was previously a platform admin, keep that status to prevent showing RegisterOrg
        // This can happen after operations like tenant deletion if there's a temporary API issue
        if (lastKnownPlatformAdmin) {
          console.warn('Failed to refresh user profile, keeping platform admin status:', e);
          setUserProfile({
            tenantId: 'platform',
            isAdmin: false,
            isPlatformAdmin: true,
            uid: '',
            email: undefined,
          });
        } else {
          setUserProfile(null);
        }
      });
  }, [authenticated, lastKnownPlatformAdmin]);

  if (!ready) return <div style={{ padding: 24 }}>Loading...</div>;
  
  // Show landing page or signup when not authenticated
  if (!authenticated) {
    return (
      <Routes>
        <Route path="/signup" element={<SignUp onSuccess={() => setAuthenticated(true)} />} />
        <Route path="/login" element={<Login onSuccess={() => setAuthenticated(true)} />} />
        <Route path="*" element={<Landing onLogin={() => setAuthenticated(true)} />} />
      </Routes>
    );
  }
  
  // After authentication, check user profile
  if (userProfile === 'loading') {
    // While loading, check if we know user is platform admin to avoid showing registration
    if (lastKnownPlatformAdmin) {
      const platformProfile: TenantProfile = {
        tenantId: 'platform',
        isAdmin: false,
        isPlatformAdmin: true,
        uid: '',
        email: undefined,
      };
      return (
        <TenantProvider value={platformProfile}>
          <Routes>
            <Route path="/platform" element={<PlatformLayout />}>
              <Route index element={<PlatformDashboard />} />
              <Route path="tenants" element={<PlatformTenants />} />
            </Route>
            <Route path="*" element={<Navigate to="/platform" replace />} />
          </Routes>
        </TenantProvider>
      );
    }
    return <div style={{ padding: 24 }}>Loading...</div>;
  }
  
  // Platform admins should NEVER see registration - they go directly to platform dashboard
  // If userProfile is null but we know they're a platform admin, show platform dashboard
  if (!userProfile && lastKnownPlatformAdmin) {
    const platformProfile: TenantProfile = {
      tenantId: 'platform',
      isAdmin: false,
      isPlatformAdmin: true,
      uid: '',
      email: undefined,
    };
    return (
      <TenantProvider value={platformProfile}>
        <Routes>
          <Route path="/platform" element={<PlatformLayout />}>
            <Route index element={<PlatformDashboard />} />
            <Route path="tenants" element={<PlatformTenants />} />
          </Route>
          <Route path="*" element={<Navigate to="/platform" replace />} />
        </Routes>
      </TenantProvider>
    );
  }
  
  // If authenticated but no tenant profile, show registration (only for regular users, not platform admins)
  if (!userProfile) {
    return <RegisterOrg onRegistered={(profile) => setUserProfile(profile)} />;
  }

  return (
    <TenantProvider value={userProfile}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="agent" element={<AgentSettings />} />
          <Route path="conversations" element={<Conversations />} />
          <Route path="conversations/:conversationId" element={<ConversationView />} />
          <Route path="handoffs" element={<HandoffQueue />} />
          <Route path="handoffs/:conversationId" element={<HandoffChat />} />
          <Route path="rag" element={<RAG />} />
          <Route path="embed" element={<Embed />} />
        </Route>
        <Route path="/platform" element={<PlatformLayout />}>
          <Route index element={<PlatformDashboard />} />
          <Route path="tenants" element={<PlatformTenants />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </TenantProvider>
  );
}
