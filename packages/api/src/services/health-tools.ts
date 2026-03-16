import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';

const ALLOWED_VITAL_TYPES = new Set([
  'temperature',
  'blood_pressure',
  'heart_rate',
  'blood_sugar',
  'oxygen',
  'weight',
] as const);

type VitalType = 'temperature' | 'blood_pressure' | 'heart_rate' | 'blood_sugar' | 'oxygen' | 'weight';

export type LogVitalsInput = {
  userId: string;
  type: string;
  value: number;
  unit?: string;
  timestamp?: string;
};

export type HealthToolResponse = {
  success: boolean;
  message?: string;
  error?: string;
  profile?: Record<string, unknown>;
};

export async function logVitals(input: LogVitalsInput): Promise<HealthToolResponse> {
  try {
    const userId = typeof input.userId === 'string' ? input.userId.trim() : '';
    const type = typeof input.type === 'string' ? input.type.trim() : '';
    const value = input.value;

    if (!userId) {
      return { success: false, error: 'userId is required' };
    }
    if (!type) {
      return { success: false, error: 'type is required' };
    }
    if (!ALLOWED_VITAL_TYPES.has(type as VitalType)) {
      return {
        success: false,
        error: `Invalid type. Allowed values: ${Array.from(ALLOWED_VITAL_TYPES).join(', ')}`,
      };
    }
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return { success: false, error: 'value must be a valid number' };
    }

    let recordedAt: FieldValue | Date = FieldValue.serverTimestamp();
    if (typeof input.timestamp === 'string' && input.timestamp.trim().length > 0) {
      const parsed = new Date(input.timestamp);
      if (Number.isNaN(parsed.getTime())) {
        return { success: false, error: 'timestamp must be a valid ISO string' };
      }
      recordedAt = parsed;
    }

    await db.collection('vitals').add({
      userId,
      type,
      value,
      unit: typeof input.unit === 'string' && input.unit.trim().length > 0 ? input.unit.trim() : null,
      recordedAt,
    });

    return {
      success: true,
      message: 'Vital recorded successfully',
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to record vital',
    };
  }
}

export async function getHealthProfile(input: { userId: string }): Promise<HealthToolResponse> {
  try {
    const userId = typeof input.userId === 'string' ? input.userId.trim() : '';
    if (!userId) {
      return { success: false, error: 'userId is required' };
    }

    const querySnap = await db
      .collection('health_profiles')
      .where('userId', '==', userId)
      .limit(1)
      .get();

    if (querySnap.empty) {
      return {
        success: false,
        message: 'Health profile not found for this user',
      };
    }

    const profileDoc = querySnap.docs[0];
    return {
      success: true,
      profile: profileDoc.data() as Record<string, unknown>,
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to fetch health profile',
    };
  }
}
