import { Link, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useTenant } from '../TenantContext';
import { useIsMobile } from '../hooks/useIsMobile';
import AIBrainVisualization from '../components/AIBrainVisualization';
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
    { label: 'Agent Settings', path: '/agent' },
    { label: 'Auto Brain', path: '/agent-brain' },
    { label: 'Agent Notebook', path: '/agent-notes' },
    { label: 'Integrations', path: '/integrations' },
    { label: 'Knowledge Base', path: '/rag' },
  ];

  const logMetrics = [
    { label: 'API Calls', value: '1' },
    { label: 'Input Tokens', value: '7,990' },
    { label: 'Output Tokens', value: '24' },
    { label: 'Total Cost', value: 'UGX 2' },
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

      <AIBrainVisualization isMobile={isMobile} />

      <AnalyticsUI isMobile={isMobile} />

      <section
        style={{
          marginTop: 28,
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: isMobile ? 16 : 20,
          background: '#f8fafc'
        }}
      >
        <h2 style={{ margin: '0 0 12px 0', fontSize: 20, color: '#0f172a' }}>Agent Config</h2>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          {agentConfigLinks.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              style={{
                textDecoration: 'none',
                color: '#1d4ed8',
                fontWeight: 600,
                background: '#fff',
                border: '1px solid #dbeafe',
                borderRadius: 10,
                padding: '12px 14px'
              }}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </section>

      <section
        style={{
          marginTop: 18,
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: isMobile ? 16 : 20,
          background: '#fff'
        }}
      >
        <h2 style={{ margin: '0 0 8px 0', fontSize: 20, color: '#0f172a' }}>Notifications</h2>
        <p style={{ margin: 0, color: '#64748b', fontSize: 14 }}>
          Notification updates will appear in this section.
        </p>
      </section>

      <section
        style={{
          marginTop: 18,
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: isMobile ? 16 : 20,
          background: '#fff'
        }}
      >
        <h2 style={{ margin: '0 0 12px 0', fontSize: 20, color: '#0f172a' }}>Logs</h2>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', marginBottom: 10 }}>Recent Metered Events</div>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
          {logMetrics.map((metric) => (
            <div key={metric.label} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', background: '#f8fafc' }}>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>{metric.label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{metric.value}</div>
            </div>
          ))}
        </div>
      </section>

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
