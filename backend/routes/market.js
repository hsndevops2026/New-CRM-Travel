import { Router } from 'express';
import { getLeadById } from '../services/leads.js';
import { getGoogleHotelReviews, getTripadvisorPlace, searchMarket } from '../services/marketSearch.js';
import { serpGet } from '../services/serpClient.js';

const router = Router();

router.get('/market/autocomplete', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 160);
    if (!q) return res.status(400).json({ error: 'q is required' });
    const data = await serpGet('google_autocomplete', { q });
    res.json({ suggestions: (data.suggestions || []).slice(0, 10).map((s) => ({ value: s.value || s.title || '', subtitle: s.subtitle || null })) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.post('/leads/:id/market-search', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json(await searchMarket(lead, req.body || {}));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.get('/leads/:id/market-reviews', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json(await getGoogleHotelReviews(String(req.query.property_token || '')));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.get('/leads/:id/market-place', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json(await getTripadvisorPlace(req.query.place_id));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

export default router;
