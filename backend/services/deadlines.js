/**
 * Dates on a booking that cost money if they pass unnoticed: the last day to cancel a hotel
 * for free, when a held flight ("option") lapses, when a supplier must be paid.
 *
 * Staff add them on the lead; when a customer accepts a quote, hotel items whose terms say
 * "Cancel from 2026-12-05" get a free-cancellation deadline automatically. The minute sweep
 * warns the lead owner 48 hours before, and again once it has passed.
 */

import { query } from '../config/database.js';
import { leadRecipients, notify, safeNotify } from './notifications.js';

export const DEADLINE_KINDS = ['free_cancellation', 'option_expiry', 'supplier_payment', 'ticketing', 'other'];
export const WARN_HOURS = 48;

function httpErr(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cleanDue(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw httpErr(400, 'due_at must be a date and time');
  return date.toISOString();
}

export async function listDeadlines(leadId) {
  const { rows } = await query(
    `SELECT * FROM booking_deadlines WHERE lead_id = $1 ORDER BY status = 'open' DESC, due_at`,
    [leadId],
  );
  return rows;
}

export async function addDeadline(leadId, input = {}, { actorId } = {}) {
  const label = String(input.label ?? '').trim().slice(0, 200);
  if (!label) throw httpErr(400, 'Write what the deadline is for');
  const kind = DEADLINE_KINDS.includes(input.kind) ? input.kind : 'other';
  const { rows } = await query(
    `INSERT INTO booking_deadlines (lead_id, kind, label, supplier, due_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [leadId, kind, label, String(input.supplier ?? '').trim().slice(0, 120) || null, cleanDue(input.due_at), actorId || null],
  );
  return rows[0];
}

export async function updateDeadline(leadId, id, input = {}) {
  const sets = [];
  const params = [];
  const set = (sql, value) => { params.push(value); sets.push(`${sql} = $${params.length}`); };
  if (input.status !== undefined) {
    if (!['open', 'done', 'dismissed'].includes(input.status)) throw httpErr(400, 'status must be open, done or dismissed');
    set('status', input.status);
    sets.push(input.status === 'open' ? 'done_at = NULL' : 'done_at = NOW()');
  }
  if (input.due_at !== undefined) {
    set('due_at', cleanDue(input.due_at));
    sets.push('warned_at = NULL', 'overdue_notified_at = NULL');
  }
  if (input.label !== undefined) {
    const label = String(input.label).trim().slice(0, 200);
    if (!label) throw httpErr(400, 'Write what the deadline is for');
    set('label', label);
  }
  if (!sets.length) throw httpErr(400, 'Nothing to change');
  params.push(id, leadId);
  const { rows } = await query(
    `UPDATE booking_deadlines SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND lead_id = $${params.length} RETURNING *`,
    params,
  );
  if (!rows[0]) throw httpErr(404, 'Deadline not found');
  return rows[0];
}

export async function deleteDeadline(leadId, id) {
  const { rowCount } = await query(`DELETE FROM booking_deadlines WHERE id = $1 AND lead_id = $2`, [id, leadId]);
  if (!rowCount) throw httpErr(404, 'Deadline not found');
}

/**
 * "Cancel from 2026-12-05 (fee 120)" → free cancellation ends at the start of 2026-12-05.
 * Returns null for "Non-refundable", "Free cancellation" and anything without a date.
 */
export function freeCancellationEnd(text) {
  const m = /cancel(?:lation)?\s+(?:fees?\s+)?from\s+(\d{4}-\d{2}-\d{2})/i.exec(String(text ?? ''));
  return m ? `${m[1]}T00:00:00Z` : null;
}

/** Adds free-cancellation deadlines for an accepted quote's hotel items (once per item). */
export async function deadlinesFromSnapshot(leadId, snapshot) {
  const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
  let added = 0;
  for (const item of items) {
    const due = freeCancellationEnd(item?.meta?.cancellation_policy || item?.description);
    if (!due || new Date(due).getTime() <= Date.now()) continue;
    const { rowCount } = await query(
      `INSERT INTO booking_deadlines (lead_id, kind, label, supplier, due_at, source, source_ref)
       VALUES ($1, 'free_cancellation', $2, $3, $4, 'quote', $5)
       ON CONFLICT DO NOTHING`,
      [leadId, `Free cancellation ends: ${item.label || 'hotel'}`.slice(0, 200), item.meta?.supplier || null, due, String(item.source_id || item.id || item.label)],
    );
    added += rowCount;
  }
  return added;
}

/** The minute sweep: warn before, and once after. Each deadline is claimed by the UPDATE. */
export async function notifyDeadlines() {
  const soon = await query(
    `UPDATE booking_deadlines SET warned_at = NOW()
     WHERE status = 'open' AND warned_at IS NULL AND due_at > NOW()
       AND due_at <= NOW() + make_interval(hours => $1)
     RETURNING *`,
    [WARN_HOURS],
  );
  const late = await query(
    `UPDATE booking_deadlines SET overdue_notified_at = NOW()
     WHERE status = 'open' AND overdue_notified_at IS NULL AND due_at <= NOW()
     RETURNING *`,
  );
  for (const [kind, rows] of [['deadline_soon', soon.rows], ['deadline_passed', late.rows]]) {
    for (const d of rows) {
      await safeNotify(async () => notify({
        adminIds: await leadRecipients(d.lead_id, { withAdmins: true }),
        kind,
        leadId: d.lead_id,
        collapse: false,
        data: { deadline_id: d.id, text: d.label, kind: d.kind, due_at: d.due_at, supplier: d.supplier },
      }));
    }
  }
  return { soon: soon.rows.length, passed: late.rows.length };
}

// ── this week's board ────────────────────────────────────────────────────────

/**
 * What happens between `from` and `to` (yyyy-mm-dd, inclusive): booked departures and
 * returns, and open deadlines. Agents see only their own leads.
 */
export async function operationsBoard({ from, to, viewer }) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(String(from)) || !iso.test(String(to))) throw httpErr(400, 'from and to must be dates');
  const isAdmin = viewer?.role === 'admin';
  const scope = isAdmin ? '' : 'AND EXISTS (SELECT 1 FROM user_leads ul WHERE ul.lead_id = l.id AND ul.user_id = $3)';
  const params = isAdmin ? [from, to] : [from, to, viewer?.id];
  const { rows: trips } = await query(
    `SELECT l.id, l.destination, l.travel_date::text AS travel_date, l.return_date::text AS return_date,
            l.adults_count, l.children_count, c.name AS customer
     FROM leads l LEFT JOIN contacts c ON c.phone = l.phone
     WHERE l.lifecycle_status = 'booked'
       AND (l.travel_date BETWEEN $1 AND $2 OR l.return_date BETWEEN $1 AND $2
            OR (l.travel_date < $1 AND l.return_date > $2))
       ${scope}
     ORDER BY l.travel_date`,
    params,
  );
  const { rows: deadlines } = await query(
    `SELECT d.*, l.destination, c.name AS customer
     FROM booking_deadlines d JOIN leads l ON l.id = d.lead_id LEFT JOIN contacts c ON c.phone = l.phone
     WHERE d.status = 'open' AND (d.due_at::date BETWEEN $1 AND $2 OR d.due_at < NOW())
       ${scope}
     ORDER BY d.due_at`,
    params,
  );
  return { from, to, trips, deadlines };
}
