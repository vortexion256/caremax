import { Link, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useTenant } from '../TenantContext';
import { useIsMobile } from '../hooks/useIsMobile';
import AnalyticsUI from '../components/AnalyticsUI';
import { api } from '../api';

type BillingNoticeData = {
  billingPlanId?: string;
  currentPlan?: {
    name?: string;
  } | null;
  billingStatus?: {
    isActive: boolean;
    isTrialPlan: boolean;
    isExpired: boolean;
    expiredReason?: string | null;
    daysRemaining: number | null;
  };
};

type TenantNotification = {
  id: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: number | null;
};

const BILLING_WARNING_DAYS = 5;

function describeExpiryReason(reason?: string | null): string {
  switch (reason) {
    case 'user_token_limit_reached':
      return 'A user token limit was reached, which expired your package early.';
    case 'user_spend_limit_reached':
      return 'A user spend limit was reached, which expired your package early.';
    case 'package_token_limit_reached':
      return 'Your package token allocation was depleted before month end.';
    case 'package_usage_amount_limit_reached':
      return 'Your package usage amount was depleted before month end.';
    case 'trial_ended':
    case 'duration_elapsed':
      return 'Your billing period ended.';
    default:
      return 'Your package has expired and requires renewal.';
  }
}

export default function Dashboard() {
  const { isPlatformAdmin, tenantId } = useTenant();
  const { isMobile } = useIsMobile();
  const [billingData, setBillingData] = useState<BillingNoticeData | null>(null);
  const [tenantNotifications, setTenantNotifications] = useState<TenantNotification[]>([]);

  useEffect(() => {
    if (!tenantId || tenantId === 'platform') return;
    api<BillingNoticeData>(`/tenants/${tenantId}/billing`)
      .then((res) => setBillingData(res))
      .catch(() => setBillingData(null));

    api<{ notifications: TenantNotification[] }>(`/tenants/${tenantId}/notifications?limit=5`)
      .then((res) => setTenantNotifications(res.notifications ?? []))
      .catch(() => setTenantNotifications([]));
  }, [tenantId]);

  if (isPlatformAdmin && tenantId === 'platform') {
    return <Navigate to="/platform" replace />;
  }

  const billing = billingData?.billingStatus ?? null;
  const isExpiredTrial = Boolean(billing?.isExpired && billing.isTrialPlan);
  const isExpiredPaidPackage = Boolean(billing?.isExpired && !billing.isTrialPlan);
  const activePlanName =
    billing?.isTrialPlan
      ? 'FREE TRIAL'
      : (billingData?.currentPlan?.name ?? billingData?.billingPlanId ?? 'ACTIVE SUBSCRIPTION').toUpperCase();

  const billingTitle = isExpiredTrial
    ? 'Your trial has ended.'
    : isExpiredPaidPackage
      ? 'Package Expired'
      : billing?.isTrialPlan
        ? `Trial active: ${billing.daysRemaining ?? 0} day(s) remaining.`
        : `SUBSCRIPTION ACTIVE. (${activePlanName})`;

  const billingDescription = isExpiredTrial
    ? 'Upgrade now to reactivate your widget and continue conversations.'
    : isExpiredPaidPackage
      ? null
      : 'Manage your package and available upgrade options from billing.';

  const daysRemaining = billing?.daysRemaining ?? null;
  const shouldWarnExpirySoon = !billing?.isExpired && daysRemaining != null && daysRemaining <= BILLING_WARNING_DAYS;
  const dashboardAlerts: string[] = [];

  if (billing?.isExpired) {
    dashboardAlerts.push(`Package expired: ${describeExpiryReason(billing.expiredReason)}`);
  }

  if (shouldWarnExpirySoon) {
    dashboardAlerts.push(`Package expiry warning: your current package will expire in ${daysRemaining} day(s).`);
  }

  if ((billing?.expiredReason ?? '') === 'user_token_limit_reached' || (billing?.expiredReason ?? '') === 'user_spend_limit_reached') {
    dashboardAlerts.push('User limit reached: at least one user exhausted their assigned package usage limit.');
  }

  tenantNotifications
    .filter((notification) => !notification.read)
    .forEach((notification) => {
      dashboardAlerts.push(`${notification.title}: ${notification.message}`);
    });

  const agentConfigLinks = [
    { label: 'Agent Settings', description: 'Configure behavior, tone, and goals.', path: '/agent' },
    { label: 'Auto Brain', description: 'Manage memory and autonomous responses.', path: '/agent-brain' },
    { label: 'Integrations', description: 'Connect Google sheets, Calendar and Gmail.', path: '/integrations' },
    { label: 'Knowledge Base', description: 'Manage RAG sources and document sync.', path: '/rag' },
    { label: 'Learning Hub', description: 'Track patient memory, clinical signals, and feedback loops.', path: '/agent-learning' },
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
            marginBottom: 16,
            padding: '10px 12px',
            maxWidth: isMobile ? '100%' : 560,
            borderRadius: 10,
            border: `1px solid ${billing.isExpired ? '#fecaca' : '#bfdbfe'}`,
            background: billing.isExpired ? '#fef2f2' : '#eff6ff',
          }}
        >
          <strong style={{ display: 'block', marginBottom: 4, fontSize: 14 }}>
            {billingTitle}
          </strong>
          {billingDescription && <span style={{ color: '#475569', fontSize: 13 }}>{billingDescription}</span>}
          {!isExpiredPaidPackage && (
            <div style={{ marginTop: 8 }}>
              <Link to="/billing" style={{ color: '#1d4ed8', fontWeight: 600, textDecoration: 'none' }}>
                View billing options →
              </Link>
            </div>
          )}
        </div>
      )}

      {dashboardAlerts.length > 0 && (
        <section
          style={{
            marginBottom: 16,
            maxWidth: isMobile ? '100%' : 760,
            borderRadius: 10,
            border: '1px solid #fed7aa',
            background: '#fff7ed',
            padding: '12px 14px',
          }}
        >
          <h2 style={{ margin: '0 0 8px 0', fontSize: 16, color: '#9a3412' }}>Tenant admin notifications</h2>
          <ul style={{ margin: 0, paddingLeft: 18, color: '#7c2d12', display: 'grid', gap: 6 }}>
            {dashboardAlerts.map((alert, index) => (
              <li key={`${alert}-${index}`} style={{ fontSize: 13, lineHeight: 1.4 }}>{alert}</li>
            ))}
          </ul>
        </section>
      )}

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

      <section style={{ marginTop: 28 }}>
        <h2 style={{ margin: '0 0 10px 0', fontSize: 18, color: '#0f172a' }}>Agent Config</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(5, minmax(0, 1fr))',
            gap: 10,
          }}
        >
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
                padding: '10px 12px',
                boxShadow: '0 1px 2px rgba(15,23,42,0.04)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <span style={{ fontWeight: 700, color: '#1e3a8a', fontSize: 13 }}>{item.label}</span>
                <span style={{ color: '#2563eb', fontWeight: 700 }}>→</span>
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: '#64748b', lineHeight: 1.35 }}>{item.description}</div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
