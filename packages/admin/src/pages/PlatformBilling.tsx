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
  subscriberCount?: number;
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

const createEmptyPlan = (): Plan => ({
  id: '',
  name: '',
  priceUgx: 0,
  priceUsd: 0,
  billingCycle: 'monthly',
  trialDays: 0,
  maxTokensPerPackage: null,
  maxUsageAmountUgxPerPackage: null,
  active: true,
  description: '',
});

const formatUgx = (amount: number) => `UGX ${Math.round(amount).toLocaleString()}`;

export default function PlatformBilling() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [billingConfig, setBillingConfig] = useState<BillingConfig>(defaultBillingConfig);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

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
    setNotice(null);

    const normalizedPlans = plans.map((plan) => ({
      ...plan,
      id: plan.id.trim().toLowerCase(),
      name: plan.name.trim(),
      description: plan.description?.trim() ?? '',
      subscriberCount: typeof plan.subscriberCount === 'number' ? plan.subscriberCount : 0,
    }));

    if (normalizedPlans.some((plan) => !plan.id || !plan.name)) {
      setNotice({ tone: 'error', message: 'Each package must include both package ID and name.' });
      return;
    }

    const uniqueIds = new Set(normalizedPlans.map((plan) => plan.id));
    if (uniqueIds.size !== normalizedPlans.length) {
      setNotice({ tone: 'error', message: 'Package IDs must be unique.' });
      return;
    }

    setSaving(true);
    try {
      await Promise.all([
        api('/platform/billing/plans', { method: 'PUT', body: JSON.stringify({ plans: normalizedPlans }) }),
        api('/platform/billing/config', { method: 'PUT', body: JSON.stringify(billingConfig) }),
      ]);
      setNotice({ tone: 'success', message: 'Billing plans and config saved successfully.' });
      await load();
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to save billing settings.' });
    } finally {
      setSaving(false);
    }
  };

  const addPlan = () => {
    setPlans((prev) => [...prev, createEmptyPlan()]);
  };

  const removePlan = (idx: number) => {
    const selectedPlan = plans[idx];
    if (selectedPlan?.subscriberCount && selectedPlan.subscriberCount > 0) {
      setNotice({
        tone: 'error',
        message: `Cannot delete package "${selectedPlan.name || selectedPlan.id}" because ${selectedPlan.subscriberCount} tenant(s) are subscribed to it.`,
      });
      return;
    }

    setPlans((prev) => prev.filter((_, i) => i !== idx));
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

      {notice && (
        <div
          style={{
            marginBottom: 12,
            padding: '10px 12px',
            borderRadius: 8,
            border: `1px solid ${notice.tone === 'success' ? '#86efac' : '#fecaca'}`,
            background: notice.tone === 'success' ? '#f0fdf4' : '#fef2f2',
            color: notice.tone === 'success' ? '#166534' : '#991b1b',
          }}
        >
          {notice.message}
        </div>
      )}

      <h3 style={{ marginBottom: 8 }}>SaaS Billing Types</h3>
      {plans.map((plan, idx) => (
        <div
          key={`${plan.id || 'new'}-${idx}`}
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
          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>{plan.id ? `${plan.id.toUpperCase()} Plan` : 'New Package'}</strong>
            <button
              type="button"
              onClick={() => removePlan(idx)}
              disabled={plan.id === 'free' || (plan.subscriberCount ?? 0) > 0}
              style={{ padding: '4px 10px' }}
              title={plan.id === 'free'
                ? 'Free plan cannot be deleted'
                : (plan.subscriberCount ?? 0) > 0
                  ? `Cannot delete: ${plan.subscriberCount} tenant(s) are subscribed to this package`
                  : 'Delete package'}
            >
              Delete package
            </button>
          </div>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#475569' }}>Package ID</span>
            <input
              value={plan.id}
              onChange={(e) =>
                setPlans((p) => p.map((x, i) => (i === idx ? { ...x, id: e.target.value.replace(/\s+/g, '-').toLowerCase() } : x)))
              }
              placeholder="e.g. growth"
            />
          </label>
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
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#475569' }}>Status</span>
            <select
              value={plan.active ? 'active' : 'inactive'}
              onChange={(e) => setPlans((p) => p.map((x, i) => (i === idx ? { ...x, active: e.target.value === 'active' } : x)))}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          {(plan.subscriberCount ?? 0) > 0 && (
            <small style={{ gridColumn: '1 / -1', color: '#991b1b', fontWeight: 600 }}>
              {plan.subscriberCount} tenant(s) are currently subscribed to this package.
            </small>
          )}
          {plan.id === 'free' && (
            <small style={{ gridColumn: '1 / -1', color: '#0f766e', fontWeight: 600 }}>Free plan value: Worth 5 USD tokens.</small>
          )}
        </div>
      ))}

      <button type="button" onClick={addPlan} style={{ padding: '8px 12px', marginBottom: 16 }}>
        + Add Package
      </button>

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
