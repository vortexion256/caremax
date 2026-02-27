import { Link } from 'react-router-dom';

export default function Contact() {
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '48px 24px', lineHeight: 1.7, color: '#1e293b' }}>
      <h1 style={{ marginTop: 0 }}>Contact</h1>
      <p>If you need help, please reach us using the details below.</p>
      <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, background: '#f8fafc' }}>
        <div><strong>Email:</strong> edrine.eminence@gmail.com</div>
        <div><strong>Phone 1:</strong> 0782830524</div>
        <div><strong>Phone 2:</strong> 0753190830</div>
      </div>
      <div style={{ marginTop: 16 }}>
        <Link to="/" style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}>← Back to Home</Link>
      </div>
    </div>
  );
}
