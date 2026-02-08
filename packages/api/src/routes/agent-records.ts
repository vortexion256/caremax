import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireTenantParam, requireAdmin, type AuthLocals } from '../middleware/auth.js';
import {
  listRecords,
  getRecord,
  createRecord,
  updateRecord,
  deleteRecord,
  listModificationRequests,
  approveModificationRequest,
  rejectModificationRequest,
} from '../services/auto-agent-brain.js';
import { runConsolidation } from '../services/agent.js';

export const agentRecordsRouter = Router({ mergeParams: true });

agentRecordsRouter.use(requireTenantParam);

agentRecordsRouter.get('/', requireAuth, requireAdmin, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  try {
    const records = await listRecords(tenantId);
    res.json({ records });
  } catch (e) {
    console.error('List agent records error:', e);
    res.status(500).json({ error: 'Failed to list records' });
  }
});

// Modification requests (must be before /:recordId so "modification-requests" is not captured as recordId)
agentRecordsRouter.get('/modification-requests', requireAuth, requireAdmin, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  try {
    const requests = await listModificationRequests(tenantId);
    res.json({ requests });
  } catch (e) {
    console.error('List modification requests error:', e);
    res.status(500).json({ error: 'Failed to list modification requests' });
  }
});

agentRecordsRouter.post('/modification-requests/:requestId/approve', requireAuth, requireAdmin, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const uid = (res.locals as AuthLocals).uid;
  const { requestId } = req.params;
  try {
    const result = await approveModificationRequest(tenantId, requestId, uid);
    if (!result.applied && result.error) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true, applied: result.applied });
  } catch (e) {
    console.error('Approve modification request error:', e);
    res.status(500).json({ error: 'Failed to approve' });
  }
});

agentRecordsRouter.post('/modification-requests/:requestId/reject', requireAuth, requireAdmin, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const uid = (res.locals as AuthLocals).uid;
  const { requestId } = req.params;
  try {
    const ok = await rejectModificationRequest(tenantId, requestId, uid);
    if (!ok) {
      res.status(404).json({ error: 'Request not found or already processed' });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('Reject modification request error:', e);
    res.status(500).json({ error: 'Failed to reject' });
  }
});

agentRecordsRouter.post('/consolidate', requireAuth, requireAdmin, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  try {
    const result = await runConsolidation(tenantId);
    res.json(result);
  } catch (e) {
    console.error('Consolidate agent brain error:', e);
    res.status(500).json({ error: 'Failed to run consolidation' });
  }
});

agentRecordsRouter.get('/:recordId', requireAuth, requireAdmin, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const { recordId } = req.params;
  const record = await getRecord(tenantId, recordId);
  if (!record) {
    res.status(404).json({ error: 'Record not found' });
    return;
  }
  res.json(record);
});

const createBody = z.object({ title: z.string().min(1), content: z.string() });
const updateBody = z.object({ title: z.string().min(1).optional(), content: z.string().optional() });

agentRecordsRouter.post('/', requireAuth, requireAdmin, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    return;
  }
  try {
    const { recordId, title } = await createRecord(tenantId, parsed.data.title, parsed.data.content);
    res.status(201).json({ recordId, title });
  } catch (e) {
    console.error('Create agent record error:', e);
    res.status(500).json({ error: 'Failed to create record' });
  }
});

agentRecordsRouter.put('/:recordId', requireAuth, requireAdmin, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const { recordId } = req.params;
  const parsed = updateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    return;
  }
  const record = await updateRecord(tenantId, recordId, {
    title: parsed.data.title,
    content: parsed.data.content,
  });
  if (!record) {
    res.status(404).json({ error: 'Record not found' });
    return;
  }
  res.json(record);
});

agentRecordsRouter.delete('/:recordId', requireAuth, requireAdmin, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const { recordId } = req.params;
  const deleted = await deleteRecord(tenantId, recordId);
  if (!deleted) {
    res.status(404).json({ error: 'Record not found' });
    return;
  }
  res.status(204).send();
});
