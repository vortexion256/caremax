import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type AgentConfig } from '../api';
import { useTenant } from '../TenantContext';
import { useIsMobile } from '../hooks/useIsMobile';

export default function Integrations() {
  const { tenantId } = useTenant();
  const { isMobile } = useIsMobile();
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
      setTimeout(() => setMessage(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading && connected === null) return <div style={{ color: '#64748b' }}>Loading integrations...</div>;

  return (
    <div>
      <h1 style={{ margin: '0 0 8px 0', fontSize: isMobile ? 24 : 32 }}>Integrations</h1>
      <p style={{ color: '#64748b', marginBottom: 32, maxWidth: 600 }}>
        Connect external services to expand your agent's capabilities.
      </p>

      {message && (
        <div style={{ padding: 12, background: '#f0fdf4', color: '#166534', borderRadius: 8, marginBottom: 24, fontSize: 14 }}>
          {message}
        </div>
      )}
      {error && (
        <div style={{ padding: 12, background: '#fef2f2', color: '#991b1b', borderRadius: 8, marginBottom: 24, fontSize: 14 }}>
          {error}
        </div>
      )}

      <section style={{ 
        background: '#fff', 
        border: '1px solid #e2e8f0', 
        borderRadius: 12, 
        padding: 24,
        marginBottom: 32
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ flex: '1 1 400px' }}>
            <h2 style={{ fontSize: 18, margin: '0 0 8px 0', color: '#0f172a' }}>Google Sheets & Drive</h2>
            <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.5, margin: 0 }}>
              Allow the agent to query spreadsheets for real-time data like bookings, inventory, or appointments.
            </p>
          </div>
          
          {connected ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ 
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px', 
                background: '#f0fdf4', 
                color: '#166534', 
                borderRadius: 20,
                fontSize: 13,
                fontWeight: 600
              }}>
                <span style={{ width: 6, height: 6, background: '#22c55e', borderRadius: '50%' }}></span>
                Connected
              </span>
              <button
                type="button"
                onClick={disconnectGoogle}
                style={{ 
                  padding: '8px 14px', 
                  fontSize: 13, 
                  border: '1px solid #e2e8f0', 
                  color: '#ef4444', 
                  background: '#fff', 
                  borderRadius: 8, 
                  cursor: 'pointer',
                  fontWeight: 500
                }}
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={startConnectGoogle}
              style={{ 
                padding: '10px 20px', 
                fontSize: 14, 
                background: '#2563eb', 
                color: '#fff', 
                border: 'none', 
                borderRadius: 8, 
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              Connect Google Account
            </button>
          )}
        </div>
      </section>

      {connected && config && (
        <section>
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 18, margin: '0 0 4px 0', color: '#0f172a' }}>Agent Spreadsheets</h2>
            <p style={{ color: '#64748b', fontSize: 14 }}>
              Configure which sheets the agent should access and when.
            </p>
          </div>
          
          <form onSubmit={saveSheetsConfig} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {(config.googleSheets ?? sheetsList).map((sheet, index) => (
                <div
                  key={index}
                  style={{
                    padding: 20,
                    border: '1px solid #e2e8f0',
                    borderRadius: 12,
                    background: '#f8fafc',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 16,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Sheet #{index + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeSheet(index)}
                      style={{ 
                        padding: '4px 8px', 
                        fontSize: 12, 
                        color: '#ef4444', 
                        border: 'none', 
                        background: 'transparent', 
                        cursor: 'pointer',
                        fontWeight: 600
                      }}
                    >
                      Remove
                    </button>
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                        Use when...
                      </label>
                      <input
                        type="text"
                        value={sheet.useWhen}
                        onChange={(e) => updateSheet(index, 'useWhen', e.target.value)}
                        placeholder="e.g. bookings, appointments"
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                        Spreadsheet ID
                      </label>
                      <input
                        type="text"
                        value={sheet.spreadsheetId}
                        onChange={(e) => updateSheet(index, 'spreadsheetId', e.target.value)}
                        placeholder="Paste ID from URL"
                        style={{ width: '100%' }}
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                      Optional Range
                    </label>
                    <input
                      type="text"
                      value={sheet.range ?? ''}
                      onChange={(e) => updateSheet(index, 'range', e.target.value)}
                      placeholder="e.g. Sheet1!A:Z"
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
              ))}
            </div>
            
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <button
                type="button"
                onClick={addSheet}
                style={{ 
                  padding: '10px 16px', 
                  fontSize: 14, 
                  border: '1px dashed #cbd5e1', 
                  color: '#475569', 
                  background: '#fff', 
                  borderRadius: 8, 
                  cursor: 'pointer',
                  fontWeight: 500
                }}
              >
                + Add Another Sheet
              </button>
              <button 
                type="submit" 
                disabled={saving} 
                style={{ 
                  padding: '10px 24px', 
                  fontSize: 14, 
                  background: '#2563eb', 
                  color: '#fff', 
                  border: 'none', 
                  borderRadius: 8, 
                  cursor: saving ? 'not-allowed' : 'pointer',
                  fontWeight: 600
                }}
              >
                {saving ? 'Saving...' : 'Save Configuration'}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
