import { Link } from 'react-router-dom';

export default function PrivacyPolicy() {
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '48px 24px', lineHeight: 1.7, color: '#1e293b' }}>
      <h1 style={{ marginTop: 0 }}>Privacy Policy</h1>
      <p>
        This is a demo Privacy Policy page for CareMax. It explains how service data may be collected, stored, and used
        to provide healthcare assistant functionality.
      </p>
      <h2>Information We Collect</h2>
      <p>We may collect account details, conversation content, and operational telemetry needed to provide and improve the service.</p>
      <h2>How We Use Information</h2>
      <p>Information is used to operate the product, improve response quality, support users, and maintain system reliability and security.</p>
      <h2>Contact</h2>
      <p>
        For privacy concerns, contact us at <strong>edrine.eminence@gmail.com</strong> or call <strong>0782830524</strong> / <strong>0753190830</strong>.
      </p>
      <Link to="/" style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}>← Back to Home</Link>
    </div>
  );
}
