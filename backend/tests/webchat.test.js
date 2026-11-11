import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, pool, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import { createApp } from '../createApp.js';
import { cleanName, handleWebChatMessage, normalizeWebPhone } from '../services/webchat.js';
import { pauseAi } from '../services/aiHandover.js';
import { getCustomerText } from '../services/customerTexts.js';

describe('webchat phone and name rules', () => {
  it('normalizes local and international numbers', () => {
    assert.equal(normalizeWebPhone('0521234567'), '972521234567');
    assert.equal(normalizeWebPhone('059-123-4567'), '970591234567');
    assert.equal(normalizeWebPhone('+972 52 123 4567'), '972521234567');
    assert.equal(normalizeWebPhone('00970591234567'), '970591234567');
    assert.equal(normalizeWebPhone('123'), null);
    assert.equal(normalizeWebPhone(''), null);
  });

  it('cleans names', () => {
    assert.equal(cleanName('  Rana <b> '), 'Rana b');
    assert.equal(cleanName('a'), null);
  });
});

describe('webchat messages', () => {
  const tag = String(Date.now()).slice(-7);
  const phone = `97255${tag}`;
  const phone2 = `97256${tag}`;
  let server;
  let base;

  before(async () => {
    await pingDb();
    await runMigrations();
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await query(`DELETE FROM messages WHERE from_number = ANY($1) OR to_number = ANY($1)`, [[phone, phone2]]);
    await query(`DELETE FROM conversations WHERE phone = ANY($1)`, [[phone, phone2]]);
    await query(`DELETE FROM ai_handover WHERE phone = ANY($1)`, [[phone, phone2]]);
    await query(`DELETE FROM contacts WHERE phone = ANY($1)`, [[phone, phone2]]);
    await pool.end();
  });

  it('keeps the name staff already have and returns no reply while an agent has the chat', async () => {
    await query(`INSERT INTO contacts (phone, name) VALUES ($1, 'Name from staff')`, [phone]);
    await pauseAi(phone, { reason: 'agent_reply' });
    const result = await handleWebChatMessage({ name: 'Someone else', phone: `+${phone}`, text: 'hotel in Dubai' });
    assert.deepEqual(result.replies, []);
    assert.equal(result.ai_paused, true);
    const { rows } = await query(`SELECT name FROM contacts WHERE phone = $1`, [phone]);
    assert.equal(rows[0].name, 'Name from staff');
  });

  it('returns only the replies produced by this request', async () => {
    await query(
      `INSERT INTO messages (direction, channel, to_number, body, status, created_at)
       VALUES ('outbound', 'whatsapp', $1, 'OLD PRIVATE MESSAGE', 'sent', NOW() - INTERVAL '1 hour')`,
      [phone2],
    );
    const result = await handleWebChatMessage({ name: 'Visitor', phone: phone2, text: 'بدي احكي مع حدا' });
    assert.deepEqual(result.replies, [getCustomerText('humanHandover', 'ar')]);
    assert.equal(result.replies.includes('OLD PRIVATE MESSAGE'), false);
  });

  it('serves the widget and answers other sites with CORS but no cookies', async () => {
    const js = await fetch(`${base}/webchat.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /javascript/);
    assert.match(await js.text(), /travelWebchatLoaded/);

    const res = await fetch(`${base}/api/public/webchat/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://booking.example.com' },
      body: JSON.stringify({ name: 'Visitor', phone: '123', text: 'hi' }),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /phone/);
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://booking.example.com');
    assert.equal(res.headers.get('access-control-allow-credentials'), null);
  });
});
