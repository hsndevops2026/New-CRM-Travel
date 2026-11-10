import { Router } from 'express';
import { searchHotelQuotes, searchHotelDestination } from '../services/hotels.js';
import { searchHotelSuggestions } from '../services/googleHotels.js';
import {
  fetchAndStoreHotelQuotesForLead,
  getHotelSourcesForLead,
} from '../services/bookingHotels.js';
import { getLeadById, setLeadQuoteStatus } from '../services/leads.js';
import { groupHotelQuotesBySource, listHotelQuotesForLead } from '../services/hotelQuotes.js';
import { enqueueHotelQuoteJob } from '../queues/hotelQuoteQueue.js';

const router = Router();

/** Destination / property autocomplete (SerpApi google_hotels_autocomplete) */
router.get('/hotels/destinations/suggest', async (req, res) => {
  try {
    const query = req.query.query || req.query.q;
    if (!query) return res.status(400).json({ error: 'query parameter is required' });

    const result = await searchHotelSuggestions(query, {
      currency_code: req.query.currency_code,
      hl: req.query.hl,
      gl: req.query.gl,
    });
    res.json(result);
  } catch (error) {
    console.error('Hotel destination autocomplete failed:', error.message);
    res.status(error.status || 500).json({ error: error.message });
  }
});

/** Live destination search (admin/debug) */
router.get('/hotels/destinations', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: 'query parameter is required' });
    const result = await searchHotelDestination(query);
    res.json(result);
  } catch (error) {
    console.error('Hotel destination search failed:', error.message);
    res.status(error.status || 500).json({ error: error.message });
  }
});

/** Live hotel availability search (admin/debug) */
router.post('/hotels/quotes', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await searchHotelQuotes({
      destination: body.destination,
      travel_date: body.travel_date,
      return_date: body.return_date,
      adults_count: body.adults_count,
      children_count: body.children_count,
      children_ages: body.children_ages,
      currency_code: body.currency_code || 'USD',
      rooms: body.rooms || 1,
      limit: body.limit || 8,
    });
    res.json(result);
  } catch (error) {
    console.error('Hotel quotes failed:', error.message, error.details || '');
    res.status(error.status || 500).json({
      error: error.message || 'Failed to fetch hotel quotes',
      details: error.details || null,
    });
  }
});

/** Saved hotels from Hotelbeds + Booking.com + Airbnb for a lead */
router.get('/leads/:id/hotel-sources', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (lead.booking_type !== 'hotel') {
      return res.status(400).json({ error: 'Lead is not a hotel booking' });
    }

    const result = await getHotelSourcesForLead(lead, {
      currency_code: req.query.currency_code || 'USD',
      limit: Number(req.query.limit) || 8,
      refresh: String(req.query.refresh || '') === '1',
    });
    res.json(result);
  } catch (error) {
    console.error('Hotel sources search failed:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Failed to load hotels' });
  }
});

/** Return saved hotel quotes for a lead */
router.get('/leads/:id/hotel-quotes', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const quotes = await listHotelQuotesForLead(lead.id);
    const search = lead.quote_search || {};

    res.json({
      lead_id: lead.id,
      quote_status: lead.quote_status,
      quote_error: lead.quote_error,
      quotes_fetched_at: lead.quotes_fetched_at,
      destination: search.destination || null,
      search: search.search || null,
      sources: groupHotelQuotesBySource(quotes, search),
      count: quotes.length,
      quotes,
    });
  } catch (error) {
    console.error('List saved hotel quotes failed:', error);
    res.status(500).json({ error: 'Failed to load hotel quotes' });
  }
});

/** Retry hotel quote fetch for a lead */
router.post('/leads/:id/hotel-quotes/retry', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (lead.booking_type !== 'hotel' && lead.booking_type !== 'package') {
      return res.status(400).json({ error: 'Lead is not a hotel or package booking' });
    }

    await setLeadQuoteStatus(lead.id, 'processing', null);

    const { getHotelQuoteQueue } = await import('../queues/hotelQuoteQueue.js');
    const queue = getHotelQuoteQueue();
    const existing = await queue.getJob(`hotel-lead-${lead.id}`);
    if (existing) await existing.remove();

    await enqueueHotelQuoteJob(lead.id);
    res.json({ lead_id: lead.id, quote_status: 'processing' });
  } catch (error) {
    console.error('Retry hotel quotes failed:', error.message);
    try {
      await setLeadQuoteStatus(req.params.id, 'error', error.message);
    } catch { /* ignore */ }
    res.status(error.status || 500).json({
      error: error.message || 'Failed to retry hotel quotes',
    });
  }
});

/** Synchronous hotel quote fetch (no queue, direct response) */
router.post('/leads/:id/hotel-quotes/fetch', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (lead.booking_type !== 'hotel') {
      return res.status(400).json({ error: 'Lead is not a hotel booking' });
    }

    await setLeadQuoteStatus(lead.id, 'processing');

    const result = await fetchAndStoreHotelQuotesForLead(lead, {
      currency_code: req.body?.currency_code || 'USD',
      rooms: req.body?.rooms || 1,
      limit: req.body?.limit || 8,
    });

    if (result.outcome.status === 'error') {
      await setLeadQuoteStatus(lead.id, 'error', result.outcome.error);
      return res.status(502).json({
        lead_id: lead.id,
        quote_status: 'error',
        error: result.outcome.error,
        sources: result.sources,
      });
    }

    await setLeadQuoteStatus(lead.id, 'completed');
    const quotes = await listHotelQuotesForLead(lead.id);
    res.json({
      lead_id: lead.id,
      quote_status: 'completed',
      count: quotes.length,
      quotes,
      sources: result.sources,
    });
  } catch (error) {
    console.error('Fetch hotel quotes failed:', error.message);

    try {
      const lead = await getLeadById(req.params.id);
      if (lead) await setLeadQuoteStatus(lead.id, 'error', error.message);
    } catch { /* ignore */ }

    res.status(error.status || 500).json({
      error: error.message || 'Failed to fetch hotel quotes',
      details: error.details || null,
    });
  }
});

export default router;
