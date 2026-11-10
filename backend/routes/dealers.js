import { Router } from 'express';
import {
  listDealers,
  upsertDealer,
  updateDealer,
  deleteDealer,
  sendQuoteToDealer,
} from '../services/dealers.js';
import { requireRole } from '../middleware/requireRole.js';
import {
  createDealerCountryCode,
  deleteDealerCountryCode,
  listDealerCountryCodes,
  updateDealerCountryCode,
} from '../services/dealerCountryCodes.js';

const router = Router();

router.get('/dealer-country-codes', async (_req, res, next) => {
  try {
    const countryCodes = await listDealerCountryCodes();
    res.json({ count: countryCodes.length, country_codes: countryCodes });
  } catch (error) {
    next(error);
  }
});

router.post('/dealer-country-codes', requireRole('admin'), async (req, res, next) => {
  try {
    const countryCode = await createDealerCountryCode(req.body);
    res.status(201).json({ country_code: countryCode });
  } catch (error) {
    next(error);
  }
});

router.patch('/dealer-country-codes/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const countryCode = await updateDealerCountryCode(req.params.id, req.body);
    if (!countryCode) return res.status(404).json({ error: 'Country code not found' });
    return res.json({ country_code: countryCode });
  } catch (error) {
    return next(error);
  }
});

router.delete('/dealer-country-codes/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const countryCode = await deleteDealerCountryCode(req.params.id);
    if (!countryCode) return res.status(404).json({ error: 'Country code not found' });
    return res.json({ deleted: true, country_code: countryCode });
  } catch (error) {
    return next(error);
  }
});

router.get('/dealers', async (req, res) => {
  try {
    const dealers = await listDealers({
      query: req.query.query || req.query.q || '',
      limit: Number(req.query.limit) || 200,
    });
    res.json({ count: dealers.length, dealers });
  } catch (error) {
    console.error('List dealers failed:', error);
    res.status(500).json({ error: 'Failed to list dealers' });
  }
});

router.post('/dealers', async (req, res) => {
  try {
    const dealer = await upsertDealer({
      phone: req.body?.phone,
      name: req.body?.name,
      company: req.body?.company,
      notes: req.body?.notes,
      whatsapp_group_id: req.body?.whatsapp_group_id,
      destinations: req.body?.destinations,
      services: req.body?.services,
    });
    res.status(201).json({ dealer });
  } catch (error) {
    console.error('Create dealer failed:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Failed to save dealer' });
  }
});

router.post('/dealers/send', async (req, res) => {
  try {
    const dealerId = String(req.body?.dealer_id || '').trim();
    const quoteId = String(req.body?.quote_id || '').trim();
    if (!dealerId || !quoteId) {
      return res.status(400).json({ error: 'dealer_id and quote_id are required' });
    }
    const result = await sendQuoteToDealer({ dealerId, quoteId });
    res.json({ sent: true, dealer: result.dealer, quote_title: result.quote.title });
  } catch (error) {
    console.error('Send quote to dealer failed:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Failed to send quote' });
  }
});

router.patch('/dealers/:id', async (req, res) => {
  try {
    const dealer = await updateDealer(req.params.id, {
      name: req.body?.name,
      phone: req.body?.phone,
      company: req.body?.company,
      notes: req.body?.notes,
      whatsapp_group_id: req.body?.whatsapp_group_id,
      destinations: req.body?.destinations,
      services: req.body?.services,
    });
    if (!dealer) return res.status(404).json({ error: 'Dealer not found' });
    res.json({ dealer });
  } catch (error) {
    console.error('Update dealer failed:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Failed to update dealer' });
  }
});

router.delete('/dealers/:id', async (req, res) => {
  try {
    const dealer = await deleteDealer(req.params.id);
    if (!dealer) return res.status(404).json({ error: 'Dealer not found' });
    res.json({ deleted: true, dealer });
  } catch (error) {
    console.error('Delete dealer failed:', error);
    res.status(500).json({ error: 'Failed to delete dealer' });
  }
});

export default router;
