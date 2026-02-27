import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { api } from '../api';
import { useTenant } from '../TenantContext';

type PublicContent = {
  privacyPolicy: string;
  termsOfService: string;
  contactEmail: string;
  contactPhonePrimary: string;
  contactPhoneSecondary: string;
  enableLandingVanta: boolean;
};

const emptyForm: PublicContent = {
  contactEmail: '',
  contactPhonePrimary: '',
  contactPhoneSecondary: '',
  privacyPolicy: '',
  termsOfService: '',
  enableLandingVanta: false,
};

export default function PlatformContentAdmin() {
  const { isPlatformAdmin } = useTenant();
  const [form, setForm] = useState<PublicContent>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    if (!isPlatformAdmin) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    api<PublicContent>('/platform/public-content')
      .then((details) => setForm(details))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load public content settings'))
      .finally(() => setLoading(false));
  }, [isPlatformAdmin]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();

    try {
      setSaveState('saving');
      setError(null);
      await api('/platform/public-content', {
        method: 'PUT',
        body: JSON.stringify({
          contactEmail: form.contactEmail.trim(),
          contactPhonePrimary: form.contactPhonePrimary.trim(),
          contactPhoneSecondary: form.contactPhoneSecondary.trim(),
          privacyPolicy: form.privacyPolicy.trim(),
          termsOfService: form.termsOfService.trim(),
          enableLandingVanta: form.enableLandingVanta,
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
        Manage one global set of landing page contact details, privacy policy text, and terms of service for the public CareMax website.
      </p>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <form onSubmit={handleSave} style={{ display: 'grid', gap: 12 }}>
        <SectionCard title='Landing Page Contact Info (Global)'>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <input
              type='checkbox'
              checked={form.enableLandingVanta}
              onChange={(e) => setForm((prev) => ({ ...prev, enableLandingVanta: e.target.checked }))}
            />
            <span style={{ fontSize: 13, color: '#334155' }}>Enable Vanta animated background on the first landing section</span>
          </label>
          <LabeledInput
            label='Contact Email'
            value={form.contactEmail}
            onChange={(value) => setForm((prev) => ({ ...prev, contactEmail: value }))}
            placeholder='support@caremax.health'
            type='email'
          />
          <LabeledInput
            label='Primary Phone'
            value={form.contactPhonePrimary}
            onChange={(value) => setForm((prev) => ({ ...prev, contactPhonePrimary: value }))}
            placeholder='+256782830524'
          />
          <LabeledInput
            label='Secondary Phone'
            value={form.contactPhoneSecondary}
            onChange={(value) => setForm((prev) => ({ ...prev, contactPhoneSecondary: value }))}
            placeholder='+256753190830'
          />
        </SectionCard>

        <SectionCard title='Privacy Policy (Landing Page)'>
          <LabeledTextArea
            label='Privacy Policy'
            value={form.privacyPolicy}
            onChange={(value) => setForm((prev) => ({ ...prev, privacyPolicy: value }))}
            rows={5}
          />
        </SectionCard>

        <SectionCard title='Terms of Service (Landing Page)'>
          <LabeledTextArea
            label='Terms of Service'
            value={form.termsOfService}
            onChange={(value) => setForm((prev) => ({ ...prev, termsOfService: value }))}
            rows={5}
          />
        </SectionCard>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type='submit'
            disabled={saveState === 'saving'}
            style={{
              border: 0,
              borderRadius: 8,
              padding: '9px 14px',
              background: '#2563eb',
              color: '#fff',
              fontWeight: 600,
              cursor: saveState === 'saving' ? 'wait' : 'pointer',
            }}
          >
            {saveState === 'saving' ? 'Saving…' : 'Save Global Landing Content'}
          </button>
          {saveState === 'saved' && <span style={{ fontSize: 13, color: '#15803d' }}>Saved successfully.</span>}
          {saveState === 'error' && <span style={{ fontSize: 13, color: '#dc2626' }}>Save failed.</span>}
        </div>
      </form>
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
