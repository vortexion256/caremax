import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useTenant } from '../TenantContext';

type TenantSummary = {
  tenantId: string;
  name: string;
};

type TenantDetails = {
  tenantId: string;
  name: string;
  privacyPolicy?: string;
  termsOfService?: string;
  contactEmail?: string;
  contactPhonePrimary?: string;
  contactPhoneSecondary?: string;
};

type ContentForm = {
  contactEmail: string;
  contactPhonePrimary: string;
  contactPhoneSecondary: string;
  privacyPolicy: string;
  termsOfService: string;
};

const emptyForm: ContentForm = {
  contactEmail: '',
  contactPhonePrimary: '',
  contactPhoneSecondary: '',
  privacyPolicy: '',
  termsOfService: '',
};

export default function PlatformContentAdmin() {
  const { isPlatformAdmin } = useTenant();
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [form, setForm] = useState<ContentForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    if (!isPlatformAdmin) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    api<{ tenants: TenantSummary[] }>('/platform/tenants')
      .then((res) => {
        const sorted = [...res.tenants].sort((a, b) => (a.name || a.tenantId).localeCompare(b.name || b.tenantId));
        setTenants(sorted);
        if (sorted.length > 0) {
          setSelectedTenantId((prev) => prev || sorted[0].tenantId);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load tenants'))
      .finally(() => setLoading(false));
  }, [isPlatformAdmin]);

  useEffect(() => {
    if (!selectedTenantId) {
      setForm(emptyForm);
      return;
    }

    setLoadingDetails(true);
    setError(null);
    api<TenantDetails>(`/platform/tenants/${selectedTenantId}`)
      .then((details) => {
        setForm({
          contactEmail: details.contactEmail ?? '',
          contactPhonePrimary: details.contactPhonePrimary ?? '',
          contactPhoneSecondary: details.contactPhoneSecondary ?? '',
          privacyPolicy: details.privacyPolicy ?? '',
          termsOfService: details.termsOfService ?? '',
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load tenant details'))
      .finally(() => setLoadingDetails(false));
  }, [selectedTenantId]);

  const selectedTenantName = useMemo(
    () => tenants.find((tenant) => tenant.tenantId === selectedTenantId)?.name ?? selectedTenantId,
    [selectedTenantId, tenants],
  );

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!selectedTenantId) return;

    try {
      setSaveState('saving');
      setError(null);
      await api(`/platform/tenants/${selectedTenantId}/settings`, {
        method: 'PATCH',
        body: JSON.stringify({
          contactEmail: form.contactEmail.trim(),
          contactPhonePrimary: form.contactPhonePrimary.trim(),
          contactPhoneSecondary: form.contactPhoneSecondary.trim(),
          privacyPolicy: form.privacyPolicy.trim(),
          termsOfService: form.termsOfService.trim(),
        }),
      });
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2000);
    } catch (e) {
      setSaveState('error');
      setError(e instanceof Error ? e.message : 'Failed to save settings');
    }
  }

  if (!isPlatformAdmin) {
    return <p style={{ color: '#c62828' }}>Platform admin access required.</p>;
  }

  if (loading) return <p>Loading SaaS content controls…</p>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Public Contact & Policy Controls</h1>
      <p style={{ color: '#64748b', marginBottom: 16 }}>
        Manage landing page contact details, support emails, privacy policy text, and terms of service from the CareMax SaaS Admin Console.
      </p>

      <div style={{ marginBottom: 16 }}>
        <label htmlFor="tenant-select" style={{ display: 'block', fontSize: 13, color: '#334155', marginBottom: 6 }}>
          Tenant
        </label>
        <select
          id="tenant-select"
          value={selectedTenantId}
          onChange={(e) => {
            setSelectedTenantId(e.target.value);
            if (saveState !== 'idle') setSaveState('idle');
          }}
          style={{
            width: '100%',
            maxWidth: 420,
            border: '1px solid #cbd5e1',
            borderRadius: 8,
            padding: '9px 10px',
            background: '#fff',
            fontSize: 14,
          }}
        >
          {tenants.length === 0 && <option value="">No tenants available</option>}
          {tenants.map((tenant) => (
            <option key={tenant.tenantId} value={tenant.tenantId}>
              {tenant.name || tenant.tenantId} ({tenant.tenantId})
            </option>
          ))}
        </select>
      </div>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      {selectedTenantId && (
        <form onSubmit={handleSave} style={{ display: 'grid', gap: 12 }}>
          <SectionCard title={`Landing Page Contact Info · ${selectedTenantName}`}>
            <LabeledInput
              label="Contact Email"
              value={form.contactEmail}
              onChange={(value) => setForm((prev) => ({ ...prev, contactEmail: value }))}
              placeholder="support@caremax.health"
              type="email"
            />
            <LabeledInput
              label="Primary Phone"
              value={form.contactPhonePrimary}
              onChange={(value) => setForm((prev) => ({ ...prev, contactPhonePrimary: value }))}
              placeholder="+256782830524"
            />
            <LabeledInput
              label="Secondary Phone"
              value={form.contactPhoneSecondary}
              onChange={(value) => setForm((prev) => ({ ...prev, contactPhoneSecondary: value }))}
              placeholder="+256753190830"
            />
          </SectionCard>

          <SectionCard title="Privacy Policy (Landing Page)">
            <LabeledTextArea
              label="Privacy Policy"
              value={form.privacyPolicy}
              onChange={(value) => setForm((prev) => ({ ...prev, privacyPolicy: value }))}
              rows={5}
            />
          </SectionCard>

          <SectionCard title="Terms of Service (Landing Page)">
            <LabeledTextArea
              label="Terms of Service"
              value={form.termsOfService}
              onChange={(value) => setForm((prev) => ({ ...prev, termsOfService: value }))}
              rows={5}
            />
          </SectionCard>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="submit"
              disabled={loadingDetails || saveState === 'saving'}
              style={{
                border: 0,
                borderRadius: 8,
                padding: '9px 14px',
                background: '#2563eb',
                color: '#fff',
                fontWeight: 600,
                cursor: loadingDetails || saveState === 'saving' ? 'wait' : 'pointer',
              }}
            >
              {saveState === 'saving' ? 'Saving…' : 'Save SaaS-Managed Content'}
            </button>
            {loadingDetails && <span style={{ fontSize: 13, color: '#64748b' }}>Loading selected tenant content…</span>}
            {saveState === 'saved' && <span style={{ fontSize: 13, color: '#15803d' }}>Saved successfully.</span>}
            {saveState === 'error' && <span style={{ fontSize: 13, color: '#dc2626' }}>Save failed.</span>}
          </div>
        </form>
      )}
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ padding: '14px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff' }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: '#0f172a' }}>{title}</div>
      <div style={{ display: 'grid', gap: 10 }}>{children}</div>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  type?: 'text' | 'email';
}) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 12, color: '#475569' }}>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px', fontSize: 14 }}
      />
    </label>
  );
}

function LabeledTextArea({
  label,
  value,
  onChange,
  rows,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  rows: number;
}) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 12, color: '#475569' }}>{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px', fontSize: 14, resize: 'vertical' }}
      />
    </label>
  );
}
