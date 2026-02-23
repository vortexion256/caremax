import { useIsMobile } from '../hooks/useIsMobile';

export default function Notifications() {
  const { isMobile } = useIsMobile();

  return (
    <div>
      <h1 style={{ margin: '0 0 8px 0', fontSize: isMobile ? 24 : 32 }}>Notifications</h1>
      <p style={{ color: '#64748b', fontSize: isMobile ? 15 : 16, lineHeight: 1.6, marginBottom: 24 }}>
        Notification updates will appear in this section.
      </p>

      <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: isMobile ? 16 : 20, background: '#fff' }}>
        <p style={{ margin: 0, color: '#64748b', fontSize: 14 }}>
          No notifications yet.
        </p>
      </div>
    </div>
  );
}
