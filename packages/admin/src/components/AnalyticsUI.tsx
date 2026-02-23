import { useState, useEffect } from 'react';
import { api } from '../api';
import { useTenant } from '../TenantContext';

type AnalyticsData = {
  totalConversations: number;
  aiOnlyResolved: number;
  humanAiResolved: number;
  uniqueUsers: number;
};

type AnalyticsResponse = Record<string, AnalyticsData>;

export default function AnalyticsUI({ isMobile }: { isMobile: boolean }) {
  const { tenantId } = useTenant();
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState('7d');

  useEffect(() => {
    if (!tenantId || tenantId === 'platform') return;

    const fetchAnalytics = async () => {
      try {
        setLoading(true);
        const res = await api<AnalyticsResponse>(`/tenants/${tenantId}/analytics/interactions`);
        setData(res);
        setError(null);
      } catch (err) {
        console.error('Failed to fetch analytics:', err);
        setError('Failed to load analytics data');
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, [tenantId, period]);

  if (loading) return <div style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>Loading analytics...</div>;
  if (error) return <div style={{ padding: 20, textAlign: 'center', color: '#ef4444' }}>{error}</div>;
  if (!data) return null;

  const currentData = data[period] || { totalConversations: 0, aiOnlyResolved: 0, humanAiResolved: 0, uniqueUsers: 0 };

  const stats = [
    { label: 'Total Chats', value: currentData.totalConversations, color: '#2563eb' },
    { label: 'AI Only Resolved', value: currentData.aiOnlyResolved, color: '#10b981' },
    { label: 'Human + AI Resolved', value: currentData.humanAiResolved, color: '#f59e0b' },
    { label: 'Unique Users', value: currentData.uniqueUsers, color: '#8b5cf6' },
  ];

  return (
    <div style={{ marginTop: 32 }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: 16,
        flexWrap: 'wrap',
        gap: 12
      }}>
        <h2 style={{ margin: 0, fontSize: 20, color: '#0f172a' }}>Analytics Overview</h2>
        <select 
          value={period} 
          onChange={(e) => setPeriod(e.target.value)}
          style={{ 
            padding: '6px 12px', 
            borderRadius: 8, 
            border: '1px solid #e2e8f0',
            fontSize: 14,
            background: '#fff',
            cursor: 'pointer'
          }}
        >
          <option value="1d">Last 24 Hours</option>
          <option value="7d">Last 7 Days</option>
          <option value="1m">Last 30 Days</option>
          <option value="1y">Last Year</option>
        </select>
      </div>

      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr 1fr', 
        gap: 16 
      }}>
        {stats.map((stat) => (
          <div key={stat.label} style={{ 
            padding: 20, 
            background: '#fff', 
            borderRadius: 12, 
            border: '1px solid #e2e8f0',
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
          }}>
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 500, marginBottom: 4, textTransform: 'uppercase' }}>
              {stat.label}
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: stat.color }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* Simple Bar Visualization */}
      <div style={{ 
        marginTop: 24, 
        padding: 24, 
        background: '#fff', 
        borderRadius: 12, 
        border: '1px solid #e2e8f0',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
      }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: 16, color: '#0f172a' }}>Resolution Mix</h3>
        <div style={{ height: 24, width: '100%', background: '#f1f5f9', borderRadius: 12, overflow: 'hidden', display: 'flex' }}>
          {currentData.totalConversations > 0 ? (
            <>
              <div style={{ 
                width: `${(currentData.aiOnlyResolved / currentData.totalConversations) * 100}%`, 
                background: '#10b981',
                height: '100%'
              }} title={`AI Only Resolved: ${currentData.aiOnlyResolved}`} />
              <div style={{ 
                width: `${(currentData.humanAiResolved / currentData.totalConversations) * 100}%`, 
                background: '#f59e0b',
                height: '100%'
              }} title={`Human + AI Resolved: ${currentData.humanAiResolved}`} />
            </>
          ) : (
            <div style={{ width: '100%', textAlign: 'center', fontSize: 12, color: '#94a3b8', lineHeight: '24px' }}>No data for this period</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#10b981' }} />
            <span style={{ fontSize: 12, color: '#64748b' }}>AI Only Resolved ({currentData.totalConversations > 0 ? Math.round((currentData.aiOnlyResolved / currentData.totalConversations) * 100) : 0}%)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#f59e0b' }} />
            <span style={{ fontSize: 12, color: '#64748b' }}>Human + AI Resolved ({currentData.totalConversations > 0 ? Math.round((currentData.humanAiResolved / currentData.totalConversations) * 100) : 0}%)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
