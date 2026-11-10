import { pool, query } from '../config/database.js';
import { enrichPredefinedQuoteImages } from './packageImages.js';

const ITEM_TYPES = new Set(['hotel', 'flight']);
const FLIGHT_DIRECTIONS = new Set(['outbound', 'return']);

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function optionalText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

export function optionalDate(value) {
  const text = String(value ?? '').trim().slice(0, 10);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw httpError(400, 'Dates must be YYYY-MM-DD');
  }
  return text;
}

export function optionalNumber(value) {
  if (value === '' || value == null) return null;
  const number = Number(value);
  if (Number.isNaN(number)) throw httpError(400, 'Invalid number');
  return number;
}

export function optionalInteger(value) {
  const number = optionalNumber(value);
  if (number == null) return null;
  return Math.trunc(number);
}

export function normalizeChildrenAges(value) {
  if (Array.isArray(value)) {
    return value.map((n) => Number(n)).filter((n) => Number.isFinite(n)).map((n) => Math.trunc(n));
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/[|,]/)
      .map((n) => Number(n.trim()))
      .filter((n) => Number.isFinite(n))
      .map((n) => Math.trunc(n));
  }
  return [];
}

export function nightsBetween(start, end) {
  if (!start || !end) return null;
  const from = new Date(`${String(start).slice(0, 10)}T12:00:00`);
  const to = new Date(`${String(end).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  const nights = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  return nights > 0 ? nights : null;
}

/**
 * Nights of a stay made of these hotel rows. Rows for the same hotel are alternatives (7, 8
 * or 9 nights) the customer picks one of, so each hotel counts once, at its shortest stay.
 */
export function shortestStayNights(hotels = []) {
  const byHotel = new Map();
  for (const item of hotels) {
    const nights = Number(item.nights);
    if (!(nights > 0)) continue;
    const key = String(item.hotel_name || item.title || '').trim().toLowerCase();
    byHotel.set(key, Math.min(byHotel.get(key) ?? Infinity, nights));
  }
  return [...byHotel.values()].reduce((sum, nights) => sum + nights, 0) || null;
}

export function deriveQuoteType(items) {
  const hasHotel = items.some((item) => item.item_type === 'hotel');
  const hasFlight = items.some((item) => item.item_type === 'flight');
  if (hasHotel && hasFlight) return 'package';
  if (hasFlight) return 'flight';
  return 'hotel';
}

export function sumItemPrices(items) {
  return items.reduce((total, item) => {
    const price = optionalNumber(item.price);
    return price == null ? total : total + price;
  }, 0);
}

export function displayTotal(quote) {
  if (quote.total_price != null && !Number.isNaN(Number(quote.total_price))) {
    return Number(quote.total_price);
  }
  const sum = sumItemPrices(quote.items || []);
  return sum > 0 ? sum : null;
}

export function quoteFilename(quote) {
  const base = String(quote?.title || 'quote')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `${base || 'quote'}.pdf`;
}

function toNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isNaN(number) ? null : number;
}

function mapItem(row) {
  return {
    ...row,
    price: toNumber(row.price),
    nights: toNumber(row.nights),
    stops: toNumber(row.stops),
    sort_order: toNumber(row.sort_order) ?? 0,
  };
}

function mapQuote(row, items = []) {
  const mappedItems = items.map(mapItem);
  const quote = {
    ...row,
    total_price: toNumber(row.total_price),
    nights: toNumber(row.nights),
    adults_count: toNumber(row.adults_count) ?? 0,
    children_count: toNumber(row.children_count) ?? 0,
    availability_mode: row.availability_mode === 'period' ? 'period' : 'fixed',
    available_months: Array.isArray(row.available_months)
      ? row.available_months.map((n) => Number(n)).filter((n) => Number.isInteger(n))
      : [],
    children_ages: Array.isArray(row.children_ages)
      ? row.children_ages.map((n) => Number(n)).filter((n) => Number.isFinite(n))
      : [],
    items: mappedItems,
  };
  quote.display_total = displayTotal(quote);
  return quote;
}

function normalizeItem(raw, index) {
  const itemType = String(raw?.item_type || '').trim();
  if (!ITEM_TYPES.has(itemType)) {
    throw httpError(400, 'Each item must be a hotel or a flight');
  }

  const directionRaw = optionalText(raw?.direction)?.toLowerCase();
  const direction = directionRaw && FLIGHT_DIRECTIONS.has(directionRaw) ? directionRaw : null;
  const checkIn = optionalDate(raw?.check_in);
  const checkOut = optionalDate(raw?.check_out);
  const nights = optionalInteger(raw?.nights) ?? nightsBetween(checkIn, checkOut);

  const item = {
    item_type: itemType,
    sort_order: index,
    title: optionalText(raw?.title),
    description: optionalText(raw?.description),
    image_url: optionalText(raw?.image_url),
    price: optionalNumber(raw?.price),
    currency: optionalText(raw?.currency)?.toUpperCase() || 'USD',
    hotel_name: optionalText(raw?.hotel_name),
    city: optionalText(raw?.city),
    country: optionalText(raw?.country),
    category: optionalText(raw?.category),
    board_name: optionalText(raw?.board_name),
    room_name: optionalText(raw?.room_name),
    check_in: checkIn,
    check_out: checkOut,
    nights,
    airline: optionalText(raw?.airline),
    flight_number: optionalText(raw?.flight_number),
    departure_airport: optionalText(raw?.departure_airport)?.toUpperCase(),
    arrival_airport: optionalText(raw?.arrival_airport)?.toUpperCase(),
    departure_city: optionalText(raw?.departure_city),
    arrival_city: optionalText(raw?.arrival_city),
    departure_time: optionalText(raw?.departure_time),
    arrival_time: optionalText(raw?.arrival_time),
    duration: optionalText(raw?.duration),
    stops: optionalInteger(raw?.stops),
    direction,
    extra: raw?.extra && typeof raw.extra === 'object' ? raw.extra : {},
  };

  if (itemType === 'hotel') {
    if (!item.hotel_name && !item.title) {
      throw httpError(400, 'Hotel items need a hotel name');
    }
    if (checkIn && checkOut && checkOut <= checkIn) {
      throw httpError(400, 'Hotel check-out must be after check-in');
    }
  }
  if (itemType === 'flight' && !item.airline && !item.title && !item.departure_airport) {
    throw httpError(400, 'Flight items need an airline, title, or route');
  }

  if (!item.title) {
    item.title =
      itemType === 'hotel'
        ? item.hotel_name
        : [item.airline, item.flight_number].filter(Boolean).join(' ') ||
          [item.departure_airport, item.arrival_airport].filter(Boolean).join(' → ');
  }

  return item;
}

function earliestDate(...values) {
  const dates = values.filter(Boolean).sort();
  return dates[0] || null;
}

function latestDate(...values) {
  const dates = values.filter(Boolean).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

export const AVAILABILITY_MODES = new Set(['fixed', 'period']);

/** Month numbers 1–12, each once, in calendar order. Anything else is dropped. */
export function normalizeMonths(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map((m) => Number(m)).filter((m) => Number.isInteger(m) && m >= 1 && m <= 12))].sort(
    (a, b) => a - b,
  );
}

export function normalizeQuoteInput(input) {
  const title = optionalText(input?.title);
  if (!title) throw httpError(400, 'Title is required');

  const items = Array.isArray(input?.items) ? input.items.map(normalizeItem) : [];
  if (!items.length) throw httpError(400, 'Add at least one hotel or flight');

  const quoteType = deriveQuoteType(items);
  const hotels = items.filter((item) => item.item_type === 'hotel');
  const flights = items.filter((item) => item.item_type === 'flight');

  const mode = optionalText(input?.availability_mode)?.toLowerCase() || 'fixed';
  if (!AVAILABILITY_MODES.has(mode)) throw httpError(400, 'Availability must be fixed dates or a period of months');
  const availableMonths = mode === 'period' ? normalizeMonths(input?.available_months) : [];
  if (mode === 'period' && !availableMonths.length) {
    throw httpError(400, 'Choose at least one month this package is available in');
  }

  let travelDate = optionalDate(input?.travel_date);
  let returnDate = optionalDate(input?.return_date);
  // Hotel stays carry their own dates; use them when the quote-level window is blank.
  if (!travelDate) {
    travelDate = earliestDate(...hotels.map((item) => item.check_in));
  }
  if (!returnDate) {
    returnDate = latestDate(...hotels.map((item) => item.check_out));
  }
  // A period package is for whole months, so it carries no single travel window.
  if (mode === 'period') {
    travelDate = null;
    returnDate = null;
  }
  if (travelDate && returnDate && returnDate < travelDate) {
    throw httpError(400, 'Return date must be on or after travel date');
  }

  let destination = optionalText(input?.destination);
  let origin = optionalText(input?.origin);
  if (!destination && hotels[0]?.city) {
    destination = hotels[0].city;
  }
  if ((quoteType === 'flight' || quoteType === 'package') && !origin) {
    const outbound = flights.find((item) => item.direction !== 'return') || flights[0];
    origin = outbound?.departure_city || outbound?.departure_airport || null;
  }
  if ((quoteType === 'flight' || quoteType === 'package') && !destination) {
    const outbound = flights.find((item) => item.direction !== 'return') || flights[0];
    destination = outbound?.arrival_city || outbound?.arrival_airport || null;
  }

  const currency = optionalText(input?.currency)?.toUpperCase() || items[0]?.currency || 'USD';
  const childrenCount = optionalInteger(input?.children_count) ?? 0;
  const childrenAges = normalizeChildrenAges(input?.children_ages);

  return {
    title,
    quote_type: quoteType,
    destination,
    origin,
    description: optionalText(input?.description),
    cover_image_url: optionalText(input?.cover_image_url),
    currency,
    total_price: optionalNumber(input?.total_price),
    notes: optionalText(input?.notes),
    travel_date: travelDate,
    return_date: returnDate,
    availability_mode: mode,
    available_months: availableMonths,
    // With no dates to count from, a period package's length is the sum of its hotel stays.
    nights:
      mode === 'period'
        ? shortestStayNights(hotels) || optionalInteger(input?.nights)
        : optionalInteger(input?.nights) ?? nightsBetween(travelDate, returnDate),
    adults_count: optionalInteger(input?.adults_count) ?? 2,
    children_count: childrenCount,
    children_ages: childrenCount > 0 ? childrenAges.slice(0, childrenCount) : [],
    items,
  };
}

const ITEM_COLUMNS = `
  item_type, sort_order, title, description, image_url, price, currency,
  hotel_name, city, country, category, board_name, room_name, check_in, check_out, nights,
  airline, flight_number, departure_airport, arrival_airport, departure_city,
  arrival_city, departure_time, arrival_time, duration, stops, direction, extra
`;

function itemValues(quoteId, item) {
  return [
    quoteId,
    item.item_type,
    item.sort_order,
    item.title,
    item.description,
    item.image_url,
    item.price,
    item.currency,
    item.hotel_name,
    item.city,
    item.country,
    item.category,
    item.board_name,
    item.room_name,
    item.check_in,
    item.check_out,
    item.nights,
    item.airline,
    item.flight_number,
    item.departure_airport,
    item.arrival_airport,
    item.departure_city,
    item.arrival_city,
    item.departure_time,
    item.arrival_time,
    item.duration,
    item.stops,
    item.direction,
    JSON.stringify(item.extra || {}),
  ];
}

async function insertItems(client, quoteId, items) {
  const saved = [];
  for (const item of items) {
    const result = await client.query(
      `INSERT INTO predefined_quote_items (quote_id, ${ITEM_COLUMNS})
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
       RETURNING *`,
      itemValues(quoteId, item),
    );
    saved.push(result.rows[0]);
  }
  return saved;
}

async function itemsForQuotes(ids) {
  if (!ids.length) return new Map();
  const result = await query(
    `SELECT * FROM predefined_quote_items
     WHERE quote_id = ANY($1::uuid[])
     ORDER BY sort_order ASC, created_at ASC`,
    [ids],
  );
  const grouped = new Map();
  for (const row of result.rows) {
    const list = grouped.get(row.quote_id) || [];
    list.push(row);
    grouped.set(row.quote_id, list);
  }
  return grouped;
}

export async function listPredefinedQuotes({ query: search = '', limit = 200 } = {}) {
  const term = String(search || '').trim();
  const cap = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const result = term
    ? await query(
        `SELECT * FROM predefined_quotes
         WHERE title ILIKE $1
            OR destination ILIKE $1
            OR origin ILIKE $1
            OR quote_type ILIKE $1
         ORDER BY updated_at DESC
         LIMIT $2`,
        [`%${term}%`, cap],
      )
    : await query(
        `SELECT * FROM predefined_quotes ORDER BY updated_at DESC LIMIT $1`,
        [cap],
      );

  const grouped = await itemsForQuotes(result.rows.map((row) => row.id));
  return result.rows.map((row) => mapQuote(row, grouped.get(row.id) || []));
}

export async function getPredefinedQuote(id) {
  const result = await query(`SELECT * FROM predefined_quotes WHERE id = $1`, [id]);
  const row = result.rows[0];
  if (!row) return null;
  const grouped = await itemsForQuotes([id]);
  return mapQuote(row, grouped.get(id) || []);
}

export async function createPredefinedQuote(input, { adminId, client: providedClient } = {}) {
  const payload = normalizeQuoteInput(input);
  // Pull Google hotel photos before the transaction so SerpApi/Cloudinary
  // latency never holds a DB lock open.
  await enrichPredefinedQuoteImages(payload);
  const client = providedClient || await pool.connect();
  const ownsTransaction = !providedClient;
  try {
    if (ownsTransaction) await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO predefined_quotes (
         title, quote_type, destination, origin, description, cover_image_url,
         currency, total_price, notes, client_name, travel_date, return_date,
         nights, adults_count, children_count, children_ages, created_by,
         availability_mode, available_months
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [
        payload.title,
        payload.quote_type,
        payload.destination,
        payload.origin,
        payload.description,
        payload.cover_image_url,
        payload.currency,
        payload.total_price,
        payload.notes,
        null,
        payload.travel_date,
        payload.return_date,
        payload.nights,
        payload.adults_count,
        payload.children_count,
        payload.children_ages,
        adminId || null,
        payload.availability_mode,
        payload.available_months,
      ],
    );
    const items = await insertItems(client, result.rows[0].id, payload.items);
    if (ownsTransaction) await client.query('COMMIT');
    return mapQuote(result.rows[0], items);
  } catch (error) {
    if (ownsTransaction) await client.query('ROLLBACK');
    throw error;
  } finally {
    if (ownsTransaction) client.release();
  }
}

export async function updatePredefinedQuote(id, input, { client: providedClient } = {}) {
  const existing = await getPredefinedQuote(id);
  if (!existing) return null;

  const payload = normalizeQuoteInput({
    ...existing,
    ...input,
    items: input?.items ?? existing.items,
  });
  await enrichPredefinedQuoteImages(payload);

  const client = providedClient || await pool.connect();
  const ownsTransaction = !providedClient;
  try {
    if (ownsTransaction) await client.query('BEGIN');
    const result = await client.query(
      `UPDATE predefined_quotes
       SET title = $2,
           quote_type = $3,
           destination = $4,
           origin = $5,
           description = $6,
           cover_image_url = $7,
           currency = $8,
           total_price = $9,
           notes = $10,
           client_name = $11,
           travel_date = $12,
           return_date = $13,
           nights = $14,
           adults_count = $15,
           children_count = $16,
           children_ages = $17,
           availability_mode = $18,
           available_months = $19,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        payload.title,
        payload.quote_type,
        payload.destination,
        payload.origin,
        payload.description,
        payload.cover_image_url,
        payload.currency,
        payload.total_price,
        payload.notes,
        null,
        payload.travel_date,
        payload.return_date,
        payload.nights,
        payload.adults_count,
        payload.children_count,
        payload.children_ages,
        payload.availability_mode,
        payload.available_months,
      ],
    );
    await client.query(`DELETE FROM predefined_quote_items WHERE quote_id = $1`, [id]);
    const items = await insertItems(client, id, payload.items);
    if (ownsTransaction) await client.query('COMMIT');
    return mapQuote(result.rows[0], items);
  } catch (error) {
    if (ownsTransaction) await client.query('ROLLBACK');
    throw error;
  } finally {
    if (ownsTransaction) client.release();
  }
}

export async function deletePredefinedQuote(id) {
  const result = await query(`DELETE FROM predefined_quotes WHERE id = $1 RETURNING *`, [id]);
  return result.rows[0] || null;
}
