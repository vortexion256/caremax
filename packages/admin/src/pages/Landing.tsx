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
        background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        maxWidth: '100vw',
        overflowX: 'hidden',
        fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Header */}
      <header style={{ 
        padding: isVerySmall ? '12px 16px' : isMobile ? '16px 24px' : '20px 48px',
        background: 'rgba(255, 255, 255, 0.05)', 
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ 
              width: 32, height: 32, background: 'white', borderRadius: 8, 
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, color: '#4f46e5', fontSize: 20
            }}>C</div>
            <h1 style={{ 
              margin: 0, 
              color: 'white', 
              fontSize: isVerySmall ? 20 : 24,
              fontWeight: 800,
              letterSpacing: '-0.02em'
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
                padding: '8px 16px',
                fontSize: 14,
                backgroundColor: 'transparent',
                color: 'white',
                border: 'none',
                borderRadius: 8,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                transition: 'opacity 0.2s'
              }}
            >
              Sign In
            </button>
            <button
              onClick={() => navigate('/signup')}
              disabled={loading}
              style={{
                padding: '10px 20px',
                fontSize: 14,
                backgroundColor: 'white',
                color: '#4f46e5',
                border: 'none',
                borderRadius: 8,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: 700,
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
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
        padding: isVerySmall ? '40px 20px' : isMobile ? '60px 24px' : '100px 24px'
      }}>
        <div style={{ 
          maxWidth: 1000, 
          textAlign: 'center', 
          color: 'white',
          width: '100%'
        }} className="animate-fade-in">
          <div className="hero-badge">✨ Powered by Google Gemini AI</div>
          <h2 style={{ 
            fontSize: isVerySmall ? 32 : isMobile ? 42 : 64,
            fontWeight: 800, 
            marginBottom: 24, 
            lineHeight: 1.1,
            letterSpacing: '-0.03em',
          }}>
            AI-Powered Clinical <br />
            <span style={{ color: 'rgba(255,255,255,0.7)' }}>Triage Assistant</span>
          </h2>
          <p style={{ 
            fontSize: isVerySmall ? 16 : 20,
            marginBottom: 48, 
            color: 'rgba(255,255,255,0.9)', 
            lineHeight: 1.6, 
            maxWidth: 700, 
            margin: '0 auto 48px',
          }}>
            CareMax helps healthcare organizations provide intelligent symptom assessment 
            and triage through a seamless, embeddable chat widget.
          </p>

          <div style={{ 
            display: 'flex', 
            gap: 16,
            justifyContent: 'center', 
            flexWrap: 'wrap',
          }}>
            <button
              onClick={() => navigate('/signup')}
              disabled={loading}
              style={{
                padding: '18px 36px',
                fontSize: 18,
                backgroundColor: 'white',
                color: '#4f46e5',
                border: 'none',
                borderRadius: 12,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: 700,
                boxShadow: '0 10px 25px -5px rgba(0,0,0,0.2)',
                transition: 'transform 0.2s',
                width: isMobile ? '100%' : 'auto',
              }}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              Start Free Trial
            </button>
            <button
              onClick={() => navigate('/login')}
              disabled={loading}
              style={{
                padding: '18px 36px',
                fontSize: 18,
                backgroundColor: 'rgba(255,255,255,0.1)',
                color: 'white',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 12,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: 700,
                backdropFilter: 'blur(8px)',
                width: isMobile ? '100%' : 'auto',
              }}
            >
              View Demo
            </button>
          </div>
        </div>
      </main>

      {/* Features Section */}
      <section style={{ 
        padding: isMobile ? '60px 24px' : '100px 24px',
        background: 'rgba(0, 0, 0, 0.2)',
        borderTop: '1px solid rgba(255, 255, 255, 0.05)'
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', width: '100%' }}>
          <div style={{ textAlign: 'center', marginBottom: 64 }} className="animate-fade-in delay-1">
            <h3 style={{ 
              fontSize: isMobile ? 28 : 40,
              fontWeight: 800, 
              color: 'white', 
              marginBottom: 16,
              letterSpacing: '-0.02em'
            }}>
              Everything you need for modern triage
            </h3>
            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 18 }}>
              Powerful features to streamline patient intake and support.
            </p>
          </div>
          
          <div className="landing-features-grid animate-fade-in delay-2">
            <div className="feature-card">
              <div className="feature-icon">🤖</div>
              <h4 className="feature-title">AI-Powered Triage</h4>
              <p className="feature-description">
                Intelligent symptom assessment using Google Gemini AI to help patients understand their next steps.
              </p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">💬</div>
              <h4 className="feature-title">Embeddable Widget</h4>
              <p className="feature-description">
                Easy-to-integrate chat widget that works seamlessly on any website or application with just one line of code.
              </p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">📚</div>
              <h4 className="feature-title">RAG Knowledge Base</h4>
              <p className="feature-description">
                Upload medical protocols and documents to create a custom knowledge base for your organization.
              </p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">👥</div>
              <h4 className="feature-title">Human Handoff</h4>
              <p className="feature-description">
                Seamless escalation to human agents when complex cases require personal attention or clinical intervention.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ 
        padding: '48px 24px',
        textAlign: 'center', 
        color: 'rgba(255,255,255,0.5)', 
        borderTop: '1px solid rgba(255, 255, 255, 0.05)'
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: 'center', gap: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ 
              width: 24, height: 24, background: 'rgba(255,255,255,0.2)', borderRadius: 6, 
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, color: 'white', fontSize: 14
            }}>C</div>
            <span style={{ fontWeight: 700, color: 'white' }}>CareMax</span>
          </div>
          <p style={{ margin: 0, fontSize: 14 }}>
            © 2026 CareMax. All rights reserved. Built for healthcare excellence.
          </p>
          <div style={{ display: 'flex', gap: 24, fontSize: 14 }}>
            <span>Privacy</span>
            <span>Terms</span>
            <span>Contact</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
