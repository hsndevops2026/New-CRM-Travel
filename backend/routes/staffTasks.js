import { Router } from 'express';
import { requireRole } from '../middleware/requireRole.js';
import { createTask, deleteTask, listAssignees, listTasks, updateTask } from '../services/staffTasks.js';

const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.param('taskId', (req, res, next, id) => (UUID.test(id) ? next() : res.status(404).json({ error: 'Task not found' })));

const viewer = (req) => ({ id: req.admin.id, role: req.admin.role, email: req.admin.email });
const fail = (res, error) => res.status(error.status || 500).json({ error: error.status ? error.message : 'Task request failed' });

router.get('/tasks/assignees', requireRole('admin', 'agent'), async (req, res) => {
  try {
    if (req.admin.role !== 'admin') return res.json({ assignees: [{ id: req.admin.id, email: req.admin.email, role: req.admin.role }] });
    return res.json({ assignees: await listAssignees() });
  } catch (error) { return fail(res, error); }
});

router.get('/tasks', requireRole('admin', 'agent'), async (req, res) => {
  try {
    const status = ['open', 'done', 'all'].includes(req.query.status) ? req.query.status : 'open';
    const assignee = UUID.test(String(req.query.assignee || '')) ? req.query.assignee : undefined;
    const leadId = UUID.test(String(req.query.lead_id || '')) ? req.query.lead_id : undefined;
    res.json({ tasks: await listTasks(viewer(req), { status, assignee, leadId }) });
  } catch (error) { fail(res, error); }
});

router.post('/tasks', requireRole('admin', 'agent'), async (req, res) => {
  try {
    res.status(201).json({ task: await createTask(viewer(req), req.body || {}) });
  } catch (error) { fail(res, error); }
});

router.patch('/tasks/:taskId', requireRole('admin', 'agent'), async (req, res) => {
  try {
    res.json({ task: await updateTask(viewer(req), req.params.taskId, req.body || {}) });
  } catch (error) { fail(res, error); }
});

router.delete('/tasks/:taskId', requireRole('admin', 'agent'), async (req, res) => {
  try {
    await deleteTask(viewer(req), req.params.taskId);
    res.json({ ok: true });
  } catch (error) { fail(res, error); }
});

export default router;
