import { Router } from 'express';
import { query } from '../config/database.js';
import { sendCustomerMessage } from '../services/chatSend.js';
import { customerLanguage } from '../services/customerLanguage.js';
import {
  addTripPlanItems,
  deleteTripPlanItem,
  formatTripPlanMessage,
  listTripPlan,
  updateTripPlanItem,
} from '../services/tripPlan.js';

const router = Router();

// Reject malformed ids before they reach Postgres (which would answer 500).
router.param('leadId', (req, res, next, value) => (UUID.test(value) ? next() : res.status(404).json({ error: 'Lead not found' })));
router.param('itemId', (req, res, next, value) => (UUID.test(value) ? next() : res.status(404).json({ error: 'Trip program item not found' })));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(res, error, fallback) {
  if (!error.status || error.status >= 500) console.error('[trip-plan]', error.message);
  res.status(error.status || 500).json({ error: error.status && error.status < 500 ? error.message : fallback });
}

async function leadSummary(leadId) {
  const { rows } = await query(
    `SELECT l.id, l.destination, l.phone, COALESCE(c.name, '') AS customer_name
     FROM leads l LEFT JOIN contacts c ON c.phone = l.phone WHERE l.id = $1`,
    [leadId],
  );
  const lead = rows[0];
  if (!lead) return null;
  const { phone, ...rest } = lead;
  return { ...rest, language: await customerLanguage(phone) };
}

function lang(value) {
  return value === 'en' ? 'en' : 'ar';
}

router.get('/leads/:leadId/trip-plan', async (req, res) => {
  try {
    const lead = await leadSummary(req.params.leadId);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json({ lead, items: await listTripPlan(lead.id) });
  } catch (error) { fail(res, error, 'Failed to load the trip program'); }
});

router.post('/leads/:leadId/trip-plan/items', async (req, res) => {
  try {
    const items = await addTripPlanItems(req.params.leadId, req.body?.items ?? req.body, { actorId: req.admin?.id });
    res.status(201).json({ items });
  } catch (error) { fail(res, error, 'Failed to add to the trip program'); }
});

router.patch('/leads/:leadId/trip-plan/items/:itemId', async (req, res) => {
  try {
    const items = await updateTripPlanItem(req.params.leadId, req.params.itemId, req.body || {}, { actorId: req.admin?.id });
    res.json({ items });
  } catch (error) { fail(res, error, 'Failed to update the trip program'); }
});

router.delete('/leads/:leadId/trip-plan/items/:itemId', async (req, res) => {
  try {
    const items = await deleteTripPlanItem(req.params.leadId, req.params.itemId, { actorId: req.admin?.id });
    res.json({ items });
  } catch (error) { fail(res, error, 'Failed to delete from the trip program'); }
});

/** The text the customer would receive, for the employee to read and edit first. */
router.post('/leads/:leadId/trip-plan/preview', async (req, res) => {
  try {
    const lead = await leadSummary(req.params.leadId);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const items = await listTripPlan(lead.id);
    if (!items.length) return res.status(400).json({ error: 'The trip program is empty' });
    res.json({
      text: formatTripPlanMessage(items, { lang: lang(req.body?.lang), customerName: lead.customer_name, destination: lead.destination }),
    });
  } catch (error) { fail(res, error, 'Failed to prepare the message'); }
});

/** Sends the (possibly edited) program to the customer on WhatsApp. Staff click only. */
router.post('/leads/:leadId/trip-plan/send', async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text is required' });
    if (text.length > 4000) return res.status(400).json({ error: 'The message is too long for WhatsApp' });
    const result = await sendCustomerMessage({ leadId: req.params.leadId, body: text, actorId: req.admin?.id });
    res.status(201).json({ message: result.message });
  } catch (error) { fail(res, error, 'Failed to send the trip program'); }
});

export default router;
