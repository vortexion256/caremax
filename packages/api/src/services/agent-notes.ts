import { db } from '../config/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';
import type FirebaseFirestore from 'firebase-admin/firestore';

const NOTES_COLLECTION = 'agent_notes';

export type AgentNote = {
  noteId: string;
  tenantId: string;
  conversationId: string;
  userId: string | null;
  patientName: string | null;
  content: string;
  category: 'common_questions' | 'keywords' | 'analytics' | 'insights' | 'other';
  status: 'pending' | 'reviewed' | 'archived';
  createdAt: number | null;
  updatedAt: number | null;
  reviewedBy: string | null;
  reviewedAt: number | null;
};

/**
 * Check if a similar note already exists to prevent duplicates.
 */
async function findSimilarNote(
  tenantId: string,
  conversationId: string,
  content: string,
  patientName?: string,
  category?: AgentNote['category']
): Promise<AgentNote | null> {
  // Check for notes in the same conversation with similar content
  // Look for notes created in the last hour to catch duplicates from the same session
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  
  try {
    const snap = await db.collection(NOTES_COLLECTION)
      .where('tenantId', '==', tenantId)
      .where('conversationId', '==', conversationId)
      .get();
    
    const normalizedContent = content.trim().toLowerCase();
    const normalizedPatientName = patientName?.trim().toLowerCase();
    
    for (const doc of snap.docs) {
      const data = doc.data();
      const noteCreatedAt = data.createdAt?.toMillis?.() ?? 0;
      
      // Only check notes from the last hour
      if (noteCreatedAt < oneHourAgo) continue;
      
      const noteContent = (data.content as string).toLowerCase();
      const notePatientName = (data.patientName as string)?.toLowerCase();
      const noteCategory = data.category as AgentNote['category'];
      
      // Check if it's the same category
      if (category && noteCategory !== category) continue;
      
      // Check if patient names match (if both provided)
      if (normalizedPatientName && notePatientName && normalizedPatientName !== notePatientName) continue;
      
      // Check content similarity - if 70% of words overlap, consider it a duplicate
      const contentWords = new Set(normalizedContent.split(/\s+/).filter(w => w.length > 2));
      const noteWords = new Set(noteContent.split(/\s+/).filter(w => w.length > 2));
      const intersection = new Set([...contentWords].filter(w => noteWords.has(w)));
      const similarity = intersection.size / Math.max(contentWords.size, noteWords.size);
      
      // If similarity is high (70%+) and it's the same category, it's likely a duplicate
      if (similarity >= 0.7) {
        return {
          noteId: doc.id,
          tenantId: data.tenantId as string,
          conversationId: data.conversationId as string,
          userId: data.userId as string | null,
          patientName: data.patientName as string | null,
          content: data.content as string,
          category: (data.category as AgentNote['category']) || 'other',
          status: (data.status as AgentNote['status']) || 'pending',
          createdAt: data.createdAt?.toMillis?.() ?? null,
          updatedAt: data.updatedAt?.toMillis?.() ?? null,
          reviewedBy: data.reviewedBy as string | null,
          reviewedAt: data.reviewedAt?.toMillis?.() ?? null,
        };
      }
    }
  } catch (e) {
    // If query fails, proceed with creation (better to have duplicates than miss notes)
    console.warn('Failed to check for duplicate notes:', e);
  }
  
  return null;
}

/**
 * Create a new agent note for doctor review.
 * Checks for duplicates before creating.
 */
export async function createNote(
  tenantId: string,
  conversationId: string,
  content: string,
  options?: {
    userId?: string;
    patientName?: string;
    category?: AgentNote['category'];
  }
): Promise<AgentNote> {
  // Check for similar existing notes to prevent duplicates
  const similarNote = await findSimilarNote(
    tenantId,
    conversationId,
    content,
    options?.patientName,
    options?.category
  );
  
  if (similarNote) {
    console.log(`Duplicate note detected, skipping creation. Similar note: ${similarNote.noteId}`);
    return similarNote; // Return existing note instead of creating duplicate
  }
  
  const ref = await db.collection(NOTES_COLLECTION).add({
    tenantId,
    conversationId,
    userId: options?.userId ?? null,
    patientName: options?.patientName?.trim() || null,
    content: content.trim(),
    category: options?.category ?? 'other',
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    reviewedBy: null,
    reviewedAt: null,
  });

  const doc = await ref.get();
  const data = doc.data()!;
  return {
    noteId: doc.id,
    tenantId: data.tenantId as string,
    conversationId: data.conversationId as string,
    userId: data.userId as string | null,
    patientName: data.patientName as string | null,
    content: data.content as string,
    category: (data.category as AgentNote['category']) || 'other',
    status: (data.status as AgentNote['status']) || 'pending',
    createdAt: data.createdAt?.toMillis?.() ?? null,
    updatedAt: data.updatedAt?.toMillis?.() ?? null,
    reviewedBy: data.reviewedBy as string | null,
    reviewedAt: data.reviewedAt?.toMillis?.() ?? null,
  };
}

/**
 * List notes for a tenant, optionally filtered by status or conversation.
 */
export async function listNotes(
  tenantId: string,
  options?: {
    conversationId?: string;
    status?: AgentNote['status'];
    patientName?: string;
    limit?: number;
  }
): Promise<AgentNote[]> {
  let query: FirebaseFirestore.Query = db.collection(NOTES_COLLECTION).where('tenantId', '==', tenantId);

  // Apply filters
  if (options?.conversationId) {
    query = query.where('conversationId', '==', options.conversationId);
  }

  if (options?.status) {
    query = query.where('status', '==', options.status);
  }

  if (options?.patientName) {
    query = query.where('patientName', '==', options.patientName.trim());
  }

  // Try to add orderBy - if index doesn't exist, we'll catch and fetch without it
  try {
    query = query.orderBy('createdAt', 'desc');
    if (options?.limit) {
      query = query.limit(options.limit);
    }
    const snap = await query.get();
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        noteId: d.id,
        tenantId: data.tenantId as string,
        conversationId: data.conversationId as string,
        userId: data.userId as string | null,
        patientName: data.patientName as string | null,
        content: data.content as string,
        category: (data.category as AgentNote['category']) || 'other',
        status: (data.status as AgentNote['status']) || 'pending',
        createdAt: data.createdAt?.toMillis?.() ?? null,
        updatedAt: data.updatedAt?.toMillis?.() ?? null,
        reviewedBy: data.reviewedBy as string | null,
        reviewedAt: data.reviewedAt?.toMillis?.() ?? null,
      };
    });
  } catch (e: any) {
    // If index doesn't exist, fetch without orderBy and sort in memory
    if (e?.code === 9 || e?.message?.includes('index')) {
      console.warn('Firestore index not ready, fetching without orderBy and sorting in memory');
      if (options?.limit) {
        query = query.limit(options.limit * 2); // Fetch more to account for client-side filtering
      }
      const snap = await query.get();
      const notes = snap.docs.map((d) => {
        const data = d.data();
        return {
          noteId: d.id,
          tenantId: data.tenantId as string,
          conversationId: data.conversationId as string,
          userId: data.userId as string | null,
          patientName: data.patientName as string | null,
          content: data.content as string,
          category: (data.category as AgentNote['category']) || 'other',
          status: (data.status as AgentNote['status']) || 'pending',
          createdAt: data.createdAt?.toMillis?.() ?? null,
          updatedAt: data.updatedAt?.toMillis?.() ?? null,
          reviewedBy: data.reviewedBy as string | null,
          reviewedAt: data.reviewedAt?.toMillis?.() ?? null,
        };
      });
      // Sort by createdAt descending in memory
      notes.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      // Apply limit after sorting
      return options?.limit ? notes.slice(0, options.limit) : notes;
    }
    throw e;
  }
}

/**
 * Get a single note by ID.
 */
export async function getNote(tenantId: string, noteId: string): Promise<AgentNote | null> {
  const doc = await db.collection(NOTES_COLLECTION).doc(noteId).get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  if (data.tenantId !== tenantId) return null;

  return {
    noteId: doc.id,
    tenantId: data.tenantId as string,
    conversationId: data.conversationId as string,
    userId: data.userId as string | null,
    patientName: data.patientName as string | null,
    content: data.content as string,
    category: (data.category as AgentNote['category']) || 'other',
    status: (data.status as AgentNote['status']) || 'pending',
    createdAt: data.createdAt?.toMillis?.() ?? null,
    updatedAt: data.updatedAt?.toMillis?.() ?? null,
    reviewedBy: data.reviewedBy as string | null,
    reviewedAt: data.reviewedAt?.toMillis?.() ?? null,
  };
}

/**
 * Update note status (e.g., mark as reviewed).
 */
export async function updateNoteStatus(
  tenantId: string,
  noteId: string,
  status: AgentNote['status'],
  reviewedBy?: string
): Promise<AgentNote | null> {
  const ref = db.collection(NOTES_COLLECTION).doc(noteId);
  const doc = await ref.get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  if (data.tenantId !== tenantId) return null;

  const updates: Record<string, unknown> = {
    status,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (status === 'reviewed' && reviewedBy) {
    updates.reviewedBy = reviewedBy;
    updates.reviewedAt = FieldValue.serverTimestamp();
  } else if (status !== 'reviewed') {
    updates.reviewedBy = null;
    updates.reviewedAt = null;
  }

  await ref.update(updates);
  return getNote(tenantId, noteId);
}

/**
 * Delete a note.
 */
export async function deleteNote(tenantId: string, noteId: string): Promise<boolean> {
  const doc = await db.collection(NOTES_COLLECTION).doc(noteId).get();
  if (!doc.exists) return false;
  const data = doc.data()!;
  if (data.tenantId !== tenantId) return false;

  await doc.ref.delete();
  return true;
}
