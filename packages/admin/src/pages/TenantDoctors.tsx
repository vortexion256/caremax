import { FormEvent, useEffect, useState } from 'react';
import { useTenant } from '../TenantContext';
import { api } from '../api';
import AppNotification from '../components/AppNotification';

type DoctorUser = {
  doctorUserId: string;
  email: string;
  displayName: string;
  createdAt: number | null;
  interactionsHandled?: number;
  activeConversations?: number;
};

export default function TenantDoctors() {
  const { tenantId } = useTenant();
  const [doctors, setDoctors] = useState<DoctorUser[]>([]);
  const [doctorEmail, setDoctorEmail] = useState('');
  const [doctorName, setDoctorName] = useState('');
  const [doctorError, setDoctorError] = useState<string | null>(null);
  const [doctorSuccess, setDoctorSuccess] = useState<string | null>(null);
  const [loadingDoctors, setLoadingDoctors] = useState(false);
  const [submittingDoctor, setSubmittingDoctor] = useState(false);
  const [loadDoctorsError, setLoadDoctorsError] = useState<string | null>(null);

  async function loadDoctors(currentTenantId: string) {
    setLoadingDoctors(true);
    setLoadDoctorsError(null);
    try {
      const res = await api<{ doctors: DoctorUser[] }>(`/tenants/${currentTenantId}/doctors`);
      setDoctors(res.doctors);
    } catch (e) {
      setDoctors([]);
      setLoadDoctorsError(e instanceof Error ? e.message : 'Failed to load doctors');
    } finally {
      setLoadingDoctors(false);
    }
  }

  useEffect(() => {
    if (!tenantId || tenantId === 'platform') {
      setDoctors([]);
      setLoadDoctorsError(null);
      return;
    }
    loadDoctors(tenantId);
  }, [tenantId]);

  async function addDoctor(e: FormEvent) {
    e.preventDefault();
    if (!tenantId || tenantId === 'platform' || submittingDoctor) return;

    const normalizedDoctorEmail = doctorEmail.trim().toLowerCase();
    const normalizedDoctorName = doctorName.trim();
    if (!normalizedDoctorEmail) {
      setDoctorError('Enter a doctor email address.');
      return;
    }

    setDoctorError(null);
    setDoctorSuccess(null);
    setSubmittingDoctor(true);
    try {
      await api(`/tenants/${tenantId}/doctors`, {
        method: 'POST',
        body: JSON.stringify({ email: normalizedDoctorEmail, displayName: normalizedDoctorName || undefined }),
      });
      await loadDoctors(tenantId);
      setDoctorEmail('');
      setDoctorName('');
      setDoctorSuccess('Doctor has been added successfully.');
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Failed to add doctor';
      if (errorMessage.toLowerCase().includes('409') || errorMessage.toLowerCase().includes('already')) {
        setDoctorError('That doctor is already in this tenant.');
      } else {
        setDoctorError(errorMessage);
      }
      await loadDoctors(tenantId);
    } finally {
      setSubmittingDoctor(false);
    }
  }

  return (
    <div>
      {doctorSuccess && <AppNotification message={doctorSuccess} type="success" onClose={() => setDoctorSuccess(null)} />}
      <h1 style={{ marginTop: 0 }}>Doctors</h1>
      <p style={{ color: '#64748b' }}>
        Add and manage handoff team doctor users. A doctor must already have a user account before you can add them.
      </p>

      <form onSubmit={addDoctor} style={{ padding: '12px 14px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#f8fafc' }}>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>Doctor users (handoff team)</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input value={doctorEmail} onChange={(e) => setDoctorEmail(e.target.value)} placeholder="doctor@email.com" style={{ flex: 1, minWidth: 220, border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px' }} />
          <input value={doctorName} onChange={(e) => setDoctorName(e.target.value)} placeholder="Display name (optional)" style={{ flex: 1, minWidth: 180, border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px' }} />
          <button disabled={submittingDoctor} type="submit" style={{ border: 0, borderRadius: 8, padding: '8px 12px', background: '#2563eb', color: '#fff', fontWeight: 600, opacity: submittingDoctor ? 0.7 : 1, cursor: submittingDoctor ? 'not-allowed' : 'pointer' }}>{submittingDoctor ? 'Adding...' : 'Add Doctor'}</button>
        </div>
        {doctorError && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 6 }}>{doctorError}</div>}
        {loadDoctorsError && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 6 }}>Could not load doctors list: {loadDoctorsError}</div>}
        <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
          {loadingDoctors && <div style={{ fontSize: 13, color: '#64748b' }}>Loading doctors...</div>}
          {!loadingDoctors && doctors.length === 0 && <div style={{ fontSize: 13, color: '#64748b' }}>No doctors added yet.</div>}
          {doctors.map((d) => (
            <div key={d.doctorUserId} style={{ fontSize: 13, color: '#0f172a', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', background: '#fff' }}>
              <div style={{ fontWeight: 600 }}>{d.displayName || 'Doctor'} — {d.email}</div>
              <div style={{ color: '#475569', marginTop: 4, fontSize: 12 }}>
                Interactions handled: {d.interactionsHandled ?? 0} · Active chats: {d.activeConversations ?? 0}
              </div>
            </div>
          ))}
        </div>
      </form>
    </div>
  );
}
