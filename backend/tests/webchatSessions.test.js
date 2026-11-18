import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, pool, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import { createApp } from '../createApp.js';
import { createLead } from '../services/leads.js';
import { cleanAttribution, webchatDeps } from '../services/webchat.js';
import {
  getWebchatSettings,
  isOriginAllowed,
  normalizeOrigin,
  normalizeWebchatSettings,
  updateWebchatSettings,
} from '../services/webchatSettings.js';

describe('webchat settings rules', () => {
  it('turns typed addresses into site origins', () => {
    assert.equal(normalizeOrigin('Agency.com/offers?x=1'), 'https://agency.com');
    assert.equal(normalizeOrigin('http://localhost:8080/'), 'http://localhost:8080');
    assert.equal(normalizeOrigin('javascript:alert(1)'), null);
    assert.equal(normalizeOrigin(''), null);
  });

  it('validates what an admin saves', () => {
    assert.deepEqual(
      normalizeWebchatSettings({ allowed_origins: ['agency.com', 'https://agency.com/x', ' '], color: '#ABCDEF', side: '' }),
      { allowed_origins: ['https://agency.com'], color: '#abcdef', side: null },
    );
    assert.throws(() => normalizeWebchatSettings({ allowed_origins: ['not a site at all'] }), /not a website address/);
    assert.throws(() => normalizeWebchatSettings({ color: 'red' }), /color/);
    assert.throws(() => normalizeWebchatSettings({ enabled: 'yes' }), /true or false/);
  });

  it('allows the listed sites, the backend itself, and any site while the list is empty', () => {
    const listed = { allowed_origins: ['https://agency.com'] };
    assert.equal(isOriginAllowed('https://agency.com', listed, { env: {} }), true);
    assert.equal(isOriginAllowed('https://evil.example', listed, { env: {} }), false);
    assert.equal(isOriginAllowed('http://localhost:3000', listed, { selfOrigin: 'http://localhost:3000', env: {} }), true);
    assert.equal(isOriginAllowed('https://evil.example', { allowed_origins: [] }, { env: {} }), true);
    assert.equal(isOriginAllowed('https://evil.example', { allowed_origins: [] }, { env: { WEBCHAT_ALLOWED_ORIGINS: 'https://agency.com' } }), false);
  });

  it('keeps where the visitor came from, without fragments or passwords', () => {
    const out = cleanAttribution({
      page_url: 'https://user:pw@agency.com/turkey?utm_source=instagram&utm_campaign=summer#top',
      referrer: 'https://www.google.com/',
      utm: { utm_medium: 'social' },
    }, 'https://agency.com');
    assert.equal(out.page_url, 'https://agency.com/turkey?utm_source=instagram&utm_campaign=summer');
    assert.equal(out.site, 'https://agency.com');
    assert.deepEqual(out.utm, { utm_source: 'instagram', utm_medium: 'social', utm_campaign: 'summer' });
    assert.equal(cleanAttribution({ page_url: 'javascript:alert(1)' }).page_url, undefined);
  });
});

describe('webchat sessions', () => {
  const tag = String(Date.now()).slice(-7);
  const phone = `97257${tag}`;
  // Starting chats is rate limited per number, so later tests use their own numbers.
  const phone2 = `97258${tag}`;
  const phone3 = `97259${tag}`;
  const phones = [phone, phone2, phone3];
  const sentCodes = [];
  const realDeps = { ...webchatDeps };
  let original;
  let server;
  let base;
  let leadId;

  const call = async (path, body, { origin = 'https://agency.test' } = {}) => {
    const res = await fetch(`${base}/api/public/webchat/${path}`, {
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
    webchatDeps.sendCode = async (to, text) => { sentCodes.push({ to, code: /(\d{6})/.exec(text)[1] }); };
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  beforeEach(async () => {
    await updateWebchatSettings({ enabled: true, verify_phone: false, show_staff_replies: true, allowed_origins: ['https://agency.test'] });
    webchatDeps.handleLead = realDeps.handleLead;
  });

  after(async () => {
    Object.assign(webchatDeps, realDeps);
    await new Promise((resolve) => server.close(resolve));
    const { updated_at: _u, ...restore } = original;
    await updateWebchatSettings(restore);
    await query(`DELETE FROM webchat_sessions WHERE phone = ANY($1)`, [phones]);
    await query(`DELETE FROM messages WHERE from_number = ANY($1) OR to_number = ANY($1)`, [phones]);
    if (leadId) await query(`DELETE FROM leads WHERE id = $1`, [leadId]);
    await query(`DELETE FROM conversations WHERE phone = ANY($1)`, [phones]);
    await query(`DELETE FROM ai_handover WHERE phone = ANY($1)`, [phones]);
    await query(`DELETE FROM contacts WHERE phone = ANY($1)`, [phones]);
    await pool.end();
  });

  it('gives the widget its look, and nothing to a site that is not on the list', async () => {
    await updateWebchatSettings({ title: 'Talk to us', language: 'en' });
    const ok = await call('config');
    assert.equal(ok.status, 200);
    assert.equal(ok.data.title, 'Talk to us');
    assert.equal(ok.data.allowed_origins, undefined);
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://agency.test');

    const blocked = await call('config', undefined, { origin: 'https://copycat.example' });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.headers.get('access-control-allow-origin'), null);
    const start = await call('session', { name: 'Rana', phone }, { origin: 'https://copycat.example' });
    assert.equal(start.status, 403);
    await updateWebchatSettings({ title: null, language: 'ar' });
  });

  it('starts a chat, and the lead it creates remembers the page and campaign', async () => {
    const start = await call('session', {
      name: 'Rana',
      phone: `+${phone}`,
      page_url: 'https://agency.test/antalya?utm_source=instagram&utm_campaign=winter',
      referrer: 'https://instagram.com/',
    });
    assert.equal(start.status, 201);
    assert.equal(start.data.verified, true);
    assert.ok(start.data.token.length > 30);

    // The bot itself is covered elsewhere; here it finishes the request at once.
    webchatDeps.handleLead = async () => {
      const lead = await createLead({
        phone,
        collected: { booking_type: 'hotel', destination: 'Antalya', travel_date: '2027-03-01', return_date: '2027-03-05', adults_count: 2, children_count: 0 },
        summary: 'test',
        source: 'web',
        skipQuoteFetch: true,
      });
      leadId = lead.id;
      return { complete: true, lead, reply: 'Thanks, our team will send you options.' };
    };
    const message = await call('message', { token: start.data.token, text: 'Antalya 1-5 March, 2 adults' });
    assert.equal(message.status, 200);
    assert.equal(message.data.lead_created, true);
    assert.deepEqual(message.data.replies, ['Thanks, our team will send you options.']);

    const { rows } = await query(`SELECT source, web_attribution FROM leads WHERE id = $1`, [leadId]);
    assert.equal(rows[0].source, 'web');
    assert.equal(rows[0].web_attribution.site, 'https://agency.test');
    assert.equal(rows[0].web_attribution.utm.utm_source, 'instagram');
    assert.equal(rows[0].web_attribution.referrer, 'https://instagram.com/');
  });

  it('rejects an unknown token', async () => {
    const res = await call('message', { token: 'x'.repeat(43), text: 'hi' });
    assert.equal(res.status, 401);
    assert.equal(res.data.code, 'session_expired');
  });

  it('with phone checks on, the chat waits for the WhatsApp code, then shows staff replies sent after it', async () => {
    await updateWebchatSettings({ verify_phone: true });
    // An older widget without a token cannot skip the check.
    const legacy = await call('message', { name: 'Rana', phone, text: 'hi' });
    assert.equal(legacy.status, 409);

    sentCodes.length = 0;
    const start = await call('session', { name: 'Rana', phone, language: 'en' });
    assert.equal(start.status, 201);
    assert.equal(start.data.needs_code, true);
    assert.equal(sentCodes.length, 1);
    assert.equal(sentCodes[0].to, phone);
    const { token } = start.data;

    const early = await call('message', { token, text: 'hi' });
    assert.equal(early.status, 403);
    assert.equal(early.data.code, 'needs_code');

    // A staff reply from before the number was confirmed is never shown.
    await query(
      `INSERT INTO messages (direction, channel, to_number, body, status, raw)
       VALUES ('outbound', 'whatsapp', $1, 'BEFORE CONFIRMING', 'sent', '{"kind":"customer","actor_id":"00000000-0000-0000-0000-000000000001"}')`,
      [phone],
    );
    const wrong = await call('verify', { token, code: sentCodes[0].code === '000000' ? '111111' : '000000' });
    assert.equal(wrong.status, 400);
    const right = await call('verify', { token, code: sentCodes[0].code });
    assert.equal(right.status, 200);
    assert.equal(right.data.verified, true);

    const none = await call('updates', { token });
    assert.equal(none.status, 200);
    assert.equal(none.data.enabled, true);
    assert.deepEqual(none.data.messages, []);

    await query(
      `INSERT INTO messages (direction, channel, to_number, body, status, raw)
       VALUES ('outbound', 'whatsapp', $1, 'Hi Rana, I have two hotels for you', 'sent', '{"kind":"customer","actor_id":"00000000-0000-0000-0000-000000000001"}'),
              ('outbound', 'whatsapp', $1, 'bot text', 'sent', '{"kind":"customer"}')`,
      [phone],
    );
    const first = await call('updates', { token, after: none.data.cursor });
    assert.deepEqual(first.data.messages.map((m) => m.text), ['Hi Rana, I have two hotels for you']);
    const again = await call('updates', { token, after: first.data.cursor });
    assert.deepEqual(again.data.messages, []);
  });

  it('limits wrong codes', async () => {
    await updateWebchatSettings({ verify_phone: true });
    sentCodes.length = 0;
    const start = await call('session', { name: 'Rana', phone: phone2 });
    const bad = sentCodes[0].code === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i += 1) {
      const res = await call('verify', { token: start.data.token, code: bad });
      assert.equal(res.status, 400);
    }
    const locked = await call('verify', { token: start.data.token, code: sentCodes[0].code });
    assert.equal(locked.status, 429);
  });

  it('shows nothing when the chat is switched off', async () => {
    await updateWebchatSettings({ enabled: false });
    const config = await call('config');
    assert.equal(config.data.enabled, false);
    const start = await call('session', { name: 'Rana', phone: phone3 });
    assert.equal(start.status, 403);
  });
});
