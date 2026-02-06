import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signUpWithEmail, signInWithGoogle } from '../firebase';
import { setAuthToken } from '../api';
import { getAuthErrorMessage } from '../utils/authErrors';

type Props = {
  onSuccess: () => void;
};

export default function SignUp({ onSuccess }: Props) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password || !confirmPassword) {
      setError('Email and password are required');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = await signUpWithEmail(email.trim(), password);
      setAuthToken(token);
      onSuccess();
    } catch (e) {
      setError(getAuthErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
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
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: '24px',
      }}
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: 12,
          padding: '40px',
          maxWidth: 500,
          width: '100%',
          boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h1 style={{ margin: '0 0 8px 0', fontSize: 30, fontWeight: 700, color: '#333' }}>Create your account</h1>
          <p style={{ color: '#666', fontSize: 14, margin: 0 }}>
            Sign up with email and password or continue with Google.
          </p>
        </div>

        {error && (
          <div
            style={{
              backgroundColor: '#ffebee',
              color: '#c62828',
              padding: '12px 16px',
              borderRadius: 6,
              marginBottom: 16,
              fontSize: 14,
              border: '1px solid #ef9a9a',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 18 }}>⚠️</span>
            <span style={{ flex: 1 }}>{error}</span>
          </div>
        )}

        <form onSubmit={handleEmailSignUp} style={{ marginBottom: 16 }}>
          <label
            style={{
              display: 'block',
              marginBottom: 12,
              fontSize: 14,
              fontWeight: 600,
              color: '#333',
            }}
          >
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{
                width: '100%',
                padding: '10px',
                marginTop: 6,
                fontSize: 14,
                borderRadius: 6,
                border: '1px solid #ddd',
                boxSizing: 'border-box',
              }}
              autoFocus
            />
          </label>

          <label
            style={{
              display: 'block',
              marginBottom: 12,
              fontSize: 14,
              fontWeight: 600,
              color: '#333',
            }}
          >
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              style={{
                width: '100%',
                padding: '10px',
                marginTop: 6,
                fontSize: 14,
                borderRadius: 6,
                border: '1px solid #ddd',
                boxSizing: 'border-box',
              }}
            />
          </label>

          <label
            style={{
              display: 'block',
              marginBottom: 16,
              fontSize: 14,
              fontWeight: 600,
              color: '#333',
            }}
          >
            Confirm Password
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter your password"
              style={{
                width: '100%',
                padding: '10px',
                marginTop: 6,
                fontSize: 14,
                borderRadius: 6,
                border: '1px solid #ddd',
                boxSizing: 'border-box',
              }}
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px 16px',
              fontSize: 15,
              fontWeight: 600,
              backgroundColor: loading ? '#ccc' : '#667eea',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: loading ? 'not-allowed' : 'pointer',
              marginBottom: 12,
            }}
          >
            {loading ? 'Creating account...' : 'Sign up'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginBottom: 12, fontSize: 12, color: '#888' }}>or</div>

        <button
          type="button"
          onClick={handleGoogleSignUp}
          disabled={loading}
          style={{
            width: '100%',
            padding: '12px 16px',
            fontSize: 15,
            fontWeight: 600,
            backgroundColor: '#4285f4',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: loading ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          {loading ? 'Signing in...' : 'Continue with Google'}
        </button>

        <div style={{ marginTop: 16, fontSize: 13, textAlign: 'center', color: '#666' }}>
          Already have an account?{' '}
          <button
            type="button"
            onClick={() => navigate('/login')}
            style={{
              background: 'none',
              border: 'none',
              color: '#667eea',
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: 0,
              fontSize: 13,
            }}
          >
            Sign in
          </button>
        </div>
      </div>
    </div>
  );
}
