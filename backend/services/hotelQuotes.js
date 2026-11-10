import { query } from '../config/database.js';
import {
  flattenHotelRooms,
  hotelFromStoredRaw,
  summarizeCancellation,
} from './hotels.js';

export function normalizeHotelProvider(provider) {
  const value = String(provider || 'hotelbeds').toLowerCase();
  if (value.includes('booking')) return 'booking.com';
  if (value.includes('airbnb')) return 'airbnb';
  return 'hotelbeds';
}

export async function replaceLeadHotelQuotes(leadId, result, provider) {
  const quotes = Array.isArray(result?.quotes) ? result.quotes : [];
  const resolved = normalizeHotelProvider(provider || quotes[0]?.provider || 'hotelbeds');

  await query(
    `DELETE FROM hotel_quotes
     WHERE lead_id = $1 AND COALESCE(provider, 'hotelbeds') = $2`,
    [leadId, resolved],
  );

  for (const quote of quotes) {
    const quoteProvider = normalizeHotelProvider(quote.provider || resolved);
    await query(
      `INSERT INTO hotel_quotes (
        lead_id,
        external_id,
        hotel_name,
        category,
        destination_code,
        destination_name,
        zone_name,
        latitude,
        longitude,
        price,
        currency,
        rate_key,
        rate_type,
        board_code,
        board_name,
        cancellation_policies,
        provider,
        raw
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18::jsonb)`,
      [
        leadId,
        quote.id || null,
        quote.hotel_name || null,
        quote.category || null,
        quote.destination_code || null,
        quote.destination_name || null,
        quote.zone_name || null,
        quote.latitude ?? null,
        quote.longitude ?? null,
        quote.price ?? null,
        quote.currency || 'USD',
        quote.rate_key || null,
        quote.rate_type || null,
        quote.board_code || null,
        quote.board_name || null,
        JSON.stringify(quote.cancellation_policies || null),
        quoteProvider,
        JSON.stringify({ ...quote, provider: quoteProvider }),
      ],
    );
  }

  return quotes.length;
}

export function mapHotelQuoteRow(row) {
  const stored = row.raw && typeof row.raw === 'object' ? row.raw : {};
  const hotel = hotelFromStoredRaw(stored);
  const currency = row.currency || stored.currency || 'USD';
  const details = hotel ? flattenHotelRooms(hotel, currency) : [];

  const cancelFromStored = summarizeCancellation({
    rateClass: stored.rate_class || null,
    cancellationPolicies: Array.isArray(row.cancellation_policies)
      ? row.cancellation_policies
      : Array.isArray(stored.cancellation_policies)
        ? stored.cancellation_policies
        : [],
  });

  return {
    id: row.id,
    external_id: row.external_id,
    hotel_name: row.hotel_name || stored.hotel_name || null,
    category: row.category || stored.category || null,
    destination_code: row.destination_code || stored.destination_code || null,
    destination_name: row.destination_name || stored.destination_name || null,
    zone_name: row.zone_name || stored.zone_name || null,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    price: row.price != null ? Number(row.price) : null,
    currency,
    room_code: stored.room_code || null,
    room_name: stored.room_name || null,
    rate_key: row.rate_key,
    rate_type: row.rate_type,
    rate_class: stored.rate_class || null,
    board_code: row.board_code,
    board_name: row.board_name || stored.board_name || null,
    review_score: stored.review_score != null ? Number(stored.review_score) : null,
    review_count: stored.review_count != null ? Number(stored.review_count) : null,
    review_word: stored.review_word || null,
    photo_url: stored.photo_url || null,
    refundable:
      stored.refundable != null ? Boolean(stored.refundable) : cancelFromStored.refundable,
    free_cancellation:
      stored.free_cancellation != null
        ? Boolean(stored.free_cancellation)
        : cancelFromStored.free_cancellation,
    cancellation_summary:
      stored.cancellation_summary || cancelFromStored.cancellation_summary,
    cancellation_policies: row.cancellation_policies,
    details,
    provider: normalizeHotelProvider(row.provider || stored.provider),
    created_at: row.created_at,
  };
}

export async function listHotelQuotesForLead(leadId) {
  const result = await query(
    `SELECT id, lead_id, external_id, hotel_name, category,
            destination_code, destination_name, zone_name,
            latitude, longitude, price, currency,
            rate_key, rate_type, board_code, board_name,
            cancellation_policies, provider, raw, created_at
     FROM hotel_quotes
     WHERE lead_id = $1
     ORDER BY price NULLS LAST, created_at ASC`,
    [leadId],
  );

  return result.rows.map(mapHotelQuoteRow);
}

export function groupHotelQuotesBySource(quotes, search = {}) {
  const hotelbedsQuotes = quotes.filter((quote) => quote.provider === 'hotelbeds');
  const bookingQuotes = quotes.filter((quote) => quote.provider === 'booking.com');
  const airbnbQuotes = quotes.filter((quote) => quote.provider === 'airbnb');
  const sourcesMeta = search.sources || {};

  return {
    hotelbeds: sourceFromQuotes(hotelbedsQuotes, sourcesMeta.hotelbeds),
    booking: sourceFromQuotes(bookingQuotes, sourcesMeta.booking),
    airbnb: sourceFromQuotes(airbnbQuotes, sourcesMeta.airbnb),
  };
}

function sourceFromQuotes(quotes, meta = {}) {
  const error = meta?.error || null;
  const ok = !error || quotes.length > 0;
  return {
    ok,
    error: quotes.length ? null : error,
    count: quotes.length,
    destination: meta?.destination || null,
    search: meta?.search || null,
    quotes,
  };
}
