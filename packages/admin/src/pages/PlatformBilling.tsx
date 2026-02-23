import { useEffect, useState } from 'react';
import { api } from '../api';

type Plan = {
  id: string;
  name: string;
  priceUgx: number;
  priceUsd: number;
  billingCycle: 'monthly';
  trialDays: number;
  maxTokensPerPackage?: number | null;
  maxUsageAmountUgxPerPackage?: number | null;
  active: boolean;
  description?: string;
};

type BillingConfig = {
  inputCostPer1MTokensUsd: number;
  outputCostPer1MTokensUsd: number;
  availableModels: string[];
};

const defaultBillingConfig: BillingConfig = {
  inputCostPer1MTokensUsd: 0.15,
  outputCostPer1MTokensUsd: 0.6,
  availableModels: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
};

const formatUgx = (amount: number) => `UGX ${Math.round(amount).toLocaleString()}`;

export default function PlatformBilling() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [billingConfig, setBillingConfig] = useState<BillingConfig>(defaultBillingConfig);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [plansData, configData] = await Promise.all([
      api<{ plans: Plan[] }>('/platform/billing/plans'),
      api<BillingConfig>('/platform/billing/config'),
    ]);
    setPlans(plansData.plans);
    setBillingConfig(configData);
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    setSaving(true);
    await Promise.all([
      api('/platform/billing/plans', { method: 'PUT', body: JSON.stringify({ plans }) }),
      api('/platform/billing/config', { method: 'PUT', body: JSON.stringify(billingConfig) }),
    ]);
    setSaving(false);
    load();
  };

  const addModel = () => {
    setBillingConfig((prev) => ({ ...prev, availableModels: [...prev.availableModels, ''] }));
  };

  const removeModel = (idx: number) => {
    setBillingConfig((prev) => {
      if (prev.availableModels.length <= 1) return prev;
      return { ...prev, availableModels: prev.availableModels.filter((_, i) => i !== idx) };
    });
  };

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Billing Plan Management</h1>
      <p style={{ color: '#64748b' }}>Configure SaaS billing types and monthly amount. Subscription collection uses UGX amounts.</p>

      <h3 style={{ marginBottom: 8 }}>SaaS Billing Types</h3>
      {plans.map((plan, idx) => (
        <div
          key={plan.id}
          style={{
            border: '1px solid #cbd5e1',
            borderRadius: 8,
            padding: 14,
            marginBottom: 12,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 10,
          }}
        >
          <div style={{ gridColumn: '1 / -1', fontWeight: 600 }}>{plan.id.toUpperCase()} Plan</div>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#475569' }}>Plan Title</span>
            <input
              value={plan.name}
              onChange={(e) => setPlans((p) => p.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))}
            />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#475569' }}>Monthly Amount (UGX)</span>
            <input
              type="number"
              value={plan.priceUgx}
              onChange={(e) => setPlans((p) => p.map((x, i) => (i === idx ? { ...x, priceUgx: Number(e.target.value) } : x)))}
            />
            <small style={{ color: '#64748b' }}>Shown as {formatUgx(plan.priceUgx)} to tenants.</small>
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#475569' }}>Trial Days</span>
            <input
              type="number"
              value={plan.trialDays}
              onChange={(e) => setPlans((p) => p.map((x, i) => (i === idx ? { ...x, trialDays: Number(e.target.value) } : x)))}
            />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#475569' }}>Detailed Description</span>
            <input
              value={plan.description ?? ''}
              onChange={(e) => setPlans((p) => p.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))}
            />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#475569' }}>Max Tokens Per Package (monthly)</span>
            <input
              type="number"
              min={1}
              value={plan.maxTokensPerPackage ?? ''}
              onChange={(e) => setPlans((p) => p.map((x, i) => (i === idx ? { ...x, maxTokensPerPackage: e.target.value === '' || Number(e.target.value) <= 0 ? null : Number(e.target.value) } : x)))}
              placeholder="No cap"
            />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#475569' }}>Max Usage Amount Per Package (UGX/month)</span>
            <input
              type="number"
              min={1}
              value={plan.maxUsageAmountUgxPerPackage ?? ''}
              onChange={(e) => setPlans((p) => p.map((x, i) => (i === idx ? { ...x, maxUsageAmountUgxPerPackage: e.target.value === '' || Number(e.target.value) <= 0 ? null : Number(e.target.value) } : x)))}
              placeholder="No cap"
            />
            <small style={{ color: '#64748b' }}>If set, package expires early when this usage value is reached before 30 days.</small>
          </label>
          {plan.id === 'free' && (
            <small style={{ gridColumn: '1 / -1', color: '#0f766e', fontWeight: 600 }}>Free plan value: Worth 5 USD tokens.</small>
          )}
        </div>
      ))}

      <div style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: 14, marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Token Pricing (per 1M tokens)</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#475569' }}>Input amount per 1M tokens (USD)</span>
            <input
              type="number"
              step="0.0001"
              value={billingConfig.inputCostPer1MTokensUsd}
              onChange={(e) => setBillingConfig((prev) => ({ ...prev, inputCostPer1MTokensUsd: Number(e.target.value) }))}
            />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#475569' }}>Output price per 1M tokens (USD)</span>
            <input
              type="number"
              step="0.0001"
              value={billingConfig.outputCostPer1MTokensUsd}
              onChange={(e) => setBillingConfig((prev) => ({ ...prev, outputCostPer1MTokensUsd: Number(e.target.value) }))}
            />
          </label>
        </div>
      </div>

      <div style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: 14, marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Models Available in Agent Config</h3>
        <p style={{ marginTop: 0, color: '#64748b', fontSize: 13 }}>Add or delete model IDs users can select under Agent Settings.</p>
        {billingConfig.availableModels.map((model, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              value={model}
              onChange={(e) =>
                setBillingConfig((prev) => ({
                  ...prev,
                  availableModels: prev.availableModels.map((x, i) => (i === idx ? e.target.value : x)),
                }))
              }
              style={{ flex: 1 }}
              placeholder="e.g. gemini-2.0-flash"
            />
            <button type="button" onClick={() => removeModel(idx)} style={{ padding: '0 10px' }}>
              Delete
            </button>
          </div>
        ))}
        <button type="button" onClick={addModel} style={{ padding: '8px 10px' }}>+ Add Model</button>
      </div>

      <button onClick={save} disabled={saving} style={{ padding: '8px 14px', marginTop: 16 }}>
        {saving ? 'Saving...' : 'Save Billing Settings'}
      </button>
    </div>
  );
}
