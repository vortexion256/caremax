import { Link } from 'react-router-dom';

export default function Contact() {
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '56px 24px 72px', lineHeight: 1.72, color: '#1e293b' }}>
      <h1 style={{ marginTop: 0, marginBottom: 12, fontSize: 40, letterSpacing: '-0.02em', color: '#0f172a' }}>Contact CareMax</h1>
      <p style={{ marginTop: 0, color: '#475569' }}>
        Need onboarding help, technical assistance, legal clarification, or partnership support? Reach our SaaS operations team
        using the channels below.
      </p>

      <div style={{ border: '1px solid #e2e8f0', borderRadius: 14, padding: 20, background: '#f8fafc', display: 'grid', gap: 8 }}>
        <div><strong>General Support:</strong> support@caremax.health</div>
        <div><strong>Privacy Office:</strong> privacy@caremax.health</div>
        <div><strong>Legal Office:</strong> legal@caremax.health</div>
        <div><strong>Primary Phone:</strong> +256 782 830524</div>
        <div><strong>Secondary Phone:</strong> +256 753 190830</div>
        <div><strong>Support Hours:</strong> Monday to Friday, 08:00–18:00 EAT</div>
      </div>

      <p style={{ marginTop: 14, fontSize: 14, color: '#64748b' }}>
        Note: legal policy and contact details are managed centrally by the SaaS admin team.
      </p>

      <Link to="/" style={{ color: '#0ea5e9', fontWeight: 700, textDecoration: 'none' }}>← Back to Home</Link>
    </div>
  );
}
