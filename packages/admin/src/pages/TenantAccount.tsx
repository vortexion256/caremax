import { FormEvent, useEffect, useState } from 'react';
import { useTenant } from '../TenantContext';
import { api } from '../api';
import AppNotification from '../components/AppNotification';

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
type DoctorUser = {
  doctorUserId: string;
  email: string;
  displayName: string;
  createdAt: number | null;
  interactionsHandled?: number;
  activeConversations?: number;
};

export default function TenantAccount() {
  const { tenantId, email, uid } = useTenant();
  const [account, setAccount] = useState<Account | null>(null);
  const [organizationName, setOrganizationName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [doctors, setDoctors] = useState<DoctorUser[]>([]);
  const [doctorEmail, setDoctorEmail] = useState('');
  const [doctorName, setDoctorName] = useState('');
  const [doctorError, setDoctorError] = useState<string | null>(null);
  const [doctorSuccess, setDoctorSuccess] = useState<string | null>(null);

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
    api<{ doctors: DoctorUser[] }>(`/tenants/${tenantId}/doctors`).then((res) => setDoctors(res.doctors)).catch(() => setDoctors([]));
  }, [tenantId]);

  async function addDoctor(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setDoctorError(null);
    setDoctorSuccess(null);
    try {
      await api(`/tenants/${tenantId}/doctors`, {
        method: 'POST',
        body: JSON.stringify({ email: doctorEmail, displayName: doctorName || undefined }),
      });
      const refreshed = await api<{ doctors: DoctorUser[] }>(`/tenants/${tenantId}/doctors`);
      setDoctors(refreshed.doctors);
      setDoctorEmail('');
      setDoctorName('');
      setDoctorSuccess('Doctor has been added successfully.');
    } catch (e) {
      setDoctorError(e instanceof Error ? e.message : 'Failed to add doctor');
    }
  }

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
      {doctorSuccess && <AppNotification message={doctorSuccess} type="success" onClose={() => setDoctorSuccess(null)} />}
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
          <Info label="Admin Email" value={email || '—'} />
          <Info label="Admin UID" value={uid || '—'} mono />
          <Info label="Billing Plan" value={account.billingPlanId} />
          <Info label="Created" value={account.createdAt ? new Date(account.createdAt).toLocaleString() : '—'} />
          <Info label="Created By UID" value={account.createdBy || '—'} mono />
          <form onSubmit={addDoctor} style={{ padding: '12px 14px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#f8fafc' }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>Doctor users (handoff team)</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input value={doctorEmail} onChange={(e) => setDoctorEmail(e.target.value)} placeholder="doctor@email.com" style={{ flex: 1, minWidth: 220, border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px' }} />
              <input value={doctorName} onChange={(e) => setDoctorName(e.target.value)} placeholder="Display name (optional)" style={{ flex: 1, minWidth: 180, border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px' }} />
              <button type="submit" style={{ border: 0, borderRadius: 8, padding: '8px 12px', background: '#2563eb', color: '#fff', fontWeight: 600 }}>Add Doctor</button>
            </div>
            {doctorError && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 6 }}>{doctorError}</div>}
            <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
              {doctors.length === 0 && <div style={{ fontSize: 13, color: '#64748b' }}>No doctors added yet.</div>}
              {doctors.map((d) => (
                <div key={d.doctorUserId} style={{ fontSize: 13, color: '#0f172a', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', background: '#fff' }}>
                  <div style={{ fontWeight: 600 }}>{d.displayName || 'Doctor'} — {d.email}</div>
                  <div style={{ color: '#475569', marginTop: 4, fontSize: 12 }}>
                    Interactions handled: {d.interactionsHandled ?? 0} · Active chats: {d.activeConversations ?? 0}
                  </div>
                </div>
              ))}
            </div>
          </form>
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
