import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { firestore } from '../firebase';
import { useTenant } from '../TenantContext';

type ConversationRecord = {
  joinedBy?: string;
  handledBy?: string;
  status?: 'open' | 'handoff_requested' | 'human_joined';
};

export default function DoctorDashboard() {
  const { tenantId, uid } = useTenant();
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);

  useEffect(() => {
    if (!tenantId) return;
    const q = query(
      collection(firestore, 'conversations'),
      where('tenantId', '==', tenantId),
      where('status', 'in', ['open', 'handoff_requested', 'human_joined'])
    );
    const unsub = onSnapshot(q, (snap) => {
      setConversations(snap.docs.map((doc) => doc.data() as ConversationRecord));
    });
    return () => unsub();
  }, [tenantId]);

  const stats = useMemo(() => {
    const interactionsHandled = conversations.filter((row) => (row.handledBy ?? row.joinedBy) === uid).length;
    const openHandoffs = conversations.filter((row) => row.status === 'handoff_requested').length;
    const activeMine = conversations.filter((row) => row.status === 'human_joined' && row.joinedBy === uid).length;
    return { interactionsHandled, openHandoffs, activeMine };
  }, [conversations, uid]);

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Doctor Dashboard</h1>
      <p style={{ color: '#64748b', marginBottom: 20 }}>Overview of your handoff workload and active conversations.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <MetricCard label="Your interactions" value={stats.interactionsHandled} subtitle="Conversations you've joined" />
        <MetricCard label="Open handoffs" value={stats.openHandoffs} subtitle="Waiting for a doctor" />
        <MetricCard label="Your active chats" value={stats.activeMine} subtitle="Currently human-joined by you" />
      </div>
    </div>
  );
}

function MetricCard({ label, value, subtitle }: { label: string; value: number; subtitle: string }) {
  return (
    <div style={{ padding: '14px 16px', border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff' }}>
      <div style={{ fontSize: 12, color: '#64748b' }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: '#0f172a', margin: '4px 0 6px' }}>{value}</div>
      <div style={{ fontSize: 12, color: '#94a3b8' }}>{subtitle}</div>
    </div>
  );
}
