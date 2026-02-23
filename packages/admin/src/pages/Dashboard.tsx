import { Link, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useTenant } from '../TenantContext';
import { useIsMobile } from '../hooks/useIsMobile';
import AnalyticsUI from '../components/AnalyticsUI';
import { api } from '../api';

type BillingNoticeData = {
  billingStatus?: {
    isActive: boolean;
    isTrialPlan: boolean;
    isExpired: boolean;
    daysRemaining: number | null;
  };
};

export default function Dashboard() {
  const { isPlatformAdmin, tenantId } = useTenant();
  const { isMobile } = useIsMobile();
  const [billing, setBilling] = useState<BillingNoticeData['billingStatus'] | null>(null);

  useEffect(() => {
    if (!tenantId || tenantId === 'platform') return;
    api<BillingNoticeData>(`/tenants/${tenantId}/billing`)
      .then((res) => setBilling(res.billingStatus ?? null))
      .catch(() => setBilling(null));
  }, [tenantId]);

  if (isPlatformAdmin && tenantId === 'platform') {
    return <Navigate to="/platform" replace />;
  }

  const isExpiredTrial = Boolean(billing?.isExpired && billing.isTrialPlan);
  const isExpiredPaidPackage = Boolean(billing?.isExpired && !billing.isTrialPlan);

  const billingTitle = isExpiredTrial
    ? 'Your trial has ended.'
    : isExpiredPaidPackage
      ? 'Package Expired'
      : billing?.isTrialPlan
        ? `Trial active: ${billing.daysRemaining ?? 0} day(s) remaining.`
        : 'Subscription active.';

  const billingDescription = isExpiredTrial
    ? 'Upgrade now to reactivate your widget and continue conversations.'
    : isExpiredPaidPackage
      ? null
      : 'Manage your package and available upgrade options from billing.';

  const agentConfigLinks = [
    { label: 'Agent Settings', description: 'Configure behavior, tone, and goals.', path: '/agent' },
    { label: 'Auto Brain', description: 'Manage memory and autonomous responses.', path: '/agent-brain' },
    { label: 'Agent Notebook', description: 'Store instructions and reusable notes.', path: '/agent-notes' },
    { label: 'Integrations', description: 'Connect channels, CRMs, and external tools.', path: '/integrations' },
    { label: 'Knowledge Base', description: 'Manage RAG sources and document sync.', path: '/rag' },
  ];


  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 8px 0', fontSize: isMobile ? 24 : 32 }}>Dashboard</h1>
      <p style={{ color: '#64748b', fontSize: isMobile ? 15 : 16, lineHeight: 1.6, marginBottom: 24 }}>
        Welcome to CareMax. Configure your agent settings, manage live handoffs, and integrate the chat widget into your website.
      </p>

      {billing && (
        <div
          style={{
            marginBottom: 20,
            padding: '14px 16px',
            borderRadius: 10,
            border: `1px solid ${billing.isExpired ? '#fecaca' : '#bfdbfe'}`,
            background: billing.isExpired ? '#fef2f2' : '#eff6ff',
          }}
        >
          <strong style={{ display: 'block', marginBottom: 6 }}>
            {billingTitle}
          </strong>
          {billingDescription && <span style={{ color: '#475569', fontSize: 14 }}>{billingDescription}</span>}
          {!isExpiredPaidPackage && (
            <div style={{ marginTop: 10 }}>
              <Link to="/billing" style={{ color: '#1d4ed8', fontWeight: 600, textDecoration: 'none' }}>
                View billing options →
              </Link>
            </div>
          )}
        </div>
      )}

      <section
        style={{
          marginTop: 20,
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))',
          gap: 14,
        }}
      >
        <div
          style={{
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            padding: isMobile ? 16 : 20,
            background: '#f8fafc'
          }}
        >
          <h2 style={{ margin: '0 0 6px 0', fontSize: 20, color: '#0f172a' }}>Agent Config</h2>
          <p style={{ margin: '0 0 12px 0', color: '#64748b', fontSize: 13 }}>
            Quick dashboard menu for all agent administration pages.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            {agentConfigLinks.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                style={{
                  display: 'block',
                  textDecoration: 'none',
                  color: '#0f172a',
                  background: '#fff',
                  border: '1px solid #dbeafe',
                  borderRadius: 10,
                  padding: '12px 14px',
                  boxShadow: '0 1px 2px rgba(15,23,42,0.04)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, color: '#1e3a8a', fontSize: 14 }}>{item.label}</span>
                  <span style={{ color: '#2563eb', fontWeight: 700 }}>→</span>
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: '#64748b', lineHeight: 1.4 }}>{item.description}</div>
              </Link>
            ))}
          </div>
        </div>
      </section>


      <AnalyticsUI isMobile={isMobile} />

      {isPlatformAdmin && (
        <div style={{ 
          marginTop: 32, 
          padding: 24, 
          background: '#f8fafc', 
          borderRadius: 12, 
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
        }}>
          <h3 style={{ margin: '0 0 8px 0', fontSize: 18, color: '#0f172a' }}>Platform Administration</h3>
          <p style={{ margin: '0 0 20px 0', fontSize: 14, color: '#64748b', lineHeight: 1.5 }}>
            You have elevated privileges. Use the platform console to manage all tenants, view usage metrics, and oversee the entire SaaS ecosystem.
          </p>
          <Link
            to="/platform"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '10px 20px',
              background: '#2563eb',
              color: '#fff',
              textDecoration: 'none',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              transition: 'background 0.2s'
            }}
          >
            Open Platform Console
          </Link>
        </div>
      )}
    </div>
  );
}
