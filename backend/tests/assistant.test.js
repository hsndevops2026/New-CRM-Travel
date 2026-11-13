import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, pool, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import { runTurn } from '../services/assistantChat.js';
import { createConversation, getConversation, listMessages } from '../services/assistantStore.js';
import { runAssistantTool } from '../services/assistantTools.js';

const tag = String(Date.now()).slice(-7);
const phoneA = `97252${tag}`;
const phoneB = `97253${tag}`;
let admin;
let agent;
let leadA;
let leadB;
let pkg;

async function insertLead(phone, destination) {
  const { rows } = await query(
    `INSERT INTO leads (phone, destination, travel_date, return_date, nights, lifecycle_status)
     VALUES ($1, $2, CURRENT_DATE + 30, CURRENT_DATE + 35, 5, 'sent') RETURNING id`,
    [phone, destination],
  );
  return rows[0].id;
}

/** Stand-in for the Claude client: plays back scripted replies and records each request. */
function fakeClaude(script) {
  const calls = [];
  const client = {
    beta: { messages: { stream(params) {
      calls.push(structuredClone(params));
      const message = script.shift();
      return {
        on() { return this; },
        async finalMessage() {
          if (!message) throw new Error('the fake client ran out of scripted replies');
          return { model: 'claude-haiku-5-5', usage: {}, ...message };
        },
      };
    } } },
    files: { async retrieveMetadata() { return {}; } },
  };
  return { connection: { client, fingerprint: 'test' }, calls };
}

async function chat(user, settings, prompt, script) {
  const conversation = await createConversation(user.id, { model: 'claude-haiku-5-5', settings });
  const fake = fakeClaude(script);
  await runTurn({
    admin: user,
    conversation: await getConversation(user.id, conversation.id),
    userContent: [{ type: 'text', text: prompt }],
    userText: prompt,
    emit: () => {},
    connection: fake.connection,
  });
  return { calls: fake.calls, rows: await listMessages(conversation.id) };
}

const toolNames = (call) => (call.tools || []).map((t) => t.name);

describe('staff assistant', () => {
  before(async () => {
    await pingDb();
    await runMigrations();
    admin = (await query(
      `INSERT INTO admins (email, password_hash, role, approval_status) VALUES ($1, 'x', 'admin', 'approved') RETURNING id, email, role`,
      [`assistant-admin-${tag}@test.local`],
    )).rows[0];
    agent = (await query(
      `INSERT INTO admins (email, password_hash, role, approval_status) VALUES ($1, 'x', 'agent', 'approved') RETURNING id, email, role`,
      [`assistant-agent-${tag}@test.local`],
    )).rows[0];
    await query(`INSERT INTO contacts (phone, name) VALUES ($1, 'Assistant Test A') ON CONFLICT (phone) DO NOTHING`, [phoneA]);
    leadA = await insertLead(phoneA, `Istanbul-${tag}`);
    leadB = await insertLead(phoneB, `Dubai-${tag}`);
    await query(`INSERT INTO user_leads (user_id, lead_id) VALUES ($1, $2)`, [agent.id, leadA]);
    pkg = (await query(
      `INSERT INTO predefined_quotes (title, destination, nights, total_price, currency)
       VALUES ($1, $2, 5, 1890, 'USD') RETURNING id`,
      [`Istanbul family ${tag}`, `Istanbul-${tag}`],
    )).rows[0];
  });

  after(async () => {
    await query(`DELETE FROM leads WHERE id = ANY($1::uuid[])`, [[leadA, leadB]]);
    if (pkg) await query(`DELETE FROM predefined_quotes WHERE id = $1`, [pkg.id]);
    await query(`DELETE FROM contacts WHERE phone = ANY($1)`, [[phoneA, phoneB]]);
    await query(`DELETE FROM admins WHERE id = ANY($1::uuid[])`, [[admin.id, agent.id]]);
    await pool.end();
  });

  it('lets an agent find only their own leads', async () => {
    const own = await runAssistantTool('search_leads', { text: tag }, agent);
    assert.deepEqual(own.leads.map((l) => l.id), [leadA]);
    assert.equal(own.leads[0].customer_name, 'Assistant Test A');
    const all = await runAssistantTool('search_leads', { text: tag }, admin);
    assert.equal(all.count, 2);
  });

  it('refuses another agent\'s lead details', async () => {
    const denied = await runAssistantTool('get_lead', { lead_id: leadB }, agent);
    assert.match(denied.error, /not found/i);
    const ok = await runAssistantTool('get_lead', { lead_id: leadA }, agent);
    assert.equal(ok.lead.id, leadA);
  });

  it('lists quotes waiting for a customer reply and the pipeline', async () => {
    const waiting = await runAssistantTool('list_quotes_waiting_for_customer', { days: 0, limit: 25 }, agent);
    assert.ok(waiting.leads.some((l) => l.id === leadA));
    const summary = await runAssistantTool('pipeline_summary', {}, agent);
    assert.equal(summary.total, 1);
  });

  it('runs CRM lookups for Claude as the signed-in user', async () => {
    const call = { type: 'tool_use', id: 't1', name: 'search_leads', input: { text: tag } };
    const { calls, rows } = await chat(agent, {}, 'Find my leads', [
      { content: [call], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'You have one lead.' }], stop_reason: 'end_turn' },
    ]);
    assert.ok(toolNames(calls[0]).includes('search_leads'));
    assert.match(calls[0].system, /Today is \d{4}-\d{2}-\d{2}/);
    const result = JSON.parse(rows[2].content[0].content);
    // The agent only sees the lead assigned to them, never the other one.
    assert.deepEqual(result.leads.map((l) => l.id), [leadA]);
  });

  it('leaves the CRM tools out when CRM data is switched off', async () => {
    const { calls } = await chat(agent, { crm_data: false }, 'Hi', [
      { content: [{ type: 'text', text: 'Hello' }], stop_reason: 'end_turn' },
    ]);
    assert.equal(toolNames(calls[0]).includes('search_leads'), false);
  });

  it('finds agency packages with their real price', async () => {
    const found = await runAssistantTool('search_packages', { destination: `Istanbul-${tag}`, max_price: 2000 }, agent);
    assert.equal(found.count, 1);
    assert.equal(Number(found.packages[0].total_price), 1890);
    const tooCheap = await runAssistantTool('search_packages', { destination: `Istanbul-${tag}`, max_price: 1000 }, agent);
    assert.equal(tooCheap.count, 0);
  });

  it('keeps the suggestion tool off unless Trip planner is on', async () => {
    const { calls } = await chat(agent, {}, 'اقترح وجهة', [
      { content: [{ type: 'text', text: 'غير موجود في النظام' }], stop_reason: 'end_turn' },
    ]);
    assert.equal(toolNames(calls[0]).includes('propose_suggestions'), false);
  });

  it('stores planner cards with the reply, with prices only from real packages', async () => {
    const call = { type: 'tool_use', id: 'c1', name: 'propose_suggestions', input: { lead_id: leadA, suggestions: [
      { title: 'Package', details: 'Fits the budget', kind: 'package', source: 'system', package_id: pkg.id },
      { title: 'Bosphorus cruise', details: 'Good in mild weather', kind: 'activity', source: 'general', price: 50 },
      { title: 'Fake package', details: 'x', kind: 'package', source: 'system', package_id: '00000000-0000-0000-0000-000000000000' },
    ] } };
    const { calls, rows } = await chat(agent, { trip_planner: true, crm_data: false }, 'اقترح نشاطات لعائلة في اسطنبول', [
      { content: [call], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'جهزت 3 اقتراحات' }], stop_reason: 'end_turn' },
    ]);
    // Trip planner brings the CRM lookups with it, since it starts from the lead and packages.
    assert.ok(toolNames(calls[0]).includes('propose_suggestions'));
    assert.ok(toolNames(calls[0]).includes('search_packages'));
    const { suggestions, lead } = rows[1].meta;
    assert.equal(suggestions.length, 3);
    const [real, general, fake] = suggestions;
    assert.deepEqual([real.source, real.price, real.currency], ['system', 1890, 'USD']);
    assert.deepEqual([general.source, general.price], ['general', null]);
    assert.deepEqual([fake.source, fake.price, fake.package_id], ['general', null, null]);
    assert.equal(lead.id, leadA);
    assert.equal(lead.customer_name, 'Assistant Test A');
  });
});
