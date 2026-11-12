import { Router } from 'express';
import { requireRole } from '../middleware/requireRole.js';
import {
  createGroupTrip,
  getGroupTrip,
  listGroupTrips,
  roomingListCsv,
  setLeadGroup,
  setLeadRoom,
  updateGroupTrip,
} from '../services/groupTrips.js';
import { listVisaRules, listVisas, saveVisaRule, updateVisa } from '../services/visas.js';

const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
for (const name of ['leadId', 'groupId', 'travellerId']) {
  router.param(name, (req, res, next, id) => (UUID.test(id) ? next() : res.status(404).json({ error: 'Not found' })));
}
const fail = (res, e) => res.status(e.status || 500).json({ error: e.status ? e.message : 'Request failed' });
const staff = requireRole('admin', 'agent');

// ── group trips ──
router.get('/group-trips', staff, async (req, res) => {
  try { res.json({ groups: await listGroupTrips({ includeClosed: req.query.all === '1' }) }); } catch (e) { fail(res, e); }
});
router.post('/group-trips', requireRole('admin'), async (req, res) => {
  try { res.status(201).json({ group: await createGroupTrip(req.body || {}, { actorId: req.admin.id }) }); } catch (e) { fail(res, e); }
});
router.get('/group-trips/:groupId', staff, async (req, res) => {
  try { res.json({ group: await getGroupTrip(req.params.groupId) }); } catch (e) { fail(res, e); }
});
router.patch('/group-trips/:groupId', requireRole('admin'), async (req, res) => {
  try { res.json({ group: await updateGroupTrip(req.params.groupId, req.body || {}) }); } catch (e) { fail(res, e); }
});
router.patch('/group-trips/:groupId/bookings/:leadId', staff, async (req, res) => {
  try { await setLeadRoom(req.params.groupId, req.params.leadId, req.body?.room); res.json({ ok: true }); } catch (e) { fail(res, e); }
});
router.get('/group-trips/:groupId/rooming.csv', staff, async (req, res) => {
  try {
    const csv = await roomingListCsv(req.params.groupId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="rooming-list.csv"');
    res.send(csv);
  } catch (e) { fail(res, e); }
});
router.put('/leads/:leadId/group', staff, async (req, res) => {
  try { res.json(await setLeadGroup(req.params.leadId, req.body?.group_trip_id || null, { room: req.body?.room })); } catch (e) { fail(res, e); }
});

// ── visas ──
router.get('/leads/:leadId/visas', staff, async (req, res) => {
  try { res.json(await listVisas(req.params.leadId)); } catch (e) { fail(res, e); }
});
router.patch('/leads/:leadId/visas/:travellerId', staff, async (req, res) => {
  try { res.json({ traveller: await updateVisa(req.params.leadId, req.params.travellerId, req.body || {}) }); } catch (e) { fail(res, e); }
});
router.get('/visa-rules', staff, async (_req, res) => {
  try { res.json({ rules: await listVisaRules() }); } catch (e) { fail(res, e); }
});
router.put('/visa-rules', requireRole('admin'), async (req, res) => {
  try { res.json({ rule: await saveVisaRule(req.body || {}, { actorId: req.admin.id }) }); } catch (e) { fail(res, e); }
});

export default router;
