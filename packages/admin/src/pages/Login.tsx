import { useState } from 'react';
import { signInWithGoogle } from '../firebase';
import { setAuthToken } from '../api';

type Props = { onSuccess: () => void };

export default function Login({ onSuccess }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogle = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await signInWithGoogle();
      setAuthToken(token);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
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
        background: '#f5f5f5',
      }}
    >
      <div style={{ textAlign: 'center', padding: 24 }}>
        <h1 style={{ marginBottom: 8 }}>CareMax Admin</h1>
        <p style={{ color: '#666', marginBottom: 24 }}>Sign in with Google</p>
        {error && <p style={{ color: '#c62828', marginBottom: 16 }}>{error}</p>}
        <button
          type="button"
          onClick={handleGoogle}
          disabled={loading}
          style={{ padding: '12px 24px', fontSize: 16, cursor: loading ? 'not-allowed' : 'pointer' }}
        >
          {loading ? 'Signing in...' : 'Continue with Google'}
        </button>
      </div>
    </div>
  );
}
