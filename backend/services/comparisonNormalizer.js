/**
 * Normalizes all quote sources for a lead into a unified comparison list.
 *
 * Source types:
 *   - predefined   — a predefined package (from predefined_quotes)
 *   - flight_api   — a flight result from the BullMQ flight worker
 *   - hotel_api    — a hotel result from booking/airbnb/hotelbeds
 *   - dealer       — an approved dealer_response with AI-extracted pricing
 *
 * Each normalized item has:
 *   id, source_type, source_id, label, description,
 *   net_cost, currency, meta (all provenance), sort_price
 */

import { query } from '../config/database.js';
import { listHotelQuotesForLead } from './hotelQuotes.js';
import { displayTotal, listPredefinedQuotes } from './predefinedQuotes.js';
import { getLeadById } from './leads.js';
import { datesMatch, placeMatches, tailorPackageQuote } from './packageOffer.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pick(...vals) {
  for (const v of vals) {
    if (v != null && v !== '') return v;
  }
  return null;
}

// ── predefined packages ───────────────────────────────────────────────────────

async function normalizePredefined(leadId) {
  const lead = await getLeadById(leadId);
  const destination = lead?.destination || '';
  const attachedId = lead?.predefined_quote_id || null;
  const quotes = await listPredefinedQuotes({ limit: 500 });

  const filtered = quotes.filter((quote) => {
    if (quote.quote_type !== 'hotel' && quote.quote_type !== 'package') return false;
    if (attachedId && String(quote.id) === String(attachedId)) return true;
    const destOk =
      Boolean(destination) &&
      (placeMatches(destination, quote.destination) || placeMatches(destination, quote.title));
    return destOk && datesMatch(lead, quote);
  });

  return filtered.map((quote) => {
    const isAttached = attachedId && String(quote.id) === String(attachedId);
    const selectedIds = isAttached && Array.isArray(lead?.raw_collected?._selected_package_item_ids)
      ? lead.raw_collected._selected_package_item_ids
      : [];
    const tailored = selectedIds.length ? tailorPackageQuote(quote, lead, selectedIds) : quote;
    const hotelItems = tailored.items?.filter((item) => item.item_type === 'hotel') || [];
    const hotelItem = hotelItems[0] || tailored.items?.[0];
    const price = displayTotal(tailored);

    return {
      id: `predefined:${quote.id}`,
      source_type: 'predefined',
      source_id: String(quote.id),
      label: quote.title || 'Package',
      description: [hotelItems.map((item) => item.hotel_name).filter(Boolean).join(' + ') || hotelItem?.hotel_name, tailored.destination]
        .filter(Boolean)
        .join(' · '),
      net_cost: num(price),
      currency: quote.currency || 'USD',
      sort_price: num(price),
      meta: {
        nights: tailored.nights,
        hotel_name: hotelItem?.hotel_name || null,
        destination: tailored.destination,
        travel_date: tailored.travel_date,
        return_date: tailored.return_date,
        departure_city: hotelItem?.departure_city || tailored.origin,
        includes: tailored.items?.map((item) => item.title).filter(Boolean).join(', ') || null,
        item_type: tailored.quote_type,
        description: tailored.description,
        selected_item_ids: selectedIds,
      },
    };
  });
}

// ── flight API results ────────────────────────────────────────────────────────

async function normalizeFlightApi(leadId) {
  const lead = await getLeadById(leadId);
  const provider = lead?.quote_search?.flight_provider || 'booking.com';
  const result = await query(
    `SELECT id, external_id, price, currency, outbound, inbound
     FROM flight_quotes
     WHERE lead_id = $1
     ORDER BY price ASC NULLS LAST`,
    [leadId],
  );

  return result.rows.map((row) => {
    const ob = row.outbound || {};
    const ib = row.inbound || {};

    const airline = pick(ob.carrier, ob.airline, ob.marketingCarrier, ib.carrier);
    const segments = [ob, ib].filter((s) => s && Object.keys(s).length > 0);
    const label = airline ? `${airline} flight` : 'Flight';
    const route = [ob.origin || ob.from, ob.destination || ob.to].filter(Boolean).join(' → ');

    return {
      id: `flight_api:${row.id}`,
      source_type: 'flight_api',
      source_id: String(row.id),
      label,
      description: route || null,
      net_cost: num(row.price),
      currency: row.currency || 'USD',
      sort_price: num(row.price),
      meta: {
        source: provider,
        external_id: row.external_id,
        airline,
        outbound: ob,
        inbound: Object.keys(ib).length ? ib : null,
        segments,
      },
    };
  });
}

// ── hotel API results (all providers combined) ────────────────────────────────

async function normalizeHotelApi(leadId) {
  const quotes = await listHotelQuotesForLead(leadId);

  return quotes.map((row) => {
    const label = [row.hotel_name, row.room_name].filter(Boolean).join(' — ') || 'Hotel';
    return {
      id: `hotel_api:${row.id}`,
      source_type: 'hotel_api',
      source_id: String(row.id),
      label,
      description: [row.board_name, row.destination_name].filter(Boolean).join(' · ') || null,
      net_cost: num(row.price),
      currency: row.currency || 'USD',
      sort_price: num(row.price),
      meta: {
        source: row.provider,
        external_id: row.external_id,
        hotel_name: row.hotel_name,
        room_type: row.room_name,
        board_name: row.board_name,
        cancellation_policy: row.cancellation_summary,
        check_in: row.details?.[0]?.check_in || null,
        check_out: row.details?.[0]?.check_out || null,
        nights: row.details?.[0]?.nights || null,
      },
    };
  });
}

// ── approved dealer responses ─────────────────────────────────────────────────

async function normalizeDealerResponses(leadId) {
  const result = await query(
    `SELECT dr.id, dr.extracted, dr.extraction_confidence, dr.raw_text, dr.is_best, dr.is_recommended, dr.ai_rank_reason,
            dreq.request_code, COALESCE(d.name, dr.from_number, dreq.group_name, 'Dealer') AS dealer_name,
            d.phone AS dealer_phone
     FROM dealer_responses dr
     JOIN dealer_requests dreq ON dreq.id = dr.dealer_request_id
     LEFT JOIN dealers d ON d.id = dreq.dealer_id
     WHERE dreq.lead_id = $1 AND dr.review_status = 'approved'
     ORDER BY dr.is_best DESC, dr.is_recommended DESC, dr.created_at ASC`,
    [leadId],
  );

  return result.rows.map((row) => {
    const ext = row.extracted || {};
    const price = num(ext.total_price) ?? num(ext.price_per_night);
    let label =
      [ext.hotel_name || ext.airline, ext.room_type].filter(Boolean).join(' — ') ||
      `${row.dealer_name} offer`;
    if (row.is_best) {
      label = `Best · ${label}`;
    } else if (row.is_recommended) {
      label = `AI pick · ${label}`;
    }

    return {
      id: `dealer:${row.id}`,
      source_type: 'dealer',
      source_id: String(row.id),
      label,
      description: [ext.board_name, ext.cancellation_terms].filter(Boolean).join(' · ') || null,
      net_cost: price,
      currency: ext.currency || 'USD',
      sort_price: price,
      meta: {
        dealer_name: row.dealer_name,
        dealer_phone: row.dealer_phone,
        request_code: row.request_code,
        confidence: row.extraction_confidence,
        extracted: ext,
        raw_text: row.raw_text,
        is_best: Boolean(row.is_best),
        is_recommended: Boolean(row.is_recommended),
        ai_rank_reason: row.ai_rank_reason || null,
      },
    };
  });
}

// ── public aggregator ─────────────────────────────────────────────────────────

/**
 * Returns all normalized comparison items for a lead, ranked cheapest first.
 * Each item with a null net_cost is placed last.
 */
export async function getComparisonItems(leadId) {
  const [predefined, flights, hotels, dealers] = await Promise.allSettled([
    normalizePredefined(leadId),
    normalizeFlightApi(leadId),
    normalizeHotelApi(leadId),
    normalizeDealerResponses(leadId),
  ]);

  const errors = [];
  const all = [];

  for (const [label, result] of [
    ['predefined', predefined],
    ['flight_api', flights],
    ['hotel_api', hotels],
    ['dealer', dealers],
  ]) {
    if (result.status === 'fulfilled') {
      all.push(...result.value);
    } else {
      errors.push({ source: label, error: result.reason?.message || 'Unknown error' });
    }
  }

  // Sort: items with a price first (cheapest), null-cost items last
  all.sort((a, b) => {
    if (a.sort_price == null && b.sort_price == null) return 0;
    if (a.sort_price == null) return 1;
    if (b.sort_price == null) return -1;
    return a.sort_price - b.sort_price;
  });

  return { items: all, errors };
}
