import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, pool, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import { employeeReport, overdueReport, parseRange, pipelineReport } from '../services/reports.js';

// Everything is seeded inside January 2020 so other tests' data never falls in the range.
const range = { from: '2020-01-01T00:00:00.000Z', to: '2020-02-01T00:00:00.000Z' };
const tag = String(Date.now()).slice(-7);
const ids = { admins: [], leads: [], contacts: [] };
let agentA;
let agentB;

async function lead(phone, status, createdAt, source = 'whatsapp') {
  const { rows } = await query(
    `INSERT INTO leads (phone, destination, travel_date, return_date, nights, lifecycle_status, source, created_at)
     VALUES ($1, 'Istanbul', '2020-03-01', '2020-03-05', 4, $2, $3, $4) RETURNING id`,
    [phone, status, source, createdAt],
  );
  ids.leads.push(rows[0].id);
  return rows[0].id;
}

async function msg(leadId, direction, at, actorId = null, body = 'hi') {
  await query(
    `INSERT INTO messages (lead_id, direction, channel, body, status, raw, created_at)
     VALUES ($1, $2, 'whatsapp', $3, 'sent', $4, $5)`,
    [leadId, direction, body, actorId ? { actor_id: actorId } : {}, at],
  );
}

async function quote(leadId, by, createdAt, { acceptedAt = null, price = null, sentAt = null } = {}) {
  const draft = (await query(
    `INSERT INTO quote_drafts (lead_id) VALUES ($1) ON CONFLICT (lead_id) DO UPDATE SET lead_id = EXCLUDED.lead_id RETURNING id`,
    [leadId],
  )).rows[0].id;
  const v = (await query(
    `INSERT INTO quote_versions (quote_draft_id, lead_id, version_number, snapshot, selling_price, currency, status, accepted_at, created_by, created_at)
     VALUES ($1, $2, 1, '{}'::jsonb, $3, 'USD', $4, $5, $6, $7) RETURNING id`,
    [draft, leadId, price, acceptedAt ? 'accepted' : 'sent', acceptedAt, by, createdAt],
  )).rows[0].id;
  if (sentAt) {
    await query(
      `INSERT INTO quote_deliveries (quote_version_id, channel, recipient, status, sent_at) VALUES ($1, 'whatsapp', '972500000000', 'sent', $2)`,
      [v, sentAt],
    );
  }
}

describe('management reports', () => {
  before(async () => {
    await pingDb();
    await runMigrations();
    for (const name of ['a', 'b']) {
      const { rows } = await query(
        `INSERT INTO admins (email, password_hash, role, approval_status) VALUES ($1, 'x', 'agent', 'approved') RETURNING id`,
        [`report-${name}-${tag}@test.local`],
      );
      ids.admins.push(rows[0].id);
    }
    [agentA, agentB] = ids.admins;

    const p = (n) => `97250${tag}${n}`;
    const l1 = await lead(p(1), 'booked', '2020-01-05T10:00:00Z');
    const l2 = await lead(p(2), 'accepted', '2020-01-06T10:00:00Z', 'web');
    const l3 = await lead(p(3), 'sent', '2020-01-07T10:00:00Z');
    const l4 = await lead(p(4), 'intake', '2020-01-08T10:00:00Z');
    await lead(p(5), 'intake', '2019-12-20T10:00:00Z'); // outside the range
    for (const [l, who] of [[l1, agentA], [l2, agentA], [l3, agentB], [l4, agentB]]) {
      await query(`INSERT INTO user_leads (user_id, lead_id, created_at) VALUES ($1, $2, '2020-01-09T00:00:00Z')`, [who, l]);
    }

    // Agent A answers lead 1 after 30 minutes and lead 2 after 90: average 60.
    await msg(l1, 'inbound', '2020-01-05T10:00:00Z');
    await msg(l1, 'outbound', '2020-01-05T10:30:00Z', agentA);
    await msg(l2, 'inbound', '2020-01-06T10:00:00Z');
    await msg(l2, 'outbound', '2020-01-06T11:30:00Z', agentA);
    // Lead 4: customer wrote last and nobody answered (unanswered, but recent activity is old).
    await msg(l4, 'inbound', '2020-01-08T10:00:00Z', null, 'any news?');

    await quote(l1, agentA, '2020-01-10T00:00:00Z', { acceptedAt: '2020-01-12T00:00:00Z', price: 2000, sentAt: '2020-01-10T00:00:00Z' });
    await quote(l2, agentA, '2020-01-11T00:00:00Z', { acceptedAt: '2020-01-13T00:00:00Z', price: 1500, sentAt: '2020-01-11T00:00:00Z' });
    await quote(l3, agentB, '2020-01-14T00:00:00Z', { sentAt: '2020-01-14T00:00:00Z' });
  });

  after(async () => {
    await query(`DELETE FROM leads WHERE id = ANY($1::uuid[])`, [ids.leads]);
    await query(`DELETE FROM admins WHERE id = ANY($1::uuid[])`, [ids.admins]);
    await pool.end();
  });

  it('validates the range', () => {
    assert.throws(() => parseRange({ from: '2020-02-01', to: '2020-01-01' }), /Invalid/);
    assert.throws(() => parseRange({ from: '2018-01-01', to: '2020-01-01' }), /400 days/);
    const r = parseRange({}, new Date('2020-01-31T00:00:00Z'));
    assert.equal(r.from, '2020-01-01T00:00:00.000Z');
  });

  it('counts the pipeline for leads created in the range', async () => {
    const r = await pipelineReport(range);
    assert.equal(r.new_leads, 4);
    assert.deepEqual(r.funnel.map((f) => [f.stage, f.count, f.rate]), [
      ['new', 4, 100], ['sent', 3, 75], ['accepted', 2, 50], ['booked', 1, 25],
    ]);
    assert.deepEqual(r.by_source, [{ source: 'whatsapp', count: 3 }, { source: 'web', count: 1 }]);
    assert.equal(r.quotes_sent, 3);
    assert.equal(r.quotes_accepted, 2);
    assert.deepEqual(r.accepted_value, [{ currency: 'USD', total: 3500, count: 2 }]);
  });

  it('measures each employee', async () => {
    const r = await employeeReport(range);
    const a = r.employees.find((e) => e.id === agentA);
    const b = r.employees.find((e) => e.id === agentB);
    assert.deepEqual(
      [a.leads_assigned, a.quotes_sent, a.quotes_accepted, a.accepted_value, a.customer_replies, a.avg_first_reply_minutes, a.first_reply_samples],
      [2, 2, 2, 3500, 2, 60, 2],
    );
    assert.deepEqual([b.leads_assigned, b.quotes_sent, b.quotes_accepted, b.avg_first_reply_minutes], [2, 1, 0, null]);
    assert.equal(b.open_leads, 2);
  });

  it('lists what is overdue', async () => {
    const r = await overdueReport({ now: new Date('2020-01-20T00:00:00Z') });
    const leadIds = (rows) => rows.map((x) => x.lead_id);
    assert.ok(leadIds(r.unanswered_customers).includes(ids.leads[3]), 'lead 4 waits for a reply');
    assert.ok(!leadIds(r.unanswered_customers).includes(ids.leads[0]), 'lead 1 was answered');
    assert.ok(leadIds(r.quotes_without_reply).includes(ids.leads[2]), 'lead 3 quote has no customer reply');
    assert.ok(leadIds(r.stalled_requests).includes(ids.leads[3]), 'lead 4 stalled in intake');
    const row = r.unanswered_customers.find((x) => x.lead_id === ids.leads[3]);
    assert.match(row.assigned_to, /report-b-/);
    assert.equal(row.last_message, 'any news?');
  });
});
