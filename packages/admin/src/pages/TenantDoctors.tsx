import { FormEvent, useEffect, useRef, useState } from 'react';
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
  const [editingDoctorId, setEditingDoctorId] = useState<string | null>(null);
  const [editingDoctorName, setEditingDoctorName] = useState('');
  const [savingDoctorId, setSavingDoctorId] = useState<string | null>(null);
  const [loadingDoctors, setLoadingDoctors] = useState(false);
  const [submittingDoctor, setSubmittingDoctor] = useState(false);
  const [loadDoctorsError, setLoadDoctorsError] = useState<string | null>(null);
  const doctorsRequestSeq = useRef(0);

  async function loadDoctors(currentTenantId: string) {
    const requestId = ++doctorsRequestSeq.current;
    setLoadingDoctors(true);
    setLoadDoctorsError(null);
    try {
      const res = await api<{ doctors: DoctorUser[] }>(`/tenants/${currentTenantId}/doctors`);
      if (requestId !== doctorsRequestSeq.current) return;
      setDoctors(Array.isArray(res?.doctors) ? res.doctors : []);
    } catch (e) {
      if (requestId !== doctorsRequestSeq.current) return;
      setDoctors([]);
      setLoadDoctorsError(e instanceof Error ? e.message : 'Failed to load doctors');
    } finally {
      if (requestId === doctorsRequestSeq.current) {
        setLoadingDoctors(false);
      }
    }
  }

  useEffect(() => {
    if (!tenantId || tenantId === 'platform') {
      doctorsRequestSeq.current += 1;
      setLoadingDoctors(false);
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

  async function saveDoctorName(doctorUserId: string) {
    if (!tenantId || tenantId === 'platform' || savingDoctorId) return;
    const normalizedDoctorName = editingDoctorName.trim();
    if (normalizedDoctorName.length < 2) {
      setDoctorError('Display name should be at least 2 characters.');
      return;
    }
    setDoctorError(null);
    setDoctorSuccess(null);
    setSavingDoctorId(doctorUserId);
    try {
      await api(`/tenants/${tenantId}/doctors/${doctorUserId}`, {
        method: 'PUT',
        body: JSON.stringify({ displayName: normalizedDoctorName }),
      });
      await loadDoctors(tenantId);
      setDoctorSuccess('Doctor details updated successfully.');
      setEditingDoctorId(null);
      setEditingDoctorName('');
    } catch (e) {
      setDoctorError(e instanceof Error ? e.message : 'Failed to update doctor');
    } finally {
      setSavingDoctorId(null);
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
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {editingDoctorId === d.doctorUserId ? (
                  <>
                    <input value={editingDoctorName} onChange={(e) => setEditingDoctorName(e.target.value)} placeholder="Display name" style={{ flex: 1, minWidth: 180, border: '1px solid #cbd5e1', borderRadius: 8, padding: '6px 10px' }} />
                    <button type="button" onClick={() => void saveDoctorName(d.doctorUserId)} disabled={savingDoctorId === d.doctorUserId} style={{ border: 0, borderRadius: 8, padding: '6px 10px', background: '#2563eb', color: '#fff', fontWeight: 600, opacity: savingDoctorId === d.doctorUserId ? 0.7 : 1 }}>
                      {savingDoctorId === d.doctorUserId ? 'Saving...' : 'Save'}
                    </button>
                    <button type="button" onClick={() => { setEditingDoctorId(null); setEditingDoctorName(''); }} style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '6px 10px', background: '#fff' }}>Cancel</button>
                  </>
                ) : (
                  <>
                    <div style={{ fontWeight: 600 }}>{d.displayName || 'Doctor'} — {d.email}</div>
                    <button type="button" onClick={() => { setEditingDoctorId(d.doctorUserId); setEditingDoctorName(d.displayName || ''); }} style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '4px 8px', background: '#fff' }}>Edit name</button>
                  </>
                )}
              </div>
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
