import { useEffect, useState } from 'react';
import { useTenant } from '../TenantContext';
import { api } from '../api';

type BillingSummary = {
  tenantId: string;
  billingPlanId: string;
  currentPlan: { id: string; name: string; priceUsd: number } | null;
  totals: { calls: number; inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number };
  byUsageType: Array<{ usageType: string; calls: number; inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number }>;
  recentEvents: Array<{ eventId: string; usageType: string; model: string | null; inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number; measurementSource: string; createdAt: number | null }>;
};

export default function TenantBilling() {
  const { tenantId } = useTenant();
  const [data, setData] = useState<BillingSummary | null>(null);

  useEffect(() => {
    api<BillingSummary>(`/tenants/${tenantId}/billing`).then(setData).catch(() => setData(null));
  }, [tenantId]);

  if (!data) return <p>Loading billing data...</p>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Billing & Token Usage</h1>
      <p style={{ color: '#64748b' }}>Track token usage for each API usage type in your tenant.</p>
      <p><strong>Plan:</strong> {data.currentPlan?.name ?? data.billingPlanId} ({data.currentPlan ? `$${data.currentPlan.priceUsd}/mo` : 'custom'})</p>
      <div style={{ display: 'flex', gap: 20, marginBottom: 18 }}>
        <Metric label="API Calls" value={data.totals.calls.toLocaleString()} />
        <Metric label="Input Tokens" value={data.totals.inputTokens.toLocaleString()} />
        <Metric label="Output Tokens" value={data.totals.outputTokens.toLocaleString()} />
        <Metric label="Total Cost" value={`$${data.totals.costUsd.toFixed(4)}`} />
      </div>

      <h3>Usage by API Flow</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th align="left">Usage Type</th><th align="right">Calls</th><th align="right">Tokens</th><th align="right">Cost</th></tr></thead>
        <tbody>
          {data.byUsageType.map((row) => (
            <tr key={row.usageType} style={{ borderTop: '1px solid #e2e8f0' }}>
              <td style={{ padding: '6px 0', fontFamily: 'monospace' }}>{row.usageType}</td>
              <td align="right">{row.calls}</td>
              <td align="right">{row.totalTokens.toLocaleString()}</td>
              <td align="right">${row.costUsd.toFixed(6)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ marginTop: 18 }}>Recent Metered Events</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr><th align="left">Time</th><th align="left">Type</th><th align="left">Source</th><th align="right">Input</th><th align="right">Output</th><th align="right">Cost</th></tr></thead>
        <tbody>
          {data.recentEvents.slice(0, 25).map((e) => (
            <tr key={e.eventId} style={{ borderTop: '1px solid #e2e8f0' }}>
              <td>{e.createdAt ? new Date(e.createdAt).toLocaleString() : '—'}</td>
              <td style={{ fontFamily: 'monospace' }}>{e.usageType}</td>
              <td>{e.measurementSource}</td>
              <td align="right">{e.inputTokens}</td>
              <td align="right">{e.outputTokens}</td>
              <td align="right">${e.costUsd.toFixed(6)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, minWidth: 140 }}><div style={{ fontSize: 12, color: '#64748b' }}>{label}</div><div style={{ fontSize: 18, fontWeight: 600 }}>{value}</div></div>;
}
