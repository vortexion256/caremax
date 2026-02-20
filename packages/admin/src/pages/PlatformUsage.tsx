import { useEffect, useState } from 'react';
import { useTenant } from '../TenantContext';
import { api } from '../api';

type UsageSummary = {
  tenantId: string;
  totalTokens: number;
  totalCostUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  lastUsed: number | null;
};

type UsageEvent = {
  eventId: string;
  tenantId: string | null;
  userId: string | null;
  conversationId: string | null;
  model: string | null;
  usageType: string | null;
  measurementSource: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  createdAt: number | null;
};

export default function PlatformUsage() {
  const { isPlatformAdmin } = useTenant();
  const [summary, setSummary] = useState<UsageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTenant, setSelectedTenant] = useState<string | null>(null);
  const [tenantEvents, setTenantEvents] = useState<UsageEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [resetting, setResetting] = useState<string | null>(null);
  const [confirmResetTenant, setConfirmResetTenant] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(1); // First day of current month
    return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(() => {
    const d = new Date();
    return d.toISOString().split('T')[0];
  });

  const loadUsage = async () => {
    if (!isPlatformAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.append('from', dateFrom);
      if (dateTo) params.append('to', dateTo);
      const url = `/platform/usage${params.toString() ? `?${params.toString()}` : ''}`;
      const data = await api<{ usage: UsageSummary[] }>(url);
      setSummary(data.usage);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load usage');
    } finally {
      setLoading(false);
    }
  };

  const loadTenantEvents = async (tenantId: string) => {
    setEventsLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.append('from', dateFrom);
      if (dateTo) params.append('to', dateTo);
      params.append('limit', '100');
      const data = await api<{ events: UsageEvent[] }>(
        `/platform/usage/${tenantId}?${params.toString()}`
      );
      setTenantEvents(data.events);
    } catch (e) {
      console.error('Failed to load tenant events:', e);
    } finally {
      setEventsLoading(false);
    }
  };

  useEffect(() => {
    loadUsage();
  }, [isPlatformAdmin, dateFrom, dateTo]);

  useEffect(() => {
    if (selectedTenant) {
      loadTenantEvents(selectedTenant);
    } else {
      setTenantEvents([]);
    }
  }, [selectedTenant, dateFrom, dateTo]);

  const handleResetClick = (tenantId: string) => {
    setConfirmResetTenant(tenantId);
  };

  const resetTenantTokens = async () => {
    if (!confirmResetTenant) return;
    
    const tenantId = confirmResetTenant;
    setConfirmResetTenant(null);
    setResetting(tenantId);
    
    try {
      await api(`/platform/usage/${tenantId}`, { method: 'DELETE' });
      // Reload usage summary and tenant events
      await loadUsage();
      if (selectedTenant === tenantId) {
        await loadTenantEvents(tenantId);
      }
      // Show success message
      setError(null);
      setSuccessMessage(`Successfully reset usage data for tenant ${tenantId}`);
      setTimeout(() => setSuccessMessage(null), 5000); // Auto-hide after 5 seconds
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reset usage data');
      setSuccessMessage(null);
    } finally {
      setResetting(null);
    }
  };

  if (!isPlatformAdmin) {
    return <p style={{ color: '#c62828' }}>Platform admin access required.</p>;
  }

  const totalCost = summary.reduce((sum, u) => sum + u.totalCostUsd, 0);
  const totalTokens = summary.reduce((sum, u) => sum + u.totalTokens, 0);
  const totalCalls = summary.reduce((sum, u) => sum + u.calls, 0);

  return (
    <div>
      <h1 style={{ margin: '0 0 16px 0' }}>Usage & Billing</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>
        Track Gemini API usage and costs per tenant. All AI calls go through your backend for accurate tracking.
      </p>

      {/* Date Range Filter */}
      <div style={{ marginBottom: 24, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          From:
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={{ padding: '6px 10px', fontSize: 14, borderRadius: 4, border: '1px solid #ddd' }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          To:
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={{ padding: '6px 10px', fontSize: 14, borderRadius: 4, border: '1px solid #ddd' }}
          />
        </label>
        <button
          onClick={loadUsage}
          style={{
            padding: '6px 16px',
            fontSize: 14,
            backgroundColor: '#667eea',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <div
          style={{
            flex: '0 0 200px',
            padding: 16,
            borderRadius: 8,
            background: '#ffffff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}
        >
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Total Cost</div>
          <div style={{ fontSize: 24, fontWeight: 600, color: '#d32f2f' }}>
            ${totalCost.toFixed(4)}
          </div>
        </div>
        <div
          style={{
            flex: '0 0 200px',
            padding: 16,
            borderRadius: 8,
            background: '#ffffff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}
        >
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Total Tokens</div>
          <div style={{ fontSize: 24, fontWeight: 600 }}>
            {totalTokens.toLocaleString()}
          </div>
        </div>
        <div
          style={{
            flex: '0 0 200px',
            padding: 16,
            borderRadius: 8,
            background: '#ffffff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}
        >
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Total Calls</div>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{totalCalls.toLocaleString()}</div>
        </div>
        <div
          style={{
            flex: '0 0 200px',
            padding: 16,
            borderRadius: 8,
            background: '#ffffff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}
        >
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Active Tenants</div>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{summary.length}</div>
        </div>
      </div>

      {error && (
        <div style={{ 
          padding: '12px 16px', 
          backgroundColor: '#ffebee', 
          border: '1px solid #ef5350', 
          borderRadius: 6, 
          marginBottom: 16,
          color: '#c62828',
          fontSize: 14
        }}>
          {error}
        </div>
      )}
      {successMessage && (
        <div style={{ 
          padding: '12px 16px', 
          backgroundColor: '#e8f5e9', 
          border: '1px solid #4caf50', 
          borderRadius: 6, 
          marginBottom: 16,
          color: '#2e7d32',
          fontSize: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          <span style={{ fontSize: 18 }}>✓</span>
          <span>{successMessage}</span>
        </div>
      )}
      {loading && <p>Loading usage data...</p>}

      {!loading && summary.length === 0 && (
        <p style={{ color: '#666' }}>No usage data found for the selected date range.</p>
      )}

      {!loading && summary.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {/* Summary Table */}
          <div>
            <h2 style={{ fontSize: 18, marginBottom: 16 }}>Usage by Tenant</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'white', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
              <thead>
                <tr style={{ backgroundColor: '#f5f5f5', borderBottom: '2px solid #e0e0e0' }}>
                  <th style={{ textAlign: 'left', padding: 12, fontSize: 13, fontWeight: 600 }}>Tenant</th>
                  <th style={{ textAlign: 'right', padding: 12, fontSize: 13, fontWeight: 600 }}>Calls</th>
                  <th style={{ textAlign: 'right', padding: 12, fontSize: 13, fontWeight: 600 }}>Tokens</th>
                  <th style={{ textAlign: 'right', padding: 12, fontSize: 13, fontWeight: 600 }}>Cost</th>
                  <th style={{ textAlign: 'left', padding: 12, fontSize: 13, fontWeight: 600 }}>Last Used</th>
                  <th style={{ textAlign: 'center', padding: 12, fontSize: 13, fontWeight: 600 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((u) => (
                  <tr
                    key={u.tenantId}
                    style={{
                      borderBottom: '1px solid #eee',
                      cursor: 'pointer',
                      backgroundColor: selectedTenant === u.tenantId ? '#f0f4ff' : 'white',
                    }}
                    onClick={() => setSelectedTenant(selectedTenant === u.tenantId ? null : u.tenantId)}
                  >
                    <td style={{ padding: 12, fontSize: 14, fontFamily: 'monospace' }}>{u.tenantId}</td>
                    <td style={{ padding: 12, fontSize: 14, textAlign: 'right' }}>{u.calls.toLocaleString()}</td>
                    <td style={{ padding: 12, fontSize: 14, textAlign: 'right' }}>
                      {u.totalTokens.toLocaleString()}
                    </td>
                    <td style={{ padding: 12, fontSize: 14, textAlign: 'right', fontWeight: 600, color: '#d32f2f' }}>
                      ${u.totalCostUsd.toFixed(4)}
                    </td>
                    <td style={{ padding: 12, fontSize: 13, color: '#666' }}>
                      {u.lastUsed ? new Date(u.lastUsed).toLocaleDateString() : '—'}
                    </td>
                    <td style={{ padding: 12, textAlign: 'center' }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleResetClick(u.tenantId);
                        }}
                        disabled={resetting === u.tenantId}
                        style={{
                          padding: '6px 12px',
                          fontSize: 12,
                          backgroundColor: resetting === u.tenantId ? '#ccc' : '#dc3545',
                          color: 'white',
                          border: 'none',
                          borderRadius: 4,
                          cursor: resetting === u.tenantId ? 'not-allowed' : 'pointer',
                          fontWeight: 500,
                        }}
                        title="Reset all usage/token data for this tenant"
                      >
                        {resetting === u.tenantId ? 'Resetting...' : 'Reset'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Detailed Events */}
          <div>
            <h2 style={{ fontSize: 18, marginBottom: 16 }}>
              {selectedTenant ? `Recent Events: ${selectedTenant}` : 'Select a tenant to view details'}
            </h2>
            {selectedTenant && eventsLoading && <p>Loading events...</p>}
            {selectedTenant && !eventsLoading && tenantEvents.length === 0 && (
              <p style={{ color: '#666' }}>No events found for this tenant.</p>
            )}
            {selectedTenant && !eventsLoading && tenantEvents.length > 0 && (
              <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'white', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                  <thead style={{ position: 'sticky', top: 0, backgroundColor: '#f5f5f5' }}>
                    <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                      <th style={{ textAlign: 'left', padding: 10, fontSize: 12, fontWeight: 600 }}>Time</th>
                      <th style={{ textAlign: 'right', padding: 10, fontSize: 12, fontWeight: 600 }}>Input</th>
                      <th style={{ textAlign: 'right', padding: 10, fontSize: 12, fontWeight: 600 }}>Output</th>
                      <th style={{ textAlign: 'right', padding: 10, fontSize: 12, fontWeight: 600 }}>Total</th>
                      <th style={{ textAlign: 'right', padding: 10, fontSize: 12, fontWeight: 600 }}>Cost</th>
                      <th style={{ textAlign: 'left', padding: 10, fontSize: 12, fontWeight: 600 }}>Type</th>
                      <th style={{ textAlign: 'left', padding: 10, fontSize: 12, fontWeight: 600 }}>Measure</th>
                      <th style={{ textAlign: 'left', padding: 10, fontSize: 12, fontWeight: 600 }}>Model</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tenantEvents.map((e) => (
                      <tr key={e.eventId} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: 10, fontSize: 12, color: '#666' }}>
                          {e.createdAt ? new Date(e.createdAt).toLocaleString() : '—'}
                        </td>
                        <td style={{ padding: 10, fontSize: 12, textAlign: 'right', fontFamily: 'monospace' }}>
                          {e.inputTokens.toLocaleString()}
                        </td>
                        <td style={{ padding: 10, fontSize: 12, textAlign: 'right', fontFamily: 'monospace' }}>
                          {e.outputTokens.toLocaleString()}
                        </td>
                        <td style={{ padding: 10, fontSize: 12, textAlign: 'right', fontFamily: 'monospace' }}>
                          {e.totalTokens.toLocaleString()}
                        </td>
                        <td style={{ padding: 10, fontSize: 12, textAlign: 'right', color: '#d32f2f' }}>
                          ${e.costUsd.toFixed(6)}
                        </td>
                        <td style={{ padding: 10, fontSize: 11, color: '#666', fontFamily: 'monospace' }}>{e.usageType ?? 'unknown'}</td>
                        <td style={{ padding: 10, fontSize: 11, color: '#666' }}>{e.measurementSource ?? 'provider'}</td>
                        <td style={{ padding: 10, fontSize: 11, color: '#666', fontFamily: 'monospace' }}>
                          {e.model ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmResetTenant && (
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
          onClick={() => setConfirmResetTenant(null)}
        >
          <div
            style={{
              backgroundColor: 'white',
              borderRadius: 12,
              padding: 24,
              maxWidth: 480,
              width: '90%',
              boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ marginBottom: 20 }}>
              <h2 style={{ margin: '0 0 8px 0', fontSize: 20, fontWeight: 600, color: '#1a1a1a' }}>
                Reset Usage Data
              </h2>
              <p style={{ margin: 0, fontSize: 14, color: '#666', lineHeight: 1.5 }}>
                Are you sure you want to reset all usage/token data for tenant{' '}
                <strong style={{ fontFamily: 'monospace', color: '#1a1a1a' }}>{confirmResetTenant}</strong>?
              </p>
            </div>
            
            <div style={{ 
              padding: 12, 
              backgroundColor: '#fff3cd', 
              borderRadius: 6, 
              marginBottom: 20,
              border: '1px solid #ffc107'
            }}>
              <p style={{ margin: 0, fontSize: 13, color: '#856404', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ fontSize: 16 }}>⚠️</span>
                <span>This action cannot be undone. All token usage, cost tracking, and call history for this tenant will be permanently deleted.</span>
              </p>
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setConfirmResetTenant(null)}
                style={{
                  padding: '10px 20px',
                  fontSize: 14,
                  backgroundColor: '#f5f5f5',
                  color: '#333',
                  border: '1px solid #ddd',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                Cancel
              </button>
              <button
                onClick={resetTenantTokens}
                disabled={resetting === confirmResetTenant}
                style={{
                  padding: '10px 20px',
                  fontSize: 14,
                  backgroundColor: resetting === confirmResetTenant ? '#ccc' : '#dc3545',
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  cursor: resetting === confirmResetTenant ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                }}
              >
                {resetting === confirmResetTenant ? 'Resetting...' : 'Reset Usage Data'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
