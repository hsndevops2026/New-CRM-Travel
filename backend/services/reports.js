import { query } from '../config/database.js';

/**
 * Management reports. Every number comes straight from the database; nothing is
 * estimated. Ranges are [from, to). Admin only (enforced by the route).
 */

const DAY = 86_400_000;

export function parseRange({ from, to } = {}, now = new Date()) {
  const end = to ? new Date(to) : now;
  const start = from ? new Date(from) : new Date(end.getTime() - 30 * DAY);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    const error = new Error('Invalid date range');
    error.status = 400;
    throw error;
  }
  if (end.getTime() - start.getTime() > 400 * DAY) {
    const error = new Error('Date range is limited to 400 days');
    error.status = 400;
    throw error;
  }
  return { from: start.toISOString(), to: end.toISOString() };
}

const SENT_OR_LATER = ['sent', 'accepted', 'booked'];
const ACCEPTED_OR_LATER = ['accepted', 'booked'];

export async function pipelineReport(range) {
  const { from, to } = range;
  const [created, sources, current, quotes, value] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS new_leads,
              COUNT(*) FILTER (WHERE lifecycle_status = ANY($3))::int AS reached_sent,
              COUNT(*) FILTER (WHERE lifecycle_status = ANY($4))::int AS reached_accepted,
              COUNT(*) FILTER (WHERE lifecycle_status = 'booked')::int AS booked,
              COUNT(*) FILTER (WHERE lifecycle_status = 'lost')::int AS lost
       FROM leads WHERE created_at >= $1 AND created_at < $2`,
      [from, to, SENT_OR_LATER, ACCEPTED_OR_LATER],
    ),
    query(
      `SELECT COALESCE(source, 'unknown') AS source, COUNT(*)::int AS count
       FROM leads WHERE created_at >= $1 AND created_at < $2
       GROUP BY 1 ORDER BY 2 DESC`,
      [from, to],
    ),
    query(
      `SELECT lifecycle_status AS status, COUNT(*)::int AS count
       FROM leads GROUP BY 1 ORDER BY 2 DESC`,
    ),
    query(
      `SELECT
         (SELECT COUNT(DISTINCT quote_version_id)::int FROM quote_deliveries
           WHERE sent_at >= $1 AND sent_at < $2 AND status IN ('sent', 'delivered')) AS quotes_sent,
         (SELECT COUNT(*)::int FROM quote_versions WHERE accepted_at >= $1 AND accepted_at < $2) AS quotes_accepted`,
      [from, to],
    ),
    query(
      `SELECT COALESCE(currency, 'USD') AS currency, ROUND(SUM(selling_price)::numeric, 2)::float AS total, COUNT(*)::int AS count
       FROM quote_versions
       WHERE accepted_at >= $1 AND accepted_at < $2 AND selling_price IS NOT NULL
       GROUP BY 1 ORDER BY 2 DESC`,
      [from, to],
    ),
  ]);
  const c = created.rows[0];
  const rate = (part) => (c.new_leads ? Math.round((part / c.new_leads) * 1000) / 10 : null);
  return {
    range,
    new_leads: c.new_leads,
    funnel: [
      { stage: 'new', count: c.new_leads, rate: c.new_leads ? 100 : null },
      { stage: 'sent', count: c.reached_sent, rate: rate(c.reached_sent) },
      { stage: 'accepted', count: c.reached_accepted, rate: rate(c.reached_accepted) },
      { stage: 'booked', count: c.booked, rate: rate(c.booked) },
    ],
    lost: c.lost,
    by_source: sources.rows,
    current_pipeline: current.rows,
    quotes_sent: quotes.rows[0].quotes_sent,
    quotes_accepted: quotes.rows[0].quotes_accepted,
    accepted_value: value.rows,
  };
}

export async function employeeReport(range) {
  const { from, to } = range;
  const { rows } = await query(
    `WITH staff AS (
       SELECT id, email, role FROM admins
       WHERE role IN ('admin', 'agent') AND COALESCE(approval_status, 'approved') = 'approved'
     ),
     assigned AS (
       SELECT user_id, COUNT(*)::int AS n FROM user_leads
       WHERE created_at >= $1 AND created_at < $2 GROUP BY 1
     ),
     open_leads AS (
       SELECT ul.user_id, COUNT(*)::int AS n FROM user_leads ul JOIN leads l ON l.id = ul.lead_id
       WHERE l.lifecycle_status NOT IN ('booked', 'lost', 'archived') GROUP BY 1
     ),
     sent AS (
       -- Versions that actually reached the customer, not every locked draft.
       SELECT qv.created_by AS user_id, COUNT(DISTINCT qv.id)::int AS n
       FROM quote_deliveries d JOIN quote_versions qv ON qv.id = d.quote_version_id
       WHERE d.sent_at >= $1 AND d.sent_at < $2 AND d.status IN ('sent', 'delivered')
         AND qv.created_by IS NOT NULL GROUP BY 1
     ),
     accepted AS (
       SELECT created_by AS user_id, COUNT(*)::int AS n,
              ROUND(SUM(selling_price)::numeric, 2)::float AS value
       FROM quote_versions
       WHERE accepted_at >= $1 AND accepted_at < $2 AND created_by IS NOT NULL GROUP BY 1
     ),
     replies AS (
       SELECT (raw->>'actor_id')::uuid AS user_id, COUNT(*)::int AS n FROM messages
       WHERE direction = 'outbound' AND created_at >= $1 AND created_at < $2
         AND raw->>'actor_id' ~ '^[0-9a-f-]{36}$'
       GROUP BY 1
     ),
     first_reply AS (
       -- For each lead assigned to the employee and created in the range: minutes
       -- from the customer's first message to the employee's first reply.
       SELECT ul.user_id,
              AVG(EXTRACT(EPOCH FROM (fr.first_out - fi.first_in)) / 60)::float AS minutes,
              COUNT(*)::int AS samples
       FROM user_leads ul
       JOIN leads l ON l.id = ul.lead_id AND l.created_at >= $1 AND l.created_at < $2
       JOIN LATERAL (
         SELECT MIN(created_at) AS first_in FROM messages
         WHERE lead_id = l.id AND direction = 'inbound'
       ) fi ON fi.first_in IS NOT NULL
       JOIN LATERAL (
         SELECT MIN(created_at) AS first_out FROM messages
         WHERE lead_id = l.id AND direction = 'outbound' AND raw->>'actor_id' = ul.user_id::text
           AND created_at >= fi.first_in
       ) fr ON fr.first_out IS NOT NULL
       GROUP BY 1
     )
     SELECT s.id, s.email, s.role,
            COALESCE(a.n, 0) AS leads_assigned,
            COALESCE(o.n, 0) AS open_leads,
            COALESCE(se.n, 0) AS quotes_sent,
            COALESCE(ac.n, 0) AS quotes_accepted,
            ac.value AS accepted_value,
            COALESCE(r.n, 0) AS customer_replies,
            CASE WHEN fr.minutes IS NULL THEN NULL ELSE ROUND(fr.minutes::numeric, 1)::float END AS avg_first_reply_minutes,
            COALESCE(fr.samples, 0) AS first_reply_samples
     FROM staff s
     LEFT JOIN assigned a ON a.user_id = s.id
     LEFT JOIN open_leads o ON o.user_id = s.id
     LEFT JOIN sent se ON se.user_id = s.id
     LEFT JOIN accepted ac ON ac.user_id = s.id
     LEFT JOIN replies r ON r.user_id = s.id
     LEFT JOIN first_reply fr ON fr.user_id = s.id
     ORDER BY quotes_accepted DESC, quotes_sent DESC, leads_assigned DESC, s.email`,
    [from, to],
  );
  return { range, employees: rows };
}

export const OVERDUE_DEFAULTS = { replyHours: 2, quoteDays: 2, staleDays: 3 };

export async function overdueReport({ now = new Date(), replyHours = 2, quoteDays = 2, staleDays = 3 } = {}) {
  const nowIso = now.toISOString();
  const assignedTo = `(SELECT string_agg(a.email, ', ' ORDER BY a.email) FROM user_leads ul JOIN admins a ON a.id = ul.user_id WHERE ul.lead_id = l.id)`;
  const [reminders, unanswered, quotes, stale] = await Promise.all([
    query(
      `SELECT r.id, r.text, r.remind_at, c.name AS customer_name, c.phone, c.id AS contact_id
       FROM contact_reminders r JOIN contacts c ON c.id = r.contact_id
       WHERE r.done_at IS NULL AND r.remind_at < $1
       ORDER BY r.remind_at ASC LIMIT 100`,
      [nowIso],
    ),
    query(
      `SELECT l.id AS lead_id, COALESCE(c.name, '') AS customer_name, l.phone, l.destination,
              last.created_at AS waiting_since, LEFT(last.body, 160) AS last_message, ${assignedTo} AS assigned_to
       FROM leads l
       LEFT JOIN contacts c ON c.phone = l.phone
       JOIN LATERAL (
         SELECT direction, body, created_at FROM messages
         WHERE lead_id = l.id ORDER BY created_at DESC LIMIT 1
       ) last ON last.direction = 'inbound'
       WHERE l.lifecycle_status NOT IN ('booked', 'lost', 'archived')
         AND last.created_at < $1::timestamptz - ($2::int * INTERVAL '1 hour')
       ORDER BY last.created_at ASC LIMIT 100`,
      [nowIso, replyHours],
    ),
    query(
      `SELECT l.id AS lead_id, COALESCE(c.name, '') AS customer_name, l.phone, l.destination,
              qv.sent_at, ${assignedTo} AS assigned_to
       FROM leads l
       LEFT JOIN contacts c ON c.phone = l.phone
       JOIN LATERAL (
         SELECT MAX(d.sent_at) AS sent_at FROM quote_deliveries d
         JOIN quote_versions v ON v.id = d.quote_version_id
         WHERE v.lead_id = l.id AND d.sent_at IS NOT NULL
       ) qv ON qv.sent_at IS NOT NULL
       WHERE l.lifecycle_status = 'sent'
         AND qv.sent_at < $1::timestamptz - ($2::int * INTERVAL '1 day')
         AND NOT EXISTS (
           SELECT 1 FROM messages m WHERE m.lead_id = l.id AND m.direction = 'inbound' AND m.created_at > qv.sent_at
         )
       ORDER BY qv.sent_at ASC LIMIT 100`,
      [nowIso, quoteDays],
    ),
    query(
      `SELECT l.id AS lead_id, COALESCE(c.name, '') AS customer_name, l.phone, l.destination, l.lifecycle_status,
              COALESCE(act.last_at, l.created_at) AS last_activity, ${assignedTo} AS assigned_to
       FROM leads l
       LEFT JOIN contacts c ON c.phone = l.phone
       LEFT JOIN LATERAL (SELECT MAX(created_at) AS last_at FROM messages WHERE lead_id = l.id) act ON TRUE
       WHERE l.lifecycle_status IN ('intake', 'sourcing', 'awaiting_dealers', 'comparing', 'drafting', 'ready_to_send')
         AND COALESCE(act.last_at, l.created_at) < $1::timestamptz - ($2::int * INTERVAL '1 day')
       ORDER BY last_activity ASC LIMIT 100`,
      [nowIso, staleDays],
    ),
  ]);
  return {
    generated_at: nowIso,
    thresholds: { reply_hours: replyHours, quote_days: quoteDays, stale_days: staleDays },
    overdue_reminders: reminders.rows,
    unanswered_customers: unanswered.rows,
    quotes_without_reply: quotes.rows,
    stalled_requests: stale.rows,
  };
}
