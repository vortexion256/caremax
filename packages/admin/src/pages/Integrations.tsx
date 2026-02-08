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

  type SheetEntry = { spreadsheetId: string; range?: string; useWhen: string };

  const sheetsList: SheetEntry[] = Array.isArray(config?.googleSheets) && config.googleSheets.length > 0
    ? config.googleSheets
    : config?.googleSheetsSpreadsheetId?.trim()
      ? [{ spreadsheetId: config.googleSheetsSpreadsheetId.trim(), range: config.googleSheetsRange?.trim() || undefined, useWhen: 'general' }]
      : [];

  const addSheet = () => {
    setConfig((c) => (c ? { ...c, googleSheets: [...(c.googleSheets ?? sheetsList), { spreadsheetId: '', useWhen: '' }] } : c));
  };

  const updateSheet = (index: number, field: keyof SheetEntry, value: string) => {
    setConfig((c) => {
      if (!c) return c;
      const list = c.googleSheets ?? sheetsList;
      const next = [...list];
      if (!next[index]) return c;
      next[index] = { ...next[index], [field]: value };
      return { ...c, googleSheets: next };
    });
  };

  const removeSheet = (index: number) => {
    setConfig((c) => {
      if (!c) return c;
      const list = c.googleSheets ?? sheetsList;
      const next = list.filter((_, i) => i !== index);
      return { ...c, googleSheets: next };
    });
  };

  const saveSheetsConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;
    const list = config.googleSheets ?? sheetsList;
    const valid = list
      .filter((s) => (s.spreadsheetId ?? '').trim() && (s.useWhen ?? '').trim())
      .map((s) => ({ spreadsheetId: s.spreadsheetId.trim(), range: s.range?.trim() || undefined, useWhen: s.useWhen.trim() }));
    setSaving(true);
    setError(null);
    try {
      await api(`/tenants/${tenantId}/agent-config`, {
        method: 'PUT',
        body: JSON.stringify({ googleSheets: valid }),
      });
      setConfig((c) => (c ? { ...c, googleSheets: valid } : c));
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
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>Google Sheets for the agent</h2>
          <p style={{ color: '#666', marginBottom: 16 }}>
            Add one or more spreadsheets. For each, set <strong>Use when</strong> (e.g. &quot;bookings&quot;, &quot;appointments&quot;, &quot;inventory&quot;) so the agent only queries that sheet when the user&apos;s question matches. This avoids calling every sheet on every request.
          </p>
          <form onSubmit={saveSheetsConfig} style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 20 }}>
            {(config.googleSheets ?? sheetsList).map((sheet, index) => (
              <div
                key={index}
                style={{
                  padding: 16,
                  border: '1px solid #e0e0e0',
                  borderRadius: 8,
                  background: '#fafafa',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: 14 }}>Sheet {index + 1}</strong>
                  <button
                    type="button"
                    onClick={() => removeSheet(index)}
                    style={{ padding: '4px 8px', fontSize: 12, color: '#c62828', border: '1px solid #c62828', background: '#fff', borderRadius: 6, cursor: 'pointer' }}
                  >
                    Remove
                  </button>
                </div>
                <label>
                  Use when (when should the agent query this sheet?)
                  <input
                    type="text"
                    value={sheet.useWhen}
                    onChange={(e) => updateSheet(index, 'useWhen', e.target.value)}
                    placeholder="e.g. bookings, appointments, inventory"
                    style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
                  />
                  <span style={{ fontSize: 12, color: '#666', marginTop: 4, display: 'block' }}>Short label; the agent will only call this sheet when the user&apos;s question fits this topic.</span>
                </label>
                <label>
                  Spreadsheet ID
                  <input
                    type="text"
                    value={sheet.spreadsheetId}
                    onChange={(e) => updateSheet(index, 'spreadsheetId', e.target.value)}
                    placeholder="From URL: .../d/SPREADSHEET_ID/edit"
                    style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
                  />
                </label>
                <label>
                  Optional range (e.g. Sheet1 or Bookings!A:F)
                  <input
                    type="text"
                    value={sheet.range ?? ''}
                    onChange={(e) => updateSheet(index, 'range', e.target.value)}
                    placeholder="Leave empty for default"
                    style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
                  />
                </label>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <button
                type="button"
                onClick={addSheet}
                style={{ padding: '8px 16px', fontSize: 14, border: '1px dashed #0d47a1', color: '#0d47a1', background: '#fff', borderRadius: 6, cursor: 'pointer' }}
              >
                Add sheet
              </button>
              <button type="submit" disabled={saving} style={{ padding: '8px 16px', fontSize: 14, background: '#0d47a1', color: '#fff', border: 'none', borderRadius: 6, cursor: saving ? 'not-allowed' : 'pointer' }}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
