import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged } from './firebase';
import { setAuthToken, clearAuthToken, api } from './api';
import { TenantProvider, type TenantProfile } from './TenantContext';
import Layout from './Layout';
import PlatformLayout from './PlatformLayout';
import Landing from './pages/Landing';
import Login from './pages/Login';
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

  useEffect(() => {
    const unsub = onAuthStateChanged((token) => {
      if (token) {
        setAuthToken(token);
        setAuthenticated(true);
      } else {
        clearAuthToken();
        setAuthenticated(false);
        setUserProfile('loading');
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
          setUserProfile({
            tenantId: me.tenantId,
            isAdmin: true,
            isPlatformAdmin: me.isPlatformAdmin === true,
            uid: me.uid,
            email: me.email,
          });
        } else if (me.isPlatformAdmin) {
          // Platform admin without a specific tenant – can still use platform views.
          setUserProfile({
            tenantId: 'platform',
            isAdmin: false,
            isPlatformAdmin: true,
            uid: me.uid,
            email: me.email,
          });
        } else {
          setUserProfile(null);
        }
      })
      .catch(() => setUserProfile(null));
  }, [authenticated]);

  if (!ready) return <div style={{ padding: 24 }}>Loading...</div>;
  
  // Show landing page when not authenticated
  if (!authenticated) {
    return (
      <Landing
        onLogin={() => setAuthenticated(true)}
        onSignUp={() => setAuthenticated(true)}
      />
    );
  }
  
  // After authentication, check user profile
  if (userProfile === 'loading') return <div style={{ padding: 24 }}>Loading...</div>;
  
  // If authenticated but no tenant profile, show registration
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
