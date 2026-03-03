import { FormEvent, useEffect, useState } from 'react';
import { api } from '../api';
import { useTenant } from '../TenantContext';

type WhatsAppConfigResponse = {
  connected: boolean;
  whatsappNumber?: string;
  accountSid?: string;
  accountSidMasked?: string;
  authTokenMasked?: string;
  messagingServiceSid?: string;
  webhookSecretMasked?: string;
  aiVoiceReplyEnabled?: boolean;
  aiVoiceReplyCharThreshold?: number;
  updatedAt?: string | null;
};

type TextFieldKey = 'accountSid' | 'authToken' | 'whatsappNumber' | 'messagingServiceSid' | 'webhookSecret';

type FormState = {
  accountSid: string;
  authToken: string;
  whatsappNumber: string;
  messagingServiceSid: string;
  webhookSecret: string;
  aiVoiceReplyEnabled: boolean;
  aiVoiceReplyCharThreshold: string;
};

const initialFormState: FormState = {
  accountSid: '',
  authToken: '',
  whatsappNumber: '',
  messagingServiceSid: '',
  webhookSecret: '',
  aiVoiceReplyEnabled: false,
  aiVoiceReplyCharThreshold: '320',
};

export default function WhatsAppIntegration() {
  const { tenantId } = useTenant();
  const [status, setStatus] = useState<WhatsAppConfigResponse>({ connected: false });
  const [form, setForm] = useState<FormState>(initialFormState);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadConfig = async () => {
    if (!tenantId) return;
    setLoading(true);
    setError('');
    try {
      const res = await api<WhatsAppConfigResponse>(`/tenants/${tenantId}/integrations/whatsapp`);
      setStatus(res);
      setForm({
        accountSid: res.accountSid ?? '',
        authToken: '',
        whatsappNumber: res.whatsappNumber ?? '',
        messagingServiceSid: res.messagingServiceSid ?? '',
        webhookSecret: '',
        aiVoiceReplyEnabled: res.aiVoiceReplyEnabled === true,
        aiVoiceReplyCharThreshold: String(res.aiVoiceReplyCharThreshold ?? 320),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load WhatsApp settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfig();
  }, [tenantId]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!tenantId) return;
    setSaving(true);
    setError('');
    setMessage('');

    try {
      const parsedThreshold = Number.parseInt(form.aiVoiceReplyCharThreshold, 10);
      await api(`/tenants/${tenantId}/integrations/whatsapp`, {
        method: 'PUT',
        body: JSON.stringify({
          ...form,
          aiVoiceReplyCharThreshold: Number.isFinite(parsedThreshold) ? parsedThreshold : 320,
        }),
      });
      setMessage('WhatsApp number connected successfully.');
      await loadConfig();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save WhatsApp settings');
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    if (!tenantId) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await api(`/tenants/${tenantId}/integrations/whatsapp`, { method: 'DELETE' });
      setMessage('WhatsApp integration disconnected.');
      await loadConfig();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to disconnect WhatsApp settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ color: '#64748b' }}>Loading WhatsApp integration...</div>;
  }

  const webhookUrl = `${window.location.origin.replace('5173', '3001')}/integrations/twilio/whatsapp/webhook/${tenantId}`;

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 28, color: '#0f172a' }}>WhatsApp Agent</h1>
        <p style={{ marginTop: 8, color: '#475569' }}>
          Connect a Twilio WhatsApp number so people can text your agent outside the widget.
        </p>
      </div>

      <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, background: '#f8fafc' }}>
        <div style={{ fontWeight: 600, color: '#0f172a' }}>Connection Status</div>
        <div style={{ marginTop: 8, color: status.connected ? '#047857' : '#b45309', fontWeight: 600 }}>
          {status.connected ? 'Connected' : 'Not Connected'}
        </div>
        {status.connected && (
          <div style={{ marginTop: 10, color: '#475569', fontSize: 14, display: 'grid', gap: 4 }}>
            <span>WhatsApp Number: {status.whatsappNumber}</span>
            <span>Twilio SID: {status.accountSidMasked}</span>
            <span>Auth Token: {status.authTokenMasked}</span>
            {status.webhookSecretMasked && <span>Webhook Secret: {status.webhookSecretMasked}</span>}
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
        {([
          { key: 'accountSid', label: 'Twilio Account SID', required: true },
          { key: 'authToken', label: 'Twilio Auth Token', required: true },
          { key: 'whatsappNumber', label: 'Twilio WhatsApp Number (e.g. whatsapp:+14155238886)', required: true },
          { key: 'messagingServiceSid', label: 'Messaging Service SID (optional)', required: false },
          { key: 'webhookSecret', label: 'Webhook Secret (optional)', required: false },
        ] as Array<{ key: TextFieldKey; label: string; required: boolean }>).map((field) => (
          <label key={field.key} style={{ display: 'grid', gap: 6, fontSize: 14, color: '#334155' }}>
            {field.label}
            <input
              type="text"
              required={field.required}
              value={form[field.key]}
              onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
              style={{
                border: '1px solid #cbd5e1',
                borderRadius: 8,
                padding: '10px 12px',
                fontSize: 14,
              }}
            />
          </label>
        ))}

        <div style={{ display: 'grid', gap: 8, border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, background: '#f8fafc' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#334155' }}>
            <input
              type="checkbox"
              checked={form.aiVoiceReplyEnabled}
              onChange={(e) => setForm((prev) => ({ ...prev, aiVoiceReplyEnabled: e.target.checked }))}
            />
            Enable AI voice-note replies on WhatsApp for long responses
          </label>

          <label style={{ display: 'grid', gap: 6, fontSize: 14, color: '#334155', maxWidth: 360 }}>
            Character threshold for voice note
            <input
              type="number"
              min={80}
              max={4000}
              value={form.aiVoiceReplyCharThreshold}
              onChange={(e) => setForm((prev) => ({ ...prev, aiVoiceReplyCharThreshold: e.target.value }))}
              disabled={!form.aiVoiceReplyEnabled}
              style={{
                border: '1px solid #cbd5e1',
                borderRadius: 8,
                padding: '10px 12px',
                fontSize: 14,
                background: form.aiVoiceReplyEnabled ? '#fff' : '#f1f5f9',
              }}
            />
          </label>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            Default is 320 characters. When enabled, AI replies at or above this length are sent as voice notes (WhatsApp only).
          </div>
        </div>

        <div style={{ fontSize: 13, color: '#64748b', background: '#f8fafc', padding: 12, borderRadius: 8 }}>
          Configure the Twilio incoming webhook URL as:
          <div style={{ marginTop: 4, fontFamily: 'monospace', wordBreak: 'break-all', color: '#0f172a' }}>{webhookUrl}</div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="submit"
            disabled={saving}
            style={{
              border: 'none',
              background: '#2563eb',
              color: '#fff',
              borderRadius: 8,
              padding: '10px 14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {saving ? 'Saving...' : status.connected ? 'Update Connection' : 'Connect Number'}
          </button>

          {status.connected && (
            <button
              type="button"
              disabled={saving}
              onClick={disconnect}
              style={{
                border: '1px solid #fecaca',
                background: '#fff1f2',
                color: '#be123c',
                borderRadius: 8,
                padding: '10px 14px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Disconnect
            </button>
          )}
        </div>
      </form>

      {message && <div style={{ color: '#047857', fontWeight: 500 }}>{message}</div>}
      {error && <div style={{ color: '#b91c1c', fontWeight: 500 }}>{error}</div>}
    </div>
  );
}
