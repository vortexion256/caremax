type AppNotificationProps = {
  message: string;
  type?: 'error' | 'success' | 'info';
  onClose: () => void;
};

export default function AppNotification({ message, type = 'info', onClose }: AppNotificationProps) {
  const bg = type === 'error' ? '#fef2f2' : type === 'success' ? '#ecfdf5' : '#eff6ff';
  const color = type === 'error' ? '#991b1b' : type === 'success' ? '#065f46' : '#1d4ed8';
  const border = type === 'error' ? '#fecaca' : type === 'success' ? '#a7f3d0' : '#bfdbfe';

  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 2100,
        maxWidth: 420,
        borderRadius: 10,
        border: `1px solid ${border}`,
        background: bg,
        color,
        padding: '10px 12px',
        boxShadow: '0 12px 30px rgba(15,23,42,0.16)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
      }}
    >
      <div style={{ flex: 1, fontSize: 14 }}>{message}</div>
      <button type="button" onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color, fontSize: 16, lineHeight: 1 }}>
        ×
      </button>
    </div>
  );
}
