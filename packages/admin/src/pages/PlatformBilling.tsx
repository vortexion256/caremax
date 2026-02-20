import { useEffect, useState } from 'react';
import { api } from '../api';

type Plan = { id: string; name: string; priceUsd: number; billingCycle: 'monthly'; trialDays: number; active: boolean; description?: string };

export default function PlatformBilling() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [saving, setSaving] = useState(false);

  const load = () => api<{ plans: Plan[] }>('/platform/billing/plans').then((d) => setPlans(d.plans));
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    await api('/platform/billing/plans', { method: 'PUT', body: JSON.stringify({ plans }) });
    setSaving(false);
    load();
  };

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Billing Plan Management</h1>
      <p style={{ color: '#64748b' }}>Configure SaaS billing types and monthly amount.</p>
      {plans.map((plan, idx) => (
        <div key={plan.id} style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: 12, marginBottom: 10, display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8 }}>
          <input value={plan.name} onChange={(e) => setPlans((p) => p.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))} />
          <input type="number" value={plan.priceUsd} onChange={(e) => setPlans((p) => p.map((x, i) => i === idx ? { ...x, priceUsd: Number(e.target.value) } : x))} />
          <input type="number" value={plan.trialDays} onChange={(e) => setPlans((p) => p.map((x, i) => i === idx ? { ...x, trialDays: Number(e.target.value) } : x))} />
          <small style={{ gridColumn: '1 / -1', color: '#64748b' }}>{plan.id} • monthly</small>
        </div>
      ))}
      <button onClick={save} disabled={saving} style={{ padding: '8px 14px' }}>{saving ? 'Saving...' : 'Save Plans'}</button>
    </div>
  );
}
