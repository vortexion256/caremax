import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';

const DIAGNOSTIC_LOGS_COLLECTION = 'tenant_diagnostic_logs';

export type DiagnosticLogStatus = 'ok' | 'warning' | 'error' | 'timeout';

export type DiagnosticLogEvent = {
  tenantId: string;
  source: string;
  step: string;
  status: DiagnosticLogStatus;
  durationMs?: number;
  conversationId?: string;
  metadata?: Record<string, unknown>;
  error?: string;
};

export async function recordDiagnosticLog(event: DiagnosticLogEvent): Promise<void> {
  try {
    await db.collection(DIAGNOSTIC_LOGS_COLLECTION).add({
      tenantId: event.tenantId,
      source: event.source,
      step: event.step,
      status: event.status,
      durationMs: typeof event.durationMs === 'number' ? event.durationMs : null,
      conversationId: event.conversationId ?? null,
      metadata: event.metadata ?? null,
      error: event.error ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.error('[Diagnostics] Failed to record diagnostic log', {
      tenantId: event.tenantId,
      source: event.source,
      step: event.step,
      status: event.status,
      reason: e instanceof Error ? e.message : String(e),
    });
  }
}
