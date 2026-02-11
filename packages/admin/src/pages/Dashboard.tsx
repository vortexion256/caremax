import { Link, Navigate } from 'react-router-dom';
import { useTenant } from '../TenantContext';
import { useIsMobile } from '../hooks/useIsMobile';

export default function Dashboard() {
  const { isPlatformAdmin, tenantId } = useTenant();
  const { isMobile } = useIsMobile();

  // If platform-only admin (no real tenant), redirect to platform console
  if (isPlatformAdmin && tenantId === 'platform') {
    return <Navigate to="/platform" replace />;
  }

  return (
    <div style={{ width: '100%', maxWidth: '100%', overflowX: 'hidden' }}>
      <h1 style={{ margin: '0 0 16px 0', fontSize: isMobile ? 20 : 24 }}>Dashboard</h1>
      <p style={{ color: '#666', fontSize: isMobile ? 14 : 16 }}>
        Welcome to CareMax Admin. Use the sidebar to configure your agent, manage handoffs, and get the embed code.
      </p>
      {isPlatformAdmin && (
        <div style={{ marginTop: 24, padding: 16, background: '#e3f2fd', borderRadius: 8 }}>
          <p style={{ margin: '0 0 8px 0', fontWeight: 500 }}>Platform admin access</p>
          <p style={{ margin: '0 0 12px 0', fontSize: 14, color: '#555' }}>
            You have platform admin privileges. Access the platform console to view all tenants and manage your SaaS.
          </p>
          <Link
            to="/platform"
            style={{
              display: 'inline-block',
              padding: isMobile ? '10px 20px' : '8px 16px',
              background: '#0d47a1',
              color: '#fff',
              textDecoration: 'none',
              borderRadius: 6,
              fontSize: isMobile ? 15 : 14,
              minHeight: 44,
              touchAction: 'manipulation',
            }}
          >
            Open platform console →
          </Link>
        </div>
      )}
    </div>
  );
}
