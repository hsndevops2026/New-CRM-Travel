import { Router } from 'express';
import { requireRole } from '../middleware/requireRole.js';
import {
  listPastCustomers,
  listPublicOffers,
  requestOffer,
  sendOfferToCustomer,
  setOfferPublic,
  travelHistory,
} from '../services/growth.js';
import { getContactById } from '../services/contacts.js';

const router = Router();
const publicRouter = Router();
const fail = (res, error) => res.status(error.status || 500).json({ error: error.status ? error.message : 'Request failed' });

// ── public (no sign-in) ──
publicRouter.get('/offers', async (_req, res) => {
  try { res.json(await listPublicOffers()); } catch (error) { fail(res, error); }
});

publicRouter.post('/offers/:id/request', async (req, res) => {
  // Bots fill every field; people don't see this one.
  if (req.body?.website) return res.status(201).json({ ok: true });
  try {
    await requestOffer(req.params.id, req.body || {});
    res.status(201).json({ ok: true });
  } catch (error) { fail(res, error); }
});

// ── staff ──
router.patch('/predefined-quotes/:id/public', requireRole('admin'), async (req, res) => {
  try { res.json(await setOfferPublic(req.params.id, req.body?.is_public)); } catch (error) { fail(res, error); }
});

router.get('/past-customers', requireRole('admin', 'agent'), async (req, res) => {
  try {
    res.json({ customers: await listPastCustomers({ month: req.query.month, destination: req.query.destination }) });
  } catch (error) { fail(res, error); }
});

router.post('/past-customers/send', requireRole('admin', 'agent'), async (req, res) => {
  try {
    res.json(await sendOfferToCustomer({
      phone: req.body?.phone,
      text: req.body?.text,
      offerId: req.body?.offer_id,
      actorId: req.admin.id,
    }));
  } catch (error) { fail(res, error); }
});

router.get('/contacts/:id/travel-history', requireRole('admin', 'agent'), async (req, res) => {
  try {
    const contact = await getContactById(req.params.id).catch(() => null);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    res.json(await travelHistory(contact.phone));
  } catch (error) { fail(res, error); }
});

export { publicRouter as publicGrowthRoutes };
export default router;
