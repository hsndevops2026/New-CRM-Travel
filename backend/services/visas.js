/**
 * Visa progress for each traveller on a booking, and what each destination asks for.
 *
 * Status: unknown → not_needed | needed → documents (collecting) → applied → approved | rejected.
 * The minute sweep warns the lead owner once when a trip is 14 days away and someone's visa
 * is still not approved (or was rejected).
 */

import { query } from '../config/database.js';
import { leadRecipients, notify, safeNotify } from './notifications.js';

export const VISA_STATUSES = ['unknown', 'not_needed', 'needed', 'documents', 'applied', 'approved', 'rejected'];
const DONE = new Set(['not_needed', 'approved']);
export const VISA_ALERT_DAYS = 14;

function httpErr(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function destinationKey(destination) {
  return String(destination ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

const day = (v) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);
function cleanDay(value, field) {
  if (value === null || value === '' || value === undefined) return null;
  const text = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw httpErr(400, `${field} must be a date`);
  return text;
}

export async function getVisaRule(destination) {
  const key = destinationKey(destination);
  if (!key) return null;
  const { rows } = await query(`SELECT * FROM visa_rules WHERE destination_key = $1`, [key]);
  return rows[0] || null;
}

export async function listVisaRules() {
  const { rows } = await query(`SELECT * FROM visa_rules ORDER BY destination`);
  return rows;
}

export async function saveVisaRule(input = {}, { actorId } = {}) {
  const destination = String(input.destination ?? '').trim().slice(0, 80);
  if (!destination) throw httpErr(400, 'destination is required');
  const days = input.processing_days === '' || input.processing_days == null ? null : Number(input.processing_days);
  if (days != null && (!Number.isInteger(days) || days < 0 || days > 365)) throw httpErr(400, 'processing_days must be 0-365');
  const { rows } = await query(
    `INSERT INTO visa_rules (destination_key, destination, requires_visa, documents, processing_days, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (destination_key) DO UPDATE
       SET destination = EXCLUDED.destination, requires_visa = EXCLUDED.requires_visa, documents = EXCLUDED.documents,
           processing_days = EXCLUDED.processing_days, updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING *`,
    [destinationKey(destination), destination, input.requires_visa !== false, String(input.documents ?? '').trim().slice(0, 3000) || null, days, actorId || null],
  );
  return rows[0];
}

/** Travellers with their visa progress, plus the destination's rule. */
export async function listVisas(leadId) {
  const { rows: lead } = await query(`SELECT destination, travel_date::text AS travel_date FROM leads WHERE id = $1`, [leadId]);
  if (!lead[0]) throw httpErr(404, 'Lead not found');
  const { rows } = await query(
    `SELECT id, full_name, is_child, nationality, visa_status, visa_notes,
            visa_applied_at::text AS visa_applied_at, visa_expected_at::text AS visa_expected_at
     FROM lead_travellers WHERE lead_id = $1 ORDER BY position, created_at`,
    [leadId],
  );
  return { destination: lead[0].destination, travel_date: lead[0].travel_date, rule: await getVisaRule(lead[0].destination), travellers: rows };
}

export async function updateVisa(leadId, travellerId, input = {}) {
  const sets = [];
  const params = [];
  const set = (sql, value) => { params.push(value); sets.push(`${sql} = $${params.length}`); };
  if (input.visa_status !== undefined) {
    if (!VISA_STATUSES.includes(input.visa_status)) throw httpErr(400, 'Unknown visa status');
    set('visa_status', input.visa_status);
    sets.push('visa_alerted_at = NULL');
    if (input.visa_status === 'applied' && input.visa_applied_at === undefined) sets.push('visa_applied_at = COALESCE(visa_applied_at, CURRENT_DATE)');
  }
  if (input.visa_notes !== undefined) set('visa_notes', String(input.visa_notes ?? '').trim().slice(0, 1000) || null);
  if (input.visa_applied_at !== undefined) set('visa_applied_at', cleanDay(input.visa_applied_at, 'visa_applied_at'));
  if (input.visa_expected_at !== undefined) set('visa_expected_at', cleanDay(input.visa_expected_at, 'visa_expected_at'));
  if (!sets.length) throw httpErr(400, 'Nothing to change');
  params.push(travellerId, leadId);
  const { rows } = await query(
    `UPDATE lead_travellers SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $${params.length - 1} AND lead_id = $${params.length}
     RETURNING id, full_name, visa_status, visa_notes, visa_applied_at::text AS visa_applied_at, visa_expected_at::text AS visa_expected_at`,
    params,
  );
  if (!rows[0]) throw httpErr(404, 'Traveller not found');
  return rows[0];
}

/** Booked trips within 14 days where a traveller's visa is not sorted: one alert per traveller. */
export async function notifyVisaRisks() {
  const { rows } = await query(
    `UPDATE lead_travellers t SET visa_alerted_at = NOW()
     FROM leads l
     WHERE l.id = t.lead_id AND l.lifecycle_status = 'booked'
       AND l.travel_date BETWEEN CURRENT_DATE AND CURRENT_DATE + make_interval(days => $1)
       AND t.visa_status IN ('needed', 'documents', 'applied', 'rejected')
       AND t.visa_alerted_at IS NULL
     RETURNING t.id, t.lead_id, t.full_name, t.visa_status, l.destination, l.travel_date::text AS travel_date`,
    [VISA_ALERT_DAYS],
  );
  for (const t of rows) {
    await safeNotify(async () => notify({
      adminIds: await leadRecipients(t.lead_id, { withAdmins: true }),
      kind: 'visa_pending',
      leadId: t.lead_id,
      collapse: true,
      data: { traveller: t.full_name, status: t.visa_status, destination: t.destination, travel_date: t.travel_date },
    }));
  }
  return rows.length;
}

export const visaDone = (status) => DONE.has(status);
export { day as visaDay };
