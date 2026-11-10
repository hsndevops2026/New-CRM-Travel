import { rapidGet } from './rapidClient.js';
import { searchAirbnbHotels } from './airbnbHotels.js';
import {
  groupHotelQuotesBySource,
  listHotelQuotesForLead,
  replaceLeadHotelQuotes,
} from './hotelQuotes.js';
import { query } from '../config/database.js';

function roundMoney(value) {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function pickHotelDestination(results, query) {
  const list = Array.isArray(results) ? results : [];
  if (!list.length) {
    const error = new Error(`No Booking.com destination found for "${query}"`);
    error.status = 404;
    throw error;
  }

  const normalized = String(query || '').trim().toLowerCase();
  const scored = list.map((item) => {
    const name = String(item.label || item.city_name || item.name || '').toLowerCase();
    const destType = String(item.dest_type || item.search_type || item.type || '').toUpperCase();
    let score = 0;
    if (destType === 'CITY') score += 40;
    if (name === normalized) score += 50;
    if (name.startsWith(normalized)) score += 20;
    if (name.includes(normalized)) score += 10;
    return { item, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].item;
}

export async function searchBookingDestination(query) {
  const raw = String(query || '').trim();
  if (!raw) {
    const error = new Error('destination query is required');
    error.status = 400;
    throw error;
  }

  const data = await rapidGet('/hotels/searchDestination', { query: raw });
  const results = data?.data || data?.result || [];
  const dest = pickHotelDestination(results, raw);
  const destId = dest.dest_id ?? dest.destId ?? dest.id;
  const searchType = dest.search_type || dest.dest_type || dest.type || 'CITY';

  if (destId == null || destId === '') {
    const error = new Error(`No Booking.com dest_id for "${query}"`);
    error.status = 404;
    throw error;
  }

  return {
    dest_id: String(destId),
    search_type: String(searchType).toUpperCase(),
    name: dest.label || dest.city_name || dest.name || raw,
    country: dest.country || dest.cc1 || null,
    raw: dest,
  };
}

export function mapBookingHotel(entry, currency_code = 'USD') {
  const property = entry?.property || entry?.hotel || entry;
  const priceObj =
    property?.priceBreakdown?.grossPrice ||
    property?.priceBreakdown?.excludedPrice ||
    property?.price ||
    {};
  const price = roundMoney(priceObj.value ?? priceObj.amount ?? property?.min_price);
  const currency = priceObj.currency || property?.currency || currency_code;
  const photos = property?.photoUrls || property?.photo_urls || [];
  const photo = Array.isArray(photos) ? photos[0] : null;

  return {
    id: String(property?.id || property?.hotel_id || entry?.hotel_id || ''),
    hotel_name: property?.name || property?.hotel_name || entry?.name || 'Unknown Hotel',
    category: property?.propertyClass != null ? `${property.propertyClass} star` : null,
    destination_code: null,
    destination_name: property?.wishlistName || null,
    zone_name: property?.countryCode || null,
    latitude: property?.latitude != null ? Number(property.latitude) : null,
    longitude: property?.longitude != null ? Number(property.longitude) : null,
    price,
    currency,
    room_code: null,
    room_name: null,
    rate_key: null,
    rate_type: null,
    rate_class: null,
    board_code: null,
    board_name: null,
    review_score: property?.reviewScore != null ? Number(property.reviewScore) : null,
    review_count: property?.reviewCount != null ? Number(property.reviewCount) : null,
    review_word: property?.reviewScoreWord || null,
    photo_url: photo || null,
    refundable: null,
    free_cancellation: Boolean(property?.isFreeCancellable || property?.is_free_cancellable),
    cancellation_summary: property?.isFreeCancellable ? 'Free cancellation' : null,
    cancellation_policies: null,
    provider: 'booking.com',
  };
}

function hotelListFromResponse(data) {
  if (Array.isArray(data?.data?.hotels)) return data.data.hotels;
  if (Array.isArray(data?.data?.result)) return data.data.result;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.result)) return data.result;
  if (Array.isArray(data?.hotels)) return data.hotels;
  return [];
}

export async function searchBookingHotels({
  destination,
  travel_date,
  return_date,
  adults_count = 1,
  children_count = 0,
  children_ages = [],
  currency_code = 'USD',
  rooms = 1,
  limit = 8,
}) {
  if (!destination || !travel_date || !return_date) {
    const error = new Error('destination, travel_date, and return_date are required');
    error.status = 400;
    throw error;
  }

  const destInfo = await searchBookingDestination(destination);

  const ages = Array.isArray(children_ages)
    ? children_ages.filter((a) => a !== '' && a != null).map(Number)
    : String(children_ages || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number);

  const childCount = Math.max(0, Number(children_count) || 0);
  const childAges =
    childCount > 0
      ? (ages.length ? ages.slice(0, childCount) : Array.from({ length: childCount }, () => 8)).join(
          ',',
        )
      : undefined;

  const data = await rapidGet('/hotels/searchHotels', {
    dest_id: destInfo.dest_id,
    search_type: destInfo.search_type,
    arrival_date: String(travel_date).slice(0, 10),
    departure_date: String(return_date).slice(0, 10),
    adults: Math.max(1, Number(adults_count) || 1),
    children_age: childAges,
    room_qty: Math.max(1, Number(rooms) || 1),
    currency_code,
    languagecode: 'en-us',
    page_number: 1,
  });

  const hotels = hotelListFromResponse(data);
  const quotes = hotels.slice(0, limit).map((hotel) => mapBookingHotel(hotel, currency_code));

  if (!quotes.length) {
    const error = new Error(
      `No Booking.com hotels available for "${destInfo.name}" on these dates.`,
    );
    error.status = 404;
    throw error;
  }

  return {
    destination: destInfo,
    search: {
      destination,
      dest_id: destInfo.dest_id,
      search_type: destInfo.search_type,
      travel_date: String(travel_date).slice(0, 10),
      return_date: String(return_date).slice(0, 10),
      adults: Math.max(1, Number(adults_count) || 1),
      children: childCount,
      rooms: Math.max(1, Number(rooms) || 1),
      currency_code,
      provider: 'booking.com',
    },
    count: quotes.length,
    quotes,
  };
}

export async function searchHotelSourcesForLead(lead, { currency_code = 'USD', limit = 8 } = {}) {
  const params = {
    destination: lead.destination,
    travel_date: lead.travel_date,
    return_date: lead.return_date,
    adults_count: lead.adults_count,
    children_count: lead.children_count,
    children_ages: lead.children_ages,
    currency_code,
    rooms: 1,
    limit,
  };

  const [hotelbeds, booking, airbnb] = await Promise.allSettled([
    import('./hotels.js').then((mod) => mod.searchHotelQuotes(params)),
    searchBookingHotels(params),
    searchAirbnbHotels(params),
  ]);

  return {
    lead_id: lead.id,
    destination: lead.destination,
    sources: {
      hotelbeds: settledSource(hotelbeds, 'hotelbeds'),
      booking: settledSource(booking, 'booking.com'),
      airbnb: settledSource(airbnb, 'airbnb'),
    },
  };
}

function settledSource(result, provider) {
  if (result.status === 'fulfilled') {
    const quotes = (result.value.quotes || []).map((quote) => ({
      ...quote,
      provider: quote.provider || provider,
    }));
    return {
      ok: true,
      error: null,
      count: quotes.length,
      destination: result.value.destination || null,
      search: result.value.search || null,
      quotes,
    };
  }

  const status = result.reason?.status;
  const error = result.reason?.message || 'Failed to load hotels';
  if (status === 404) {
    return {
      ok: true,
      error: null,
      count: 0,
      destination: null,
      search: null,
      quotes: [],
    };
  }

  return {
    ok: false,
    error,
    count: 0,
    destination: null,
    search: null,
    quotes: [],
  };
}

export function hotelSourcesOutcome(sources = {}) {
  const list = [sources.hotelbeds, sources.booking, sources.airbnb];
  const anyOk = list.some((source) => source?.ok);
  const anyQuotes = list.some((source) => (source?.count || 0) > 0);
  const errors = list.map((source) => source?.error).filter(Boolean);

  if (anyOk || anyQuotes) {
    return { status: 'completed', error: null };
  }

  return {
    status: 'error',
    error: errors.join(' · ') || 'All hotel sources failed',
  };
}

const inflightByLead = new Map();

function sourceMeta(source) {
  return {
    error: source.ok ? null : source.error,
    count: source.count,
    destination: source.destination,
    search: source.search,
  };
}

async function persistHotelSources(lead, payload) {
  const hotelbeds = payload.sources.hotelbeds;
  const booking = payload.sources.booking;
  const airbnb = payload.sources.airbnb;

  await replaceLeadHotelQuotes(lead.id, hotelbeds, 'hotelbeds');
  await replaceLeadHotelQuotes(lead.id, booking, 'booking.com');
  await replaceLeadHotelQuotes(lead.id, airbnb, 'airbnb');

  await query(
    `UPDATE leads
     SET quote_search = COALESCE(quote_search, '{}'::jsonb) || $2::jsonb,
         quotes_fetched_at = NOW()
     WHERE id = $1`,
    [
      lead.id,
      JSON.stringify({
        sources_fetched: true,
        destination: hotelbeds.destination || booking.destination || airbnb.destination || null,
        search: hotelbeds.search || booking.search || airbnb.search || null,
        sources: {
          hotelbeds: sourceMeta(hotelbeds),
          booking: sourceMeta(booking),
          airbnb: sourceMeta(airbnb),
        },
      }),
    ],
  );
}

export async function fetchAndStoreHotelQuotesForLead(lead, options = {}) {
  const live = await searchHotelSourcesForLead(lead, options);
  await persistHotelSources(lead, live);
  return {
    ...live,
    cached: false,
    outcome: hotelSourcesOutcome(live.sources),
  };
}

function cachedSourcesPayload(lead, quotes) {
  const search = lead.quote_search || {};
  return {
    lead_id: lead.id,
    destination: lead.destination,
    cached: true,
    sources: groupHotelQuotesBySource(quotes, search),
  };
}

export async function getHotelSourcesForLead(lead, options = {}) {
  const refresh = Boolean(options.refresh);
  const key = String(lead.id);

  if (!refresh) {
    const quotes = await listHotelQuotesForLead(lead.id);
    return cachedSourcesPayload(lead, quotes);
  }

  if (inflightByLead.has(key)) {
    return inflightByLead.get(key);
  }

  const run = fetchAndStoreHotelQuotesForLead(lead, options);
  inflightByLead.set(key, run);
  try {
    return await run;
  } finally {
    inflightByLead.delete(key);
  }
}
