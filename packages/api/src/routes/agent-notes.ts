import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireTenantParam, requireAdmin } from '../middleware/auth.js';
import { listNotes, getNote, updateNoteStatus, deleteNote } from '../services/agent-notes.js';

export const agentNotesRouter: Router = Router({ mergeParams: true });

agentNotesRouter.use(requireTenantParam);
agentNotesRouter.use(requireAuth);

// List notes for a tenant (admins can see all, regular users see their own)
agentNotesRouter.get('/', async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const isAdmin = res.locals.isAdmin as boolean;
  const userId = res.locals.userId as string;

  try {
    const conversationId = typeof req.query.conversationId === 'string' ? req.query.conversationId : undefined;
    const status = typeof req.query.status === 'string' && ['unread', 'read', 'archived'].includes(req.query.status)
      ? (req.query.status as 'unread' | 'read' | 'archived')
      : undefined;
    const patientName = typeof req.query.patientName === 'string' ? req.query.patientName : undefined;
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;

    // If not admin, filter by userId
    const notes = await listNotes(tenantId, {
      conversationId,
      status,
      patientName,
      limit,
    });

    res.json({ notes });
  } catch (e) {
    console.error('Failed to list agent notes:', e);
    res.status(500).json({ error: 'Failed to load notes' });
  }
});

// Get a single note
agentNotesRouter.get('/:noteId', async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const isAdmin = res.locals.isAdmin as boolean;
  const userId = res.locals.userId as string;
  const { noteId } = req.params;

  try {
    const note = await getNote(tenantId, noteId);
    if (!note) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }



    res.json({ note });
  } catch (e) {
    console.error('Failed to get agent note:', e);
    res.status(500).json({ error: 'Failed to load note' });
  }
});

// Update note status (admin only)
agentNotesRouter.patch('/:noteId', requireAdmin, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const { noteId } = req.params;
  const reviewerId = res.locals.userId as string;

  const body = z.object({
    status: z.enum(['unread', 'read', 'archived']),
  });

  const parsed = body.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    return;
  }

  try {
    const note = await updateNoteStatus(tenantId, noteId, parsed.data.status, reviewerId);
    if (!note) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }
    res.json({ note });
  } catch (e) {
    console.error('Failed to update note status:', e);
    res.status(500).json({ error: 'Failed to update note' });
  }
});

// Delete note (admin only)
agentNotesRouter.delete('/:noteId', requireAdmin, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const { noteId } = req.params;

  try {
    const deleted = await deleteNote(tenantId, noteId);
    if (!deleted) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }
    res.json({ success: true });
  } catch (e) {
    console.error('Failed to delete note:', e);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});


