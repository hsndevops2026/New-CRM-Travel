import { hotelbedsConfig, hotelbedsHeaders } from '../config/hotelbeds.js';
import { serpGet } from './serpClient.js';

function requireKeys() {
  if (!hotelbedsConfig.apiKey || !hotelbedsConfig.secret) {
    const error = new Error(
      'HOTELBEDS_API_KEY and HOTELBEDS_SECRET are not configured. Add them to backend/.env.',
    );
    error.status = 500;
    throw error;
  }
}

async function hotelbedsPost(path, body) {
  requireKeys();

  const response = await fetch(`${hotelbedsConfig.baseUrl}${path}`, {
    method: 'POST',
    headers: hotelbedsHeaders(),
    body: JSON.stringify(body),
  });

  return handleResponse(response);
}

async function handleResponse(response) {
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const apiError =
      data?.error?.message ||
      data?.error ||
      data?.message ||
      `Hotelbeds API error (${response.status})`;
    const message = typeof apiError === 'string' ? apiError : JSON.stringify(apiError);
    const error = new Error(message);
    error.status = response.status === 401 || response.status === 403 ? 502 : response.status;
    error.details = data;
    throw error;
  }

  return data;
}

export function mapHotelbedsPlace(raw, place) {
  const latitude = Number(place?.gps_coordinates?.latitude);
  const longitude = Number(place?.gps_coordinates?.longitude);
  if (!place || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    const error = new Error(`Could not locate "${raw}" on the map. Enter a city and country or a Hotelbeds destination code.`);
    error.status = 404;
    throw error;
  }
  return {
    code: null,
    name: place.title || raw,
    address: place.address || null,
    geolocation: { latitude, longitude, radius: 30, unit: 'km' },
    source: 'google-maps-serpapi',
  };
}

/** Resolve a city, district, or property name to coordinates for Hotelbeds. */
export async function searchHotelDestination(query) {
  const raw = String(query || '').trim();
  if (!raw) {
    const error = new Error('destination query is required');
    error.status = 400;
    throw error;
  }

  // A code explicitly entered by an agent can still use Hotelbeds' code search.
  if (/^[A-Z0-9]{2,5}$/.test(raw) || /^[a-z]{3}$/.test(raw)) {
    return {
      code: raw.toUpperCase(),
      name: raw.toUpperCase(),
      countryCode: null,
      source: 'code',
    };
  }

  // Content API destination lists require a separate entitlement. Google Maps
  // resolves worldwide place names; Hotelbeds Booking API accepts geolocation.
  let data;
  try {
    data = await serpGet('google_maps', { q: raw, type: 'search' });
  } catch (error) {
    if (!/hasn't returned any results|no results/i.test(error.message)) throw error;
    data = {};
  }
  return mapHotelbedsPlace(raw, data.place_results);
}

/**
 * Search hotel availability via Hotelbeds Booking API.
 */
export async function searchHotelQuotes({
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

  requireKeys();

  const destInfo = await searchHotelDestination(destination);

  const ages = Array.isArray(children_ages)
    ? children_ages.filter((a) => a !== '' && a != null).map(Number)
    : String(children_ages || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number);

  const occupancy = {
    rooms: Math.max(1, Number(rooms) || 1),
    adults: Math.max(1, Number(adults_count) || 1),
    children: Math.max(0, Number(children_count) || 0),
  };

  if (occupancy.children > 0) {
    const childAges = ages.length
      ? ages.slice(0, occupancy.children)
      : Array.from({ length: occupancy.children }, () => 8);
    occupancy.paxes = childAges.map((age) => ({
      type: 'CH',
      age: Number(age) || 8,
    }));
  }

  const requestBody = {
    stay: {
      checkIn: String(travel_date).slice(0, 10),
      checkOut: String(return_date).slice(0, 10),
    },
    occupancies: [occupancy],
    ...(destInfo.code
      ? { destination: { code: destInfo.code } }
      : { geolocation: destInfo.geolocation }),
    filter: {
      maxHotels: Math.min(Math.max(limit, 1), 50),
    },
  };

  const data = await hotelbedsPost('/hotel-api/1.0/hotels', requestBody);
  const hotels = data?.hotels?.hotels || [];

  if (!hotels.length) {
    const error = new Error(
      `No Hotelbeds hotels available near "${destInfo.name}" on these dates.`,
    );
    error.status = 404;
    throw error;
  }

  const quotes = hotels.slice(0, limit).map((hotel) => mapHotelOffer(hotel, currency_code));

  return {
    destination: destInfo,
    search: {
      destination,
      destination_code: destInfo.code,
      travel_date: requestBody.stay.checkIn,
      return_date: requestBody.stay.checkOut,
      adults: occupancy.adults,
      children: occupancy.children,
      rooms: occupancy.rooms,
      currency_code,
      provider: 'hotelbeds',
    },
    count: quotes.length,
    quotes,
  };
}

function roundMoney(value) {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Hotelbeds has no free_cancellation boolean.
 * NRF rateClass => non-refundable. Empty policies => treat as free until further notice.
 */
export function summarizeCancellation(rate) {
  const rateClass = String(rate?.rateClass || '').toUpperCase();
  const policies = Array.isArray(rate?.cancellationPolicies)
    ? rate.cancellationPolicies
    : [];

  if (rateClass === 'NRF') {
    return {
      refundable: false,
      free_cancellation: false,
      cancellation_summary: 'Non-refundable',
      cancellation_policies: policies,
    };
  }

  if (!policies.length) {
    return {
      refundable: true,
      free_cancellation: true,
      cancellation_summary: 'Free cancellation',
      cancellation_policies: policies,
    };
  }

  const sorted = [...policies].sort(
    (a, b) => new Date(a.from || 0).getTime() - new Date(b.from || 0).getTime(),
  );
  const first = sorted[0];
  const when = first?.from ? String(first.from).slice(0, 10) : null;
  const amount = roundMoney(first?.amount);
  const summary = when
    ? amount != null
      ? `Cancel from ${when} (fee ${amount})`
      : `Cancel from ${when}`
    : 'Cancellation fees apply';

  return {
    refundable: true,
    free_cancellation: false,
    cancellation_summary: summary,
    cancellation_policies: policies,
  };
}

function mapPromotions(rate) {
  const list = [];
  for (const item of rate?.promotions || []) {
    list.push({
      code: item.code || null,
      name: item.name || null,
      amount: roundMoney(item.amount),
    });
  }
  for (const item of rate?.offers || []) {
    list.push({
      code: item.code || null,
      name: item.name || null,
      amount: roundMoney(item.amount),
    });
  }
  return list.length ? list : null;
}

/**
 * Expand Hotelbeds hotel.rooms[].rates[] into detail rows for Custom quotes UI.
 */
export function flattenHotelRooms(hotel, currency_code = 'USD') {
  if (!hotel || typeof hotel !== 'object') return [];

  const hotelMeta = {
    hotel_code: hotel.code != null ? String(hotel.code) : null,
    hotel_name: hotel.name || hotel.hotelName || null,
    category: hotel.categoryName || hotel.categoryCode || null,
    destination_code: hotel.destinationCode || null,
    destination_name: hotel.destinationName || null,
    zone_code: hotel.zoneCode != null ? String(hotel.zoneCode) : null,
    zone_name: hotel.zoneName || null,
    latitude: hotel.latitude != null ? Number(hotel.latitude) : null,
    longitude: hotel.longitude != null ? Number(hotel.longitude) : null,
  };

  const details = [];
  for (const room of hotel.rooms || []) {
    for (const rate of room.rates || []) {
      const cancel = summarizeCancellation(rate);
      const net = roundMoney(rate.net);
      const selling = roundMoney(rate.sellingRate);
      details.push({
        ...hotelMeta,
        room_code: room.code || null,
        room_name: room.name || null,
        rate_key: rate.rateKey || null,
        rate_class: rate.rateClass || null,
        rate_type: rate.rateType || null,
        net,
        selling_rate: selling,
        price: net ?? selling,
        currency: currency_code || hotel.currency || 'USD',
        board_code: rate.boardCode || null,
        board_name: rate.boardName || null,
        allotment: rate.allotment != null ? Number(rate.allotment) : null,
        payment_type: rate.paymentType || null,
        packaging: rate.packaging === true || rate.packaging === 'true',
        adults: rate.adults != null ? Number(rate.adults) : null,
        children: rate.children != null ? Number(rate.children) : null,
        children_ages: rate.childrenAges || null,
        rooms: rate.rooms != null ? Number(rate.rooms) : null,
        rate_comments_id: rate.rateCommentsId || null,
        promotions: mapPromotions(rate),
        refundable: cancel.refundable,
        free_cancellation: cancel.free_cancellation,
        cancellation_summary: cancel.cancellation_summary,
        cancellation_policies: cancel.cancellation_policies,
      });
    }
  }

  details.sort((a, b) => {
    const pa = a.price == null ? Number.POSITIVE_INFINITY : a.price;
    const pb = b.price == null ? Number.POSITIVE_INFINITY : b.price;
    return pa - pb;
  });

  return details;
}

/** Resolve nested Hotelbeds hotel object from a stored hotel_quotes.raw payload. */
export function hotelFromStoredRaw(stored) {
  if (!stored || typeof stored !== 'object') return null;
  if (stored.raw && typeof stored.raw === 'object' && Array.isArray(stored.raw.rooms)) {
    return stored.raw;
  }
  if (Array.isArray(stored.rooms)) return stored;
  return null;
}

function mapHotelOffer(hotel, currency_code) {
  const rooms = hotel.rooms || [];
  const firstRoom = rooms[0] || {};
  const rates = firstRoom.rates || [];

  const bestRate = rates.reduce((best, rate) => {
    if (!best) return rate;
    const rateNet = parseFloat(rate.net || rate.sellingRate || 0);
    const bestNet = parseFloat(best.net || best.sellingRate || 0);
    return rateNet < bestNet ? rate : best;
  }, null);

  const price = bestRate
    ? roundMoney(bestRate.net || bestRate.sellingRate)
    : null;
  const cancel = summarizeCancellation(bestRate);

  return {
    id: String(hotel.code || hotel.hotelCode || ''),
    hotel_name: hotel.name || hotel.hotelName || 'Unknown Hotel',
    category: hotel.categoryName || hotel.categoryCode || null,
    destination_code: hotel.destinationCode || null,
    destination_name: hotel.destinationName || null,
    zone_name: hotel.zoneName || null,
    latitude: hotel.latitude != null ? Number(hotel.latitude) : null,
    longitude: hotel.longitude != null ? Number(hotel.longitude) : null,
    price,
    currency: currency_code,
    room_code: firstRoom.code || null,
    room_name: firstRoom.name || null,
    rate_key: bestRate?.rateKey || null,
    rate_type: bestRate?.rateType || null,
    rate_class: bestRate?.rateClass || null,
    board_code: bestRate?.boardCode || null,
    board_name: bestRate?.boardName || null,
    review_score: null,
    review_count: null,
    review_word: null,
    photo_url: null,
    refundable: cancel.refundable,
    free_cancellation: cancel.free_cancellation,
    cancellation_summary: cancel.cancellation_summary,
    cancellation_policies: bestRate?.cancellationPolicies || null,
    provider: 'hotelbeds',
    raw: hotel,
  };
}
