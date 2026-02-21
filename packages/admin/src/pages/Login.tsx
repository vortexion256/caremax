import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithEmail, signInWithGoogle } from '../firebase';
import { setAuthToken } from '../api';
import { getAuthErrorMessage } from '../utils/authErrors';
import './Landing.css';

type Props = { onSuccess: () => void };

export default function Login({ onSuccess }: Props) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Email and password are required');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = await signInWithEmail(email.trim(), password);
      setAuthToken(token);
      onSuccess();
    } catch (e) {
      setError(getAuthErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await signInWithGoogle();
      setAuthToken(token);
      onSuccess();
    } catch (e) {
      setError(getAuthErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="auth-page-shell"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
        position: 'relative',
        isolation: 'isolate',
        overflow: 'hidden',
      }}
    >
      <div className="dynamic-bg" />
      
      <div className="auth-card" style={{ maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ 
            width: 40, height: 40, background: '#38bdf8', borderRadius: 10, 
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, color: 'white', fontSize: 22, margin: '0 auto 14px',
            boxShadow: '0 6px 12px rgba(56, 189, 248, 0.25)'
          }}>C</div>
          <h1 style={{ margin: '0 0 8px 0', fontSize: 28, fontWeight: 800, color: '#0f172a', letterSpacing: '-0.03em' }}>Welcome Back</h1>
          <p style={{ color: '#64748b', fontSize: 14, margin: 0 }}>
            Sign in to manage your clinical triage dashboard.
          </p>
        </div>

        {error && (
          <div
            style={{
              backgroundColor: '#fef2f2',
              color: '#dc2626',
              padding: '14px 18px',
              borderRadius: 12,
              marginBottom: 24,
              fontSize: 14,
              border: '1px solid #fee2e2',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontWeight: 500
            }}
          >
            <span style={{ fontSize: 18 }}>⚠️</span>
            <span style={{ flex: 1 }}>{error}</span>
          </div>
        )}

        <form onSubmit={handleEmailLogin} style={{ marginBottom: 18 }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
              Email Address
            </label>
            <input
              type="email"
              className="auth-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@hospital.org"
              autoFocus
            />
          </div>
          <div style={{ marginBottom: 18 }}>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
              Password
            </label>
            <input
              type="password"
              className="auth-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="auth-button-primary"
            style={{ backgroundColor: loading ? '#94a3b8' : '#0ea5e9' }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }}></div>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#94a3b8' }}>OR</div>
          <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }}></div>
        </div>

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={loading}
          className="auth-button-google"
        >
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>

        <div style={{ marginTop: 24, fontSize: 14, textAlign: 'center', color: '#64748b' }}>
          Don&apos;t have an account?{' '}
          <button
            type="button"
            onClick={() => navigate('/signup')}
            style={{
              background: 'none',
              border: 'none',
              color: '#0ea5e9',
              cursor: 'pointer',
              fontWeight: 700,
              padding: 0,
              fontSize: 14,
            }}
          >
            Create Account
          </button>
        </div>
      </div>
    </div>
  );
}
