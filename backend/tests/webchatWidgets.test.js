import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, pool, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import { createApp } from '../createApp.js';
import { createAdmin } from '../services/admins.js';
import { signAccessToken } from '../services/authTokens.js';
import { createLead } from '../services/leads.js';
import { assignLeadToUser } from '../services/permissions.js';
import { webchatDeps } from '../services/webchat.js';
import { getWebchatSettings, updateWebchatSettings } from '../services/webchatSettings.js';

/** One chat per CRM user: the key in the script tag decides whose chat it is and who gets the lead. */
describe('website chat per user', () => {
  const tag = `${Date.now()}`.slice(-7);
  const phones = [`97251${tag}`, `97252${tag}`, `97253${tag}`];
  const realDeps = { ...webchatDeps };
  const leadIds = [];
  let original;
  let server;
  let base;
  let admin;
  let agent;
  let agent2;
  let calls;

  const api = async (method, path, user, body) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${signAccessToken(user)}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const chat = async (path, key, body, origin = 'https://agent-site.test') => {
    const url = `${base}/api/public/webchat/${path}${key ? `?key=${encodeURIComponent(key)}` : ''}`;
    const res = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, headers: res.headers, data: await res.json().catch(() => ({})) };
  };

  before(async () => {
    await pingDb();
    await runMigrations();
    original = await getWebchatSettings({ fresh: true });
    const make = (role, name) => createAdmin({ email: `wc-${name}-${tag}@example.com`, password: 'password123', role, approvalStatus: 'approved' });
    admin = await make('admin', 'admin');
    agent = await make('agent', 'agent');
    agent2 = await make('agent', 'agent2');
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  beforeEach(async () => {
    await updateWebchatSettings({ enabled: true, verify_phone: false, allowed_origins: ['https://agency.test'], title: null });
    calls = [];
    // Stands in for the WhatsApp bot: finishes the request at once, and gives the lead
    // to the chat's owner the way the bot does.
    webchatDeps.handleLead = async (input) => {
      calls.push(input);
      const lead = await createLead({
        phone: input.from,
        collected: { booking_type: 'hotel', destination: 'Dubai', travel_date: '2027-04-01', return_date: '2027-04-04', adults_count: 2, children_count: 0 },
        summary: 'test',
        source: 'web',
        skipQuoteFetch: true,
      });
      leadIds.push(lead.id);
      if (input.ownerId) await assignLeadToUser(input.ownerId, lead.id);
      return { complete: true, lead, reply: 'Thanks!' };
    };
  });

  after(async () => {
    Object.assign(webchatDeps, realDeps);
    await new Promise((resolve) => server.close(resolve));
    const { updated_at: _u, ...restore } = original;
    await updateWebchatSettings(restore);
    await query(`DELETE FROM webchat_sessions WHERE phone = ANY($1)`, [phones]);
    await query(`DELETE FROM leads WHERE id = ANY($1::uuid[])`, [leadIds]);
    for (const table of ['messages']) await query(`DELETE FROM ${table} WHERE from_number = ANY($1) OR to_number = ANY($1)`, [phones]);
    for (const table of ['conversations', 'ai_handover', 'contacts']) await query(`DELETE FROM ${table} WHERE phone = ANY($1)`, [phones]);
    await query(`DELETE FROM admins WHERE id = ANY($1::uuid[])`, [[admin.id, agent.id, agent2.id]]);
    await pool.end();
  });

  it('gives every user their own chat code, and only admins the list of all chats', async () => {
    const mine = await api('GET', '/webchat-settings', agent);
    assert.equal(mine.status, 200);
    assert.match(mine.data.my_widget.public_key, /^wc_/);
    assert.equal(mine.data.my_widget.owner_id, agent.id);
    assert.match(mine.data.my_widget.test_page_url, /key=wc_/);
    assert.equal(mine.data.widgets, undefined);

    const again = await api('GET', '/webchat-settings', agent);
    assert.equal(again.data.my_widget.public_key, mine.data.my_widget.public_key);

    await api('GET', '/webchat-settings', agent2);
    const all = await api('GET', '/webchat-settings', admin);
    const owners = all.data.widgets.map((w) => w.owner_id);
    assert.ok(owners.includes(agent.id) && owners.includes(agent2.id));

    // Agents may change their own chat, not the agency defaults.
    assert.equal((await api('PATCH', '/webchat-settings', agent, { title: 'x' })).status, 403);
    assert.equal((await api('PATCH', '/webchat-widgets/' + mine.data.my_widget.id, agent, { enabled: false })).status, 403);
  });

  it('a lead from a user\'s chat goes to that user, and says whose chat it came from', async () => {
    const saved = await api('PATCH', '/webchat-widget', agent, {
      title: 'Ahmed Travel', color: '#123456', allowed_origins: ['agent-site.test'],
    });
    assert.equal(saved.status, 200);
    const key = saved.data.my_widget.public_key;

    const config = await chat('config', key);
    assert.equal(config.status, 200);
    assert.equal(config.data.title, 'Ahmed Travel');
    assert.equal(config.data.color, '#123456');
    assert.equal(config.headers.get('access-control-allow-origin'), 'https://agent-site.test');

    // The agency's site is not on this user's list.
    assert.equal((await chat('config', key, undefined, 'https://agency.test')).status, 403);
    // The shared chat (no key) still follows the agency list.
    assert.equal((await chat('config', null, undefined, 'https://agency.test')).status, 200);

    const start = await chat('session', key, { name: 'Sara', phone: phones[0], page_url: 'https://agent-site.test/dubai' });
    assert.equal(start.status, 201);
    const message = await chat('message', key, { token: start.data.token, text: 'Dubai 1-4 April, 2 adults' });
    assert.equal(message.status, 200);
    assert.equal(calls[0].ownerId, agent.id);

    const leadId = leadIds.at(-1);
    const { rows } = await query(`SELECT assigned_to, web_attribution FROM leads WHERE id = $1`, [leadId]);
    assert.equal(rows[0].assigned_to, agent.id);
    assert.equal(rows[0].web_attribution.chat_owner.id, agent.id);
    const owners = await query(`SELECT user_id FROM user_leads WHERE lead_id = $1`, [leadId]);
    assert.deepEqual(owners.rows.map((r) => r.user_id), [agent.id]);

    // The other agent cannot see it; the owner can.
    assert.equal((await api('GET', `/leads/${leadId}`, agent2)).status, 403);
    assert.equal((await api('GET', `/leads/${leadId}`, agent)).status, 200);

    const all = await api('GET', '/webchat-settings', admin);
    assert.equal(all.data.widgets.find((w) => w.owner_id === agent.id).lead_count, 1);
    assert.equal((await api('GET', '/webchat-settings', agent)).data.my_widget.lead_count, 1);
  });

  it('the shared chat without a key gives the lead to nobody', async () => {
    const start = await chat('session', null, { name: 'Omar', phone: phones[1] }, 'https://agency.test');
    assert.equal(start.status, 201);
    await chat('message', null, { token: start.data.token, text: 'Dubai' }, 'https://agency.test');
    assert.equal(calls[0].ownerId, null);
    const { rows } = await query(`SELECT assigned_to FROM leads WHERE id = $1`, [leadIds.at(-1)]);
    assert.equal(rows[0].assigned_to, null);
  });

  it('a new code stops the old one, and an admin can switch a user\'s chat off', async () => {
    const before = (await api('GET', '/webchat-settings', agent2)).data.my_widget;
    await api('PATCH', '/webchat-widget', agent2, { allowed_origins: ['agent-site.test'] });
    const rotated = await api('POST', '/webchat-widget/rotate-key', agent2);
    const after = rotated.data.my_widget;
    assert.notEqual(after.public_key, before.public_key);
    const old = await chat('config', before.public_key);
    assert.equal(old.status, 404);
    assert.equal(old.data.code, 'unknown_key');
    assert.equal((await chat('config', after.public_key)).status, 200);

    // A chat already open when the admin switches it off stops too.
    const start = await chat('session', after.public_key, { name: 'Lina', phone: phones[2] });
    assert.equal(start.status, 201);
    const off = await api('PATCH', `/webchat-widgets/${after.id}`, admin, { enabled: false });
    assert.equal(off.status, 200);
    assert.equal((await chat('config', after.public_key)).data.enabled, false);
    assert.equal((await chat('session', after.public_key, { name: 'Lina', phone: phones[2] })).status, 403);
    assert.equal((await chat('message', after.public_key, { token: start.data.token, text: 'hi' })).status, 403);
  });

  it('the agency switch turns every user\'s chat off', async () => {
    const key = (await api('GET', '/webchat-settings', agent)).data.my_widget.public_key;
    await updateWebchatSettings({ enabled: false });
    assert.equal((await chat('config', key)).data.enabled, false);
  });
});
