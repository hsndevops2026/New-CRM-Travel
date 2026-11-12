/**
 * Who is travelling on a booking, as written in their passports, and whether the
 * passports are good for the trip.
 *
 * Staff edit the list on the lead. The customer can fill it in through a private link
 * (14 days, reusable until the trip) instead of sending passport photos on WhatsApp.
 */

import crypto from 'crypto';
import { pool, query } from '../config/database.js';
import { leadRecipients, notify, safeNotify } from './notifications.js';
import { resolveFrontendBaseUrl } from './quoteDelivery.js';
import { sendTextMessage } from './wasender.js';
import { saveMessage } from './messages.js';
import { customerLanguage } from './customerLanguage.js';

const MAX_TRAVELLERS = 20;
const LINK_DAYS = 14;
/** Many countries ask for a passport valid six months past the end of the trip. */
export const PASSPORT_MARGIN_MONTHS = 6;

function httpErr(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function cleanDate(value, field) {
  if (value == null || value === '') return null;
  const text = String(value).slice(0, 10);
  if (!ISO.test(text) || Number.isNaN(new Date(`${text}T12:00:00Z`).getTime())) throw httpErr(400, `${field} must be a date`);
  return text;
}

function cleanText(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

export function normalizeTraveller(input = {}, index = 0) {
  const fullName = cleanText(input.full_name, 120);
  if (!fullName) throw httpErr(400, `Traveller ${index + 1}: the name is required`);
  return {
    full_name: fullName,
    is_child: Boolean(input.is_child),
    date_of_birth: cleanDate(input.date_of_birth, 'date_of_birth'),
    nationality: cleanText(input.nationality, 60),
    passport_number: cleanText(input.passport_number, 30)?.toUpperCase() || null,
    passport_expiry: cleanDate(input.passport_expiry, 'passport_expiry'),
  };
}

function addMonths(day, months) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function dayOf(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/**
 * Problems to fix before the trip, per traveller:
 *   expired / expires_during_trip / under_six_months / missing_passport / missing_birth_date
 */
export function passportIssues(traveller, { travelDate, returnDate } = {}) {
  const issues = [];
  const expiry = dayOf(traveller.passport_expiry);
  const start = dayOf(travelDate);
  const end = dayOf(returnDate) || start;
  if (!traveller.passport_number || !expiry) issues.push('missing_passport');
  if (!traveller.date_of_birth) issues.push('missing_birth_date');
  if (expiry && start) {
    if (expiry < start) issues.push('expired');
    else if (end && expiry <= end) issues.push('expires_during_trip');
    else if (end && expiry < addMonths(end, PASSPORT_MARGIN_MONTHS)) issues.push('under_six_months');
  }
  return issues;
}

async function leadDates(leadId) {
  const { rows } = await query(
    `SELECT id, phone, destination, travel_date::text AS travel_date, return_date::text AS return_date,
            adults_count, children_count
     FROM leads WHERE id = $1`,
    [leadId],
  );
  return rows[0] || null;
}

function withIssues(rows, lead) {
  return rows.map((t) => ({
    ...t,
    date_of_birth: dayOf(t.date_of_birth),
    passport_expiry: dayOf(t.passport_expiry),
    issues: passportIssues(t, { travelDate: lead?.travel_date, returnDate: lead?.return_date }),
  }));
}

export async function listTravellers(leadId) {
  const lead = await leadDates(leadId);
  if (!lead) throw httpErr(404, 'Lead not found');
  const { rows } = await query(
    `SELECT id, position, full_name, is_child, date_of_birth::text AS date_of_birth, nationality,
            passport_number, passport_expiry::text AS passport_expiry, updated_at
     FROM lead_travellers WHERE lead_id = $1 ORDER BY position, created_at`,
    [leadId],
  );
  const { rows: links } = await query(
    `SELECT token, expires_at, submitted_at FROM lead_traveller_links
     WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [leadId],
  );
  return {
    travellers: withIssues(rows, lead),
    expected: { adults: Number(lead.adults_count) || 0, children: Number(lead.children_count) || 0 },
    trip: { travel_date: lead.travel_date, return_date: lead.return_date },
    link: links[0] ? { url: travellerFormUrl(links[0].token), expires_at: links[0].expires_at, submitted_at: links[0].submitted_at } : null,
  };
}

/** Replaces the whole list (the form always sends every traveller). */
export async function saveTravellers(leadId, list) {
  if (!Array.isArray(list)) throw httpErr(400, 'travellers must be a list');
  if (list.length > MAX_TRAVELLERS) throw httpErr(400, `At most ${MAX_TRAVELLERS} travellers`);
  const clean = list.map(normalizeTraveller);
  if (!(await leadDates(leadId))) throw httpErr(404, 'Lead not found');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Keep each traveller's row (and its visa progress) when the list is saved again:
    // rows sent with their id are updated, new ones inserted, missing ones removed.
    const { rows: existing } = await client.query(`SELECT id FROM lead_travellers WHERE lead_id = $1`, [leadId]);
    const known = new Set(existing.map((r) => r.id));
    const kept = new Set();
    for (const [i, t] of clean.entries()) {
      const id = list[i]?.id && known.has(list[i].id) ? list[i].id : null;
      if (id) {
        kept.add(id);
        await client.query(
          `UPDATE lead_travellers SET position = $2, full_name = $3, is_child = $4, date_of_birth = $5, nationality = $6,
                  passport_number = $7, passport_expiry = $8, updated_at = NOW()
           WHERE id = $1`,
          [id, i, t.full_name, t.is_child, t.date_of_birth, t.nationality, t.passport_number, t.passport_expiry],
        );
      } else {
        await client.query(
          `INSERT INTO lead_travellers (lead_id, position, full_name, is_child, date_of_birth, nationality, passport_number, passport_expiry)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [leadId, i, t.full_name, t.is_child, t.date_of_birth, t.nationality, t.passport_number, t.passport_expiry],
        );
      }
    }
    const gone = [...known].filter((id) => !kept.has(id));
    if (gone.length) await client.query(`DELETE FROM lead_travellers WHERE id = ANY($1::uuid[])`, [gone]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return listTravellers(leadId);
}

// ── customer link ────────────────────────────────────────────────────────────

export function travellerFormUrl(token) {
  return `${resolveFrontendBaseUrl()}/travellers/${token}`;
}

export async function createTravellerLink(leadId, { actorId } = {}) {
  if (!(await leadDates(leadId))) throw httpErr(404, 'Lead not found');
  const token = crypto.randomBytes(24).toString('base64url');
  await query(
    `INSERT INTO lead_traveller_links (token, lead_id, created_by, expires_at)
     VALUES ($1, $2, $3, NOW() + make_interval(days => $4))`,
    [token, leadId, actorId || null, LINK_DAYS],
  );
  return { token, url: travellerFormUrl(token) };
}

async function resolveLink(token) {
  if (!token || String(token).length < 20) return null;
  const { rows } = await query(
    `SELECT * FROM lead_traveller_links WHERE token = $1 AND expires_at > NOW()`,
    [String(token)],
  );
  return rows[0] || null;
}

/** What the customer's form shows: the trip and the travellers so far. */
export async function getTravellerForm(token) {
  const link = await resolveLink(token);
  if (!link) throw httpErr(404, 'This link has expired. Please ask us for a new one.');
  const data = await listTravellers(link.lead_id);
  const lead = await leadDates(link.lead_id);
  return {
    destination: lead.destination,
    trip: data.trip,
    expected: data.expected,
    travellers: data.travellers.map(({ issues, updated_at, ...t }) => t),
    submitted_at: link.submitted_at,
  };
}

export async function submitTravellerForm(token, list) {
  const link = await resolveLink(token);
  if (!link) throw httpErr(404, 'This link has expired. Please ask us for a new one.');
  const result = await saveTravellers(link.lead_id, list);
  await query(`UPDATE lead_traveller_links SET submitted_at = NOW() WHERE token = $1`, [link.token]);
  const problems = result.travellers.filter((t) => t.issues.some((i) => i !== 'missing_birth_date')).length;
  await safeNotify(async () => notify({
    adminIds: await leadRecipients(link.lead_id, { withAdmins: true }),
    kind: 'travellers_submitted',
    leadId: link.lead_id,
    collapse: true,
    data: { count: result.travellers.length, problems },
  }));
  return { saved: result.travellers.length, problems };
}

/** WhatsApp the form link to the customer. */
export async function sendTravellerLink(leadId, { actorId, send = sendTextMessage } = {}) {
  const lead = await leadDates(leadId);
  if (!lead) throw httpErr(404, 'Lead not found');
  if (!lead.phone) throw httpErr(400, 'This lead has no phone number');
  const lang = await customerLanguage(lead.phone);
  const created = await createTravellerLink(leadId, { actorId });
  const url = lang === 'en' ? `${created.url}?lang=en` : created.url;
  const text = lang === 'en'
    ? `Hi, to finish your booking${lead.destination ? ` to ${lead.destination}` : ''}, please fill in each traveller's details exactly as in the passport:\n${url}`
    : `مرحباً، لإكمال حجزك${lead.destination ? ` إلى ${lead.destination}` : ''}، نرجو تعبئة بيانات كل مسافر كما هي في جواز السفر:\n${url}`;
  await send(lead.phone, text);
  await saveMessage({
    leadId,
    direction: 'outbound',
    channel: 'whatsapp',
    toNumber: lead.phone,
    body: text,
    status: 'sent',
    raw: { kind: 'traveller_form', actor_id: actorId || null },
  });
  return { url };
}

// ── travelling now ───────────────────────────────────────────────────────────

/** A booked trip that is happening today for this phone, if any. */
export async function currentTripForPhone(phone, today = new Date().toISOString().slice(0, 10)) {
  const { rows } = await query(
    `SELECT id, destination FROM leads
     WHERE phone = $1 AND lifecycle_status = 'booked'
       AND travel_date <= $2::date AND COALESCE(return_date, travel_date) >= $2::date
     ORDER BY travel_date DESC LIMIT 1`,
    [phone, today],
  );
  return rows[0] || null;
}

/** A customer who is abroad right now wrote to us: tell the lead owner straight away. */
export async function flagTravellerMessage(phone, text) {
  const trip = await currentTripForPhone(phone);
  if (!trip) return false;
  await notify({
    adminIds: await leadRecipients(trip.id, { withAdmins: true }),
    kind: 'traveller_message',
    leadId: trip.id,
    data: { destination: trip.destination, preview: String(text || '').slice(0, 140), phone },
  });
  return true;
}
