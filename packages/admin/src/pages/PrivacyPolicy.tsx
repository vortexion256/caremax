import { Link } from 'react-router-dom';

const sectionStyle = {
  marginBottom: 28,
};

export default function PrivacyPolicy() {
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '56px 24px 72px', lineHeight: 1.72, color: '#1e293b' }}>
      <h1 style={{ marginTop: 0, marginBottom: 12, fontSize: 40, letterSpacing: '-0.02em', color: '#0f172a' }}>Privacy Policy</h1>
      <p style={{ marginTop: 0, color: '#475569' }}>
        CareMax provides an AI-powered triage chat platform for healthcare organizations. This policy explains how we collect,
        use, secure, and share information when healthcare teams, patients, and partner organizations use our services.
      </p>

      <div style={sectionStyle}>
        <h2>1. Data We Collect</h2>
        <ul>
          <li>Account and organization profile details (name, role, email, authentication metadata).</li>
          <li>Triage conversation records, including symptom descriptions, patient-provided context, and chat transcripts.</li>
          <li>Operational and diagnostic telemetry such as usage logs, request timing, and security events.</li>
          <li>Configuration data entered by SaaS administrators for legal policies, support contacts, and escalation routing.</li>
        </ul>
      </div>

      <div style={sectionStyle}>
        <h2>2. How We Use Data</h2>
        <ul>
          <li>Deliver triage workflows, handoff tools, and conversational support to authorized care teams.</li>
          <li>Maintain platform reliability, monitor abuse, and strengthen system security controls.</li>
          <li>Generate analytics and quality improvements for AI safety, response consistency, and support operations.</li>
          <li>Comply with lawful requests and healthcare-related data governance obligations.</li>
        </ul>
      </div>

      <div style={sectionStyle}>
        <h2>3. Data Sharing and Subprocessors</h2>
        <p>
          CareMax shares data only with approved infrastructure and AI service providers required to run the platform,
          such as hosting, observability, and language model vendors. We apply contractual, technical, and organizational
          safeguards to these integrations and do not sell personal data.
        </p>
      </div>

      <div style={sectionStyle}>
        <h2>4. Security and Retention</h2>
        <p>
          We implement layered safeguards including authenticated access controls, encrypted transport, role-based permissions,
          audit logging, and restricted administrative access. Data retention periods are aligned to contractual requirements,
          legal obligations, and operational necessity.
        </p>
      </div>

      <div style={sectionStyle}>
        <h2>5. Your Rights and Choices</h2>
        <p>
          Depending on your jurisdiction, you may request access, correction, export, or deletion of eligible information.
          Requests are evaluated under applicable law and contractual obligations with your healthcare organization.
        </p>
      </div>

      <div style={sectionStyle}>
        <h2>6. Privacy Contacts</h2>
        <p>
          For privacy or data protection inquiries, contact our compliance team at <strong>privacy@caremax.health</strong>.
          For urgent support, use <strong>+256 782 830524</strong> or <strong>+256 753 190830</strong>.
        </p>
      </div>

      <p style={{ fontSize: 13, color: '#64748b' }}>Last updated: 27 February 2026</p>
      <Link to="/" style={{ color: '#0ea5e9', fontWeight: 700, textDecoration: 'none' }}>← Back to Home</Link>
    </div>
  );
}
