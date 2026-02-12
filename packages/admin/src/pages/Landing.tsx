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
  const [showVideo, setShowVideo] = useState(false);
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
        color: '#0f172a',
        backgroundColor: '#f8fafc',
      }}
    >
      <div className="dynamic-bg" />

      {/* Header */}
      <header style={{ 
        padding: isVerySmall ? '12px 16px' : isMobile ? '16px 24px' : '20px 48px',
        background: 'rgba(255, 255, 255, 0.8)', 
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(0, 0, 0, 0.05)',
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
              color: '#0f172a', 
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
                color: '#475569',
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
            color: '#0f172a'
          }}>
            Intelligent Clinical <br />
            <span style={{ color: '#38bdf8' }}>Triage for Healthcare</span>
          </h2>
          <p style={{ 
            fontSize: isVerySmall ? 17 : 22,
            marginBottom: 56, 
            color: '#475569', 
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
              onClick={() => setShowVideo(true)}
              disabled={loading}
              style={{
                padding: '20px 44px',
                fontSize: 18,
                backgroundColor: 'white',
                color: '#0f172a',
                border: '1px solid #e2e8f0',
                borderRadius: 14,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: 700,
                width: isMobile ? '100%' : 'auto',
                transition: 'all 0.3s',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
            >
              Watch Demo
            </button>
          </div>
        </div>
      </main>

      {/* Features Section */}
      <section style={{ 
        padding: isMobile ? '80px 24px' : '120px 24px',
        background: '#ffffff',
        borderTop: '1px solid #f1f5f9'
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', width: '100%' }}>
          <div style={{ textAlign: 'center', marginBottom: 80 }} className="animate-fade-in delay-1">
            <h3 style={{ 
              fontSize: isMobile ? 32 : 44,
              fontWeight: 800, 
              color: '#0f172a', 
              marginBottom: 20,
              letterSpacing: '-0.03em'
            }}>
              Built for Modern Healthcare
            </h3>
            <p style={{ color: '#64748b', fontSize: 20, maxWidth: 700, margin: '0 auto' }}>
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
        color: '#64748b', 
        borderTop: '1px solid #f1f5f9',
        background: '#f8fafc',
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: 'center', gap: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ 
              width: 28, height: 28, background: '#0ea5e9', borderRadius: 8, 
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, color: 'white', fontSize: 16
            }}>C</div>
            <span style={{ fontWeight: 700, color: '#0f172a', fontSize: 20, letterSpacing: '-0.02em' }}>CareMax</span>
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

      {/* Video Modal */}
      {showVideo && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: isMobile ? 10 : 40
          }}
          onClick={() => setShowVideo(false)}
        >
          <div 
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: 1000,
              aspectRatio: '16/9',
              backgroundColor: '#000',
              borderRadius: 12,
              overflow: 'hidden',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
            }}
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setShowVideo(false)}
              style={{
                position: 'absolute',
                top: 20,
                right: 20,
                background: 'rgba(255, 255, 255, 0.2)',
                border: 'none',
                color: 'white',
                width: 40,
                height: 40,
                borderRadius: '50%',
                cursor: 'pointer',
                fontSize: 24,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10,
                backdropFilter: 'blur(4px)'
              }}
            >
              ×
            </button>
            <video 
              autoPlay 
              controls 
              muted 
              style={{ width: '100%', height: '100%' }}
            >
              <source src="https://firebasestorage.googleapis.com/v0/b/caremax-15f69.firebasestorage.app/o/CareMAX%20-%20vid.mp4?alt=media&token=fddfcc94-74ee-4298-b983-6666e531f136" type="video/mp4" />
              Your browser does not support the video tag.
            </video>
          </div>
        </div>
      )}
    </div>
  );
}
