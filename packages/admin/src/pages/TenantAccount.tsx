import { FormEvent, useEffect, useState } from 'react';
import { useTenant } from '../TenantContext';
import { api } from '../api';

type Account = {
  tenantId: string;
  name: string;
  privacyPolicy: string;
  termsOfService: string;
  contactEmail: string;
  contactPhonePrimary: string;
  contactPhoneSecondary: string;
  createdAt: number | null;
  createdBy: string | null;
  billingPlanId: string;
};

export default function TenantAccount() {
  const { tenantId, email, uid } = useTenant();
  const [account, setAccount] = useState<Account | null>(null);
  const [organizationName, setOrganizationName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    if (!tenantId || tenantId === 'platform') {
      setError('Account settings are only available for a tenant admin profile.');
      setAccount(null);
      return;
    }

    setError(null);
    api<Account>(`/tenants/${tenantId}/account`)
      .then((res) => {
        setAccount(res);
        setOrganizationName(res.name ?? '');
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : 'Failed to load account details';
        setError(message);
        setAccount(null);
      });
  }, [tenantId]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!tenantId || !account) return;

    const trimmedName = organizationName.trim();
    if (!trimmedName) {
      setSaveState('error');
      return;
    }

    try {
      setSaveState('saving');
      await api(`/tenants/${tenantId}/account`, {
        method: 'PUT',
        body: JSON.stringify({
          name: trimmedName,
        }),
      });
      setAccount((prev) => (prev ? {
        ...prev,
        name: trimmedName,
      } : prev));
      setOrganizationName(trimmedName);
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2000);
    } catch {
      setSaveState('error');
    }
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Account Settings</h1>
      <p style={{ color: '#64748b' }}>Tenant account details and subscription assignment.</p>
      {!account && !error && <p>Loading account details...</p>}
      {error && <p style={{ color: '#dc2626' }}>Could not load account details: {error}</p>}
      {account && (
        <div style={{ display: 'grid', gap: 12 }}>
          <Info label="Tenant ID" value={account.tenantId} mono />

          <form onSubmit={handleSave} style={{ padding: '12px 14px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#f8fafc' }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>Organization</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                value={organizationName}
                onChange={(e) => {
                  setOrganizationName(e.target.value);
                  if (saveState !== 'idle') setSaveState('idle');
                }}
                style={{
                  flex: 1,
                  minWidth: 220,
                  border: '1px solid #cbd5e1',
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 14,
                }}
              />
              <button
                type="submit"
                disabled={saveState === 'saving' || organizationName.trim() === ''}
                style={{
                  border: 0,
                  borderRadius: 8,
                  padding: '8px 12px',
                  background: '#2563eb',
                  color: '#fff',
                  cursor: saveState === 'saving' ? 'wait' : 'pointer',
                  opacity: saveState === 'saving' ? 0.8 : 1,
                  fontWeight: 600,
                }}
              >
                {saveState === 'saving' ? 'Saving…' : 'Save'}
              </button>
            </div>
            {saveState === 'saved' && <div style={{ color: '#15803d', fontSize: 12, marginTop: 6 }}>Organization name updated.</div>}
            {saveState === 'error' && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 6 }}>Could not save name. Check input and try again.</div>}
          </form>

          <Info label="Contact Email (managed by SaaS Admin)" value={account.contactEmail || '—'} />
          <Info label="Primary Phone (managed by SaaS Admin)" value={account.contactPhonePrimary || '—'} />
          <Info label="Secondary Phone (managed by SaaS Admin)" value={account.contactPhoneSecondary || '—'} />
          <Info label="Privacy Policy (managed by SaaS Admin)" value={account.privacyPolicy || '—'} />
          <Info label="Terms of Service (managed by SaaS Admin)" value={account.termsOfService || '—'} />

          <Info label="Admin Email" value={email || '—'} />
          <Info label="Admin UID" value={uid || '—'} mono />
          <Info label="Billing Plan" value={account.billingPlanId} />
          <Info label="Created" value={account.createdAt ? new Date(account.createdAt).toLocaleString() : '—'} />
          <Info label="Created By UID" value={account.createdBy || '—'} mono />
        </div>
      )}
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ padding: '12px 14px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#f8fafc' }}>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, color: '#0f172a', fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</div>
    </div>
  );
}
