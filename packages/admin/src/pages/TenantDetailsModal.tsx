import { useEffect, useState } from 'react';
import { api } from '../api';

type TenantDetails = {
  tenantId: string;
  name: string;
  allowedDomains: string[];
  createdAt: number | null;
  createdBy: string | null;
  createdByEmail: string | null;
  agentConfig: {
    agentName: string | null;
    model: string | null;
    ragEnabled: boolean;
    agentVersion: 'v1' | 'v2' | null;
    createdAt: number | null;
  } | null;
  billingPlanId: string;
  showUsageByApiFlow?: boolean;
  maxTokensPerUser?: number | null;
  maxSpendUgxPerUser?: number | null;
  billingStatus?: {
    isActive: boolean;
    isTrialPlan: boolean;
    isExpired: boolean;
    expiredReason?: string | null;
    daysRemaining: number | null;
    trialEndsAt: number | null;
    subscriptionEndsAt: number | null;
  };
  totals: { calls: number; inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number };
  byUsageType: Array<{ usageType: string; calls: number; totalTokens: number; costUsd: number }>;
  recentEvents: Array<{ eventId: string; usageType: string; measurementSource: string; inputTokens: number; outputTokens: number; costUsd: number; createdAt: number | null }>;
};

const UGX_PER_USD = 3800;
const formatUgx = (amount: number) => `UGX ${Math.round(amount).toLocaleString()}`;
const formatUsageCostUgx = (costUsd: number) => formatUgx(costUsd * UGX_PER_USD);

function getExpiryMessage(reason?: string | null): string {
  switch (reason) {
    case 'user_token_limit_reached':
      return 'Expired early: assigned token balance depleted';
    case 'user_spend_limit_reached':
      return 'Expired early: assigned spend amount depleted';
    case 'package_token_limit_reached':
      return 'Expired early: package token limit depleted';
    case 'package_usage_amount_limit_reached':
      return 'Expired early: package usage amount depleted';
    case 'duration_elapsed':
    case 'trial_ended':
      return 'Expired: billing days elapsed';
    default:
      return 'Package expired';
  }
}

type DiagnosticLog = {
  logId: string;
  tenantId: string;
  source: string;
  step: string;
  status: 'ok' | 'warning' | 'error' | 'timeout' | string;
  durationMs: number | null;
  conversationId: string | null;
  metadata: Record<string, unknown> | null;
  error: string | null;
  createdAt: number | null;
};

type Props = {
  tenantId: string;
  onClose: () => void;
};

export default function TenantDetailsModal({ tenantId, onClose }: Props) {
  const [details, setDetails] = useState<TenantDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [endingTrial, setEndingTrial] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [logs, setLogs] = useState<DiagnosticLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logSourceFilter, setLogSourceFilter] = useState('');
  const [logStatusFilter, setLogStatusFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    setError(null);
    api<TenantDetails>(`/platform/tenants/${tenantId}`)
      .then(setDetails)
      .catch((e) => setError(e.message || 'Failed to load tenant details'))
      .finally(() => setLoading(false));
  }, [tenantId]);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set('limit', '150');
    if (logSourceFilter) params.set('source', logSourceFilter);
    if (logStatusFilter) params.set('status', logStatusFilter);

    setLogsLoading(true);
    api<{ logs: DiagnosticLog[] }>(`/platform/tenants/${tenantId}/logs?${params.toString()}`)
      .then((response) => setLogs(response.logs))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load diagnostics logs'))
      .finally(() => setLogsLoading(false));
  }, [tenantId, logSourceFilter, logStatusFilter]);

  const handleEndTrialNow = async () => {
    if (!details || endingTrial) return;
    setEndingTrial(true);
    setError(null);
    try {
      await api(`/platform/tenants/${tenantId}/trial/end`, { method: 'PATCH' });
      const refreshed = await api<TenantDetails>(`/platform/tenants/${tenantId}`);
      setDetails(refreshed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to end trial early');
    } finally {
      setEndingTrial(false);
    }
  };


  const saveTenantSettings = async (updates: {
    showUsageByApiFlow?: boolean;
    maxTokensPerUser?: number;
    maxSpendUgxPerUser?: number;
    agentVersion?: 'v1' | 'v2';
  }) => {
    if (savingSettings) return;
    setSavingSettings(true);
    setError(null);
    try {
      await api(`/platform/tenants/${tenantId}/settings`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
      const refreshed = await api<TenantDetails>(`/platform/tenants/${tenantId}`);
      setDetails(refreshed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save tenant settings');
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: 8,
          padding: 24,
          maxWidth: 600,
          width: '90%',
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0 }}>Tenant Details</h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 24,
              cursor: 'pointer',
              color: '#666',
              padding: 0,
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>

        {loading && <p>Loading tenant details...</p>}
        {error && <p style={{ color: '#c62828' }}>{error}</p>}
        {details && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Tenant ID</div>
              <div style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 500 }}>{details.tenantId}</div>
            </div>

            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Company/Organization Name</div>
              <div style={{ fontSize: 16, fontWeight: 500 }}>{details.name}</div>
            </div>

            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Allowed Domains</div>
              <div style={{ fontSize: 14 }}>
                {details.allowedDomains && details.allowedDomains.length > 0 ? (
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {details.allowedDomains.map((domain, i) => (
                      <li key={i}>{domain}</li>
                    ))}
                  </ul>
                ) : (
                  <span style={{ color: '#999' }}>No domains configured</span>
                )}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Created At</div>
              <div style={{ fontSize: 14 }}>
                {details.createdAt ? new Date(details.createdAt).toLocaleString() : 'Unknown'}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Created By</div>
              <div style={{ fontSize: 14 }}>
                {details.createdByEmail ? (
                  <>
                    <div>{details.createdByEmail}</div>
                    {details.createdBy && (
                      <div style={{ fontSize: 12, color: '#999', fontFamily: 'monospace', marginTop: 2 }}>
                        UID: {details.createdBy}
                      </div>
                    )}
                  </>
                ) : details.createdBy ? (
                  <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{details.createdBy}</div>
                ) : (
                  <span style={{ color: '#999' }}>Unknown</span>
                )}
              </div>
            </div>

            {details.agentConfig && (
              <div style={{ marginTop: 8, paddingTop: 16, borderTop: '1px solid #e0e0e0' }}>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>Agent Configuration</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>Agent Name</div>
                    <div style={{ fontSize: 14 }}>{details.agentConfig.agentName || '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>Model</div>
                    <div style={{ fontSize: 14 }}>{details.agentConfig.model || '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>RAG Enabled</div>
                    <div style={{ fontSize: 14 }}>{details.agentConfig.ragEnabled ? 'Yes' : 'No'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>Agent Version</div>
                    <div style={{ fontSize: 14 }}>{details.agentConfig.agentVersion || 'v1 (default)'}</div>
                  </div>
                  {details.agentConfig.createdAt && (
                    <div>
                      <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>Agent Config Created</div>
                      <div style={{ fontSize: 14 }}>{new Date(details.agentConfig.createdAt).toLocaleString()}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div style={{ marginTop: 8, paddingTop: 16, borderTop: '1px solid #e0e0e0' }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>Billing & Usage</div>
              <div style={{ marginBottom: 12, fontSize: 14 }}>
                <strong>Plan:</strong> {details.billingPlanId}
              </div>
              {details.billingStatus && (
                <div style={{ marginBottom: 12, padding: 10, borderRadius: 6, border: `1px solid ${details.billingStatus.isExpired ? '#fecaca' : '#bfdbfe'}`, background: details.billingStatus.isExpired ? '#fef2f2' : '#eff6ff' }}>
                  {details.billingStatus.isExpired
                    ? getExpiryMessage(details.billingStatus.expiredReason)
                    : `Status: active${details.billingStatus.daysRemaining != null ? ` (${details.billingStatus.daysRemaining} day(s) remaining)` : ''}`}
                </div>
              )}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                <Metric label="API Calls" value={details.totals.calls.toLocaleString()} />
                <Metric label="Tokens Used" value={details.totals.totalTokens.toLocaleString()} />
                <Metric label="Cost" value={formatUsageCostUgx(details.totals.costUsd)} />
              </div>

              {details.billingStatus?.isTrialPlan && !details.billingStatus.isExpired && (
                <button
                  onClick={handleEndTrialNow}
                  disabled={endingTrial}
                  style={{
                    padding: '8px 14px',
                    backgroundColor: '#d32f2f',
                    color: 'white',
                    border: 'none',
                    borderRadius: 4,
                    cursor: endingTrial ? 'not-allowed' : 'pointer',
                    marginBottom: 12,
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {endingTrial ? 'Ending Trial...' : 'End Trial Now'}
                </button>
              )}


              <div style={{ marginBottom: 12, padding: 10, borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc' }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Tenant Admin Visibility & Limits</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={details.showUsageByApiFlow === true}
                    onChange={(e) => saveTenantSettings({ showUsageByApiFlow: e.target.checked })}
                    disabled={savingSettings}
                  />
                  Show “Usage by API Flow” in tenant admin
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10, fontSize: 13 }}>
                  Agent runtime version
                  <select
                    value={details.agentConfig?.agentVersion ?? 'v1'}
                    onChange={(e) => saveTenantSettings({ agentVersion: e.target.value as 'v1' | 'v2' })}
                    disabled={savingSettings}
                    style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', width: 180 }}
                  >
                    <option value="v1">v1</option>
                    <option value="v2">v2</option>
                  </select>
                </label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => saveTenantSettings({ maxTokensPerUser: Number(prompt('Max tokens per user', String(details.maxTokensPerUser ?? 0)) ?? 0) || 0 })}
                    disabled={savingSettings}
                    style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1', cursor: 'pointer' }}
                  >
                    Set max tokens/user ({details.maxTokensPerUser ?? 'not set'})
                  </button>
                  <button
                    onClick={() => saveTenantSettings({ maxSpendUgxPerUser: Number(prompt('Max spend per user (UGX)', String(details.maxSpendUgxPerUser ?? 0)) ?? 0) || 0 })}
                    disabled={savingSettings}
                    style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1', cursor: 'pointer' }}
                  >
                    Set max spend/user ({details.maxSpendUgxPerUser ?? 'not set'})
                  </button>
                </div>
              </div>


              {details.byUsageType.length > 0 ? (
                <>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Usage by API Flow</div>
                  <div style={{ width: '100%', overflowX: 'auto', marginBottom: 12 }}>
                    <table style={{ width: '100%', minWidth: 520, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th align="left">Usage Type</th><th align="right">Calls</th><th align="right">Tokens</th><th align="right">Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {details.byUsageType.map((row) => (
                          <tr key={row.usageType} style={{ borderTop: '1px solid #eee' }}>
                            <td style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{row.usageType}</td>
                            <td align="right">{row.calls}</td>
                            <td align="right">{row.totalTokens.toLocaleString()}</td>
                            <td align="right">{formatUsageCostUgx(row.costUsd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p style={{ margin: '0 0 12px 0', color: '#64748b', fontSize: 13 }}>No data exists to use.</p>
              )}



              <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #e5e7eb' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Diagnostics Logs (per-tenant)</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <select value={logSourceFilter} onChange={(e) => setLogSourceFilter(e.target.value)} style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12 }}>
                      <option value="">All sources</option>
                      <option value="agent">agent</option>
                      <option value="google_sheets">google_sheets</option>
                    </select>
                    <select value={logStatusFilter} onChange={(e) => setLogStatusFilter(e.target.value)} style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12 }}>
                      <option value="">All status</option>
                      <option value="ok">ok</option>
                      <option value="warning">warning</option>
                      <option value="timeout">timeout</option>
                      <option value="error">error</option>
                    </select>
                  </div>
                </div>

                {logsLoading ? (
                  <p style={{ fontSize: 12, color: '#64748b' }}>Loading diagnostics logs...</p>
                ) : logs.length === 0 ? (
                  <p style={{ fontSize: 12, color: '#64748b' }}>No diagnostic logs found for this tenant.</p>
                ) : (
                  <div style={{ width: '100%', overflowX: 'auto', maxHeight: 280, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 6 }}>
                    <table style={{ width: '100%', minWidth: 980, borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead style={{ position: 'sticky', top: 0, background: '#f8fafc' }}>
                        <tr>
                          <th align="left" style={{ padding: 8 }}>Time</th>
                          <th align="left" style={{ padding: 8 }}>Source</th>
                          <th align="left" style={{ padding: 8 }}>Step</th>
                          <th align="left" style={{ padding: 8 }}>Status</th>
                          <th align="right" style={{ padding: 8 }}>Duration</th>
                          <th align="left" style={{ padding: 8 }}>Conversation</th>
                          <th align="left" style={{ padding: 8 }}>Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {logs.map((log) => (
                          <tr key={log.logId} style={{ borderTop: '1px solid #eee' }}>
                            <td style={{ padding: 8 }}>{log.createdAt ? new Date(log.createdAt).toLocaleString() : '—'}</td>
                            <td style={{ padding: 8, fontFamily: 'monospace' }}>{log.source}</td>
                            <td style={{ padding: 8, fontFamily: 'monospace' }}>{log.step}</td>
                            <td style={{ padding: 8 }}>
                              <span style={{
                                display: 'inline-block',
                                padding: '2px 8px',
                                borderRadius: 999,
                                fontSize: 11,
                                background: log.status === 'error' || log.status === 'timeout' ? '#fee2e2' : log.status === 'warning' ? '#fef3c7' : '#dcfce7',
                                color: log.status === 'error' || log.status === 'timeout' ? '#991b1b' : log.status === 'warning' ? '#92400e' : '#166534',
                              }}>{log.status}</span>
                            </td>
                            <td align="right" style={{ padding: 8 }}>{typeof log.durationMs === 'number' ? `${log.durationMs}ms` : '—'}</td>
                            <td style={{ padding: 8, fontFamily: 'monospace' }}>{log.conversationId ?? '—'}</td>
                            <td style={{ padding: 8, color: '#991b1b', maxWidth: 280, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }} title={log.error ?? ''}>{log.error ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {details.recentEvents.length > 0 ? (
                <>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Recent Metered Events</div>
                  <div style={{ width: '100%', overflowX: 'auto' }}>
                    <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th align="left">Time</th><th align="left">Type</th><th align="left">Source</th><th align="right">Input</th><th align="right">Output</th><th align="right">Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {details.recentEvents.slice(0, 15).map((event) => (
                          <tr key={event.eventId} style={{ borderTop: '1px solid #eee' }}>
                            <td>{event.createdAt ? new Date(event.createdAt).toLocaleString() : '—'}</td>
                            <td style={{ fontFamily: 'monospace', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{event.usageType}</td>
                            <td>{event.measurementSource}</td>
                            <td align="right">{event.inputTokens}</td>
                            <td align="right">{event.outputTokens}</td>
                            <td align="right">{formatUsageCostUgx(event.costUsd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p style={{ margin: 0, color: '#64748b', fontSize: 13 }}>No data exists to use.</p>
              )}
            </div>

            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={onClose}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#1976d2',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 8, minWidth: 120 }}>
      <div style={{ fontSize: 11, color: '#64748b' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600 }}>{value}</div>
    </div>
  );
}
