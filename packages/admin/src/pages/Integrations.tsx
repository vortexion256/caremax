import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type AgentConfig } from '../api';
import { useTenant } from '../TenantContext';

export default function Integrations() {
  const { tenantId } = useTenant();
  const [searchParams, setSearchParams] = useSearchParams();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      api<{ connected: boolean }>(`/tenants/${tenantId}/integrations/google/status`).then((r) => r.connected),
      api<AgentConfig>(`/tenants/${tenantId}/agent-config`),
    ])
      .then(([conn, cfg]) => {
        setConnected(conn);
        setConfig(cfg);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tenantId]);

  useEffect(() => {
    const google = searchParams.get('google');
    const tid = searchParams.get('tenantId');
    if (google && tid === tenantId) {
      if (google === 'success') {
        setMessage('Google account connected successfully.');
        setConnected(true);
      } else {
        setMessage('Google connection failed or was cancelled.');
      }
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, tenantId, setSearchParams]);

  const startConnectGoogle = () => {
    setError(null);
    api<{ url: string }>(`/tenants/${tenantId}/integrations/google/auth-url`)
      .then(({ url }) => {
        window.location.href = url;
      })
      .catch((e) => setError(e.message));
  };

  const disconnectGoogle = async () => {
    if (!confirm('Disconnect Google? The agent will no longer be able to query your sheet.')) return;
    setError(null);
    try {
      await api(`/tenants/${tenantId}/integrations/google/disconnect`, { method: 'POST' });
      setConnected(false);
      setMessage('Google account disconnected.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to disconnect');
    }
  };

  const saveSheetsConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/tenants/${tenantId}/agent-config`, {
        method: 'PUT',
        body: JSON.stringify({
          googleSheetsEnabled: config.googleSheetsEnabled ?? false,
          googleSheetsSpreadsheetId: (config.googleSheetsSpreadsheetId ?? '').trim() || undefined,
          googleSheetsRange: (config.googleSheetsRange ?? '').trim() || undefined,
        }),
      });
      setMessage('Settings saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading && connected === null) return <p>Loading...</p>;

  return (
    <div>
      <h1 style={{ margin: '0 0 16px 0' }}>Integrations</h1>
      {message && (
        <p style={{ padding: 12, background: '#e8f5e9', borderRadius: 8, marginBottom: 16 }}>{message}</p>
      )}
      {error && <p style={{ color: '#c62828', marginBottom: 16 }}>{error}</p>}

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Google Sheets &amp; Drive</h2>
        <p style={{ color: '#666', marginBottom: 16 }}>
          Connect a Google account so the agent can read a spreadsheet (e.g. booking details) when users ask. The agent will query the sheet only when needed.
        </p>
        {connected ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ padding: '6px 12px', background: '#e8f5e9', color: '#1b5e20', borderRadius: 6 }}>
              Connected
            </span>
            <button
              type="button"
              onClick={disconnectGoogle}
              style={{ padding: '6px 12px', fontSize: 14, border: '1px solid #c62828', color: '#c62828', background: '#fff', borderRadius: 6, cursor: 'pointer' }}
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={startConnectGoogle}
            style={{ padding: '8px 16px', fontSize: 14, background: '#0d47a1', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
          >
            Connect Google
          </button>
        )}
      </section>

      {connected && config && (
        <section>
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>Google Sheet for the agent</h2>
          <p style={{ color: '#666', marginBottom: 16 }}>
            Enter the spreadsheet ID (from the sheet URL: <code>https://docs.google.com/spreadsheets/d/<strong>SPREADSHEET_ID</strong>/edit</code>) and optionally a range. Enable to let the agent query this sheet when users ask (e.g. about bookings).
          </p>
          <form onSubmit={saveSheetsConfig} style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={config.googleSheetsEnabled ?? false}
                onChange={(e) => setConfig((c) => (c ? { ...c, googleSheetsEnabled: e.target.checked } : c))}
              />
              Enable Google Sheets (agent can query the sheet when needed)
            </label>
            <label>
              Spreadsheet ID
              <input
                type="text"
                value={config.googleSheetsSpreadsheetId ?? ''}
                onChange={(e) => setConfig((c) => (c ? { ...c, googleSheetsSpreadsheetId: e.target.value } : c))}
                placeholder="e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
                style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
              />
            </label>
            <label>
              Optional range (e.g. <code>Sheet1</code> or <code>Bookings!A:F</code>)
              <input
                type="text"
                value={config.googleSheetsRange ?? ''}
                onChange={(e) => setConfig((c) => (c ? { ...c, googleSheetsRange: e.target.value } : c))}
                placeholder="Leave empty for default (first sheet)"
                style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
              />
            </label>
            <button type="submit" disabled={saving} style={{ padding: '8px 16px', fontSize: 14, alignSelf: 'flex-start', cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
