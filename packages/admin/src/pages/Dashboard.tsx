import { Link, Navigate } from 'react-router-dom';
import { useTenant } from '../TenantContext';
import { useIsMobile } from '../hooks/useIsMobile';

export default function Dashboard() {
  const { isPlatformAdmin, tenantId } = useTenant();
  const { isMobile } = useIsMobile();

  if (isPlatformAdmin && tenantId === 'platform') {
    return <Navigate to="/platform" replace />;
  }

  return (
    <div>
      <h1 style={{ margin: '0 0 8px 0', fontSize: isMobile ? 24 : 32 }}>Dashboard</h1>
      <p style={{ color: '#64748b', fontSize: isMobile ? 15 : 16, lineHeight: 1.6, marginBottom: 32 }}>
        Welcome to CareMax. Configure your agent settings, manage live handoffs, and integrate the chat widget into your website.
      </p>

      {isPlatformAdmin && (
        <div style={{ 
          marginTop: 32, 
          padding: 24, 
          background: '#f8fafc', 
          borderRadius: 12, 
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
        }}>
          <h3 style={{ margin: '0 0 8px 0', fontSize: 18, color: '#0f172a' }}>Platform Administration</h3>
          <p style={{ margin: '0 0 20px 0', fontSize: 14, color: '#64748b', lineHeight: 1.5 }}>
            You have elevated privileges. Use the platform console to manage all tenants, view usage metrics, and oversee the entire SaaS ecosystem.
          </p>
          <Link
            to="/platform"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '10px 20px',
              background: '#2563eb',
              color: '#fff',
              textDecoration: 'none',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              transition: 'background 0.2s'
            }}
          >
            Open Platform Console
          </Link>
        </div>
      )}
    </div>
  );
}
