import { Link } from 'react-router-dom';

export default function TermsOfService() {
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '56px 24px 72px', lineHeight: 1.72, color: '#1e293b' }}>
      <h1 style={{ marginTop: 0, marginBottom: 12, fontSize: 40, letterSpacing: '-0.02em', color: '#0f172a' }}>Terms of Service</h1>
      <p style={{ marginTop: 0, color: '#475569' }}>
        These Terms govern access to and use of the CareMax triage chat agent platform. By using CareMax, organizations and
        authorized users agree to these terms and all applicable law.
      </p>

      <h2>1. Service Scope</h2>
      <p>
        CareMax provides software for AI-assisted triage, workflow support, and human handoff coordination. The platform is
        a decision-support tool and does not replace licensed medical judgment, emergency services, or clinical diagnosis.
      </p>

      <h2>2. Account Responsibilities</h2>
      <ul>
        <li>Customers must ensure only authorized users access tenant environments.</li>
        <li>Users are responsible for safeguarding credentials and reporting suspicious access promptly.</li>
        <li>Customer organizations are accountable for data entered by their teams and end users.</li>
      </ul>

      <h2>3. Acceptable Use</h2>
      <ul>
        <li>No unlawful, abusive, deceptive, or harmful use of the platform.</li>
        <li>No attempts to bypass security controls, reverse engineer restricted systems, or disrupt service availability.</li>
        <li>No upload of content you are not authorized to process.</li>
      </ul>

      <h2>4. Data and Compliance</h2>
      <p>
        Customers must use CareMax in compliance with healthcare, privacy, and records regulations applicable to their
        jurisdiction. CareMax may suspend access where continued use presents legal, security, or safety risk.
      </p>

      <h2>5. Billing and Subscription</h2>
      <p>
        Paid subscriptions are billed according to selected package terms. Access to premium usage features may be limited
        when plans expire, payment fails, or usage exceeds purchased package allowances.
      </p>

      <h2>6. Limitation and Availability</h2>
      <p>
        CareMax is provided on an "as available" basis. While we aim for high reliability and safety, no platform can guarantee
        uninterrupted or error-free performance. Organizations remain responsible for clinical governance decisions.
      </p>

      <h2>7. Support Contact</h2>
      <p>
        Legal and support inquiries can be sent to <strong>legal@caremax.health</strong> or by phone at{' '}
        <strong>+256 782 830524</strong> / <strong>+256 753 190830</strong>.
      </p>

      <p style={{ fontSize: 13, color: '#64748b' }}>Last updated: 27 February 2026</p>
      <Link to="/" style={{ color: '#0ea5e9', fontWeight: 700, textDecoration: 'none' }}>← Back to Home</Link>
    </div>
  );
}
