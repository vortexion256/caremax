import { CSSProperties, useEffect, useState } from 'react';
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
  const [activePlanIndex, setActivePlanIndex] = useState<number | null>(null);
  const [activePlanMode, setActivePlanMode] = useState<'view' | 'edit'>('view');
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const buttonBaseStyle: CSSProperties = {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    background: '#f8fafc',
    color: '#0f172a',
    fontWeight: 600,
    cursor: 'pointer',
  };

  const primaryButtonStyle: CSSProperties = {
    ...buttonBaseStyle,
    background: '#0f172a',
    borderColor: '#0f172a',
    color: '#f8fafc',
  };

  const dangerButtonStyle: CSSProperties = {
    ...buttonBaseStyle,
    borderColor: '#fecaca',
    color: '#991b1b',
    background: '#fef2f2',
  };

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
    setActivePlanMode('edit');
    setActivePlanIndex(plans.length);
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
    setActivePlanIndex((prev) => {
      if (prev === null) return prev;
      if (prev === idx) return null;
      return prev > idx ? prev - 1 : prev;
    });
  };

  const openPlan = (idx: number, mode: 'view' | 'edit') => {
    setActivePlanIndex(idx);
    setActivePlanMode(mode);
  };

  const activePlan = activePlanIndex === null ? null : plans[activePlanIndex] ?? null;
  const isReadOnly = activePlanMode === 'view';

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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: 16 }}>
      {plans.map((plan, idx) => (
        <div
          key={`${plan.id || 'new'}-${idx}`}
          style={{
            border: '1px solid #cbd5e1',
            borderRadius: 8,
            padding: 14,
            display: 'grid',
            gap: 8,
            background: '#ffffff',
            boxShadow: activePlanIndex === idx ? '0 0 0 2px #bfdbfe' : 'none',
          }}
        >
          <strong>{plan.name || 'New Package'}</strong>
          <small style={{ color: '#64748b' }}>{plan.id ? plan.id.toUpperCase() : 'No ID yet'}</small>
          <small style={{ color: '#334155' }}>{formatUgx(plan.priceUgx)} / month</small>
          <small style={{ color: plan.active ? '#166534' : '#991b1b', fontWeight: 600 }}>
            {plan.active ? 'Active' : 'Inactive'}
          </small>
          {(plan.subscriberCount ?? 0) > 0 && (
            <small style={{ color: '#7c2d12', fontWeight: 600 }}>{plan.subscriberCount} subscriber(s)</small>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => openPlan(idx, 'view')} style={buttonBaseStyle}>View</button>
            <button type="button" onClick={() => openPlan(idx, 'edit')} style={primaryButtonStyle}>Edit</button>
            <button
              type="button"
              onClick={() => removePlan(idx)}
              disabled={plan.id === 'free' || (plan.subscriberCount ?? 0) > 0}
              style={{ ...dangerButtonStyle, opacity: plan.id === 'free' || (plan.subscriberCount ?? 0) > 0 ? 0.55 : 1, cursor: plan.id === 'free' || (plan.subscriberCount ?? 0) > 0 ? 'not-allowed' : 'pointer' }}
              title={plan.id === 'free'
                ? 'Free plan cannot be deleted'
                : (plan.subscriberCount ?? 0) > 0
                  ? `Cannot delete: ${plan.subscriberCount} tenant(s) are subscribed to this package`
                  : 'Delete package'}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
      </div>

      {activePlan && activePlanIndex !== null && (
        <div
          style={{
            border: '1px solid #cbd5e1',
            borderRadius: 8,
            padding: 14,
            marginBottom: 12,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 10,
            background: '#f8fafc',
          }}
        >
          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>
              {isReadOnly ? 'Viewing SaaS Billing Type' : 'Editing SaaS Billing Type'}: {activePlan.name || activePlan.id || 'New Package'}
            </strong>
            <div style={{ display: 'flex', gap: 8 }}>
              {!isReadOnly && (
                <button type="button" onClick={() => setActivePlanMode('view')} style={buttonBaseStyle}>Done Editing</button>
              )}
              {isReadOnly && (
                <button type="button" onClick={() => setActivePlanMode('edit')} style={primaryButtonStyle}>Switch to Edit</button>
              )}
              <button type="button" onClick={() => setActivePlanIndex(null)} style={buttonBaseStyle}>Close</button>
            </div>
          </div>
          <label style={{ display: 'grid', gap: 6, opacity: isReadOnly ? 0.85 : 1 }}>
            <span style={{ fontSize: 12, color: '#475569' }}>Package ID</span>
            <input
              value={activePlan.id}
              disabled={isReadOnly}
              onChange={(e) =>
                setPlans((p) => p.map((x, i) => (i === activePlanIndex ? { ...x, id: e.target.value.replace(/\s+/g, '-').toLowerCase() } : x)))
              }
              placeholder="e.g. growth"
            />
          </label>
          <label style={{ display: 'grid', gap: 6, opacity: isReadOnly ? 0.85 : 1 }}>
            <span style={{ fontSize: 12, color: '#475569' }}>Plan Title</span>
            <input
              value={activePlan.name}
              disabled={isReadOnly}
              onChange={(e) => setPlans((p) => p.map((x, i) => (i === activePlanIndex ? { ...x, name: e.target.value } : x)))}
            />
          </label>
          <label style={{ display: 'grid', gap: 6, opacity: isReadOnly ? 0.85 : 1 }}>
            <span style={{ fontSize: 12, color: '#475569' }}>Monthly Amount (UGX)</span>
            <input
              type="number"
              value={activePlan.priceUgx}
              disabled={isReadOnly}
              onChange={(e) => setPlans((p) => p.map((x, i) => (i === activePlanIndex ? { ...x, priceUgx: Number(e.target.value) } : x)))}
            />
            <small style={{ color: '#64748b' }}>Shown as {formatUgx(activePlan.priceUgx)} to tenants.</small>
          </label>
          <label style={{ display: 'grid', gap: 6, opacity: isReadOnly ? 0.85 : 1 }}>
            <span style={{ fontSize: 12, color: '#475569' }}>Trial Days</span>
            <input
              type="number"
              value={activePlan.trialDays}
              disabled={isReadOnly}
              onChange={(e) => setPlans((p) => p.map((x, i) => (i === activePlanIndex ? { ...x, trialDays: Number(e.target.value) } : x)))}
            />
          </label>
          <label style={{ display: 'grid', gap: 6, opacity: isReadOnly ? 0.85 : 1 }}>
            <span style={{ fontSize: 12, color: '#475569' }}>Detailed Description</span>
            <input
              value={activePlan.description ?? ''}
              disabled={isReadOnly}
              onChange={(e) => setPlans((p) => p.map((x, i) => (i === activePlanIndex ? { ...x, description: e.target.value } : x)))}
            />
          </label>
          <label style={{ display: 'grid', gap: 6, opacity: isReadOnly ? 0.85 : 1 }}>
            <span style={{ fontSize: 12, color: '#475569' }}>Max Tokens Per Package (monthly)</span>
            <input
              type="number"
              min={1}
              value={activePlan.maxTokensPerPackage ?? ''}
              disabled={isReadOnly}
              onChange={(e) => setPlans((p) => p.map((x, i) => (i === activePlanIndex ? { ...x, maxTokensPerPackage: e.target.value === '' || Number(e.target.value) <= 0 ? null : Number(e.target.value) } : x)))}
              placeholder="No cap"
            />
          </label>
          <label style={{ display: 'grid', gap: 6, opacity: isReadOnly ? 0.85 : 1 }}>
            <span style={{ fontSize: 12, color: '#475569' }}>Max Usage Amount Per Package (UGX/month)</span>
            <input
              type="number"
              min={1}
              value={activePlan.maxUsageAmountUgxPerPackage ?? ''}
              disabled={isReadOnly}
              onChange={(e) => setPlans((p) => p.map((x, i) => (i === activePlanIndex ? { ...x, maxUsageAmountUgxPerPackage: e.target.value === '' || Number(e.target.value) <= 0 ? null : Number(e.target.value) } : x)))}
              placeholder="No cap"
            />
            <small style={{ color: '#64748b' }}>If set, package expires early when this usage value is reached before 30 days.</small>
          </label>
          <label style={{ display: 'grid', gap: 6, opacity: isReadOnly ? 0.85 : 1 }}>
            <span style={{ fontSize: 12, color: '#475569' }}>Status</span>
            <select
              value={activePlan.active ? 'active' : 'inactive'}
              disabled={isReadOnly}
              onChange={(e) => setPlans((p) => p.map((x, i) => (i === activePlanIndex ? { ...x, active: e.target.value === 'active' } : x)))}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          {(activePlan.subscriberCount ?? 0) > 0 && (
            <small style={{ gridColumn: '1 / -1', color: '#991b1b', fontWeight: 600 }}>
              {activePlan.subscriberCount} tenant(s) are currently subscribed to this package.
            </small>
          )}
          {activePlan.id === 'free' && (
            <small style={{ gridColumn: '1 / -1', color: '#0f766e', fontWeight: 600 }}>Free plan value: Worth 5 USD tokens.</small>
          )}
        </div>
      )}

      <button type="button" onClick={addPlan} style={{ ...buttonBaseStyle, marginBottom: 16 }}>
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
            <button type="button" onClick={() => removeModel(idx)} style={dangerButtonStyle}>
              Delete
            </button>
          </div>
        ))}
        <button type="button" onClick={addModel} style={buttonBaseStyle}>+ Add Model</button>
      </div>

      <button onClick={save} disabled={saving} style={{ ...primaryButtonStyle, marginTop: 16, opacity: saving ? 0.7 : 1 }}>
        {saving ? 'Saving...' : 'Save Billing Settings'}
      </button>
    </div>
  );
}
