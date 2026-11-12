import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import { addCost, deleteCost, listCosts, profitOf, profitReport, setTarget, supplierScorecard, targetsReport, updateCost } from '../services/businessReports.js';

const tag = String(Date.now()).slice(-7);
const ids = {};
const month = new Date().toISOString().slice(0, 7);
const range = { from: new Date(Date.now() - 86_400_000).toISOString(), to: new Date(Date.now() + 86_400_000).toISOString() };

describe('profit, targets and suppliers', () => {
  before(async () => {
    await pingDb();
    await runMigrations();
    ids.agent = (await query(`INSERT INTO admins (email, password_hash, role, approval_status) VALUES ($1,'x','agent','approved') RETURNING id`, [`br-${tag}@t.local`])).rows[0].id;
    ids.lead = (await query(
      `INSERT INTO leads (phone, destination, travel_date, return_date, nights, source, lifecycle_status)
       VALUES ($1, 'Prague', CURRENT_DATE + 20, CURRENT_DATE + 24, 4, 'web', 'booked') RETURNING id`,
      [`97264${tag}`],
    )).rows[0].id;
    ids.draft = (await query(`INSERT INTO quote_drafts (lead_id, currency) VALUES ($1, 'USD') RETURNING id`, [ids.lead])).rows[0].id;
    await query(
      `INSERT INTO quote_versions (quote_draft_id, lead_id, version_number, snapshot, selling_price, currency, status, created_by, accepted_at)
       VALUES ($1, $2, 1, $3, 2000, 'USD', 'accepted', $4, NOW())`,
      [ids.draft, ids.lead, JSON.stringify({ pricing: { net_total: 1700 } }), ids.agent],
    );
    ids.dealer = (await query(`INSERT INTO dealers (name, phone) VALUES ($1, $2) RETURNING id`, [`Dealer ${tag}`, `97265${tag}`])).rows[0].id;
    const r1 = (await query(`INSERT INTO dealer_requests (lead_id, dealer_id, request_code, status, message_body, sent_at) VALUES ($1, $2, $3, 'sent', 'rfq', NOW() - INTERVAL '2 hours') RETURNING id`, [ids.lead, ids.dealer, `R1${tag}`])).rows[0].id;
    await query(`INSERT INTO dealer_requests (lead_id, dealer_id, request_code, status, message_body, sent_at) VALUES ($1, $2, $3, 'sent', 'rfq', NOW() - INTERVAL '1 hour')`, [ids.lead, ids.dealer, `R2${tag}`]);
    await query(`INSERT INTO dealer_responses (dealer_request_id, raw_text, is_best, created_at) VALUES ($1, 'price 900', TRUE, NOW() - INTERVAL '90 minutes')`, [r1]);
  });

  after(async () => {
    await query(`DELETE FROM leads WHERE id = $1`, [ids.lead]);
    await query(`DELETE FROM dealers WHERE id = $1`, [ids.dealer]);
    await query(`DELETE FROM admins WHERE id = $1`, [ids.agent]);
  });

  it('works out profit without mixing currencies', () => {
    const p = profitOf({ price: 1000, currency: 'USD' }, [{ amount: 600, currency: 'USD' }, { amount: 100, currency: 'EUR' }]);
    assert.deepEqual([p.costs, p.profit, p.margin_pct, p.other_currency], [600, 400, 40, true]);
    assert.equal(profitOf(null, []).profit, null);
  });

  it('records actual costs on a booking', async () => {
    let r = await addCost(ids.lead, { supplier: 'Hotel Golden', description: 'Hotel 4 nights', amount: 1200, currency: 'usd' });
    r = await addCost(ids.lead, { description: 'Flights', amount: 600 });
    assert.equal(r.summary.costs, 1800);
    assert.equal(r.summary.profit, 200);
    r = await updateCost(ids.lead, r.costs[0].id, { paid: true });
    assert.equal(r.costs[0].paid, true);
    await assert.rejects(addCost(ids.lead, { description: 'x', amount: -5 }), { status: 400 });
    const flights = r.costs.find((c) => c.description === 'Flights');
    r = await deleteCost(ids.lead, flights.id);
    assert.equal((await listCosts(ids.lead)).summary.costs, 1200);
  });

  it('the profit report uses actual costs when recorded', async () => {
    const report = await profitReport(range);
    const row = report.bookings.find((b) => b.id === ids.lead);
    assert.equal(row.cost_source, 'actual');
    assert.equal(row.profit, 800);
    assert.ok(report.totals.some((t) => t.currency === 'USD'));
  });

  it('targets show progress and commission on profit', async () => {
    await setTarget({ adminId: ids.agent, month, target_amount: 10000, currency: 'USD', commission_pct: 10 });
    const mine = await targetsReport({ month, viewer: { id: ids.agent, role: 'agent' } });
    assert.equal(mine.people.length, 1, 'an agent sees only their own');
    const me = mine.people[0];
    assert.deepEqual([me.sales, me.profit, me.progress_pct, me.commission], [2000, 800, 20, 80]);
    await assert.rejects(setTarget({ adminId: ids.agent, month: 'soon', target_amount: 1 }), { status: 400 });
    await assert.rejects(setTarget({ adminId: ids.agent, month, target_amount: 1, commission_pct: 150 }), { status: 400 });
  });

  it('scores suppliers on answers, speed and picks', async () => {
    const row = (await supplierScorecard(range)).find((s) => s.id === ids.dealer);
    assert.deepEqual([row.requests, row.answered, row.answer_rate, row.median_minutes, row.picked, row.picked_and_booked], [2, 1, 50, 30, 1, 1]);
  });
});
