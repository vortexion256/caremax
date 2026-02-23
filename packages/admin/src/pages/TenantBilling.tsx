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
    daysRemaining: number | null;
    trialEndsAt: number | null;
    subscriptionEndsAt: number | null;
  };
  availablePlans?: Array<{ id: string; name: string; priceUgx: number; priceUsd?: number; description?: string; billingCycle?: 'monthly' }>;
  totals: { calls: number; inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number };
  byUsageType: Array<{ usageType: string; calls: number; inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number }>;
  recentEvents: Array<{ eventId: string; usageType: string; model: string | null; inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number; measurementSource: string; createdAt: number | null }>;
};

const formatUgx = (amount: number) => `UGX ${Math.round(amount).toLocaleString()}`;

export default function TenantBilling() {
  const { tenantId } = useTenant();
  const [data, setData] = useState<BillingSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState('+256');
  const [collectingPlanId, setCollectingPlanId] = useState<string | null>(null);
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (!tenantId || tenantId === 'platform') {
      setLoadError('Billing is only available for a tenant admin profile.');
      setActionError(null);
      setData(null);
      return;
    }

    loadBilling();
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId || tenantId === 'platform' || !pendingPlanId) return;

    const poll = () => {
      api<BillingSummary>(`/tenants/${tenantId}/billing`)
        .then((res) => {
          setData(res);
          setLoadError(null);

          if (res.billingPlanId === pendingPlanId && !res.billingStatus?.isExpired) {
            setPendingPlanId(null);
            setCollectingPlanId(null);
            setActionError('Payment confirmed. Your package has been updated.');
          }
        })
        .catch((e) => {
          const message = e instanceof Error ? e.message : 'Failed to refresh billing data';
          setLoadError(message);
        });
    };

    poll();
    const interval = window.setInterval(poll, 5000);
    const timeout = window.setTimeout(() => {
      setPendingPlanId((currentPending) => {
        if (currentPending !== pendingPlanId) return currentPending;
        setActionError('Payment request is still pending. Once approved on phone, this page will update automatically.');
        return null;
      });
    }, 120000);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [tenantId, pendingPlanId]);

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
      setActionError('Marz Pay payment was not successful. Please try again.');
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
        setActionError(null);
        loadBilling();
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : 'Failed to verify payment';
        setActionError(message);
      });
  }, [tenantId, searchParams]);

  const startUpgrade = async (billingPlanId: string) => {
    if (!tenantId || tenantId === 'platform') return;
    if (!/^\+\d{10,15}$/.test(phoneNumber.trim())) {
      setActionError('Enter a valid phone number in international format, e.g. +2567XXXXXXXX.');
      return;
    }
    setBusyPlan(billingPlanId);
    try {
      const res = await api<{ status: string; message?: string }>(`/tenants/${tenantId}/payments/marzpay/initialize`, {
        method: 'POST',
        body: JSON.stringify({ billingPlanId, phoneNumber, country: 'UG' }),
      });
      setActionError(res.message ?? `Collection status: ${res.status}`);
      setPendingPlanId(billingPlanId);
      setCollectingPlanId(null);
      loadBilling();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unable to initialize payment';
      setActionError(message);
    } finally {
      setBusyPlan(null);
    }
  };

  if (!data && !loadError) return <p>Loading billing data...</p>;
  if (loadError) return <p style={{ color: '#dc2626' }}>Could not load billing data: {loadError}</p>;
  if (!data) return null;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Billing & Token Usage</h1>
      <p style={{ color: '#64748b' }}>Track token usage for each API usage type in your tenant.</p>
      {actionError && <p style={{ color: '#dc2626' }}>{actionError}</p>}
      <p><strong>Plan:</strong> {data.currentPlan?.name ?? data.billingPlanId} ({data.currentPlan ? `${formatUgx(data.currentPlan.priceUgx)}/mo` : 'custom'})</p>

      {data.billingStatus && (
        <div style={{ marginBottom: 18, padding: 12, borderRadius: 8, border: `1px solid ${data.billingStatus.isExpired ? '#fecaca' : '#c7d2fe'}`, background: data.billingStatus.isExpired ? '#fef2f2' : '#eef2ff' }}>
          <strong>
            {data.billingStatus.isExpired
              ? 'Trial expired. Your widget is paused until you upgrade.'
              : `Status: active${data.billingStatus.daysRemaining != null ? ` (${data.billingStatus.daysRemaining} day(s) remaining)` : ''}`}
          </strong>
          <div style={{ marginTop: 8, fontSize: 14, color: '#475569' }}>
            {data.billingStatus.isExpired ? 'Upgrade to any available package below.' : 'Upgrade or change package.'}
          </div>
        </div>
      )}

      {(data.availablePlans?.length ?? 0) > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ marginBottom: 8 }}>Available upgrade options</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {data.availablePlans?.map((plan) => (
              <div
                key={plan.id}
                style={{
                  border: `1px solid ${plan.id === data.billingPlanId ? '#6366f1' : '#e2e8f0'}`,
                  borderRadius: 10,
                  padding: 12,
                  background: plan.id === data.billingPlanId ? '#eef2ff' : '#fff',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontWeight: 600, color: '#0f172a' }}>{plan.name}</div>
                  {plan.id === data.billingPlanId && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#4338ca', background: '#e0e7ff', padding: '2px 8px', borderRadius: 999 }}>
                      Current package
                    </span>
                  )}
                </div>
                <div style={{ marginTop: 4, color: '#1e293b', fontSize: 14 }}>{formatUgx(plan.priceUgx)}/mo</div>
                {plan.description && <div style={{ marginTop: 4, color: '#64748b', fontSize: 13 }}>({plan.description})</div>}
                {plan.id !== data.billingPlanId && plan.priceUgx > 0 && (
                  <>
                    <button
                      onClick={() => {
                        setActionError(null);
                        setCollectingPlanId(plan.id);
                      }}
                      disabled={busyPlan === plan.id}
                      style={{ marginTop: 10, padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1', cursor: 'pointer' }}
                    >
                      {busyPlan === plan.id ? 'Requesting…' : 'Pay with Marz Pay'}
                    </button>

                    {collectingPlanId === plan.id && (
                      <div style={{ marginTop: 10, border: '1px solid #cbd5e1', borderRadius: 8, padding: 10, background: '#f8fafc' }}>
                        <label style={{ display: 'block', fontSize: 13, marginBottom: 4, color: '#334155' }}>
                          Mobile money number
                        </label>
                        <input
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value)}
                          placeholder="+256700000000"
                          style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #cbd5e1' }}
                        />
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                          <button
                            onClick={() => startUpgrade(plan.id)}
                            disabled={busyPlan === plan.id}
                            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1', cursor: 'pointer' }}
                          >
                            {busyPlan === plan.id ? 'Requesting…' : 'Confirm payment request'}
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
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 20, marginBottom: 18 }}>
        <Metric label="API Calls" value={data.totals.calls.toLocaleString()} />
        <Metric label="Input Tokens" value={data.totals.inputTokens.toLocaleString()} />
        <Metric label="Output Tokens" value={data.totals.outputTokens.toLocaleString()} />
        <Metric label="Total Cost" value={`$${data.totals.costUsd.toFixed(4)}`} />
      </div>

      {data.byUsageType.length > 0 ? (
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
                    <td align="right">${row.costUsd.toFixed(6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p style={{ color: '#64748b' }}>No data exists to use.</p>
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
                    <td align="right">${e.costUsd.toFixed(6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p style={{ color: '#64748b' }}>No data exists to use.</p>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, minWidth: 140 }}><div style={{ fontSize: 12, color: '#64748b' }}>{label}</div><div style={{ fontSize: 18, fontWeight: 600 }}>{value}</div></div>;
}
