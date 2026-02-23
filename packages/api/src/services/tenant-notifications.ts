import { db } from '../config/firebase.js';

export type TenantNotificationType =
  | 'payment_success'
  | 'payment_failed'
  | 'subscription_expired'
  | 'subscription_warning';

export async function createTenantNotification(params: {
  tenantId: string;
  type: TenantNotificationType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.collection('tenant_notifications').add({
      tenantId: params.tenantId,
      type: params.type,
      title: params.title,
      message: params.message,
      metadata: params.metadata ?? null,
      read: false,
      createdAt: new Date(),
    });
  } catch (e) {
    console.error('Failed to create tenant notification:', e);
  }
}
