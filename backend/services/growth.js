/**
 * Bringing customers in and back:
 *  - a public offers page built from the packages staff mark as public,
 *  - "I want this offer" from that page creates a lead,
 *  - past customers to contact by travel month or destination, one message at a time,
 *  - a customer's travel history for the contact profile.
 */

import { query } from '../config/database.js';
import { createLead } from './leads.js';
import { normalizeContactPhone, upsertContact } from './contacts.js';
import { notifyNewLead, safeNotify } from './notifications.js';
import { getAgencySettings, publicAgencySettings } from './agencySettings.js';
import { displayTotal } from './predefinedQuotes.js';
import { sendTextMessage } from './wasender.js';
import { saveMessage } from './messages.js';
import { resolveFrontendBaseUrl } from './quoteDelivery.js';

function httpErr(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── public offers ────────────────────────────────────────────────────────────

/** What a visitor may see of a package. No client names, notes or item costs. */
export function publicOffer(row) {
  return {
    id: row.id,
    title: row.title,
    quote_type: row.quote_type,
    destination: row.destination,
    origin: row.origin,
    description: row.description,
    cover_image_url: row.cover_image_url,
    currency: row.currency,
    price: displayTotal({ total_price: row.total_price, items: row.items || [] }),
    nights: row.nights == null ? null : Number(row.nights),
    travel_date: row.travel_date ? String(row.travel_date instanceof Date ? row.travel_date.toISOString() : row.travel_date).slice(0, 10) : null,
    availability_mode: row.availability_mode === 'period' ? 'period' : 'fixed',
    available_months: Array.isArray(row.available_months) ? row.available_months.map(Number) : [],
  };
}

export async function listPublicOffers() {
  const { rows } = await query(
    `SELECT pq.*, COALESCE(
       (SELECT json_agg(json_build_object('price', i.price)) FROM predefined_quote_items i WHERE i.quote_id = pq.id), '[]'
     ) AS items
     FROM predefined_quotes pq
     WHERE pq.is_public
       AND (pq.availability_mode = 'period' OR pq.travel_date IS NULL OR pq.travel_date >= CURRENT_DATE)
     ORDER BY pq.updated_at DESC
     LIMIT 60`,
  );
  return { offers: rows.map(publicOffer), agency: publicAgencySettings(await getAgencySettings()) };
}

export async function setOfferPublic(id, isPublic) {
  if (!UUID.test(String(id))) throw httpErr(404, 'Package not found');
  const { rows } = await query(
    `UPDATE predefined_quotes SET is_public = $2 WHERE id = $1 RETURNING id, is_public`,
    [id, Boolean(isPublic)],
  );
  if (!rows[0]) throw httpErr(404, 'Package not found');
  return rows[0];
}

/** A visitor asked for an offer: becomes a web lead with the package attached. */
export async function requestOffer(id, input = {}) {
  if (!UUID.test(String(id))) throw httpErr(404, 'Offer not found');
  const name = String(input.name ?? '').trim().slice(0, 120);
  const phone = normalizeContactPhone(input.phone);
  if (!name) throw httpErr(400, 'Please write your name');
  if (phone.length < 9 || phone.length > 15) throw httpErr(400, 'Please write a valid phone number with the country code');
  const adults = Math.min(Math.max(Number.parseInt(input.adults, 10) || 2, 1), 20);
  const children = Math.min(Math.max(Number.parseInt(input.children, 10) || 0, 0), 20);
  const travelDate = /^\d{4}-\d{2}-\d{2}$/.test(String(input.travel_date || '')) ? String(input.travel_date) : null;
  const notes = String(input.notes ?? '').trim().slice(0, 500) || null;

  const { rows } = await query(`SELECT * FROM predefined_quotes WHERE id = $1 AND is_public`, [id]);
  const offer = rows[0];
  if (!offer) throw httpErr(404, 'Offer not found');

  // The same person asking twice for the same offer in a day is one request.
  const { rows: recent } = await query(
    `SELECT id FROM leads WHERE phone = $1 AND predefined_quote_id = $2 AND created_at > NOW() - INTERVAL '24 hours' LIMIT 1`,
    [phone, id],
  );
  if (recent[0]) return { lead_id: recent[0].id, duplicate: true };

  const fixedDate = offer.travel_date ? String(offer.travel_date instanceof Date ? offer.travel_date.toISOString() : offer.travel_date).slice(0, 10) : null;
  const date = travelDate || fixedDate;
  if (!date) throw httpErr(400, 'Please choose when you would like to travel');
  const nights = Number(offer.nights) > 0 ? Number(offer.nights) : 7;
  const back = new Date(`${date}T12:00:00Z`);
  back.setUTCDate(back.getUTCDate() + nights);

  await upsertContact({ phone, name });
  const lead = await createLead({
    phone,
    collected: {
      booking_type: offer.quote_type === 'flight' ? 'flight' : offer.quote_type === 'hotel' ? 'hotel' : 'package',
      destination: offer.destination,
      origin: offer.origin,
      travel_date: date,
      return_date: back.toISOString().slice(0, 10),
      nights,
      adults_count: adults,
      children_count: children,
      notes: [`Asked for the offer "${offer.title}" on the website.`, notes].filter(Boolean).join(' '),
    },
    summary: `Website offer request: ${offer.title}`,
    source: 'web',
    skipQuoteFetch: true,
    predefinedQuoteId: id,
  });
  void safeNotify(() => notifyNewLead(lead.id));
  return { lead_id: lead.id, duplicate: false };
}

export function offersPageUrl(offerId) {
  return `${resolveFrontendBaseUrl()}/offers${offerId ? `#${offerId}` : ''}`;
}

// ── past customers ───────────────────────────────────────────────────────────

/**
 * Customers who travelled with us before, matching a month (any earlier year) and/or a
 * destination. Leaves out anyone with a request open in the last 60 days, and says when we
 * last sent them an offer.
 */
export async function listPastCustomers({ month, destination } = {}) {
  const m = Number(month);
  const monthFilter = Number.isInteger(m) && m >= 1 && m <= 12 ? m : null;
  const dest = String(destination ?? '').trim().slice(0, 80);
  const { rows } = await query(
    `WITH trips AS (
       SELECT regexp_replace(l.phone, '\\D', '', 'g') AS phone, l.id, l.destination, l.travel_date
       FROM leads l
       WHERE l.lifecycle_status = 'booked' AND l.travel_date < CURRENT_DATE
     ),
     matching AS (
       SELECT phone FROM trips
       WHERE ($1::int IS NULL OR EXTRACT(MONTH FROM travel_date) = $1)
         AND ($2 = '' OR destination ILIKE '%' || $2 || '%')
       GROUP BY phone
     )
     SELECT c.id AS contact_id, c.name, m.phone,
            COUNT(t.id)::int AS trips,
            (ARRAY_AGG(t.destination ORDER BY t.travel_date DESC))[1] AS last_destination,
            MAX(t.travel_date)::text AS last_travel_date,
            (SELECT MAX(o.created_at) FROM customer_outreach o WHERE o.phone = m.phone) AS last_offer_at
     FROM matching m
     JOIN trips t ON t.phone = m.phone
     LEFT JOIN contacts c ON c.phone = m.phone
     WHERE NOT EXISTS (
       SELECT 1 FROM leads open
       WHERE regexp_replace(open.phone, '\\D', '', 'g') = m.phone
         AND open.created_at > NOW() - INTERVAL '60 days'
         AND COALESCE(open.lifecycle_status, 'intake') NOT IN ('booked', 'lost', 'archived')
     )
     GROUP BY c.id, c.name, m.phone
     ORDER BY MAX(t.travel_date) DESC
     LIMIT 300`,
    [monthFilter, dest],
  );
  return rows;
}

/** One offer message to one past customer, written (or approved) by staff. */
export async function sendOfferToCustomer({ phone, text, offerId, actorId, send = sendTextMessage }) {
  const to = normalizeContactPhone(phone);
  const body = String(text ?? '').trim();
  if (!to) throw httpErr(400, 'phone is required');
  if (!body) throw httpErr(400, 'Write the message first');
  if (body.length > 1500) throw httpErr(400, 'The message is too long');
  // A customer gets at most one offer a week, however many staff press send.
  const { rows: recent } = await query(
    `SELECT 1 FROM customer_outreach WHERE phone = $1 AND created_at > NOW() - INTERVAL '7 days' LIMIT 1`,
    [to],
  );
  if (recent.length) throw httpErr(409, 'This customer already got an offer this week');
  await send(to, body);
  await query(
    `INSERT INTO customer_outreach (phone, kind, offer_id, body, sent_by) VALUES ($1, 'seasonal_offer', $2, $3, $4)`,
    [to, UUID.test(String(offerId || '')) ? offerId : null, body, actorId || null],
  );
  await saveMessage({
    direction: 'outbound',
    channel: 'whatsapp',
    toNumber: to,
    body,
    status: 'sent',
    raw: { kind: 'seasonal_offer', actor_id: actorId || null },
  });
  return { sent: true };
}

// ── travel history ───────────────────────────────────────────────────────────

/** Booked trips for a phone, with the accepted price, newest first, plus totals per currency. */
export async function travelHistory(phone) {
  const digits = normalizeContactPhone(phone);
  if (!digits) return { trips: [], totals: [] };
  const { rows } = await query(
    `SELECT l.id, l.destination, l.travel_date::text AS travel_date, l.return_date::text AS return_date,
            l.adults_count, l.children_count, v.selling_price::float AS price, v.currency
     FROM leads l
     LEFT JOIN LATERAL (
       SELECT selling_price, currency FROM quote_versions
       WHERE lead_id = l.id AND status = 'accepted' ORDER BY accepted_at DESC LIMIT 1
     ) v ON TRUE
     WHERE regexp_replace(l.phone, '\\D', '', 'g') = $1 AND l.lifecycle_status = 'booked'
     ORDER BY l.travel_date DESC NULLS LAST`,
    [digits],
  );
  const totals = new Map();
  for (const trip of rows) {
    if (trip.price == null) continue;
    const key = trip.currency || 'USD';
    totals.set(key, (totals.get(key) || 0) + Number(trip.price));
  }
  return {
    trips: rows,
    totals: [...totals.entries()].map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 })),
  };
}
