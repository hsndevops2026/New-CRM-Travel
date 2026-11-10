import './support/isolatedRedis.js';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, pool, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import { createAdmin } from '../services/admins.js';
import { createLead } from '../services/leads.js';
import { getNavCounts } from '../services/navCounts.js';

const tag = crypto.randomBytes(3).toString('hex');
const noThreads = async () => ({ threads: [] });

describe('getNavCounts', () => {
  const leadIds = [];
  const adminIds = [];
  let admin;
  let agent;

  async function lead(stage, suffix) {
    const created = await createLead({
      phone: `99966${tag}${suffix}`,
      collected: {
        booking_type: 'hotel', destination: 'Test City', travel_date: '2027-05-01',
        return_date: '2027-05-04', adults_count: 2, children_count: 0, children_ages: [],
      },
      summary: 'nav counts test', status: 'new', source: 'crm', skipQuoteFetch: true,
    });
    leadIds.push(created.id);
    await query(`UPDATE leads SET lifecycle_status = $2 WHERE id = $1`, [created.id, stage]);
    return created;
  }

  before(async () => {
    await pingDb();
    await runMigrations();
    admin = await createAdmin({
      email: `nav-admin-${tag}@example.test`, password: `Pw-${tag}-abc123`, role: 'admin', approvalStatus: 'approved',
    });
    agent = await createAdmin({
      email: `nav-agent-${tag}@example.test`, password: `Pw-${tag}-abc123`, role: 'agent', approvalStatus: 'approved',
    });
    adminIds.push(admin.id, agent.id);
  });

  after(async () => {
    await query(`DELETE FROM user_leads WHERE lead_id = ANY($1::uuid[])`, [leadIds]);
    await query(`DELETE FROM leads WHERE id = ANY($1::uuid[])`, [leadIds]);
    await query(`DELETE FROM admins WHERE id = ANY($1::uuid[])`, [adminIds]);
    await pool.end();
  });

  it('counts leads that are still being worked, not finished ones', async () => {
    const before = (await getNavCounts(admin, { listThreadsFn: noThreads })).leads_open;
    await lead('intake', '1');
    await lead('comparing', '2');
    await lead('sent', '3');
    await lead('lost', '4');
    await lead('archived', '5');
    await lead('booked', '6');

    const after = (await getNavCounts(admin, { listThreadsFn: noThreads })).leads_open;
    assert.equal(after - before, 3, 'intake, comparing and sent count; lost, archived and booked do not');
  });

  it('counts only conversations that are waiting for us (last message from the customer)', async () => {
    const threads = [
      { last_direction: 'inbound' },
      { last_direction: 'inbound' },
      { last_direction: 'outbound' },
      { last_direction: null },
    ];
    const counts = await getNavCounts(admin, { listThreadsFn: async () => ({ threads }) });
    assert.equal(counts.inbox_awaiting, 2);
  });

  it('asks only for customer conversations', async () => {
    let seen;
    await getNavCounts(admin, { listThreadsFn: async (args) => { seen = args; return { threads: [] }; } });
    assert.equal(seen.kind, 'customer');
    assert.equal(seen.userId, null);
  });

  it('shows pending staff approvals to admins only', async () => {
    const before = (await getNavCounts(admin, { listThreadsFn: noThreads })).approvals_pending;
    const pending = await createAdmin({
      email: `nav-pending-${tag}@example.test`, password: `Pw-${tag}-abc123`, role: 'agent', approvalStatus: 'pending',
    });
    adminIds.push(pending.id);

    const asAdmin = await getNavCounts(admin, { listThreadsFn: noThreads });
    assert.equal(asAdmin.approvals_pending - before, 1);

    const asAgent = await getNavCounts(agent, { listThreadsFn: noThreads });
    assert.equal(asAgent.approvals_pending, null, 'agents never see the approvals count');
  });

  it('limits an agent to their own leads and conversations', async () => {
    const mine = await lead('comparing', '8');
    await lead('comparing', '9'); // someone else's
    await query(`INSERT INTO user_leads (user_id, lead_id) VALUES ($1, $2)`, [agent.id, mine.id]);

    let seen;
    const counts = await getNavCounts(agent, {
      listThreadsFn: async (args) => { seen = args; return { threads: [] }; },
    });

    assert.equal(counts.leads_open, 1, 'only the lead assigned to this agent');
    assert.equal(seen.userId, agent.id, 'conversations are scoped to this agent too');
  });
});
