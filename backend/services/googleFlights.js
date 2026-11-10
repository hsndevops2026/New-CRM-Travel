/**
 * Google Flights via SerpApi.
 *
 * Two engines are used:
 *   - google_flights_autocomplete — resolves free-text ("dubai") to an airport code
 *   - google_flights              — the itinerary search itself
 *
 * Quotes are mapped to the SAME shape as services/flights.js (Booking.com), so
 * they drop into replaceLeadQuotes / listQuotesForLead / the comparison
 * normalizer / the frontend without any downstream changes.
 *
 * Round-trip note: with type=1 Google returns OUTBOUND itineraries only; each
 * carries a `departure_token` that must be replayed in a second search to get
 * the matching return legs. Each replay costs a SerpApi search credit, so only
 * the cheapest few offers are resolved (SERPAPI_FLIGHTS_RETURN_LOOKUPS, default
 * 3). Unresolved offers keep their token and are flagged `outbound_only`, and
 * can be completed later via resolveGoogleFlightReturn().
 */

import { serpGet } from './serpClient.js';
import { minutesToDuration } from '../utils/duration.js';

const IATA_RE = /^[A-Z]{3}$/;
const KGMID_RE = /^\/m\//;

const TRAVEL_CLASS = {
  ECONOMY: 1,
  PREMIUM_ECONOMY: 2,
  BUSINESS: 3,
  FIRST: 4,
};

const DEFAULT_RETURN_LOOKUPS = Math.max(
  0,
  Number(process.env.SERPAPI_FLIGHTS_RETURN_LOOKUPS ?? 3) || 0,
);

/**
 * Metro search uses a city's Knowledge Graph id instead of one airport code, so
 * Google searches every airport it associates with that city.
 *
 * Whether that is right depends on how far apart those airports actually are:
 *
 *   new york  JFK(12) LGA(8) EWR(8)                    spread 12mi — all NYC
 *   london    LHR(14) LGW(25) LTN(27) STN(30) SEN(35)  spread 35mi — all "London"
 *   dubai     DXB(6) SHJ(17) AUH(66)                   spread 66mi — Abu Dhabi!
 *
 * So metro is enabled per-city by measuring the spread rather than by keeping a
 * hand-maintained list. Under the threshold the whole metro is searched (which
 * also avoids having to guess between JFK and LGA for "new york"); over it, the
 * nearest airport alone is quoted, so a Dubai lead never departs Abu Dhabi.
 *
 * Set to 0 to always quote a single airport; set very high to always go wide.
 */
const METRO_MAX_SPREAD_MI = Math.max(
  0,
  Number(process.env.SERPAPI_FLIGHTS_METRO_MAX_MI ?? 40) || 0,
);

function roundMoney(value) {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

/** Autocomplete returns distance as a display string ("6 mi"), not a number. */
export function parseDistance(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const match = String(value || '').match(/([0-9]+(?:\.[0-9]+)?)/);
  return match ? Number(match[1]) : null;
}

/* ------------------------------------------------------------------ *
 * Autocomplete (engine: google_flights_autocomplete)
 * ------------------------------------------------------------------ */

/** Normalizes one `suggestions[]` entry into `{ id, name, type, description, airports[] }`. */
export function mapFlightSuggestion(entry) {
  const airports = Array.isArray(entry?.airports) ? entry.airports : [];
  return {
    id: entry?.id || null,
    name: entry?.name || null,
    type: entry?.type || null,
    description: entry?.description || null,
    position: entry?.position ?? null,
    airports: airports.map((airport) => ({
      id: airport?.id || null,
      name: airport?.name || null,
      city: airport?.city || null,
      city_id: airport?.city_id || null,
      // Raw display string ("6 mi") kept for the UI; parsed value for sorting.
      distance: airport?.distance ?? null,
      distance_value: parseDistance(airport?.distance),
    })),
  };
}

/** Airport/city suggestions for a free-text query. */
export async function searchFlightAirports(query, options = {}) {
  const raw = String(query || '').trim();
  if (!raw) {
    const error = new Error('query is required');
    error.status = 400;
    throw error;
  }

  const data = await serpGet(
    'google_flights_autocomplete',
    { q: raw, exclude_regions: options.exclude_regions },
    options,
  );

  const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
  return {
    query: raw,
    count: suggestions.length,
    suggestions: suggestions.map(mapFlightSuggestion),
  };
}

/** Picks the usable Google Flights id (IATA code preferred) out of a suggestion. */
export function pickAirportId(suggestion) {
  const airports = Array.isArray(suggestion?.airports) ? suggestion.airports : [];
  const withCode = airports.filter((airport) => IATA_RE.test(String(airport?.id || '').toUpperCase()));

  if (withCode.length) {
    // Prefer the closest airport to the searched location when distances are given.
    // `distance` arrives as "6 mi", so it must be parsed before comparing.
    const sorted = [...withCode].sort((a, b) => {
      const da = a.distance_value ?? parseDistance(a.distance);
      const db = b.distance_value ?? parseDistance(b.distance);
      if (da != null && db != null) return da - db;
      if (da != null) return -1;
      if (db != null) return 1;
      return 0;
    });
    return String(sorted[0].id).toUpperCase();
  }

  // Cities resolve to a Knowledge Graph id, which google_flights also accepts.
  const id = String(suggestion?.id || '');
  return KGMID_RE.test(id) ? id : null;
}

/**
 * Widest distance between the searched location and any of its airports.
 * Returns null when the API gave no usable distances.
 */
export function airportSpread(suggestion) {
  const distances = (suggestion?.airports || [])
    .filter((airport) => airport?.id)
    .map((airport) => airport.distance_value ?? parseDistance(airport.distance))
    .filter((distance) => distance != null);

  return distances.length ? Math.max(...distances) : null;
}

/**
 * Resolves user text to something google_flights accepts.
 * A bare IATA code ("DXB") is used as-is and costs no extra search credit.
 */
export async function resolveFlightLocation(value, options = {}) {
  const raw = String(value || '').trim();
  if (!raw) {
    const error = new Error('origin and destination are required');
    error.status = 400;
    throw error;
  }

  if (IATA_RE.test(raw.toUpperCase())) {
    const code = raw.toUpperCase();
    return {
      id: code,
      name: code,
      code,
      type: 'airport',
      metro: false,
      airport_spread_mi: null,
      nearby_airports: [],
      raw: null,
    };
  }
  if (KGMID_RE.test(raw)) {
    return {
      id: raw,
      name: raw,
      code: null,
      type: 'kgmid',
      metro: true,
      airport_spread_mi: null,
      nearby_airports: [],
      raw: null,
    };
  }

  const { suggestions } = await searchFlightAirports(raw, options);

  for (const suggestion of suggestions) {
    const airportId = pickAirportId(suggestion);
    const kgmid = KGMID_RE.test(String(suggestion.id || '')) ? String(suggestion.id) : null;

    // options.metro forces the choice; otherwise decide on how far apart the
    // city's airports are (see METRO_MAX_SPREAD_MI).
    const spread = airportSpread(suggestion);
    const spreadAllowsMetro =
      METRO_MAX_SPREAD_MI > 0 && spread != null && spread <= METRO_MAX_SPREAD_MI;
    const useMetro = Boolean(kgmid) && (options.metro ?? spreadAllowsMetro);

    const id = useMetro ? kgmid : airportId || kgmid;
    if (!id) continue;

    return {
      id,
      name: suggestion.name || raw,
      code: IATA_RE.test(id) ? id : null,
      type: suggestion.type || null,
      metro: useMetro,
      airport_spread_mi: spread,
      // Every airport in the metro — lets an agent widen or narrow knowingly.
      nearby_airports: suggestion.airports.filter((airport) => airport.id),
      raw: suggestion,
    };
  }

  const error = new Error(`No airport found for "${raw}" on Google Flights`);
  error.status = 404;
  throw error;
}

/* ------------------------------------------------------------------ *
 * Flight search (engine: google_flights)
 * ------------------------------------------------------------------ */

function mapLeg(flight) {
  return {
    airline: flight?.airline || null,
    flight_number: flight?.flight_number || null,
    departure_airport: flight?.departure_airport?.id || null,
    departure_city: flight?.departure_airport?.name || null,
    departure_time: flight?.departure_airport?.time || null,
    arrival_airport: flight?.arrival_airport?.id || null,
    arrival_city: flight?.arrival_airport?.name || null,
    arrival_time: flight?.arrival_airport?.time || null,
    duration: minutesToDuration(flight?.duration),
    airplane: flight?.airplane || null,
    travel_class: flight?.travel_class || null,
    legroom: flight?.legroom || null,
    overnight: Boolean(flight?.overnight),
    often_delayed: Boolean(flight?.often_delayed_by_over_30_min),
  };
}

/**
 * Maps a Google Flights itinerary (`flights[]` + `layovers[]`) into the
 * segment shape used by the existing flight quote UI.
 */
export function mapItinerary(itinerary) {
  const flights = Array.isArray(itinerary?.flights) ? itinerary.flights : [];
  if (!flights.length) return null;

  const first = flights[0];
  const last = flights[flights.length - 1];
  const layovers = Array.isArray(itinerary?.layovers) ? itinerary.layovers : [];

  return {
    airline: first?.airline || 'Airline',
    airline_logo: itinerary?.airline_logo || first?.airline_logo || null,
    flight_number: first?.flight_number || null,
    departure_airport: first?.departure_airport?.id || null,
    departure_city: first?.departure_airport?.name || null,
    departure_time: first?.departure_airport?.time || null,
    arrival_airport: last?.arrival_airport?.id || null,
    arrival_city: last?.arrival_airport?.name || null,
    arrival_time: last?.arrival_airport?.time || null,
    duration: minutesToDuration(itinerary?.total_duration),
    stops: Math.max(0, flights.length - 1),
    layovers: layovers.map((layover) => ({
      airport: layover?.id || null,
      name: layover?.name || null,
      duration: minutesToDuration(layover?.duration),
      overnight: Boolean(layover?.overnight),
    })),
    legs: flights.map(mapLeg),
  };
}

/** Maps one best_flights/other_flights entry into the shared quote shape. */
export function mapGoogleFlightOffer(entry, index, { currency = 'USD', roundTrip = false } = {}) {
  const outbound = mapItinerary(entry);

  return {
    id: entry?.booking_token || entry?.departure_token || `google-offer-${index}`,
    price: roundMoney(entry?.price),
    currency,
    outbound,
    // Round trips need a second search (departure_token) before inbound is known.
    inbound: null,
    outbound_only: Boolean(roundTrip),
    cabin_class: entry?.flights?.[0]?.travel_class || null,
    total_duration: minutesToDuration(entry?.total_duration),
    carbon_emissions: entry?.carbon_emissions
      ? {
          this_flight: entry.carbon_emissions.this_flight ?? null,
          typical_for_this_route: entry.carbon_emissions.typical_for_this_route ?? null,
          difference_percent: entry.carbon_emissions.difference_percent ?? null,
        }
      : null,
    extensions: Array.isArray(entry?.extensions) ? entry.extensions : [],
    departure_token: entry?.departure_token || null,
    booking_token: entry?.booking_token || null,
    provider: 'google_flights',
  };
}

function buildSearchParams({
  fromId,
  toId,
  travel_date,
  return_date,
  adults_count = 1,
  children_count = 0,
  currency_code = 'USD',
  cabinClass = 'ECONOMY',
  stops,
  max_price,
  sort_by,
  deep_search,
}) {
  const params = {
    departure_id: fromId,
    arrival_id: toId,
    outbound_date: String(travel_date).slice(0, 10),
    type: return_date ? 1 : 2,
    currency: currency_code,
    adults: Math.max(1, Number(adults_count) || 1),
    travel_class: TRAVEL_CLASS[String(cabinClass || 'ECONOMY').toUpperCase()] || 1,
    stops,
    max_price,
    sort_by,
    deep_search,
  };

  if (return_date) params.return_date = String(return_date).slice(0, 10);

  const children = Math.max(0, Number(children_count) || 0);
  if (children > 0) params.children = children;

  return params;
}

function collectOffers(data, limit, mapOptions) {
  const best = Array.isArray(data?.best_flights) ? data.best_flights : [];
  const other = Array.isArray(data?.other_flights) ? data.other_flights : [];
  return [...best, ...other]
    .slice(0, limit)
    .map((entry, index) => mapGoogleFlightOffer(entry, index, mapOptions));
}

/**
 * Second leg of a round-trip search: replays the original query with a
 * `departure_token` to fetch return itineraries for that chosen outbound.
 */
export async function resolveGoogleFlightReturn(searchParams, departure_token, options = {}) {
  const data = await serpGet(
    'google_flights',
    { ...searchParams, departure_token },
    options,
  );

  const candidates = [
    ...(Array.isArray(data?.best_flights) ? data.best_flights : []),
    ...(Array.isArray(data?.other_flights) ? data.other_flights : []),
  ];
  if (!candidates.length) return null;

  // Cheapest valid return pairing; price here is the round-trip total.
  const cheapest = candidates.reduce((acc, entry) => {
    const price = Number(entry?.price);
    const accPrice = Number(acc?.price);
    if (!Number.isFinite(price)) return acc;
    if (!Number.isFinite(accPrice)) return entry;
    return price < accPrice ? entry : acc;
  }, candidates[0]);

  return {
    inbound: mapItinerary(cheapest),
    price: roundMoney(cheapest?.price),
    booking_token: cheapest?.booking_token || null,
  };
}

export async function searchGoogleFlightQuotes({
  origin,
  destination,
  travel_date,
  return_date,
  adults_count = 1,
  children_count = 0,
  currency_code = 'USD',
  cabinClass = 'ECONOMY',
  stops,
  max_price,
  sort_by,
  deep_search,
  limit = 8,
  return_lookups = DEFAULT_RETURN_LOOKUPS,
  metro,
  hl,
  gl,
} = {}) {
  if (!origin || !destination || !travel_date) {
    const error = new Error('origin, destination, and travel_date are required');
    error.status = 400;
    throw error;
  }

  const locale = { hl, gl, metro };

  // Sequential so a bad origin fails before spending a second search credit.
  const from = await resolveFlightLocation(origin, locale);
  const to = await resolveFlightLocation(destination, locale);

  const searchParams = buildSearchParams({
    fromId: from.id,
    toId: to.id,
    travel_date,
    return_date,
    adults_count,
    children_count,
    currency_code,
    cabinClass,
    stops,
    max_price,
    sort_by,
    deep_search,
  });

  const data = await serpGet('google_flights', searchParams, locale);
  const roundTrip = Boolean(return_date);
  const quotes = collectOffers(data, limit, { currency: currency_code, roundTrip });

  if (!quotes.length) {
    const error = new Error(
      `No Google Flights results for ${from.name} → ${to.name} on ${searchParams.outbound_date}.`,
    );
    error.status = 404;
    throw error;
  }

  // Attach return legs to the cheapest few offers (one extra search credit each).
  if (roundTrip && return_lookups > 0) {
    const resolvable = quotes
      .filter((quote) => quote.departure_token)
      .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
      .slice(0, return_lookups);

    for (const quote of resolvable) {
      try {
        const resolved = await resolveGoogleFlightReturn(
          searchParams,
          quote.departure_token,
          locale,
        );
        if (!resolved?.inbound) continue;
        quote.inbound = resolved.inbound;
        quote.outbound_only = false;
        if (resolved.price != null) quote.price = resolved.price;
        if (resolved.booking_token) quote.booking_token = resolved.booking_token;
      } catch (error) {
        // A failed return lookup must not sink the whole search — the offer
        // stays usable as outbound-only and can be resolved on demand later.
        console.warn(
          `[google-flights] return lookup failed for ${quote.id}: ${error.message}`,
        );
      }
    }
  }

  return {
    from,
    to,
    search: {
      origin,
      destination,
      travel_date: searchParams.outbound_date,
      return_date: searchParams.return_date || null,
      adults: searchParams.adults,
      children: Math.max(0, Number(children_count) || 0),
      currency_code,
      cabinClass,
      trip_type: roundTrip ? 'round_trip' : 'one_way',
      metro_search: Boolean(from.metro || to.metro),
      provider: 'google_flights',
    },
    price_insights: data?.price_insights || null,
    airports: Array.isArray(data?.airports) ? data.airports : [],
    count: quotes.length,
    quotes,
  };
}
