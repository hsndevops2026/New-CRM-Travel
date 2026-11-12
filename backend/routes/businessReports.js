import { Router } from 'express';
import { requireRole } from '../middleware/requireRole.js';
import {
  addCost,
  deleteCost,
  listCosts,
  profitReport,
  setTarget,
  supplierScorecard,
  targetsReport,
  updateCost,
} from '../services/businessReports.js';
import { parseRange } from '../services/reports.js';

const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
for (const name of ['leadId', 'costId']) router.param(name, (req, res, next, id) => (UUID.test(id) ? next() : res.status(404).json({ error: 'Not found' })));
const fail = (res, e) => res.status(e.status || 500).json({ error: e.status ? e.message : 'Request failed' });
const staff = requireRole('admin', 'agent');

router.get('/leads/:leadId/costs', staff, async (req, res) => { try { res.json(await listCosts(req.params.leadId)); } catch (e) { fail(res, e); } });
router.post('/leads/:leadId/costs', staff, async (req, res) => { try { res.status(201).json(await addCost(req.params.leadId, req.body || {}, { actorId: req.admin.id })); } catch (e) { fail(res, e); } });
router.patch('/leads/:leadId/costs/:costId', staff, async (req, res) => { try { res.json(await updateCost(req.params.leadId, req.params.costId, req.body || {})); } catch (e) { fail(res, e); } });
router.delete('/leads/:leadId/costs/:costId', staff, async (req, res) => { try { res.json(await deleteCost(req.params.leadId, req.params.costId)); } catch (e) { fail(res, e); } });

router.get('/reports/profit', requireRole('admin'), async (req, res) => {
  try { const { from, to } = parseRange(req.query); res.json(await profitReport({ from, to })); } catch (e) { fail(res, e); }
});
router.get('/reports/suppliers', requireRole('admin'), async (req, res) => {
  try { const { from, to } = parseRange(req.query); res.json({ suppliers: await supplierScorecard({ from, to }) }); } catch (e) { fail(res, e); }
});
router.get('/targets', staff, async (req, res) => {
  try { res.json(await targetsReport({ month: req.query.month || new Date().toISOString().slice(0, 7), viewer: req.admin })); } catch (e) { fail(res, e); }
});
router.put('/targets', requireRole('admin'), async (req, res) => {
  try {
    if (!UUID.test(String(req.body?.admin_id || ''))) return res.status(400).json({ error: 'admin_id is required' });
    await setTarget({ ...req.body, adminId: req.body.admin_id });
    res.json(await targetsReport({ month: req.body.month, viewer: req.admin }));
  } catch (e) { fail(res, e); }
});

export default router;
