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
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        maxWidth: '100vw',
        overflowX: 'hidden',
      }}
    >
      {/* Header */}
      <header style={{ 
        padding: isVerySmall ? '12px 16px' : isMobile ? '16px 24px' : '24px 48px',
        background: 'rgba(255, 255, 255, 0.1)', 
        backdropFilter: 'blur(10px)'
      }}>
        <div style={{ 
          maxWidth: 1200, 
          margin: '0 auto', 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: isVerySmall ? 8 : 12
        }}>
          <h1 style={{ 
            margin: 0, 
            color: 'white', 
            fontSize: isVerySmall ? 20 : isMobile ? 24 : 28,
            fontWeight: 700,
            wordBreak: 'break-word'
          }}>CareMax</h1>
          <div style={{ 
            display: 'flex', 
            gap: isVerySmall ? 6 : isMobile ? 8 : 12,
            flexWrap: 'wrap',
            alignItems: 'center'
          }}>
            <button
              onClick={() => navigate('/login')}
              disabled={loading}
              style={{
                padding: isVerySmall ? '6px 12px' : isMobile ? '8px 16px' : '10px 20px',
                fontSize: isVerySmall ? 12 : 14,
                backgroundColor: 'transparent',
                color: 'white',
                border: '2px solid white',
                borderRadius: 6,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: 500,
                whiteSpace: 'nowrap',
                minWidth: 'fit-content'
              }}
            >
              Sign In
            </button>
            <button
              onClick={() => navigate('/signup')}
              disabled={loading}
              style={{
                padding: isVerySmall ? '6px 12px' : isMobile ? '8px 16px' : '10px 20px',
                fontSize: isVerySmall ? 12 : 14,
                backgroundColor: 'white',
                color: '#667eea',
                border: 'none',
                borderRadius: 6,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                minWidth: 'fit-content'
              }}
            >
              Sign Up
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
        padding: isVerySmall ? '24px 12px' : isMobile ? '32px 16px' : '48px 24px'
      }}>
        <div style={{ 
          maxWidth: 900, 
          textAlign: 'center', 
          color: 'white',
          width: '100%'
        }}>
          <h2 style={{ 
            fontSize: isVerySmall ? 24 : isMobile ? 32 : 48,
            fontWeight: 700, 
            marginBottom: isVerySmall ? 12 : isMobile ? 16 : 24, 
            lineHeight: 1.2,
            padding: '0 4px',
            wordWrap: 'break-word',
            overflowWrap: 'break-word'
          }}>
            AI-Powered Clinical Triage Assistant
          </h2>
          <p style={{ 
            fontSize: isVerySmall ? 14 : isMobile ? 16 : 20,
            marginBottom: isVerySmall ? 24 : isMobile ? 32 : 40, 
            opacity: 0.95, 
            lineHeight: 1.6, 
            maxWidth: 700, 
            margin: '0 auto',
            padding: '0 4px',
            wordWrap: 'break-word',
            overflowWrap: 'break-word'
          }}>
            CareMax helps healthcare organizations provide intelligent symptom assessment and triage 
            through an embeddable chat widget powered by Google Gemini AI.
          </p>

          <div style={{ 
            display: 'flex', 
            gap: isVerySmall ? 8 : isMobile ? 12 : 16,
            justifyContent: 'center', 
            flexWrap: 'wrap',
            padding: '0 4px'
          }}>
            <button
              onClick={() => navigate('/signup')}
              disabled={loading}
              style={{
                padding: isVerySmall ? '10px 20px' : isMobile ? '12px 24px' : '16px 32px',
                fontSize: isVerySmall ? 14 : isMobile ? 16 : 18,
                backgroundColor: 'white',
                color: '#667eea',
                border: 'none',
                borderRadius: 8,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                transition: 'transform 0.2s',
                width: isVerySmall || isMobile ? '100%' : 'auto',
                maxWidth: isVerySmall ? 260 : isMobile ? 280 : 'none'
              }}
              onMouseEnter={(e) => {
                if (!loading) e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              Get Started Free
            </button>
            <button
              onClick={() => navigate('/login')}
              disabled={loading}
              style={{
                padding: isVerySmall ? '10px 20px' : isMobile ? '12px 24px' : '16px 32px',
                fontSize: isVerySmall ? 14 : isMobile ? 16 : 18,
                backgroundColor: 'transparent',
                color: 'white',
                border: '2px solid white',
                borderRadius: 8,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                width: isVerySmall || isMobile ? '100%' : 'auto',
                maxWidth: isVerySmall ? 260 : isMobile ? 280 : 'none'
              }}
            >
              Sign In
            </button>
          </div>
        </div>
      </main>

      {/* Features Section */}
      <section style={{ 
        padding: isVerySmall ? '32px 12px' : isMobile ? '48px 16px' : '64px 24px',
        background: 'rgba(255, 255, 255, 0.05)'
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', width: '100%' }}>
          <h3 style={{ 
            fontSize: isVerySmall ? 20 : isMobile ? 24 : 32,
            fontWeight: 600, 
            textAlign: 'center', 
            color: 'white', 
            marginBottom: isVerySmall ? 24 : isMobile ? 32 : 48,
            wordWrap: 'break-word',
            overflowWrap: 'break-word',
            padding: '0 4px'
          }}>
            Why CareMax?
          </h3>
          <div className="landing-features-grid">
            <div style={{ textAlign: 'center', color: 'white', minWidth: 0, wordWrap: 'break-word', overflowWrap: 'break-word' }}>
              <div style={{ fontSize: isMobile ? 40 : 48, marginBottom: isMobile ? 12 : 16 }}>🤖</div>
              <h4 style={{ fontSize: isMobile ? 16 : 20, fontWeight: 600, marginBottom: 8, wordWrap: 'break-word', overflowWrap: 'break-word' }}>AI-Powered Triage</h4>
              <p style={{ fontSize: isMobile ? 13 : 16, opacity: 0.9, lineHeight: 1.6, wordWrap: 'break-word', overflowWrap: 'break-word', hyphens: 'auto', padding: '0 4px' }}>
                Intelligent symptom assessment using Google Gemini AI to help patients understand their next steps.
              </p>
            </div>
            <div style={{ textAlign: 'center', color: 'white', minWidth: 0, wordWrap: 'break-word', overflowWrap: 'break-word' }}>
              <div style={{ fontSize: isMobile ? 40 : 48, marginBottom: isMobile ? 12 : 16 }}>💬</div>
              <h4 style={{ fontSize: isMobile ? 16 : 20, fontWeight: 600, marginBottom: 8, wordWrap: 'break-word', overflowWrap: 'break-word' }}>Embeddable Widget</h4>
              <p style={{ fontSize: isMobile ? 13 : 16, opacity: 0.9, lineHeight: 1.6, wordWrap: 'break-word', overflowWrap: 'break-word', hyphens: 'auto', padding: '0 4px' }}>
                Easy-to-integrate chat widget that works seamlessly on any website or application.
              </p>
            </div>
            <div style={{ textAlign: 'center', color: 'white', minWidth: 0, wordWrap: 'break-word', overflowWrap: 'break-word' }}>
              <div style={{ fontSize: isMobile ? 40 : 48, marginBottom: isMobile ? 12 : 16 }}>📚</div>
              <h4 style={{ fontSize: isMobile ? 16 : 20, fontWeight: 600, marginBottom: 8, wordWrap: 'break-word', overflowWrap: 'break-word' }}>RAG Knowledge Base</h4>
              <p style={{ fontSize: isMobile ? 13 : 16, opacity: 0.9, lineHeight: 1.6, wordWrap: 'break-word', overflowWrap: 'break-word', hyphens: 'auto', padding: '0 4px' }}>
                Upload documents to create a custom knowledge base for your organization's specific needs.
              </p>
            </div>
            <div style={{ textAlign: 'center', color: 'white', minWidth: 0, wordWrap: 'break-word', overflowWrap: 'break-word' }}>
              <div style={{ fontSize: isMobile ? 40 : 48, marginBottom: isMobile ? 12 : 16 }}>👥</div>
              <h4 style={{ fontSize: isMobile ? 16 : 20, fontWeight: 600, marginBottom: 8, wordWrap: 'break-word', overflowWrap: 'break-word' }}>Human Handoff</h4>
              <p style={{ fontSize: isMobile ? 13 : 16, opacity: 0.9, lineHeight: 1.6, wordWrap: 'break-word', overflowWrap: 'break-word', hyphens: 'auto', padding: '0 4px' }}>
                Seamless escalation to human agents when complex cases require personal attention.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ 
        padding: isMobile ? '24px 16px' : '32px 24px',
        textAlign: 'center', 
        color: 'white', 
        opacity: 0.8
      }}>
        <p style={{ margin: 0, fontSize: isMobile ? 12 : 14 }}>
          © 2026 CareMax. Multi-tenant SaaS for AI-powered clinical triage.
        </p>
      </footer>
    </div>
  );
}
