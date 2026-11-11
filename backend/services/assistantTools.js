import { query } from '../config/database.js';

/**
 * Read-only CRM tools for the staff assistant. Every query is scoped to the
 * signed-in user: an agent only ever sees leads assigned to them, an admin sees
 * everything. Nothing here sends a message or changes data.
 */

const LIFECYCLE = [
  'intake', 'sourcing', 'awaiting_dealers', 'comparing', 'drafting',
  'ready_to_send', 'sent', 'accepted', 'booked', 'lost', 'archived',
];

function scope(user, params, alias = 'l') {
  if (user?.role === 'admin') return '';
  params.push(user?.id || null);
  return ` AND EXISTS (SELECT 1 FROM user_leads ul WHERE ul.lead_id = ${alias}.id AND ul.user_id = $${params.length})`;
}

function clampLimit(value, fallback = 10, max = 25) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : fallback;
}

const LEAD_COLUMNS = `
  l.id, COALESCE(c.name, '') AS customer_name, l.phone, l.booking_type, l.origin, l.destination,
  to_char(l.travel_date, 'YYYY-MM-DD') AS travel_date, to_char(l.return_date, 'YYYY-MM-DD') AS return_date,
  l.adults_count, l.children_count, l.lifecycle_status, l.created_at`;

export const assistantToolDefinitions = [
  {
    name: 'search_leads',
    description: 'Find travel leads by customer name, phone or destination, optionally filtered by lifecycle status. Returns the newest first.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Customer name, phone digits or destination to look for' },
        lifecycle_status: { type: 'string', enum: LIFECYCLE },
        limit: { type: 'integer', minimum: 1, maximum: 25 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_lead',
    description: 'Full details of one lead: trip, customer, quote status, open reminders and the latest WhatsApp messages.',
    parameters: {
      type: 'object',
      properties: { lead_id: { type: 'string', description: 'The lead id from search_leads' } },
      required: ['lead_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'pipeline_summary',
    description: 'Number of leads in each lifecycle status, plus leads created in the last 7 days.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_overdue_reminders',
    description: 'Reminders whose time has passed and that are not marked done.',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 25 } },
      additionalProperties: false,
    },
  },
  {
    name: 'list_quotes_waiting_for_customer',
    description: 'Leads whose quote was sent to the customer but the customer has not written back for at least N days.',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'integer', minimum: 0, maximum: 60, description: 'Days without a customer reply (default 2)' },
        limit: { type: 'integer', minimum: 1, maximum: 25 },
      },
      additionalProperties: false,
    },
  },
];

async function searchLeads(user, { text, lifecycle_status, limit } = {}) {
  const params = [];
  let where = 'WHERE 1=1';
  if (text && String(text).trim()) {
    params.push(`%${String(text).trim()}%`);
    where += ` AND (c.name ILIKE $${params.length} OR l.phone ILIKE $${params.length} OR l.destination ILIKE $${params.length})`;
  }
  if (lifecycle_status && LIFECYCLE.includes(lifecycle_status)) {
    params.push(lifecycle_status);
    where += ` AND l.lifecycle_status = $${params.length}`;
  }
  where += scope(user, params);
  params.push(clampLimit(limit));
  const { rows } = await query(
    `SELECT ${LEAD_COLUMNS}
     FROM leads l LEFT JOIN contacts c ON c.phone = l.phone
     ${where}
     ORDER BY l.created_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return { count: rows.length, leads: rows };
}

async function getLead(user, { lead_id } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(String(lead_id || ''))) return { error: 'lead_id must be a lead id from search_leads' };
  const params = [lead_id];
  const { rows } = await query(
    `SELECT ${LEAD_COLUMNS}, l.notes, l.budget, l.hotel_name,
            qd.status AS quote_status, qd.currency AS quote_currency, qd.valid_until AS quote_valid_until
     FROM leads l
     LEFT JOIN contacts c ON c.phone = l.phone
     LEFT JOIN quote_drafts qd ON qd.lead_id = l.id
     WHERE l.id = $1${scope(user, params)}`,
    params,
  );
  const lead = rows[0];
  if (!lead) return { error: 'Lead not found or not assigned to you' };

  const messages = await query(
    `SELECT direction, LEFT(body, 400) AS body, created_at
     FROM messages WHERE lead_id = $1 AND body IS NOT NULL
     ORDER BY created_at DESC LIMIT 12`,
    [lead.id],
  );
  const reminders = await query(
    `SELECT r.text, r.remind_at
     FROM contact_reminders r JOIN contacts c ON c.id = r.contact_id
     WHERE c.phone = $1 AND r.done_at IS NULL
     ORDER BY r.remind_at ASC LIMIT 10`,
    [lead.phone],
  );
  return { lead, latest_messages: messages.rows.reverse(), open_reminders: reminders.rows };
}

async function pipelineSummary(user) {
  const params = [];
  const s = scope(user, params);
  const { rows } = await query(
    `SELECT l.lifecycle_status, COUNT(*)::int AS count,
            COUNT(*) FILTER (WHERE l.created_at > NOW() - INTERVAL '7 days')::int AS new_last_7_days
     FROM leads l WHERE 1=1${s}
     GROUP BY l.lifecycle_status ORDER BY count DESC`,
    params,
  );
  return { by_status: rows, total: rows.reduce((sum, r) => sum + r.count, 0) };
}

async function listOverdueReminders(user, { limit } = {}) {
  const params = [];
  let filter = '';
  if (user?.role !== 'admin') {
    params.push(user?.id || null);
    filter = ` AND EXISTS (
      SELECT 1 FROM leads l JOIN user_leads ul ON ul.lead_id = l.id
      WHERE l.phone = c.phone AND ul.user_id = $${params.length})`;
  }
  params.push(clampLimit(limit));
  const { rows } = await query(
    `SELECT r.text, r.remind_at, c.name AS customer_name, c.phone
     FROM contact_reminders r JOIN contacts c ON c.id = r.contact_id
     WHERE r.done_at IS NULL AND r.remind_at < NOW()${filter}
     ORDER BY r.remind_at ASC LIMIT $${params.length}`,
    params,
  );
  return { count: rows.length, reminders: rows };
}

async function listQuotesWaiting(user, { days, limit } = {}) {
  const d = Number.isFinite(Number(days)) ? Math.max(0, Math.min(60, Number(days))) : 2;
  const params = [d];
  const s = scope(user, params);
  params.push(clampLimit(limit));
  const { rows } = await query(
    `SELECT ${LEAD_COLUMNS},
            (SELECT MAX(m.created_at) FROM messages m WHERE m.lead_id = l.id AND m.direction = 'inbound') AS last_customer_message_at
     FROM leads l LEFT JOIN contacts c ON c.phone = l.phone
     WHERE l.lifecycle_status = 'sent'
       AND COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.lead_id = l.id AND m.direction = 'inbound'), l.created_at)
           < NOW() - ($1::int * INTERVAL '1 day')${s}
     ORDER BY l.created_at ASC LIMIT $${params.length}`,
    params,
  );
  return { days_without_reply: d, count: rows.length, leads: rows };
}

const HANDLERS = {
  search_leads: searchLeads,
  get_lead: getLead,
  pipeline_summary: pipelineSummary,
  list_overdue_reminders: listOverdueReminders,
  list_quotes_waiting_for_customer: listQuotesWaiting,
};

export async function runAssistantTool(name, args, user) {
  const handler = HANDLERS[name];
  if (!handler) return { error: `Unknown tool ${name}` };
  try {
    return await handler(user, args && typeof args === 'object' ? args : {});
  } catch (error) {
    console.error(`[assistant] tool ${name} failed:`, error.message);
    return { error: 'The lookup failed. Try a simpler question.' };
  }
}
