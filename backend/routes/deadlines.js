import { Router } from 'express';
import { requireRole } from '../middleware/requireRole.js';
import { addDeadline, deleteDeadline, listDeadlines, operationsBoard, updateDeadline } from '../services/deadlines.js';

const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.param('leadId', (req, res, next, id) => (UUID.test(id) ? next() : res.status(404).json({ error: 'Lead not found' })));
router.param('deadlineId', (req, res, next, id) => (UUID.test(id) ? next() : res.status(404).json({ error: 'Deadline not found' })));
const fail = (res, error) => res.status(error.status || 500).json({ error: error.status ? error.message : 'Request failed' });
const staff = requireRole('admin', 'agent');

router.get('/leads/:leadId/deadlines', staff, async (req, res) => {
  try { res.json({ deadlines: await listDeadlines(req.params.leadId) }); } catch (e) { fail(res, e); }
});
router.post('/leads/:leadId/deadlines', staff, async (req, res) => {
  try { res.status(201).json({ deadline: await addDeadline(req.params.leadId, req.body || {}, { actorId: req.admin.id }) }); } catch (e) { fail(res, e); }
});
router.patch('/leads/:leadId/deadlines/:deadlineId', staff, async (req, res) => {
  try { res.json({ deadline: await updateDeadline(req.params.leadId, req.params.deadlineId, req.body || {}) }); } catch (e) { fail(res, e); }
});
router.delete('/leads/:leadId/deadlines/:deadlineId', staff, async (req, res) => {
  try { await deleteDeadline(req.params.leadId, req.params.deadlineId); res.json({ ok: true }); } catch (e) { fail(res, e); }
});
router.get('/operations/board', staff, async (req, res) => {
  try { res.json(await operationsBoard({ from: req.query.from, to: req.query.to, viewer: req.admin })); } catch (e) { fail(res, e); }
});

export default router;
