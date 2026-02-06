import { useState } from 'react';
import { signInWithGoogle } from '../firebase';
import { setAuthToken } from '../api';

type Props = { 
  onLogin: () => void;
  onSignUp: () => void;
};

export default function Landing({ onLogin, onSignUp }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleAuth = async (isSignUp: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const token = await signInWithGoogle();
      setAuthToken(token);
      if (isSignUp) {
        onSignUp();
      } else {
        onLogin();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <header style={{ padding: '24px 48px', background: 'rgba(255, 255, 255, 0.1)', backdropFilter: 'blur(10px)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ margin: 0, color: 'white', fontSize: 28, fontWeight: 700 }}>CareMax</h1>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={() => handleGoogleAuth(false)}
              disabled={loading}
              style={{
                padding: '10px 20px',
                fontSize: 14,
                backgroundColor: 'transparent',
                color: 'white',
                border: '2px solid white',
                borderRadius: 6,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: 500,
              }}
            >
              Sign In
            </button>
            <button
              onClick={() => handleGoogleAuth(true)}
              disabled={loading}
              style={{
                padding: '10px 20px',
                fontSize: 14,
                backgroundColor: 'white',
                color: '#667eea',
                border: 'none',
                borderRadius: 6,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: 600,
              }}
            >
              Sign Up
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 24px' }}>
        <div style={{ maxWidth: 900, textAlign: 'center', color: 'white' }}>
          <h2 style={{ fontSize: 48, fontWeight: 700, marginBottom: 24, lineHeight: 1.2 }}>
            AI-Powered Clinical Triage Assistant
          </h2>
          <p style={{ fontSize: 20, marginBottom: 40, opacity: 0.95, lineHeight: 1.6, maxWidth: 700, margin: '0 auto 40px' }}>
            CareMax helps healthcare organizations provide intelligent symptom assessment and triage 
            through an embeddable chat widget powered by Google Gemini AI.
          </p>

          {error && (
            <div
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.2)',
                color: 'white',
                padding: '12px 24px',
                borderRadius: 6,
                marginBottom: 24,
                display: 'inline-block',
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => handleGoogleAuth(true)}
              disabled={loading}
              style={{
                padding: '16px 32px',
                fontSize: 18,
                backgroundColor: 'white',
                color: '#667eea',
                border: 'none',
                borderRadius: 8,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                transition: 'transform 0.2s',
              }}
              onMouseEnter={(e) => {
                if (!loading) e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              {loading ? 'Signing in...' : 'Get Started Free'}
            </button>
            <button
              onClick={() => handleGoogleAuth(false)}
              disabled={loading}
              style={{
                padding: '16px 32px',
                fontSize: 18,
                backgroundColor: 'transparent',
                color: 'white',
                border: '2px solid white',
                borderRadius: 8,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: 600,
              }}
            >
              Sign In
            </button>
          </div>
        </div>
      </main>

      {/* Features Section */}
      <section style={{ padding: '64px 24px', background: 'rgba(255, 255, 255, 0.05)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <h3 style={{ fontSize: 32, fontWeight: 600, textAlign: 'center', color: 'white', marginBottom: 48 }}>
            Why CareMax?
          </h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 32,
            }}
          >
            <div style={{ textAlign: 'center', color: 'white' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🤖</div>
              <h4 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>AI-Powered Triage</h4>
              <p style={{ fontSize: 16, opacity: 0.9, lineHeight: 1.6 }}>
                Intelligent symptom assessment using Google Gemini AI to help patients understand their next steps.
              </p>
            </div>
            <div style={{ textAlign: 'center', color: 'white' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>💬</div>
              <h4 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Embeddable Widget</h4>
              <p style={{ fontSize: 16, opacity: 0.9, lineHeight: 1.6 }}>
                Easy-to-integrate chat widget that works seamlessly on any website or application.
              </p>
            </div>
            <div style={{ textAlign: 'center', color: 'white' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📚</div>
              <h4 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>RAG Knowledge Base</h4>
              <p style={{ fontSize: 16, opacity: 0.9, lineHeight: 1.6 }}>
                Upload documents to create a custom knowledge base for your organization's specific needs.
              </p>
            </div>
            <div style={{ textAlign: 'center', color: 'white' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>👥</div>
              <h4 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Human Handoff</h4>
              <p style={{ fontSize: 16, opacity: 0.9, lineHeight: 1.6 }}>
                Seamless escalation to human agents when complex cases require personal attention.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ padding: '32px 24px', textAlign: 'center', color: 'white', opacity: 0.8 }}>
        <p style={{ margin: 0, fontSize: 14 }}>
          © 2026 CareMax. Multi-tenant SaaS for AI-powered clinical triage.
        </p>
      </footer>
    </div>
  );
}
