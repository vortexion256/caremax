import { useState } from 'react';
import { api, setAuthToken } from '../api';
import { refreshIdToken } from '../firebase';
import type { TenantProfile } from '../TenantContext';

type Props = { onRegistered: (profile: TenantProfile) => void };

export default function RegisterOrg({ onRegistered }: Props) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError(e instanceof Error ? e.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: '48px auto', padding: 24 }}>
      <h1 style={{ margin: '0 0 8px 0', fontSize: 24 }}>Register your organization</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>
        Create a tenant to get your own agent settings, handoff queue, RAG documents, and embeddable widget.
      </p>
      <form onSubmit={handleSubmit}>
        <label style={{ display: 'block', marginBottom: 16 }}>
          Organization name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme Clinic"
            style={{ display: 'block', width: '100%', padding: 10, marginTop: 6, fontSize: 14 }}
            autoFocus
          />
        </label>
        <label style={{ display: 'block', marginBottom: 16 }}>
          Custom URL slug <span style={{ color: '#888', fontWeight: 400 }}>(optional)</span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="e.g. acme-clinic"
            style={{ display: 'block', width: '100%', padding: 10, marginTop: 6, fontSize: 14 }}
          />
          <span style={{ fontSize: 12, color: '#666' }}>
            Letters, numbers, hyphens only. Used in embed URLs.
          </span>
        </label>
        {error && <p style={{ color: '#c62828', marginBottom: 16 }}>{error}</p>}
        <button type="submit" disabled={submitting} style={{ padding: '10px 20px' }}>
          {submitting ? 'Creating…' : 'Create organization'}
        </button>
      </form>
    </div>
  );
}
