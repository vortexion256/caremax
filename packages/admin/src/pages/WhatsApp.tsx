import { FormEvent, useEffect, useState } from 'react';
import { api } from '../api';
import { useTenant } from '../TenantContext';

type TwilioConfigResponse = {
  connected: boolean;
  whatsappNumber?: string;
  accountSid?: string;
  accountSidMasked?: string;
  authTokenMasked?: string;
  messagingServiceSid?: string;
  webhookSecretMasked?: string;
  updatedAt?: string | null;
};

type MetaConfigResponse = {
  connected: boolean;
  phoneNumberId?: string;
  accessTokenMasked?: string;
  webhookVerifyTokenMasked?: string;
  updatedAt?: string | null;
};

type TwilioFormState = {
  accountSid: string;
  authToken: string;
  whatsappNumber: string;
  messagingServiceSid: string;
  webhookSecret: string;
};

type MetaFormState = {
  phoneNumberId: string;
  accessToken: string;
  webhookVerifyToken: string;
};

const initialTwilioFormState: TwilioFormState = {
  accountSid: '',
  authToken: '',
  whatsappNumber: '',
  messagingServiceSid: '',
  webhookSecret: '',
};

const initialMetaFormState: MetaFormState = {
  phoneNumberId: '',
  accessToken: '',
  webhookVerifyToken: '',
};

export default function WhatsAppIntegration() {
  const { tenantId } = useTenant();
  const [provider, setProvider] = useState<'twilio' | 'meta'>('twilio');

  const [twilioStatus, setTwilioStatus] = useState<TwilioConfigResponse>({ connected: false });
  const [twilioForm, setTwilioForm] = useState<TwilioFormState>(initialTwilioFormState);

  const [metaStatus, setMetaStatus] = useState<MetaConfigResponse>({ connected: false });
  const [metaForm, setMetaForm] = useState<MetaFormState>(initialMetaFormState);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadConfig = async () => {
    if (!tenantId) return;
    setLoading(true);
    setError('');
    try {
      const [twilio, meta] = await Promise.all([
        api<TwilioConfigResponse>(`/tenants/${tenantId}/integrations/whatsapp/twilio`),
        api<MetaConfigResponse>(`/tenants/${tenantId}/integrations/whatsapp/meta`),
      ]);

      setTwilioStatus(twilio);
      setTwilioForm({
        accountSid: twilio.accountSid ?? '',
        authToken: '',
        whatsappNumber: twilio.whatsappNumber ?? '',
        messagingServiceSid: twilio.messagingServiceSid ?? '',
        webhookSecret: '',
      });

      setMetaStatus(meta);
      setMetaForm({
        phoneNumberId: meta.phoneNumberId ?? '',
        accessToken: '',
        webhookVerifyToken: '',
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

  const onSubmitTwilio = async (event: FormEvent) => {
    event.preventDefault();
    if (!tenantId) return;
    setSaving(true);
    setError('');
    setMessage('');

    try {
      await api(`/tenants/${tenantId}/integrations/whatsapp/twilio`, {
        method: 'PUT',
        body: JSON.stringify(twilioForm),
      });
      setMessage('WhatsApp Twilio integration saved successfully.');
      await loadConfig();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save WhatsApp Twilio settings');
    } finally {
      setSaving(false);
    }
  };

  const onSubmitMeta = async (event: FormEvent) => {
    event.preventDefault();
    if (!tenantId) return;
    setSaving(true);
    setError('');
    setMessage('');

    try {
      await api(`/tenants/${tenantId}/integrations/whatsapp/meta`, {
        method: 'PUT',
        body: JSON.stringify(metaForm),
      });
      setMessage('WhatsApp Meta integration saved successfully.');
      await loadConfig();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save WhatsApp Meta settings');
    } finally {
      setSaving(false);
    }
  };

  const disconnectTwilio = async () => {
    if (!tenantId) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await api(`/tenants/${tenantId}/integrations/whatsapp/twilio`, { method: 'DELETE' });
      setMessage('WhatsApp Twilio integration disconnected.');
      await loadConfig();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to disconnect WhatsApp Twilio settings');
    } finally {
      setSaving(false);
    }
  };

  const disconnectMeta = async () => {
    if (!tenantId) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await api(`/tenants/${tenantId}/integrations/whatsapp/meta`, { method: 'DELETE' });
      setMessage('WhatsApp Meta integration disconnected.');
      await loadConfig();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to disconnect WhatsApp Meta settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ color: '#64748b' }}>Loading WhatsApp integration...</div>;
  }

  const apiBaseUrl = (import.meta.env.VITE_API_URL ?? window.location.origin.replace('5173', '3001')).replace(/\/+$/, '');
  const twilioWebhookUrl = `${apiBaseUrl}/integrations/twilio/whatsapp/webhook/${tenantId}`;
  const metaWebhookUrl = `${apiBaseUrl}/integrations/meta/whatsapp/webhook/${tenantId}`;
  const statusFieldStyle = { overflowWrap: 'anywhere' as const, wordBreak: 'break-word' as const };

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 28, color: '#0f172a' }}>WhatsApp Agent</h1>
        <p style={{ marginTop: 8, color: '#475569' }}>
          Configure separate channels for WhatsApp via Twilio and WhatsApp Cloud API (Meta/Facebook).
        </p>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" onClick={() => setProvider('twilio')} style={{ borderRadius: 8, border: '1px solid #cbd5e1', padding: '8px 12px', background: provider === 'twilio' ? '#dbeafe' : '#fff' }}>WhatsApp Twilio</button>
        <button type="button" onClick={() => setProvider('meta')} style={{ borderRadius: 8, border: '1px solid #cbd5e1', padding: '8px 12px', background: provider === 'meta' ? '#dbeafe' : '#fff' }}>WhatsApp Meta (Facebook)</button>
      </div>

      {provider === 'twilio' ? (
        <>
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, background: '#f8fafc' }}>
            <div style={{ fontWeight: 600, color: '#0f172a' }}>Twilio Connection Status</div>
            <div style={{ marginTop: 8, color: twilioStatus.connected ? '#047857' : '#b45309', fontWeight: 600 }}>
              {twilioStatus.connected ? 'Connected' : 'Not Connected'}
            </div>
            {twilioStatus.connected && (
              <div style={{ marginTop: 10, color: '#475569', fontSize: 14, display: 'grid', gap: 4 }}>
                <span style={statusFieldStyle}>WhatsApp Number: {twilioStatus.whatsappNumber}</span>
                <span style={statusFieldStyle}>Twilio SID: {twilioStatus.accountSidMasked}</span>
                <span style={statusFieldStyle}>Auth Token: {twilioStatus.authTokenMasked}</span>
                {twilioStatus.webhookSecretMasked && <span style={statusFieldStyle}>Webhook Secret: {twilioStatus.webhookSecretMasked}</span>}
              </div>
            )}
          </div>

          <form onSubmit={onSubmitTwilio} style={{ display: 'grid', gap: 12 }}>
            {[
              { key: 'accountSid', label: 'Twilio Account SID', required: true },
              { key: 'authToken', label: 'Twilio Auth Token', required: true },
              { key: 'whatsappNumber', label: 'Twilio WhatsApp Number (e.g. whatsapp:+14155238886)', required: true },
              { key: 'messagingServiceSid', label: 'Messaging Service SID (optional)', required: false },
              { key: 'webhookSecret', label: 'Webhook Secret (optional)', required: false },
            ].map((field) => (
              <label key={field.key} style={{ display: 'grid', gap: 6, fontSize: 14, color: '#334155' }}>
                {field.label}
                <input
                  type="text"
                  required={field.required}
                  value={twilioForm[field.key as keyof TwilioFormState]}
                  onChange={(e) => setTwilioForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '10px 12px', fontSize: 14 }}
                />
              </label>
            ))}

            <div style={{ fontSize: 13, color: '#64748b', background: '#f8fafc', padding: 12, borderRadius: 8 }}>
              Configure the Twilio incoming webhook URL as:
              <div style={{ marginTop: 4, fontFamily: 'monospace', wordBreak: 'break-all', color: '#0f172a' }}>{twilioWebhookUrl}</div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="submit" disabled={saving} style={{ border: 'none', background: '#2563eb', color: '#fff', borderRadius: 8, padding: '10px 14px', fontWeight: 600, cursor: 'pointer' }}>
                {saving ? 'Saving...' : twilioStatus.connected ? 'Update Connection' : 'Connect Number'}
              </button>

              {twilioStatus.connected && (
                <button type="button" disabled={saving} onClick={disconnectTwilio} style={{ border: '1px solid #fecaca', background: '#fff1f2', color: '#be123c', borderRadius: 8, padding: '10px 14px', fontWeight: 600, cursor: 'pointer' }}>
                  Disconnect
                </button>
              )}
            </div>
          </form>
        </>
      ) : (
        <>
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, background: '#f8fafc' }}>
            <div style={{ fontWeight: 600, color: '#0f172a' }}>Meta Connection Status</div>
            <div style={{ marginTop: 8, color: metaStatus.connected ? '#047857' : '#b45309', fontWeight: 600 }}>
              {metaStatus.connected ? 'Connected' : 'Not Connected'}
            </div>
            {metaStatus.connected && (
              <div style={{ marginTop: 10, color: '#475569', fontSize: 14, display: 'grid', gap: 4 }}>
                <span style={statusFieldStyle}>Phone Number ID: {metaStatus.phoneNumberId}</span>
                <span style={statusFieldStyle}>Access Token: {metaStatus.accessTokenMasked}</span>
                {metaStatus.webhookVerifyTokenMasked && <span style={statusFieldStyle}>Verify Token: {metaStatus.webhookVerifyTokenMasked}</span>}
              </div>
            )}
          </div>

          <form onSubmit={onSubmitMeta} style={{ display: 'grid', gap: 12 }}>
            {[
              { key: 'phoneNumberId', label: 'Meta WhatsApp Phone Number ID', required: true },
              { key: 'accessToken', label: 'Meta Permanent Access Token', required: true },
              { key: 'webhookVerifyToken', label: 'Webhook Verify Token', required: false },
            ].map((field) => (
              <label key={field.key} style={{ display: 'grid', gap: 6, fontSize: 14, color: '#334155' }}>
                {field.label}
                <input
                  type="text"
                  required={field.required}
                  value={metaForm[field.key as keyof MetaFormState]}
                  onChange={(e) => setMetaForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '10px 12px', fontSize: 14 }}
                />
              </label>
            ))}

            <div style={{ fontSize: 13, color: '#64748b', background: '#f8fafc', padding: 12, borderRadius: 8 }}>
              Configure the Meta webhook callback URL as:
              <div style={{ marginTop: 4, fontFamily: 'monospace', wordBreak: 'break-all', color: '#0f172a' }}>{metaWebhookUrl}</div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="submit" disabled={saving} style={{ border: 'none', background: '#2563eb', color: '#fff', borderRadius: 8, padding: '10px 14px', fontWeight: 600, cursor: 'pointer' }}>
                {saving ? 'Saving...' : metaStatus.connected ? 'Update Connection' : 'Connect Number'}
              </button>

              {metaStatus.connected && (
                <button type="button" disabled={saving} onClick={disconnectMeta} style={{ border: '1px solid #fecaca', background: '#fff1f2', color: '#be123c', borderRadius: 8, padding: '10px 14px', fontWeight: 600, cursor: 'pointer' }}>
                  Disconnect
                </button>
              )}
            </div>
          </form>
        </>
      )}

      {message && <div style={{ color: '#047857', fontWeight: 500 }}>{message}</div>}
      {error && <div style={{ color: '#b91c1c', fontWeight: 500 }}>{error}</div>}
    </div>
  );
}
