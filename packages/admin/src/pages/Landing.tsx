import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './Landing.css';
import { useIsMobile } from '../hooks/useIsMobile';
import { api } from '../api';

type PublicBillingPlan = {
  id: string;
  name: string;
  description: string;
  priceUgx: number;
  trialDays: number;
};

const fallbackPackages: PublicBillingPlan[] = [
  {
    id: 'free-trial',
    name: 'Free Trial',
    priceUgx: 0,
    trialDays: 14,
    description: 'Explore CareMax with a guided setup, core triage workflows, and no upfront commitment.',
  },
  {
    id: 'starter',
    name: 'Starter Triage',
    priceUgx: 0,
    trialDays: 14,
    description: 'Best for new clinics validating AI triage workflows with secure chat, core escalation, and usage insights.',
  },
  {
    id: 'growth',
    name: 'Growth Care',
    priceUgx: 149000,
    trialDays: 0,
    description: 'For active outpatient teams that need richer automations, protocol-backed responses, and SLA support.',
  },
  {
    id: 'enterprise',
    name: 'Enterprise HealthOps',
    priceUgx: 0,
    trialDays: 0,
    description: 'For large providers requiring advanced governance, dedicated onboarding, and tailored compliance controls.',
  },
];

function formatUgx(priceUgx: number): string {
  if (priceUgx <= 0) return 'Custom';
  return `UGX ${new Intl.NumberFormat('en-UG').format(priceUgx)}`;
}

export default function Landing() {
  const navigate = useNavigate();
  const [loading] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [plans, setPlans] = useState<PublicBillingPlan[]>(fallbackPackages);
  const { isMobile, isVerySmall } = useIsMobile();

  const displayPlans = useMemo(() => {
    const freeTrialPlan: PublicBillingPlan = {
      id: 'free-trial',
      name: 'Free Trial',
      priceUgx: 0,
      trialDays: 14,
      description: 'Explore CareMax with a guided setup, core triage workflows, and no upfront commitment.',
    };

    const hasFreeTrial = plans.some((plan) => plan.id === freeTrialPlan.id);
    return hasFreeTrial ? plans : [freeTrialPlan, ...plans];
  }, [plans]);

  useEffect(() => {
    let active = true;
    api<{ plans: PublicBillingPlan[] }>('/public/billing/plans')
      .then((data) => {
        if (!active || !Array.isArray(data.plans) || data.plans.length === 0) return;
        setPlans(data.plans);
      })
      .catch(() => {
        // Keep fallback packages if public plans cannot be loaded.
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="landing-shell">
      <div className="dynamic-bg" />

      <header className="landing-header" style={{ padding: isVerySmall ? '12px 16px' : isMobile ? '16px 24px' : '20px 48px' }}>
        <div className="landing-container landing-header-content">
          <div className="brand-wrap">
            <div className="brand-icon">C</div>
            <h1>CareMax</h1>
          </div>
          <nav className="landing-nav-links">
            <button onClick={() => navigate('/login')} disabled={loading} className="nav-ghost-btn">Sign In</button>
            <button onClick={() => navigate('/signup')} disabled={loading} className="nav-primary-btn">Sign Up</button>
          </nav>
        </div>
      </header>

      <main>
        <section className="hero-section">
          <div className="landing-container hero-content animate-fade-in">
            <div className="hero-badge">Healthcare AI • Secure • Scalable</div>
            <h2>
              Professional AI Triage <br />
              <span>for Modern Care Teams</span>
            </h2>
            <p>
              CareMax helps healthcare organizations run patient-first triage conversations, route urgent cases faster,
              and keep every team aligned with secure, clinically aware AI workflows.
            </p>
            <div className="hero-actions">
              <button onClick={() => navigate('/signup')} disabled={loading} className="cta-primary">Start Free Trial</button>
              <button onClick={() => setShowVideo(true)} disabled={loading} className="cta-secondary">View Product Tour</button>
            </div>
          </div>
        </section>

        <section className="surface-section">
          <div className="landing-container">
            <div style={{ textAlign: 'center', marginBottom: 60 }} className="animate-fade-in delay-1">
              <h3 className="section-title">Platform Highlights</h3>
              <p className="section-subtitle">Built for healthcare operations, clinical quality, and trusted patient communications.</p>
            </div>
            <div className="landing-features-grid animate-fade-in delay-2">
              <div className="feature-card">
                <div className="feature-icon">🩺</div>
                <h4 className="feature-title">AI Triage Intelligence</h4>
                <p className="feature-description">Assess symptoms, collect structured context, and route patients with configurable risk pathways.</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">🔐</div>
                <h4 className="feature-title">Secure by Design</h4>
                <p className="feature-description">Role-based access, audit visibility, and controlled integrations for high-trust healthcare delivery.</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">🤝</div>
                <h4 className="feature-title">Human Handoff</h4>
                <p className="feature-description">Escalate conversations to live care teams with context handover and continuity built in.</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">📊</div>
                <h4 className="feature-title">Operational Visibility</h4>
                <p className="feature-description">Track usage, response quality, and service demand to improve staffing and patient outcomes.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="pricing-section">
          <div className="landing-container">
            <div style={{ textAlign: 'center', marginBottom: 48 }}>
              <h3 className="section-title">Billing Plans</h3>
              <p className="section-subtitle">Flexible plans for clinics, care teams, and enterprise health operations.</p>
            </div>
            <div className="pricing-grid">
              {displayPlans.map((pkg, idx) => (
                <div key={pkg.id} className={`pricing-card${idx === 1 ? ' highlighted' : ''}`}>
                  <h4>{pkg.name}</h4>
                  <p className="price">
                    {pkg.id === 'free-trial' ? 'Free' : formatUgx(pkg.priceUgx)}
                    <span>{pkg.id === 'free-trial' ? '/limited time' : pkg.priceUgx > 0 ? '/month' : '/contract'}</span>
                  </p>
                  {pkg.trialDays > 0 && <p className="price-trial">{pkg.trialDays} day trial included</p>}
                  <p className="price-description">{pkg.description}</p>
                  <button onClick={() => navigate('/signup')} className="pricing-btn">{pkg.id === 'free-trial' ? 'Start Free Trial' : 'Choose Package'}</button>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-container footer-content" style={{ flexDirection: isMobile ? 'column' : 'row' }}>
          <div className="footer-brand-block">
            <div className="brand-wrap">
              <div className="brand-icon small">C</div>
              <span className="footer-brand">CareMax</span>
            </div>
            <p className="footer-details">support@caremax.health • +256 700 000 000</p>
            <p className="footer-details">Kampala, Uganda</p>
          </div>
          <p>© 2026 CareMax Health Technologies. All rights reserved.</p>
          <div className="footer-links">
            <Link to="/privacy-policy">Privacy Policy</Link>
            <Link to="/terms-of-service">Terms of Service</Link>
            <Link to="/contact">Contact</Link>
          </div>
        </div>
      </footer>

      {showVideo && (
        <div className="modal-overlay" onClick={() => setShowVideo(false)}>
          <div className="video-modal" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setShowVideo(false)} className="modal-close">×</button>
            <video autoPlay controls muted style={{ width: '100%', height: '100%' }}>
              <source src="https://firebasestorage.googleapis.com/v0/b/caremax-15f69.firebasestorage.app/o/CareMAX%20-%20vid.mp4?alt=media&token=fddfcc94-74ee-4298-b983-6666e531f136" type="video/mp4" />
              Your browser does not support the video tag.
            </video>
          </div>
        </div>
      )}
    </div>
  );
}
