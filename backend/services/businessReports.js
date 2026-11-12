/**
 * Money and people:
 *  - actual costs per booking (what suppliers were really paid) and the real profit,
 *  - monthly targets and commission per employee,
 *  - a scorecard for each supplier (dealer): how often and how fast they answer, and how
 *    often their price was the one we used.
 *
 * Amounts are never added across currencies: totals are per currency.
 */

import { query } from '../config/database.js';

function httpErr(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const CURRENCY = /^[A-Z]{3}$/;
const round = (n) => Math.round(Number(n) * 100) / 100;

// ── actual costs ─────────────────────────────────────────────────────────────

/** The accepted price of a booking (latest accepted version), or null. */
async function soldPrice(leadId) {
  const { rows } = await query(
    `SELECT selling_price::float AS price, currency, created_by FROM quote_versions
     WHERE lead_id = $1 AND status = 'accepted' ORDER BY accepted_at DESC LIMIT 1`,
    [leadId],
  );
  return rows[0] || null;
}

export function profitOf(sold, costs) {
  if (!sold) return { price: null, currency: null, costs: 0, profit: null, margin_pct: null, other_currency: costs.length > 0 };
  const same = costs.filter((c) => c.currency === sold.currency);
  const total = round(same.reduce((sum, c) => sum + Number(c.amount), 0));
  const profit = round(sold.price - total);
  return {
    price: sold.price,
    currency: sold.currency,
    costs: total,
    profit,
    margin_pct: sold.price > 0 ? round((profit / sold.price) * 100) : null,
    other_currency: same.length !== costs.length,
  };
}

export async function listCosts(leadId) {
  const { rows } = await query(
    `SELECT id, supplier, description, amount::float AS amount, currency, paid, created_at
     FROM booking_costs WHERE lead_id = $1 ORDER BY created_at`,
    [leadId],
  );
  return { costs: rows, summary: profitOf(await soldPrice(leadId), rows) };
}

export async function addCost(leadId, input = {}, { actorId } = {}) {
  const description = String(input.description ?? '').trim().slice(0, 200);
  if (!description) throw httpErr(400, 'Write what the cost is for');
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < 0) throw httpErr(400, 'The amount must be a positive number');
  const currency = String(input.currency || 'USD').toUpperCase();
  if (!CURRENCY.test(currency)) throw httpErr(400, 'currency must be a 3-letter code');
  await query(
    `INSERT INTO booking_costs (lead_id, supplier, description, amount, currency, paid, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [leadId, String(input.supplier ?? '').trim().slice(0, 120) || null, description, round(amount), currency, Boolean(input.paid), actorId || null],
  );
  return listCosts(leadId);
}

export async function updateCost(leadId, id, input = {}) {
  if (input.paid === undefined) throw httpErr(400, 'Nothing to change');
  const { rowCount } = await query(`UPDATE booking_costs SET paid = $3 WHERE id = $1 AND lead_id = $2`, [id, leadId, Boolean(input.paid)]);
  if (!rowCount) throw httpErr(404, 'Cost not found');
  return listCosts(leadId);
}

export async function deleteCost(leadId, id) {
  const { rowCount } = await query(`DELETE FROM booking_costs WHERE id = $1 AND lead_id = $2`, [id, leadId]);
  if (!rowCount) throw httpErr(404, 'Cost not found');
  return listCosts(leadId);
}

/**
 * Booked trips accepted between from and to: price, recorded costs, profit, and who made
 * the quote. Quoted cost (from the snapshot) is shown too, so bookings with no recorded
 * costs still have an estimate.
 */
export async function profitReport({ from, to }) {
  const { rows } = await query(
    `SELECT l.id, l.destination, l.travel_date::text AS travel_date, c.name AS customer,
            v.selling_price::float AS price, v.currency, v.accepted_at,
            (v.snapshot->'pricing'->>'net_total')::float AS quoted_cost,
            a.email AS employee, v.created_by AS employee_id,
            COALESCE((SELECT SUM(bc.amount) FROM booking_costs bc WHERE bc.lead_id = l.id AND bc.currency = v.currency), 0)::float AS costs,
            (SELECT COUNT(*) FROM booking_costs bc WHERE bc.lead_id = l.id)::int AS cost_lines,
            EXISTS (SELECT 1 FROM booking_costs bc WHERE bc.lead_id = l.id AND bc.currency <> v.currency) AS other_currency
     FROM quote_versions v
     JOIN leads l ON l.id = v.lead_id
     LEFT JOIN contacts c ON c.phone = l.phone
     LEFT JOIN admins a ON a.id = v.created_by
     WHERE v.status = 'accepted' AND v.accepted_at >= $1 AND v.accepted_at < $2
       AND COALESCE(l.lifecycle_status, '') NOT IN ('lost', 'archived')
       AND NOT EXISTS (SELECT 1 FROM quote_versions later
                       WHERE later.lead_id = v.lead_id AND later.status = 'accepted' AND later.accepted_at > v.accepted_at)
     ORDER BY v.accepted_at DESC`,
    [from, to],
  );
  const bookings = rows.map((r) => {
    const recorded = r.cost_lines > 0;
    const cost = recorded ? r.costs : Number(r.quoted_cost || 0);
    const profit = round(r.price - cost);
    return { ...r, cost, cost_source: recorded ? 'actual' : 'quoted', profit, margin_pct: r.price > 0 ? round((profit / r.price) * 100) : null };
  });
  const totals = new Map();
  for (const b of bookings) {
    const t = totals.get(b.currency) || { currency: b.currency, sales: 0, cost: 0, profit: 0, bookings: 0 };
    t.sales = round(t.sales + b.price);
    t.cost = round(t.cost + b.cost);
    t.profit = round(t.profit + b.profit);
    t.bookings += 1;
    totals.set(b.currency, t);
  }
  return { bookings, totals: [...totals.values()] };
}

// ── targets and commission ───────────────────────────────────────────────────

export function monthStart(value) {
  const m = /^(\d{4})-(\d{2})/.exec(String(value ?? ''));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw httpErr(400, 'month must look like 2026-12');
  return `${m[1]}-${m[2]}-01`;
}

const nextMonth = (start) => {
  const d = new Date(`${start}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
};

export async function setTarget({ adminId, month, target_amount, currency = 'USD', commission_pct = 0 }) {
  const start = monthStart(month);
  const target = Number(target_amount);
  const pct = Number(commission_pct);
  const cur = String(currency).toUpperCase();
  if (!Number.isFinite(target) || target < 0) throw httpErr(400, 'The target must be a positive amount');
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw httpErr(400, 'Commission must be 0-100%');
  if (!CURRENCY.test(cur)) throw httpErr(400, 'currency must be a 3-letter code');
  await query(
    `INSERT INTO staff_targets (admin_id, month, target_amount, currency, commission_pct, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (admin_id, month) DO UPDATE
       SET target_amount = EXCLUDED.target_amount, currency = EXCLUDED.currency,
           commission_pct = EXCLUDED.commission_pct, updated_at = NOW()`,
    [adminId, start, round(target), cur, round(pct)],
  );
}

/**
 * Each employee's month: sales and profit from quotes they made that were accepted that
 * month (in the target's currency), progress to target, and commission = % × profit.
 */
export async function targetsReport({ month, viewer }) {
  const start = monthStart(month);
  const end = nextMonth(start);
  const report = await profitReport({ from: start, to: end });
  const { rows: staff } = await query(
    `SELECT a.id, a.email, a.role, t.target_amount::float AS target_amount, t.currency, t.commission_pct::float AS commission_pct
     FROM admins a LEFT JOIN staff_targets t ON t.admin_id = a.id AND t.month = $1
     WHERE COALESCE(a.approval_status, 'approved') = 'approved' AND a.role IN ('admin', 'agent')
       ${viewer?.role === 'admin' ? '' : 'AND a.id = $2'}
     ORDER BY a.email`,
    viewer?.role === 'admin' ? [start] : [start, viewer?.id],
  );
  const people = staff.map((p) => {
    const currency = p.currency || 'USD';
    const mine = report.bookings.filter((b) => b.employee_id === p.id && b.currency === currency);
    const sales = round(mine.reduce((s, b) => s + b.price, 0));
    const profit = round(mine.reduce((s, b) => s + b.profit, 0));
    const pct = Number(p.commission_pct || 0);
    return {
      id: p.id,
      email: p.email,
      role: p.role,
      currency,
      target_amount: p.target_amount ?? null,
      commission_pct: pct,
      bookings: mine.length,
      sales,
      profit,
      progress_pct: p.target_amount ? Math.min(999, round((sales / p.target_amount) * 100)) : null,
      commission: round((Math.max(0, profit) * pct) / 100),
      other_currency_bookings: report.bookings.filter((b) => b.employee_id === p.id && b.currency !== currency).length,
    };
  });
  return { month: start.slice(0, 7), people };
}

// ── supplier scorecard ───────────────────────────────────────────────────────

/** Per dealer over the period: requests, answers, answer rate, typical answer time, picks. */
export async function supplierScorecard({ from, to }) {
  const { rows } = await query(
    `WITH req AS (
       SELECT r.id, r.dealer_id, r.lead_id, COALESCE(r.sent_at, r.created_at) AS sent_at,
              (SELECT MIN(x.created_at) FROM dealer_responses x WHERE x.dealer_request_id = r.id) AS first_answer,
              EXISTS (SELECT 1 FROM dealer_responses x WHERE x.dealer_request_id = r.id AND (x.is_best OR x.best_confirmed_at IS NOT NULL)) AS picked,
              EXISTS (SELECT 1 FROM leads l WHERE l.id = r.lead_id AND l.lifecycle_status = 'booked') AS booked
       FROM dealer_requests r
       WHERE COALESCE(r.sent_at, r.created_at) >= $1 AND COALESCE(r.sent_at, r.created_at) < $2
     )
     SELECT d.id, d.name, d.company,
            COUNT(req.id)::int AS requests,
            COUNT(req.first_answer)::int AS answered,
            ROUND(100.0 * COUNT(req.first_answer) / NULLIF(COUNT(req.id), 0), 1)::float AS answer_rate,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (req.first_answer - req.sent_at)) / 60.0))::numeric, 0)::float AS median_minutes,
            COUNT(*) FILTER (WHERE req.picked)::int AS picked,
            COUNT(*) FILTER (WHERE req.picked AND req.booked)::int AS picked_and_booked
     FROM dealers d
     JOIN req ON req.dealer_id = d.id
     GROUP BY d.id, d.name, d.company
     ORDER BY picked DESC, answer_rate DESC NULLS LAST, requests DESC`,
    [from, to],
  );
  return rows;
}
