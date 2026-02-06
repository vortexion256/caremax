import { useState, useEffect } from 'react';
import { signOut } from 'firebase/auth';
import { api, setAuthToken, clearAuthToken } from '../api';
import { refreshIdToken, auth } from '../firebase';
import type { TenantProfile } from '../TenantContext';

type Props = { onRegistered: (profile: TenantProfile) => void };

export default function RegisterOrg({ onRegistered }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signupData, setSignupData] = useState<{ organizationName: string; slug?: string } | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');

  useEffect(() => {
    // Get form data from sessionStorage (set during SignUp)
    try {
      const stored = sessionStorage.getItem('signup_data');
      if (stored) {
        const data = JSON.parse(stored);
        sessionStorage.removeItem('signup_data'); // Clear after reading
        setSignupData(data);
        setName(data.organizationName);
        if (data.slug) setSlug(data.slug);
      }
    } catch {
      // Ignore
    }
  }, []);

  useEffect(() => {
    // Auto-submit registration if we have signup data from SignUp flow
    if (signupData && !submitting && !error) {
      handleAutoRegister();
    }
  }, [signupData]);

  const handleAutoRegister = async () => {
    if (!signupData) return;
    
    setSubmitting(true);
    setError(null);
    try {
      const trimmedName = signupData.organizationName.trim();
      const body: { name: string; slug?: string } = { name: trimmedName };
      if (signupData.slug?.trim()) {
        body.slug = signupData.slug.trim().toLowerCase().replace(/\s+/g, '-');
      }
      const data = await api<{ tenantId: string; name: string }>('/register', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const newToken = await refreshIdToken();
      if (newToken) setAuthToken(newToken);
      onRegistered({
        tenantId: data.tenantId,
        name: data.name,
        isAdmin: true,
      });
    } catch (e) {
      if (e instanceof Error) {
        // Handle "Already registered" error specifically
        if (e.message.includes('Already registered') || e.message.includes('already registered')) {
          setError('This Google account is already registered to a tenant. Please sign in instead.');
        } else {
          setError(e.message);
        }
      } else {
        setError('Registration failed');
      }
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Organization name is required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body: { name: string; slug?: string } = { name: trimmedName };
      if (slug.trim()) body.slug = slug.trim().toLowerCase().replace(/\s+/g, '-');
      const data = await api<{ tenantId: string; name: string }>('/register', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const newToken = await refreshIdToken();
      if (newToken) setAuthToken(newToken);
      onRegistered({
        tenantId: data.tenantId,
        name: data.name,
        isAdmin: true,
      });
    } catch (e) {
      if (e instanceof Error) {
        if (e.message.includes('Already registered') || e.message.includes('already registered')) {
          setError('This Google account is already registered to a tenant. Please sign in instead.');
        } else {
          setError(e.message);
        }
      } else {
        setError('Registration failed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    try {
      clearAuthToken();
      await signOut(auth);
      // The auth state change will be handled by App.tsx
    } catch (e) {
      console.error('Sign out error:', e);
    }
  };

  // If we have signup data, show loading state (auto-registering)
  if (signupData) {
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
            textAlign: 'center',
          }}
        >
          <div style={{ marginBottom: 24 }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                backgroundColor: '#667eea',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
                fontSize: 32,
              }}
            >
              ⚙️
            </div>
            <h1 style={{ margin: '0 0 8px 0', fontSize: 24, fontWeight: 600, color: '#333' }}>
              Creating your organization...
            </h1>
            <p style={{ color: '#666', fontSize: 16, margin: 0 }}>
              Setting up <strong>{signupData.organizationName}</strong>
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
          {submitting && (
            <div style={{ color: '#666', fontSize: 14 }}>
              <div style={{ marginBottom: 8 }}>Please wait while we set everything up...</div>
              <div
                style={{
                  width: '100%',
                  height: 4,
                  backgroundColor: '#e0e0e0',
                  borderRadius: 2,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: '60%',
                    height: '100%',
                    backgroundColor: '#667eea',
                    animation: 'pulse 1.5s ease-in-out infinite',
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Manual form (fallback if no signup data)
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
          position: 'relative',
        }}
      >
        {/* Sign Out Button */}
        <button
          onClick={handleSignOut}
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            padding: '8px 16px',
            fontSize: 13,
            backgroundColor: 'transparent',
            color: '#666',
            border: '1px solid #ddd',
            borderRadius: 6,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span>Sign Out</span>
        </button>

        <div style={{ marginBottom: 32 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 12,
              backgroundColor: '#667eea',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
              fontSize: 28,
            }}
          >
            🏢
          </div>
          <h1 style={{ margin: '0 0 8px 0', fontSize: 28, fontWeight: 700, color: '#333' }}>
            Register your organization
          </h1>
          <p style={{ color: '#666', fontSize: 15, lineHeight: 1.6, margin: 0 }}>
            Create your tenant to get started with agent settings, handoff queue, RAG documents, and an embeddable widget.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 20 }}>
            <label
              style={{
                display: 'block',
                marginBottom: 8,
                fontSize: 14,
                fontWeight: 600,
                color: '#333',
              }}
            >
              Organization Name <span style={{ color: '#d32f2f' }}>*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Medical Clinic"
              style={{
                width: '100%',
                padding: '12px',
                fontSize: 14,
                border: '1px solid #ddd',
                borderRadius: 6,
                boxSizing: 'border-box',
                transition: 'border-color 0.2s',
              }}
              onFocus={(e) => (e.target.style.borderColor = '#667eea')}
              onBlur={(e) => (e.target.style.borderColor = '#ddd')}
              autoFocus
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label
              style={{
                display: 'block',
                marginBottom: 8,
                fontSize: 14,
                fontWeight: 600,
                color: '#333',
              }}
            >
              Custom URL Slug{' '}
              <span style={{ color: '#888', fontWeight: 400, fontSize: 13 }}>(optional)</span>
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => {
                const value = e.target.value.toLowerCase().replace(/\s+/g, '-');
                setSlug(value);
              }}
              placeholder="e.g. acme-clinic"
              style={{
                width: '100%',
                padding: '12px',
                fontSize: 14,
                border: '1px solid #ddd',
                borderRadius: 6,
                boxSizing: 'border-box',
                fontFamily: 'monospace',
                transition: 'border-color 0.2s',
              }}
              onFocus={(e) => (e.target.style.borderColor = '#667eea')}
              onBlur={(e) => (e.target.style.borderColor = '#ddd')}
            />
            <p style={{ fontSize: 12, color: '#666', margin: '6px 0 0 0', lineHeight: 1.4 }}>
              Letters, numbers, and hyphens only. Used in embed URLs. If left empty, a random ID will be generated.
            </p>
          </div>

          {error && (
            <div
              style={{
                backgroundColor: '#ffebee',
                color: '#c62828',
                padding: '12px 16px',
                borderRadius: 6,
                marginBottom: 20,
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

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%',
              padding: '14px',
              fontSize: 16,
              fontWeight: 600,
              backgroundColor: submitting ? '#ccc' : '#667eea',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: submitting ? 'not-allowed' : 'pointer',
              transition: 'background-color 0.2s',
              marginBottom: 16,
            }}
            onMouseEnter={(e) => {
              if (!submitting) e.currentTarget.style.backgroundColor = '#5568d3';
            }}
            onMouseLeave={(e) => {
              if (!submitting) e.currentTarget.style.backgroundColor = '#667eea';
            }}
          >
            {submitting ? 'Creating Organization...' : 'Create Organization'}
          </button>

          <div style={{ textAlign: 'center', fontSize: 13, color: '#888' }}>
            <p style={{ margin: 0 }}>
              Already have an organization?{' '}
              <button
                type="button"
                onClick={handleSignOut}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#667eea',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  fontSize: 13,
                  padding: 0,
                }}
              >
                Sign out and sign in
              </button>
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
