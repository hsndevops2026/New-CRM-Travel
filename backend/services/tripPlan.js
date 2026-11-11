import { query } from '../config/database.js';
import { logAuditEvent } from './audit.js';

/**
 * The customer's trip program: items the employee chose for one lead. Prices
 * are only stored for items linked to an agency package, and they are copied
 * from the package, never typed in or taken from the AI.
 */

const KINDS = ['activity', 'trip_idea', 'package', 'note'];

function httpErr(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function cleanText(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function cleanDay(value) {
  if (value === null || value === '' || value === undefined) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 60) httpErr(400, 'day_number must be between 1 and 60');
  return n;
}

async function packagePrice(packageId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(packageId || ''))) return null;
  const { rows } = await query(`SELECT id, total_price, currency FROM predefined_quotes WHERE id = $1`, [packageId]);
  return rows[0] || null;
}

export async function listTripPlan(leadId) {
  const { rows } = await query(
    `SELECT id, lead_id, day_number, position, title, details, kind, source, package_id,
            price::float AS price, currency, created_at, updated_at
     FROM trip_plan_items WHERE lead_id = $1
     ORDER BY day_number NULLS LAST, position, created_at`,
    [leadId],
  );
  return rows;
}

export async function addTripPlanItems(leadId, items, { actorId = null } = {}) {
  const list = Array.isArray(items) ? items.slice(0, 20) : [items];
  const { rows: lead } = await query(`SELECT id FROM leads WHERE id = $1`, [leadId]);
  if (!lead[0]) httpErr(404, 'Lead not found');
  const created = [];
  for (const raw of list) {
    const title = cleanText(raw?.title, 160);
    if (!title) httpErr(400, 'title is required');
    const pkg = raw?.source === 'system' ? await packagePrice(raw?.package_id) : null;
    const { rows } = await query(
      `INSERT INTO trip_plan_items (lead_id, day_number, position, title, details, kind, source, package_id, price, currency, created_by)
       VALUES ($1, $2,
               COALESCE((SELECT MAX(position) + 1 FROM trip_plan_items WHERE lead_id = $1), 0),
               $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        leadId,
        cleanDay(raw?.day_number),
        title,
        cleanText(raw?.details, 2000),
        KINDS.includes(raw?.kind) ? raw.kind : 'activity',
        pkg ? 'system' : 'general',
        pkg ? pkg.id : null,
        pkg?.total_price ?? null,
        pkg ? pkg.currency : null,
        actorId,
      ],
    );
    created.push(rows[0].id);
  }
  await logAuditEvent({ entityType: 'lead', entityId: leadId, action: 'trip_plan_items_added', actorId, after: { count: created.length } }).catch(() => {});
  return listTripPlan(leadId);
}

export async function updateTripPlanItem(leadId, itemId, patch = {}, { actorId = null } = {}) {
  const { rows } = await query(`SELECT * FROM trip_plan_items WHERE id = $1 AND lead_id = $2`, [itemId, leadId]);
  const item = rows[0];
  if (!item) httpErr(404, 'Trip program item not found');
  const title = patch.title !== undefined ? cleanText(patch.title, 160) : item.title;
  if (!title) httpErr(400, 'title is required');
  await query(
    `UPDATE trip_plan_items
     SET title = $3, details = $4, day_number = $5, position = $6, updated_at = NOW()
     WHERE id = $1 AND lead_id = $2`,
    [
      itemId,
      leadId,
      title,
      patch.details !== undefined ? cleanText(patch.details, 2000) : item.details,
      patch.day_number !== undefined ? cleanDay(patch.day_number) : item.day_number,
      Number.isInteger(patch.position) ? patch.position : item.position,
    ],
  );
  await logAuditEvent({ entityType: 'lead', entityId: leadId, action: 'trip_plan_item_updated', actorId }).catch(() => {});
  return listTripPlan(leadId);
}

export async function deleteTripPlanItem(leadId, itemId, { actorId = null } = {}) {
  const { rowCount } = await query(`DELETE FROM trip_plan_items WHERE id = $1 AND lead_id = $2`, [itemId, leadId]);
  if (!rowCount) httpErr(404, 'Trip program item not found');
  await logAuditEvent({ entityType: 'lead', entityId: leadId, action: 'trip_plan_item_deleted', actorId }).catch(() => {});
  return listTripPlan(leadId);
}

/** Message the customer receives: grouped by day, Arabic or English. */
export function formatTripPlanMessage(items, { lang = 'ar', customerName = '', destination = '' } = {}) {
  const ar = lang === 'ar';
  const lines = [];
  const hello = customerName ? (ar ? `مرحباً ${customerName}،` : `Hi ${customerName},`) : (ar ? 'مرحباً،' : 'Hi,');
  lines.push(hello);
  lines.push(ar
    ? `هذا برنامج رحلتك المقترح${destination ? ` إلى ${destination}` : ''}:`
    : `Here is your suggested trip program${destination ? ` for ${destination}` : ''}:`);
  const groups = new Map();
  for (const item of items) {
    const key = item.day_number ?? 0;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const keys = [...groups.keys()].sort((a, b) => (a || 999) - (b || 999));
  for (const key of keys) {
    lines.push('');
    lines.push(key ? (ar ? `اليوم ${key}:` : `Day ${key}:`) : (ar ? 'اقتراحات إضافية:' : 'More ideas:'));
    for (const item of groups.get(key)) {
      const price = item.price != null && item.currency ? ` (${Number(item.price).toLocaleString('en-US')} ${item.currency})` : '';
      lines.push(`• ${item.title}${price}`);
      if (item.details) lines.push(`  ${item.details}`);
    }
  }
  lines.push('');
  lines.push(ar
    ? 'المواعيد والتوفر قابلة للتأكيد. أخبرنا بما يعجبك وسنكمل الترتيبات.'
    : 'Times and availability are to be confirmed. Tell us what you like and we will arrange the rest.');
  return lines.join('\n');
}
