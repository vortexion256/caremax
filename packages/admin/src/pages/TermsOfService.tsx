import { Link } from 'react-router-dom';

export default function TermsOfService() {
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '48px 24px', lineHeight: 1.7, color: '#1e293b' }}>
      <h1 style={{ marginTop: 0 }}>Terms of Service</h1>
      <p>This is a demo Terms of Service page for CareMax.</p>
      <h2>Acceptable Use</h2>
      <p>Users must use the platform lawfully and responsibly. Abuse, misuse, and unauthorized access attempts are prohibited.</p>
      <h2>Service Scope</h2>
      <p>CareMax provides AI-enabled support tooling and is not a replacement for licensed medical professionals.</p>
      <h2>Support Contact</h2>
      <p>
        Reach us via <strong>edrine.eminence@gmail.com</strong> or <strong>0782830524</strong> / <strong>0753190830</strong>.
      </p>
      <Link to="/" style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}>← Back to Home</Link>
    </div>
  );
}
