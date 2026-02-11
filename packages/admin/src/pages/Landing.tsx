import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Landing.css';
import { useIsMobile } from '../hooks/useIsMobile';

type Props = { 
  onLogin: () => void;
};

export default function Landing({ onLogin }: Props) {
  const navigate = useNavigate();
  const [loading] = useState(false);
  const { isMobile, isVerySmall } = useIsMobile();

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        maxWidth: '100vw',
        overflowX: 'hidden',
        fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
        color: 'white',
      }}
    >
      <div className="dynamic-bg" />

      {/* Header */}
      <header style={{ 
        padding: isVerySmall ? '12px 16px' : isMobile ? '16px 24px' : '20px 48px',
        background: 'rgba(15, 23, 42, 0.3)', 
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ 
          maxWidth: 1200, 
          margin: '0 auto', 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          gap: isVerySmall ? 8 : 12
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ 
              width: 36, height: 36, background: 'white', borderRadius: 10, 
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, color: '#0ea5e9', fontSize: 22,
              boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
            }}>C</div>
            <h1 style={{ 
              margin: 0, 
              color: 'white', 
              fontSize: isVerySmall ? 20 : 26,
              fontWeight: 800,
              letterSpacing: '-0.03em'
            }}>CareMax</h1>
          </div>
          <div style={{ 
            display: 'flex', 
            gap: isVerySmall ? 8 : 16,
            alignItems: 'center'
          }}>
            <button
              onClick={() => navigate('/login')}
              disabled={loading}
              style={{
                padding: '10px 20px',
                fontSize: 15,
                backgroundColor: 'transparent',
                color: 'white',
                border: 'none',
                borderRadius: 10,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                transition: 'all 0.2s'
              }}
            >
              Sign In
            </button>
            <button
              onClick={() => navigate('/signup')}
              disabled={loading}
              style={{
                padding: '12px 24px',
                fontSize: 15,
                backgroundColor: 'white',
                color: '#0c4a6e',
                border: 'none',
                borderRadius: 10,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: 700,
                boxShadow: '0 10px 15px -3px rgba(0,0,0,0.2)',
              }}
            >
              Get Started
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ 
        flex: 1, 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        padding: isVerySmall ? '60px 20px' : isMobile ? '80px 24px' : '120px 24px'
      }}>
        <div style={{ 
          maxWidth: 1000, 
          textAlign: 'center', 
          width: '100%'
        }} className="animate-fade-in">
          <div className="hero-badge">
            <span style={{ fontSize: 18 }}>✨</span> Powered by Google Gemini AI
          </div>
          <h2 style={{ 
            fontSize: isVerySmall ? 36 : isMobile ? 48 : 72,
            fontWeight: 800, 
            marginBottom: 28, 
            lineHeight: 1.05,
            letterSpacing: '-0.04em',
            textShadow: '0 10px 30px rgba(0,0,0,0.3)',
            color: 'white'
          }}>
            Intelligent Clinical <br />
            <span style={{ color: '#38bdf8' }}>Triage for Healthcare</span>
          </h2>
          <p style={{ 
            fontSize: isVerySmall ? 17 : 22,
            marginBottom: 56, 
            color: 'rgba(255,255,255,0.85)', 
            lineHeight: 1.6, 
            maxWidth: 750, 
            margin: '0 auto 56px',
          }}>
            Empower your clinical teams with AI-driven symptom assessment. 
            Streamline patient intake and ensure every case gets the right level of care.
          </p>

          <div style={{ 
            display: 'flex', 
            gap: 20,
            justifyContent: 'center', 
            flexWrap: 'wrap',
          }}>
            <button
              onClick={() => navigate('/signup')}
              disabled={loading}
              style={{
                padding: '20px 44px',
                fontSize: 18,
                backgroundColor: '#0ea5e9',
                color: 'white',
                border: 'none',
                borderRadius: 14,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: 700,
                boxShadow: '0 20px 25px -5px rgba(14, 165, 233, 0.4)',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                width: isMobile ? '100%' : 'auto',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-4px)';
                e.currentTarget.style.backgroundColor = '#0284c7';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.backgroundColor = '#0ea5e9';
              }}
            >
              Start Free Trial
            </button>
            <button
              onClick={() => navigate('/login')}
              disabled={loading}
              style={{
                padding: '20px 44px',
                fontSize: 18,
                backgroundColor: 'rgba(255,255,255,0.05)',
                color: 'white',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 14,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: 700,
                backdropFilter: 'blur(12px)',
                width: isMobile ? '100%' : 'auto',
                transition: 'all 0.3s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
            >
              View Demo
            </button>
          </div>
        </div>
      </main>

      {/* Features Section */}
      <section style={{ 
        padding: isMobile ? '80px 24px' : '120px 24px',
        background: 'rgba(15, 23, 42, 0.4)',
        borderTop: '1px solid rgba(255, 255, 255, 0.05)'
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', width: '100%' }}>
          <div style={{ textAlign: 'center', marginBottom: 80 }} className="animate-fade-in delay-1">
            <h3 style={{ 
              fontSize: isMobile ? 32 : 44,
              fontWeight: 800, 
              color: 'white', 
              marginBottom: 20,
              letterSpacing: '-0.03em'
            }}>
              Built for Modern Healthcare
            </h3>
            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 20, maxWidth: 700, margin: '0 auto' }}>
              Advanced AI capabilities designed to integrate seamlessly into clinical workflows.
            </p>
          </div>
          
          <div className="landing-features-grid animate-fade-in delay-2">
            <div className="feature-card">
              <div className="feature-icon">🏥</div>
              <h4 className="feature-title">Clinical Triage</h4>
              <p className="feature-description">
                Sophisticated symptom assessment using Google Gemini AI to guide patients to appropriate care levels.
              </p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">⚡</div>
              <h4 className="feature-title">Instant Integration</h4>
              <p className="feature-description">
                Deploy our secure chat widget on any hospital portal or patient app with a single line of code.
              </p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">🛡️</div>
              <h4 className="feature-title">Secure Knowledge</h4>
              <p className="feature-description">
                Upload your medical protocols to create a private, RAG-powered knowledge base for accurate responses.
              </p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">👨‍⚕️</div>
              <h4 className="feature-title">Expert Handoff</h4>
              <p className="feature-description">
                Intelligent escalation to clinical staff when cases require human intervention or complex decision-making.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ 
        padding: '64px 24px',
        textAlign: 'center', 
        color: 'rgba(255,255,255,0.5)', 
        borderTop: '1px solid rgba(255, 255, 255, 0.05)',
        background: 'rgba(15, 23, 42, 0.6)',
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: 'center', gap: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ 
              width: 28, height: 28, background: 'rgba(255,255,255,0.2)', borderRadius: 8, 
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, color: 'white', fontSize: 16
            }}>C</div>
            <span style={{ fontWeight: 700, color: 'white', fontSize: 20, letterSpacing: '-0.02em' }}>CareMax</span>
          </div>
          <p style={{ margin: 0, fontSize: 15 }}>
            © 2026 CareMax Health Technologies. All rights reserved.
          </p>
          <div style={{ display: 'flex', gap: 32, fontSize: 15 }}>
            <span style={{ cursor: 'pointer' }}>Privacy Policy</span>
            <span style={{ cursor: 'pointer' }}>Terms of Service</span>
            <span style={{ cursor: 'pointer' }}>Contact</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
