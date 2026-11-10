import { Router } from 'express';
import { searchFlightQuotes } from '../services/flights.js';
import { searchFlightAirports, searchGoogleFlightQuotes } from '../services/googleFlights.js';
import { getLeadById, retryLeadQuotes } from '../services/leads.js';
import { listQuotesForLead } from '../services/quotes.js';

const router = Router();

/** Airport / city autocomplete (SerpApi google_flights_autocomplete) */
router.get('/flights/airports', async (req, res) => {
  try {
    const query = req.query.query || req.query.q;
    if (!query) return res.status(400).json({ error: 'query parameter is required' });

    const result = await searchFlightAirports(query, {
      exclude_regions: req.query.exclude_regions,
      hl: req.query.hl,
      gl: req.query.gl,
    });
    res.json(result);
  } catch (error) {
    console.error('Flight airport autocomplete failed:', error.message);
    res.status(error.status || 500).json({ error: error.message });
  }
});

/**
 * Live search (admin/debug). Prefer saved quotes via GET /leads/:id/quotes.
 * `provider`: 'booking' (default, RapidAPI) or 'google' (SerpApi Google Flights).
 */
router.post('/flights/quotes', async (req, res) => {
  try {
    const body = req.body || {};
    const provider = String(body.provider || 'booking').toLowerCase();

    const result =
      provider === 'google' || provider === 'google_flights'
        ? await searchGoogleFlightQuotes({
            origin: body.origin,
            destination: body.destination,
            travel_date: body.travel_date,
            return_date: body.return_date,
            adults_count: body.adults_count,
            children_count: body.children_count,
            currency_code: body.currency_code || 'USD',
            cabinClass: body.cabinClass || 'ECONOMY',
            stops: body.stops,
            max_price: body.max_price,
            sort_by: body.sort_by,
            deep_search: body.deep_search,
            limit: body.limit || 8,
            return_lookups: body.return_lookups,
            metro: body.metro,
          })
        : await searchFlightQuotes({
            origin: body.origin,
            destination: body.destination,
            travel_date: body.travel_date,
            return_date: body.return_date,
            adults_count: body.adults_count,
            children_count: body.children_count,
            children_ages: body.children_ages,
            currency_code: body.currency_code || 'USD',
            sort: body.sort || 'BEST',
            cabinClass: body.cabinClass || 'ECONOMY',
            limit: body.limit || 8,
          });

    res.json({ provider: provider === 'google' ? 'google_flights' : 'booking.com', ...result });
  } catch (error) {
    console.error('Flight quotes failed:', error.message, error.details || '');
    res.status(error.status || 500).json({
      error: error.message || 'Failed to fetch flight quotes',
      details: error.details || null,
    });
  }
});

router.get('/leads/:id/quotes', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const quotes = await listQuotesForLead(lead.id);
    const search = lead.quote_search || {};

    res.json({
      lead_id: lead.id,
      quote_status: lead.quote_status,
      quote_error: lead.quote_error,
      quotes_fetched_at: lead.quotes_fetched_at,
      from: search.from || null,
      to: search.to || null,
      search: search.search || null,
      count: quotes.length,
      quotes,
    });
  } catch (error) {
    console.error('List saved quotes failed:', error);
    res.status(500).json({ error: 'Failed to load quotes' });
  }
});

router.post('/leads/:id/quotes/retry', async (req, res) => {
  try {
    const lead = await retryLeadQuotes(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json({ lead });
  } catch (error) {
    console.error('Retry quotes failed:', error.message);
    res.status(error.status || 500).json({
      error: error.message || 'Failed to retry quotes',
    });
  }
});

export default router;
