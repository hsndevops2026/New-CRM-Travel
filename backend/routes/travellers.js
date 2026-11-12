import { Router } from 'express';
import {
  createTravellerLink,
  getTravellerForm,
  listTravellers,
  saveTravellers,
  sendTravellerLink,
  submitTravellerForm,
} from '../services/travellers.js';
import { requireRole } from '../middleware/requireRole.js';

const router = Router();
const publicRouter = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.param('leadId', (req, res, next, id) => (UUID.test(id) ? next() : res.status(404).json({ error: 'Lead not found' })));
const fail = (res, error) => res.status(error.status || 500).json({ error: error.status ? error.message : 'Request failed' });

router.get('/leads/:leadId/travellers', requireRole('admin', 'agent'), async (req, res) => {
  try { res.json(await listTravellers(req.params.leadId)); } catch (error) { fail(res, error); }
});

router.put('/leads/:leadId/travellers', requireRole('admin', 'agent'), async (req, res) => {
  try { res.json(await saveTravellers(req.params.leadId, req.body?.travellers)); } catch (error) { fail(res, error); }
});

router.post('/leads/:leadId/travellers/link', requireRole('admin', 'agent'), async (req, res) => {
  try {
    const result = req.body?.send
      ? await sendTravellerLink(req.params.leadId, { actorId: req.admin.id })
      : await createTravellerLink(req.params.leadId, { actorId: req.admin.id });
    res.status(201).json({ url: result.url });
  } catch (error) { fail(res, error); }
});

// The customer's form (no sign-in; the token is the key).
publicRouter.get('/travellers/:token', async (req, res) => {
  try { res.json(await getTravellerForm(req.params.token)); } catch (error) { fail(res, error); }
});

publicRouter.put('/travellers/:token', async (req, res) => {
  try { res.json(await submitTravellerForm(req.params.token, req.body?.travellers)); } catch (error) { fail(res, error); }
});

export { publicRouter as publicTravellerRoutes };
export default router;
