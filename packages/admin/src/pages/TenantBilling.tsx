import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTenant } from '../TenantContext';
import { api } from '../api';

type BillingSummary = {
  tenantId: string;
  billingPlanId: string;
  currentPlan: { id: string; name: string; priceUgx: number; priceUsd?: number } | null;
  billingStatus?: {
    isActive: boolean;
    isTrialPlan: boolean;
    isExpired: boolean;
    expiredReason?: string | null;
    daysRemaining: number | null;
    trialEndsAt: number | null;
    subscriptionEndsAt: number | null;
  };
  availablePlans?: Array<{ id: string; name: string; priceUgx: number; priceUsd?: number; description?: string; billingCycle?: 'monthly'; maxTokensPerPackage?: number | null; maxUsageAmountUgxPerPackage?: number | null }>;
  showUsageByApiFlow?: boolean;
  maxTokensPerUser?: number | null;
  maxSpendUgxPerUser?: number | null;
  totals: { calls: number; inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number };
  byUsageType: Array<{ usageType: string; calls: number; inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number }>;
  recentEvents: Array<{ eventId: string; usageType: string; model: string | null; inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number; measurementSource: string; createdAt: number | null }>;
};

type UiNoticeTone = 'success' | 'error' | 'info';

type UiNotice = {
  tone: UiNoticeTone;
  message: string;
};

type TenantNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: number | null;
};

type PaymentStatusResponse = {
  txRef: string;
  status: string;
  providerStatus?: string | null;
  failureReason?: string | null;
};

const formatUgx = (amount: number) => `UGX ${Math.round(amount).toLocaleString()}`;
const UGX_PER_USD = 3800;
const formatUsageCostUgx = (costUsd: number) => formatUgx(costUsd * UGX_PER_USD);

function getExpiryMessage(reason?: string | null): string {
  switch (reason) {
    case 'user_token_limit_reached':
      return 'Package expired early because your assigned token balance was depleted.';
    case 'user_spend_limit_reached':
      return 'Package expired early because your assigned spend amount was depleted.';
    case 'package_token_limit_reached':
      return 'Package expired early because package token limit was depleted.';
    case 'package_usage_amount_limit_reached':
      return 'Package expired early because package usage amount was depleted.';
    case 'duration_elapsed':
    case 'trial_ended':
      return 'Package expired because the billing period has ended.';
    default:
      return 'Package expired. Your widget is paused until you upgrade.';
  }
}

export default function TenantBilling() {
  const { tenantId, isPlatformAdmin } = useTenant();
  const [data, setData] = useState<BillingSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<UiNotice | null>(null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState('+256');
  const [collectingPlanId, setCollectingPlanId] = useState<string | null>(null);
  const [pendingPayment, setPendingPayment] = useState<{ txRef: string; billingPlanId: string } | null>(null);
  const [searchParams] = useSearchParams();
  const [notifications, setNotifications] = useState<TenantNotification[]>([]);

  useEffect(() => {
    if (!tenantId || tenantId === 'platform') {
      setLoadError('Billing is only available for a tenant admin profile.');
      setNotice(null);
      setData(null);
      return;
    }

    loadBilling();
    loadNotifications();
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId || tenantId === 'platform' || !pendingPayment) return;

    const poll = () => {
      api<PaymentStatusResponse>(`/tenants/${tenantId}/payments/${pendingPayment.txRef}/status`)
        .then((payment) => {
          const normalizedStatus = (payment.status ?? '').toLowerCase();

          if (normalizedStatus === 'completed') {
            setPendingPayment(null);
            setCollectingPlanId(null);
            setNotice({ tone: 'success', message: 'Payment confirmed. Your package has been updated.' });
            loadBilling();
            loadNotifications();
            return;
          }

          if (normalizedStatus === 'failed' || normalizedStatus === 'cancelled' || normalizedStatus === 'canceled' || normalizedStatus === 'expired') {
            setPendingPayment(null);
            setCollectingPlanId(null);
            setNotice({
              tone: 'error',
              message: payment.failureReason
                ?? `Payment failed (${payment.providerStatus ?? normalizedStatus}). Please try again.`,
            });
            loadBilling();
            loadNotifications();
          }
        })
        .catch((e) => {
          const message = e instanceof Error ? e.message : 'Failed to refresh payment status';
          setNotice({ tone: 'error', message });
        });
    };

    poll();
    const interval = window.setInterval(poll, 5000);
    const timeout = window.setTimeout(() => {
      setPendingPayment((currentPending) => {
        if (!currentPending || currentPending.txRef !== pendingPayment.txRef) return currentPending;
        setNotice({ tone: 'info', message: 'Payment request is still pending. Once approved on phone, this page will update automatically.' });
        return null;
      });
    }, 120000);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [tenantId, pendingPayment]);

  const loadBilling = () => {
    setLoadError(null);
    api<BillingSummary>(`/tenants/${tenantId}/billing`)
      .then((res) => {
        setData(res);
        setLoadError(null);
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : 'Failed to load billing data';
        setLoadError(message);
        setData(null);
      });
  };

  const loadNotifications = () => {
    api<{ notifications: TenantNotification[] }>(`/tenants/${tenantId}/notifications?limit=20`)
      .then((res) => setNotifications(res.notifications ?? []))
      .catch(() => setNotifications([]));
  };

  useEffect(() => {
    if (!tenantId || tenantId === 'platform') return;
    const txRef = searchParams.get('tx_ref') ?? searchParams.get('txRef') ?? searchParams.get('trxref');
    const transactionIdRaw = searchParams.get('transaction_id') ?? searchParams.get('transactionId');
    const reference = searchParams.get('reference');
    const status = searchParams.get('status');
    const parsedTransactionId = transactionIdRaw ? Number(transactionIdRaw) : undefined;
    const transactionId = typeof parsedTransactionId === 'number' && Number.isFinite(parsedTransactionId) && parsedTransactionId > 0
      ? parsedTransactionId
      : undefined;

    if (!txRef) return;
    if (status && !['successful', 'success', 'completed', 'paid'].includes(status.toLowerCase())) {
      setNotice({ tone: 'error', message: 'Marz Pay payment was not successful. Please try again.' });
      return;
    }

    const payload: { txRef: string; transactionId?: number; status?: string; reference?: string } = { txRef };
    if (transactionId) payload.transactionId = transactionId;
    if (status) payload.status = status;
    if (reference) payload.reference = reference;

    api(`/tenants/${tenantId}/payments/marzpay/verify`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
      .then(() => {
        setNotice({ tone: 'success', message: 'Payment was verified and your package is now active.' });
        loadBilling();
    loadNotifications();
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : 'Failed to verify payment';
        setNotice({ tone: 'error', message });
      });
  }, [tenantId, searchParams]);

  const startUpgrade = async (billingPlanId: string) => {
    if (!tenantId || tenantId === 'platform') return;
    if (!/^\+\d{10,15}$/.test(phoneNumber.trim())) {
      setNotice({ tone: 'error', message: 'Enter a valid phone number in international format, e.g. +2567XXXXXXXX.' });
      return;
    }
    setBusyPlan(billingPlanId);
    try {
      const res = await api<{ txRef: string; status: string; message?: string }>(`/tenants/${tenantId}/payments/marzpay/initialize`, {
        method: 'POST',
        body: JSON.stringify({ billingPlanId, phoneNumber, country: 'UG' }),
      });
      setNotice({ tone: 'info', message: res.message ?? `Collection status: ${res.status}` });
      setPendingPayment({ txRef: res.txRef, billingPlanId });
      setCollectingPlanId(null);
      loadBilling();
    loadNotifications();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unable to initialize payment';
      setNotice({ tone: 'error', message });
    } finally {
      setBusyPlan(null);
    }
  };

  if (!data && !loadError) return <p>Loading billing data...</p>;
  if (loadError) return <p style={{ color: '#dc2626' }}>Could not load billing data: {loadError}</p>;
  if (!data) return null;

  const planChangeLocked = data.billingPlanId !== 'free' && data.billingStatus?.isActive;
  const currentPackageExpired = Boolean(data.billingStatus?.isExpired);
  const selectedPlan = data.availablePlans?.find((plan) => plan.id === collectingPlanId) ?? null;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Billing</h1>
      <p style={{ color: '#64748b' }}>Billing and subscription package details</p>
      {notice && <NoticeBanner tone={notice.tone} message={notice.message} />}
      <p><strong>Plan:</strong> {data.currentPlan?.name ?? data.billingPlanId} ({data.currentPlan ? `${formatUgx(data.currentPlan.priceUgx)}/mo` : 'custom'})</p>

      {pendingPayment && (
        <div style={{ marginBottom: 12, border: '1px solid #bfdbfe', background: '#eff6ff', padding: 10, borderRadius: 8, color: '#1d4ed8' }}>
          Waiting for payment confirmation for <strong>{pendingPayment.billingPlanId}</strong>. Approve the prompt on your phone.
        </div>
      )}

      {data.billingStatus && (
        <div style={{ marginBottom: 18, padding: 12, borderRadius: 8, border: `1px solid ${data.billingStatus.isExpired ? '#fecaca' : '#c7d2fe'}`, background: data.billingStatus.isExpired ? '#fef2f2' : '#eef2ff' }}>
          <strong>
            {data.billingStatus.isExpired
              ? getExpiryMessage(data.billingStatus.expiredReason)
              : `Status: active${data.billingStatus.daysRemaining != null ? ` (${data.billingStatus.daysRemaining} day(s) remaining)` : ''}`}
          </strong>
          <div style={{ marginTop: 8, fontSize: 14, color: '#475569' }}>
            {data.billingStatus.isExpired ? 'Upgrade to any available package below.' : (planChangeLocked ? 'Plan changes unlock when your current package expires.' : 'Upgrade or change package.')}
          </div>
        </div>
      )}

      {(data.availablePlans?.length ?? 0) > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ marginBottom: 8 }}>CareMax Packages</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {data.availablePlans?.map((plan) => {
              const isCurrentPlan = plan.id === data.billingPlanId;
              const isCurrentExpiredPlan = isCurrentPlan && currentPackageExpired;
              const canPayPlan = plan.priceUgx > 0 && (!isCurrentPlan || isCurrentExpiredPlan);

              return (
                <div
                  key={plan.id}
                  style={{
                    border: `1px solid ${isCurrentExpiredPlan ? '#dc2626' : isCurrentPlan ? '#6366f1' : '#e2e8f0'}`,
                    borderRadius: 10,
                    padding: 12,
                    background: isCurrentExpiredPlan ? '#fef2f2' : isCurrentPlan ? '#eef2ff' : '#fff',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontWeight: 600, color: '#0f172a' }}>{plan.name}</div>
                    {isCurrentPlan && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: isCurrentExpiredPlan ? '#b91c1c' : '#4338ca', background: isCurrentExpiredPlan ? '#fee2e2' : '#e0e7ff', padding: '2px 8px', borderRadius: 999 }}>
                        {isCurrentExpiredPlan ? 'Expired package' : 'Current package'}
                      </span>
                    )}
                  </div>
                  <div style={{ marginTop: 4, color: '#1e293b', fontSize: 14 }}>{formatUgx(plan.priceUgx)}/mo</div>
                  {plan.description && <div style={{ marginTop: 4, color: '#64748b', fontSize: 13 }}>({plan.description})</div>}
                  <div style={{ marginTop: 6, color: '#475569', fontSize: 12 }}>
                    <div>Max tokens: {plan.maxTokensPerPackage ? plan.maxTokensPerPackage.toLocaleString() : 'Not limited'}</div>
                    <div>Max usage amount: {plan.maxUsageAmountUgxPerPackage ? formatUgx(plan.maxUsageAmountUgxPerPackage) : 'Not limited'}</div>
                  </div>
                  {canPayPlan && (
                    <button
                      onClick={() => {
                        setNotice(null);
                        setCollectingPlanId(plan.id);
                      }}
                      disabled={busyPlan === plan.id || (!isCurrentExpiredPlan && planChangeLocked)}
                      style={{ marginTop: 10, padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1', cursor: 'pointer' }}
                    >
                      {!isCurrentExpiredPlan && planChangeLocked
                        ? 'Locked until package expires'
                        : busyPlan === plan.id
                          ? 'Requesting…'
                          : isCurrentExpiredPlan
                            ? 'Pay & Resume package'
                            : 'Pay with Marz Pay'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {selectedPlan && (
            <div style={{ marginTop: 14, border: '1px solid #bfdbfe', borderRadius: 12, padding: 14, background: '#eff6ff' }}>
              <h4 style={{ margin: '0 0 8px', color: '#1d4ed8' }}>Complete payment with Marz Pay</h4>
              <div style={{ fontSize: 14, color: '#1e3a8a', marginBottom: 8 }}>
                You are about to activate <strong>{selectedPlan.name}</strong> for <strong>{formatUgx(selectedPlan.priceUgx)}/mo</strong>.
              </div>
              <label style={{ display: 'block', fontSize: 13, marginBottom: 4, color: '#334155' }}>
                Mobile money number
              </label>
              <input
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+256700000000"
                style={{ width: '100%', maxWidth: 360, padding: '8px 10px', borderRadius: 6, border: '1px solid #93c5fd', background: '#fff' }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  onClick={() => startUpgrade(selectedPlan.id)}
                  disabled={busyPlan === selectedPlan.id || planChangeLocked}
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #60a5fa', background: '#dbeafe', cursor: 'pointer' }}
                >
                  {busyPlan === selectedPlan.id ? 'Requesting…' : 'Confirm payment request'}
                </button>
                <button
                  onClick={() => setCollectingPlanId(null)}
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 20, marginBottom: 18 }}>
        <Metric label="API Calls" value={data.totals.calls.toLocaleString()} />
        <Metric label="Input Tokens" value={data.totals.inputTokens.toLocaleString()} />
        <Metric label="Output Tokens" value={data.totals.outputTokens.toLocaleString()} />
        <Metric label="Total Cost" value={formatUsageCostUgx(data.totals.costUsd)} />
      </div>

      {(isPlatformAdmin || data.showUsageByApiFlow) && data.byUsageType.length > 0 ? (
        <>
          <h3>Usage by API Flow</h3>
          <div style={{ width: '100%', overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 520, borderCollapse: 'collapse' }}>
              <thead><tr><th align="left">Usage Type</th><th align="right">Calls</th><th align="right">Tokens</th><th align="right">Cost</th></tr></thead>
              <tbody>
                {data.byUsageType.map((row) => (
                  <tr key={row.usageType} style={{ borderTop: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '6px 0', fontFamily: 'monospace', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{row.usageType}</td>
                    <td align="right">{row.calls}</td>
                    <td align="right">{row.totalTokens.toLocaleString()}</td>
                    <td align="right">{formatUsageCostUgx(row.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p style={{ color: '#64748b' }}>{isPlatformAdmin || data.showUsageByApiFlow ? 'No data exists to use.' : 'Usage by API Flow is managed by SaaS admin.'}</p>
      )}

      <h3 style={{ marginTop: 18 }}>Notifications</h3>
      {notifications.length > 0 ? (
        <div style={{ display: 'grid', gap: 8, marginBottom: 10 }}>
          {notifications.map((n) => (
            <div key={n.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, background: n.read ? '#fff' : '#f8fafc' }}>
              <div style={{ fontWeight: 600 }}>{n.title}</div>
              <div style={{ fontSize: 13, color: '#475569' }}>{n.message}</div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{n.createdAt ? new Date(n.createdAt).toLocaleString() : '—'}</div>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ color: '#64748b' }}>No notifications yet.</p>
      )}

      {data.recentEvents.length > 0 ? (
        <>
          <h3 style={{ marginTop: 18 }}>Recent Metered Events</h3>
          <div style={{ width: '100%', overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr><th align="left">Time</th><th align="left">Type</th><th align="left">Source</th><th align="right">Input</th><th align="right">Output</th><th align="right">Cost</th></tr></thead>
              <tbody>
                {data.recentEvents.slice(0, 25).map((e) => (
                  <tr key={e.eventId} style={{ borderTop: '1px solid #e2e8f0' }}>
                    <td>{e.createdAt ? new Date(e.createdAt).toLocaleString() : '—'}</td>
                    <td style={{ fontFamily: 'monospace', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{e.usageType}</td>
                    <td>{e.measurementSource}</td>
                    <td align="right">{e.inputTokens}</td>
                    <td align="right">{e.outputTokens}</td>
                    <td align="right">{formatUsageCostUgx(e.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p style={{ color: '#64748b' }}>No metered events yet.</p>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, minWidth: 140 }}><div style={{ fontSize: 12, color: '#64748b' }}>{label}</div><div style={{ fontSize: 18, fontWeight: 600 }}>{value}</div></div>;
}

function NoticeBanner({ tone, message }: UiNotice) {
  const palette: Record<UiNoticeTone, { border: string; background: string; text: string; icon: string; title: string }> = {
    success: { border: '#86efac', background: '#f0fdf4', text: '#166534', icon: '✅', title: 'Payment successful' },
    error: { border: '#fecaca', background: '#fef2f2', text: '#991b1b', icon: '⚠️', title: 'Payment update' },
    info: { border: '#bfdbfe', background: '#eff6ff', text: '#1d4ed8', icon: 'ℹ️', title: 'Payment in progress' },
  };

  const selected = palette[tone];
  return (
    <div style={{ marginBottom: 12, padding: 12, borderRadius: 10, border: `1px solid ${selected.border}`, background: selected.background, color: selected.text }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{selected.icon} {selected.title}</div>
      <div>{message}</div>
    </div>
  );
}
