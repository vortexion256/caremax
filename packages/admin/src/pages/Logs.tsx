import { useIsMobile } from '../hooks/useIsMobile';

const logMetrics = [
  { label: 'API Calls', value: '1' },
  { label: 'Input Tokens', value: '7,990' },
  { label: 'Output Tokens', value: '24' },
  { label: 'Total Cost', value: 'UGX 2' },
];

export default function Logs() {
  const { isMobile } = useIsMobile();

  return (
    <div>
      <h1 style={{ margin: '0 0 8px 0', fontSize: isMobile ? 24 : 32 }}>Logs</h1>
      <p style={{ color: '#64748b', fontSize: isMobile ? 15 : 16, lineHeight: 1.6, marginBottom: 24 }}>
        Review recent metered events and usage summaries.
      </p>

      <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: isMobile ? 16 : 20, background: '#fff' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', marginBottom: 10 }}>Recent Metered Events</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          {logMetrics.map((metric) => (
            <div key={metric.label} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', background: '#f8fafc' }}>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>{metric.label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{metric.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
