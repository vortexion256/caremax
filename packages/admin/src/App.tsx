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
import AdvancedPromptSettings from './pages/AdvancedPromptSettings';
import HandoffQueue from './pages/HandoffQueue';
import HandoffChat from './pages/HandoffChat';
import Conversations from './pages/Conversations';
import ConversationView from './pages/ConversationView';
import PlatformTenants from './pages/PlatformTenants';
import PlatformDashboard from './pages/PlatformDashboard';
import PlatformUsage from './pages/PlatformUsage';
import RAG from './pages/RAG';
import AutoAgentBrain from './pages/AutoAgentBrain';
import Integrations from './pages/Integrations';
import WhatsAppIntegration from './pages/WhatsApp';
import WhatsAppPatientActivityPage from './pages/WhatsAppPatientActivity';
import Embed from './pages/Embed';
import PlatformBilling from './pages/PlatformBilling';
import PlatformPayments from './pages/PlatformPayments';
import PlatformContentAdmin from './pages/PlatformContentAdmin';
import TenantBilling from './pages/TenantBilling';
import TenantAccount from './pages/TenantAccount';
import VisualDiagram from './pages/VisualDiagram';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import Contact from './pages/Contact';
import PatientProfilePage from './pages/XPersonProfile';
import SpecialMessagesPage from './pages/SpecialMessages';
import AgentLearningHub from './pages/AgentLearningHub';
import DoctorDashboard from './pages/DoctorDashboard';

type MeResponse = {
  uid: string;
  email?: string;
  tenantId?: string;
  tenantName?: string;
  isAdmin?: boolean;
  isPlatformAdmin?: boolean;
  isDoctor?: boolean;
};

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
        if (me.tenantId && (me.isAdmin || me.isDoctor)) {
          const profile = {
            tenantId: me.tenantId,
            name: me.tenantName,
            isAdmin: me.isAdmin === true,
            isDoctor: me.isDoctor === true,
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
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />
        <Route path="/terms-of-service" element={<TermsOfService />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="*" element={<Landing />} />
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
              <Route path="advanced-prompts" element={<AdvancedPromptSettings />} />
              <Route path="tenants" element={<PlatformTenants />} />
              <Route path="usage" element={<PlatformUsage />} />
              <Route path="billing" element={<PlatformBilling />} />
              <Route path="payments" element={<PlatformPayments />} />
              <Route path="content" element={<PlatformContentAdmin />} />
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
            <Route path="advanced-prompts" element={<AdvancedPromptSettings />} />
            <Route path="tenants" element={<PlatformTenants />} />
            <Route path="usage" element={<PlatformUsage />} />
            <Route path="billing" element={<PlatformBilling />} />
            <Route path="payments" element={<PlatformPayments />} />
            <Route path="content" element={<PlatformContentAdmin />} />
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
            <Route index element={userProfile.isDoctor ? <DoctorDashboard /> : <Dashboard />} />
          <Route path="agent" element={userProfile.isDoctor ? <Navigate to="/handoffs" replace /> : <AgentSettings />} />
          <Route path="visual-diagram" element={userProfile.isDoctor ? <Navigate to="/handoffs" replace /> : <VisualDiagram />} />
          <Route path="conversations" element={<Conversations />} />
          <Route path="conversations/:conversationId" element={<ConversationView />} />
          <Route path="handoffs" element={<HandoffQueue />} />
          <Route path="handoffs/:conversationId" element={<HandoffChat />} />
          <Route path="rag" element={userProfile.isDoctor ? <Navigate to="/handoffs" replace /> : <RAG />} />
          <Route path="agent-brain" element={userProfile.isDoctor ? <Navigate to="/handoffs" replace /> : <AutoAgentBrain />} />
          <Route path="integrations" element={userProfile.isDoctor ? <Navigate to="/handoffs" replace /> : <Integrations />} />
          <Route path="whatsapp" element={userProfile.isDoctor ? <Navigate to="/handoffs" replace /> : <WhatsAppIntegration />} />
          <Route path="whatsapp-patient-activity" element={userProfile.isDoctor ? <Navigate to="/handoffs" replace /> : <WhatsAppPatientActivityPage />} />
          <Route path="embed" element={userProfile.isDoctor ? <Navigate to="/handoffs" replace /> : <Embed />} />
          <Route path="account" element={userProfile.isDoctor ? <Navigate to="/handoffs" replace /> : <TenantAccount />} />
          <Route path="billing" element={userProfile.isDoctor ? <Navigate to="/handoffs" replace /> : <TenantBilling />} />
          <Route path="patient-profile" element={userProfile.isDoctor ? <Navigate to="/handoffs" replace /> : <PatientProfilePage />} />
          <Route path="special-messages" element={userProfile.isDoctor ? <Navigate to="/handoffs" replace /> : <SpecialMessagesPage />} />
          <Route path="agent-learning" element={userProfile.isDoctor ? <Navigate to="/handoffs" replace /> : <AgentLearningHub />} />
        </Route>
        <Route path="/platform" element={<PlatformLayout />}>
          <Route index element={<PlatformDashboard />} />
          <Route path="advanced-prompts" element={<AdvancedPromptSettings />} />
          <Route path="tenants" element={<PlatformTenants />} />
          <Route path="usage" element={<PlatformUsage />} />
          <Route path="billing" element={<PlatformBilling />} />
          <Route path="payments" element={<PlatformPayments />} />
          <Route path="content" element={<PlatformContentAdmin />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </TenantProvider>
  );
}
