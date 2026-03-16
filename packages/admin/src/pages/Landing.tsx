import { useEffect, useMemo, useRef, useState } from 'react';
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

type PublicContent = {
  contactEmail: string;
  contactPhonePrimary: string;
  contactPhoneSecondary: string;
  enableLandingVanta: boolean;
  landingVantaEmbedCode: string;
};

type VantaNetEffect = {
  destroy: () => void;
};

interface VantaWindow extends Window {
  VANTA?: Record<string, (options: Record<string, unknown>) => VantaNetEffect>;
  THREE?: unknown;
}


const defaultVantaConfig = {
  threeScriptSrc: 'https://cdn.jsdelivr.net/npm/three@0.134.0/build/three.min.js',
  effectScriptSrc: 'https://cdn.jsdelivr.net/npm/vanta@latest/dist/vanta.halo.min.js',
  effectName: 'HALO',
  options: {
    mouseControls: true,
    touchControls: true,
    gyroControls: false,
    minHeight: 200,
    minWidth: 200,
  } as Record<string, unknown>,
};

function resolveScriptSrc(src: string): string {
  const trimmed = src.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.endsWith('three.r134.min.js') || trimmed.endsWith('three.min.js')) {
    return defaultVantaConfig.threeScriptSrc;
  }
  if (trimmed.endsWith('vanta.halo.min.js')) {
    return defaultVantaConfig.effectScriptSrc;
  }
  if (trimmed.endsWith('.js')) {
    return `https://cdn.jsdelivr.net/npm/vanta@latest/dist/${trimmed.split('/').pop()}`;
  }
  return trimmed;
}

function parseVantaEmbedCode(embedCode: string) {
  if (!embedCode.trim()) return defaultVantaConfig;

  const scriptSources = [...embedCode.matchAll(/<script[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi)].map((m) => m[1]);
  const vantaCall = embedCode.match(/VANTA\.([A-Z0-9_]+)\s*\(\s*({[\s\S]*?})\s*\)/m);
  if (!vantaCall) return defaultVantaConfig;

  const effectName = vantaCall[1].toUpperCase();
  let parsedOptions: Record<string, unknown> = {};

  try {
    parsedOptions = Function(`"use strict"; return (${vantaCall[2]});`)() as Record<string, unknown>;
  } catch {
    parsedOptions = {};
  }

  const { el: _el, ...rest } = parsedOptions;

  return {
    threeScriptSrc: resolveScriptSrc(scriptSources[0] ?? defaultVantaConfig.threeScriptSrc),
    effectScriptSrc: resolveScriptSrc(scriptSources[1] ?? `https://cdn.jsdelivr.net/npm/vanta@latest/dist/vanta.${effectName.toLowerCase()}.min.js`),
    effectName,
    options: Object.keys(rest).length > 0 ? rest : defaultVantaConfig.options,
  };
}

function formatUgx(priceUgx: number): string {
  if (priceUgx <= 0) return 'Custom';
  return `UGX ${new Intl.NumberFormat('en-UG').format(priceUgx)}`;
}

export default function Landing() {
  const navigate = useNavigate();
  const [loading] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [plans, setPlans] = useState<PublicBillingPlan[]>([]);
  const [publicContent, setPublicContent] = useState<PublicContent>({
    contactEmail: 'support@caremax.health',
    contactPhonePrimary: '+256 700 000 000',
    contactPhoneSecondary: '+256 753 190 830',
    enableLandingVanta: false,
    landingVantaEmbedCode: '',
  });
  const { isMobile, isVerySmall } = useIsMobile();
  const displayPlans = useMemo(() => plans, [plans]);
  const heroVantaRef = useRef<HTMLDivElement | null>(null);
  const vantaEffectRef = useRef<VantaNetEffect | null>(null);
  const capabilities = [
    {
      icon: '🧠',
      title: 'Intelligent Symptom Assessment',
      description:
        'Patients describe symptoms in natural language. CareMax asks structured follow-up questions, gathers clinical context, and guides patients through safe triage pathways so teams can assess urgency early.',
    },
    {
      icon: '🩺',
      title: 'Clinical Triage Workflows',
      description:
        'CareMax evaluates symptoms and routes patients toward the right level of care, including self-care guidance, clinic visits, telemedicine consultations, or urgent medical care based on configurable protocols.',
    },
    {
      icon: '🤖',
      title: 'Personal AI Health Assistant',
      description:
        'Patients receive an always-on assistant that explains common symptoms, answers health questions, helps prepare for appointments, and provides general care guidance to reduce routine workload.',
    },
    {
      icon: '🤝',
      title: 'Seamless Human Handoff',
      description:
        'When clinical intervention is needed, CareMax transfers conversations with full context including reported symptoms, triage responses, and conversation history for faster informed decisions.',
    },
    {
      icon: '🔐',
      title: 'Designed for Healthcare Environments',
      description:
        'Built with strong access control, secure integrations, and clear audit visibility to support trusted healthcare operations.',
    },
    {
      icon: '📊',
      title: 'Operational & Patient Insights',
      description:
        'Track common patient concerns, triage outcomes, response quality, and service demand patterns to continuously improve care access and delivery.',
    },
  ];

  useEffect(() => {
    let active = true;
    api<{ plans: PublicBillingPlan[] }>('/public/billing/plans')
      .then((data) => {
        if (!active || !Array.isArray(data.plans) || data.plans.length === 0) return;
        setPlans(data.plans);
      })
      .catch(() => {
        setPlans([]);
      });

    api<PublicContent>('/public/content')
      .then((data) => {
        if (!active) return;
        setPublicContent(data);
      })
      .catch(() => {
        if (!active) return;
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    async function ensureScript(id: string, src: string) {
      if (document.getElementById(id)) return;
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.id = id;
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.body.appendChild(script);
      });
    }

    async function createVanta() {
      if (!publicContent.enableLandingVanta || !heroVantaRef.current || vantaEffectRef.current) return;

      const parsedConfig = parseVantaEmbedCode(publicContent.landingVantaEmbedCode ?? '');
      await ensureScript('vanta-three-script', parsedConfig.threeScriptSrc);
      await ensureScript(`vanta-effect-script-${parsedConfig.effectName.toLowerCase()}`, parsedConfig.effectScriptSrc);

      const vantaWindow = window as VantaWindow;
      const effectFactory = vantaWindow.VANTA?.[parsedConfig.effectName];
      if (!effectFactory || !vantaWindow.THREE) return;

      vantaEffectRef.current = effectFactory({
        el: heroVantaRef.current,
        THREE: vantaWindow.THREE,
        ...defaultVantaConfig.options,
        ...parsedConfig.options,
      });
    }

    if (publicContent.enableLandingVanta) {
      createVanta().catch(() => {
        vantaEffectRef.current = null;
      });
    }

    if (!publicContent.enableLandingVanta && vantaEffectRef.current) {
      vantaEffectRef.current.destroy();
      vantaEffectRef.current = null;
    }

    return () => {
      if (vantaEffectRef.current) {
        vantaEffectRef.current.destroy();
        vantaEffectRef.current = null;
      }
    };
  }, [publicContent.enableLandingVanta, publicContent.landingVantaEmbedCode]);

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
        <section className={`hero-section${publicContent.enableLandingVanta ? ' vanta-enabled' : ''}`}>
          {publicContent.enableLandingVanta && <div ref={heroVantaRef} className="hero-vanta-bg" />}
          <div className="landing-container hero-content animate-fade-in">
            <div className="hero-badge">Healthcare AI • Secure • Scalable</div>
            <h2>
              AI Clinical Triage <br />
              <span>and Personal Health Guidance for Modern Care</span>
            </h2>
            <p>
              CareMax helps patients understand symptoms, receive safe guidance, and reach the right care faster through
              clinically-aware AI conversations.
            </p>
            <p>
              Built for clinics, telemedicine providers, and healthcare teams who want to deliver responsive care without
              overwhelming staff.
            </p>
            <div className="hero-actions">
              <button onClick={() => navigate('/signup')} disabled={loading} className="cta-primary">Start Free Trial</button>
              <button onClick={() => setShowVideo(true)} disabled={loading} className="cta-secondary">View Product Tour</button>
            </div>
          </div>
        </section>

        <div className="platform-pricing-flow">
          <section className="surface-section platform-highlights-section">
            <div className="landing-container">
              <div style={{ textAlign: 'center', marginBottom: 60 }} className="animate-fade-in delay-1">
                <h3 className="section-title">Deliver Faster Patient Support with Intelligent Triage</h3>
                <p className="section-subtitle">CareMax combines AI symptom triage, patient guidance, and intelligent care routing to help healthcare organizations manage patient demand safely and efficiently.</p>
                <p className="section-subtitle">Patients get immediate support while clinicians stay focused on the cases that truly require their expertise.</p>
              </div>
              <div className="landing-features-grid animate-fade-in delay-2">
                {capabilities.map((item) => (
                  <div key={item.title} className="feature-card">
                    <div className="feature-icon">{item.icon}</div>
                    <h4 className="feature-title">{item.title}</h4>
                    <p className="feature-description">{item.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="surface-section platform-highlights-section">
            <div className="landing-container">
              <div style={{ textAlign: 'center', marginBottom: 40 }}>
                <h3 className="section-title">Who CareMax Is For</h3>
                <p className="section-subtitle">Clinics and outpatient practices • Telemedicine providers • Health insurance care programs • Digital health platforms • Patient support teams</p>
              </div>
              <div style={{ textAlign: 'center' }}>
                <h4 className="feature-title" style={{ marginBottom: 10 }}>Trust &amp; Safety Note</h4>
                <p className="section-subtitle">CareMax provides informational health guidance and triage support. It does not replace professional medical diagnosis or treatment from licensed healthcare providers.</p>
                <h4 className="feature-title" style={{ marginTop: 28, marginBottom: 10 }}>Core Positioning Statement</h4>
                <p className="section-subtitle">CareMax is an AI-powered clinical triage and patient guidance platform that helps healthcare teams respond to patient needs faster while keeping clinicians focused on critical care.</p>
              </div>
            </div>
          </section>

          {displayPlans.length > 0 && (
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
                        {pkg.priceUgx <= 0 ? 'Free' : formatUgx(pkg.priceUgx)}
                        <span>{pkg.priceUgx > 0 ? '/month' : '/limited time'}</span>
                      </p>
                      {pkg.trialDays > 0 && <p className="price-trial">{pkg.trialDays} day trial included</p>}
                      <p className="price-description">{pkg.description}</p>
                      <button onClick={() => navigate('/signup')} className="pricing-btn">{pkg.priceUgx <= 0 ? 'Start Free Trial' : 'Choose Package'}</button>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}
        </div>
      </main>

      <footer className="landing-footer">
        <div className="landing-container footer-content" style={{ flexDirection: isMobile ? 'column' : 'row' }}>
          <div className="footer-brand-block">
            <div className="brand-wrap">
              <div className="brand-icon small">C</div>
              <span className="footer-brand">CareMax</span>
            </div>
            <p className="footer-details">{publicContent.contactEmail} • {publicContent.contactPhonePrimary}</p>
            <p className="footer-details">{publicContent.contactPhoneSecondary}</p>
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
