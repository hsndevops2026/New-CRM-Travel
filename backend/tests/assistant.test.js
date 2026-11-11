import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, pool, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import { askAssistant, cleanHistory } from '../services/assistant.js';
import { runAssistantTool } from '../services/assistantTools.js';

const tag = String(Date.now()).slice(-7);
const phoneA = `97252${tag}`;
const phoneB = `97253${tag}`;
let admin;
let agent;
let leadA;
let leadB;

async function insertLead(phone, destination) {
  const { rows } = await query(
    `INSERT INTO leads (phone, destination, travel_date, return_date, nights, lifecycle_status)
     VALUES ($1, $2, CURRENT_DATE + 30, CURRENT_DATE + 35, 5, 'sent') RETURNING id`,
    [phone, destination],
  );
  return rows[0].id;
}

/** Fake OpenAI client: first asks for a tool, then answers with what the tool returned. */
function fakeOpenAI(toolName, args) {
  let round = 0;
  const seen = [];
  return {
    seen,
    chat: { completions: { create: async ({ messages }) => {
      seen.push(messages);
      round += 1;
      if (round === 1) {
        return { choices: [{ message: { role: 'assistant', content: null, tool_calls: [
          { id: 'call_1', type: 'function', function: { name: toolName, arguments: JSON.stringify(args) } },
        ] } }] };
      }
      const toolMsg = messages.find((m) => m.role === 'tool');
      return { choices: [{ message: { role: 'assistant', content: `ANSWER ${toolMsg.content}` } }] };
    } } },
  };
}

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
  });

  after(async () => {
    await query(`DELETE FROM leads WHERE id = ANY($1::uuid[])`, [[leadA, leadB]]);
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

  it('runs the tool loop and answers from tool results', async () => {
    const client = fakeOpenAI('search_leads', { text: tag });
    const result = await askAssistant({
      messages: [{ role: 'user', content: 'وين وصل طلب اسطنبول؟' }],
      user: agent,
      env: { ASSISTANT_PROVIDER: 'openai' },
      openaiClient: client,
    });
    assert.equal(result.provider, 'openai');
    assert.deepEqual(result.tools_used, ['search_leads']);
    assert.match(result.reply, new RegExp(`Istanbul-${tag}`));
    assert.doesNotMatch(result.reply, new RegExp(`Dubai-${tag}`));
    assert.match(client.seen[0][0].content, /Never invent/);
  });

  it('works with Claude through the Messages API', async () => {
    let call = 0;
    const fetchImpl = async (_url, init) => {
      call += 1;
      const body = JSON.parse(init.body);
      if (call === 1) {
        assert.equal(init.headers['x-api-key'], 'test-key');
        assert.ok(body.tools.some((t) => t.name === 'pipeline_summary'));
        return { ok: true, json: async () => ({ content: [{ type: 'tool_use', id: 'tu_1', name: 'pipeline_summary', input: {} }] }) };
      }
      const toolResult = body.messages.at(-1).content[0];
      assert.equal(toolResult.type, 'tool_result');
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: `Claude: ${toolResult.content}` }] }) };
    };
    const result = await askAssistant({
      messages: [{ role: 'user', content: 'How many leads do I have?' }],
      user: agent,
      env: { ASSISTANT_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-key' },
      fetchImpl,
    });
    assert.equal(result.provider, 'anthropic');
    assert.match(result.reply, /"total":1/);
  });

  it('rejects empty or malformed conversations', async () => {
    assert.deepEqual(cleanHistory([{ role: 'system', content: 'x' }, { role: 'user', content: '  ' }]), []);
    await assert.rejects(() => askAssistant({ messages: [], user: agent, env: {} }), /question/);
  });
});
