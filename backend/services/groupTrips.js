/**
 * Group trips (Umrah, organised tours, school trips): a set number of seats, the bookings
 * that fill them, everyone's passport details in one list, and who shares which room.
 *
 * A booking (lead) joins a group with leads.group_trip_id. Seats used are the adults and
 * children on those bookings that aren't lost or archived.
 */

import { query } from '../config/database.js';

function httpErr(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const cleanDay = (v, f) => {
  if (v === null || v === '' || v === undefined) return null;
  const text = String(v).slice(0, 10);
  if (!ISO.test(text)) throw httpErr(400, `${f} must be a date`);
  return text;
};

function cleanGroup(input = {}, partial = false) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k);
  if (!partial || has('title')) {
    const title = String(input.title ?? '').trim().slice(0, 160);
    if (!title) throw httpErr(400, 'title is required');
    out.title = title;
  }
  if (has('destination')) out.destination = String(input.destination ?? '').trim().slice(0, 120) || null;
  if (has('travel_date')) out.travel_date = cleanDay(input.travel_date, 'travel_date');
  if (has('return_date')) out.return_date = cleanDay(input.return_date, 'return_date');
  if (!partial || has('seats_total')) {
    const seats = Number(input.seats_total ?? 0);
    if (!Number.isInteger(seats) || seats < 0 || seats > 2000) throw httpErr(400, 'seats_total must be 0-2000');
    out.seats_total = seats;
  }
  if (has('price_per_person')) {
    const price = input.price_per_person === '' || input.price_per_person == null ? null : Number(input.price_per_person);
    if (price != null && (!Number.isFinite(price) || price < 0)) throw httpErr(400, 'price_per_person must be a positive number');
    out.price_per_person = price;
  }
  if (has('currency')) out.currency = /^[A-Z]{3}$/.test(String(input.currency || '').toUpperCase()) ? String(input.currency).toUpperCase() : 'USD';
  if (has('notes')) out.notes = String(input.notes ?? '').trim().slice(0, 4000) || null;
  if (has('status')) {
    if (!['open', 'closed', 'cancelled'].includes(input.status)) throw httpErr(400, 'status must be open, closed or cancelled');
    out.status = input.status;
  }
  return out;
}

const SEATS_USED = `COALESCE((SELECT SUM(COALESCE(l.adults_count, 0) + COALESCE(l.children_count, 0))
  FROM leads l WHERE l.group_trip_id = g.id AND COALESCE(l.lifecycle_status, '') NOT IN ('lost', 'archived')), 0)::int`;

export async function listGroupTrips({ includeClosed = false } = {}) {
  const { rows } = await query(
    `SELECT g.*, g.travel_date::text AS travel_date, g.return_date::text AS return_date,
            ${SEATS_USED} AS seats_used,
            (SELECT COUNT(*) FROM leads l WHERE l.group_trip_id = g.id)::int AS bookings
     FROM group_trips g
     ${includeClosed ? '' : "WHERE g.status = 'open'"}
     ORDER BY g.travel_date NULLS LAST, g.created_at DESC`,
  );
  return rows;
}

export async function createGroupTrip(input, { actorId } = {}) {
  const g = cleanGroup(input);
  const cols = Object.keys(g);
  const { rows } = await query(
    `INSERT INTO group_trips (${cols.join(', ')}, created_by) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${cols.length + 1}) RETURNING id`,
    [...cols.map((c) => g[c]), actorId || null],
  );
  return getGroupTrip(rows[0].id);
}

export async function updateGroupTrip(id, input) {
  const g = cleanGroup(input, true);
  const cols = Object.keys(g);
  if (!cols.length) throw httpErr(400, 'Nothing to change');
  const { rowCount } = await query(
    `UPDATE group_trips SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = NOW() WHERE id = $1`,
    [id, ...cols.map((c) => g[c])],
  );
  if (!rowCount) throw httpErr(404, 'Group trip not found');
  return getGroupTrip(id);
}

/** The group, its bookings, and every traveller on them. */
export async function getGroupTrip(id) {
  const { rows } = await query(
    `SELECT g.*, g.travel_date::text AS travel_date, g.return_date::text AS return_date, ${SEATS_USED} AS seats_used
     FROM group_trips g WHERE g.id = $1`,
    [id],
  );
  const group = rows[0];
  if (!group) throw httpErr(404, 'Group trip not found');
  const { rows: bookings } = await query(
    `SELECT l.id, l.phone, l.adults_count, l.children_count, l.lifecycle_status, l.group_room, c.name AS customer
     FROM leads l LEFT JOIN contacts c ON c.phone = l.phone
     WHERE l.group_trip_id = $1 ORDER BY l.created_at`,
    [id],
  );
  const { rows: travellers } = await query(
    `SELECT t.id, t.lead_id, t.full_name, t.is_child, t.date_of_birth::text AS date_of_birth, t.nationality,
            t.passport_number, t.passport_expiry::text AS passport_expiry, t.visa_status
     FROM lead_travellers t JOIN leads l ON l.id = t.lead_id
     WHERE l.group_trip_id = $1 ORDER BY l.group_room NULLS LAST, l.created_at, t.position`,
    [id],
  );
  return { ...group, seats_left: Math.max(0, group.seats_total - group.seats_used), bookings, travellers };
}

/** Put a booking in a group (or take it out with groupId null). Refuses to overbook. */
export async function setLeadGroup(leadId, groupId, { room } = {}) {
  if (groupId) {
    const group = await getGroupTrip(groupId);
    if (group.status !== 'open') throw httpErr(409, 'This group trip is not open');
    const { rows } = await query(
      `SELECT group_trip_id, COALESCE(adults_count, 0) + COALESCE(children_count, 0) AS seats FROM leads WHERE id = $1`,
      [leadId],
    );
    if (!rows[0]) throw httpErr(404, 'Lead not found');
    const already = rows[0].group_trip_id === groupId;
    if (!already && group.seats_total && group.seats_used + Number(rows[0].seats) > group.seats_total) {
      throw httpErr(409, `Only ${group.seats_left} seat(s) left in this group`);
    }
  }
  const { rowCount } = await query(
    `UPDATE leads SET group_trip_id = $2, group_room = CASE WHEN $2::uuid IS NULL THEN NULL ELSE COALESCE($3, group_room) END WHERE id = $1`,
    [leadId, groupId || null, room === undefined ? null : String(room).trim().slice(0, 60) || null],
  );
  if (!rowCount) throw httpErr(404, 'Lead not found');
  return { lead_id: leadId, group_trip_id: groupId || null };
}

export async function setLeadRoom(groupId, leadId, room) {
  const { rowCount } = await query(
    `UPDATE leads SET group_room = $3 WHERE id = $2 AND group_trip_id = $1`,
    [groupId, leadId, String(room ?? '').trim().slice(0, 60) || null],
  );
  if (!rowCount) throw httpErr(404, 'Booking not in this group');
}

const csvCell = (v) => {
  const text = v == null ? '' : String(v);
  // Leading = + - @ would be read as a formula by Excel.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Rooming list for the hotel / passenger list for the airline, as CSV (Excel-friendly). */
export async function roomingListCsv(groupId) {
  const group = await getGroupTrip(groupId);
  const roomOf = new Map(group.bookings.map((b) => [b.id, b.group_room || b.customer || b.phone]));
  const header = ['Room', 'Full name', 'Child', 'Date of birth', 'Nationality', 'Passport', 'Passport expiry', 'Visa'];
  const lines = [header, ...group.travellers.map((t) => [
    roomOf.get(t.lead_id), t.full_name, t.is_child ? 'yes' : '', t.date_of_birth, t.nationality, t.passport_number, t.passport_expiry, t.visa_status,
  ])];
  return `﻿${lines.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
