import { useEffect, useState } from 'react';
import { useTenant } from '../TenantContext';
import { api } from '../api';

type Account = {
  tenantId: string;
  name: string;
  allowedDomains: string[];
  createdAt: number | null;
  createdBy: string | null;
  billingPlanId: string;
};

export default function TenantAccount() {
  const { tenantId, email, uid } = useTenant();
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : 'Failed to load account details';
        setError(message);
        setAccount(null);
      });
  }, [tenantId]);

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Account Settings</h1>
      <p style={{ color: '#64748b' }}>Tenant account details and subscription assignment.</p>
      {!account && !error && <p>Loading account details...</p>}
      {error && <p style={{ color: '#dc2626' }}>Could not load account details: {error}</p>}
      {account && (
        <div style={{ display: 'grid', gap: 12 }}>
          <Info label="Tenant ID" value={account.tenantId} mono />
          <Info label="Organization" value={account.name || '—'} />
          <Info label="Admin Email" value={email || '—'} />
          <Info label="Admin UID" value={uid || '—'} mono />
          <Info label="Billing Plan" value={account.billingPlanId} />
          <Info label="Allowed Domains" value={account.allowedDomains.length ? account.allowedDomains.join(', ') : 'No domain restrictions'} />
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
