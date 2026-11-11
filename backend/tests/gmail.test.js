import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, pool, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import { decrypt, encrypt } from '../utils/tokenCrypto.js';
import {
  addressQuery,
  buildRawMessage,
  connectAccount,
  consumeState,
  createAuthUrl,
  defaultAccount,
  disconnectAccount,
  getMessage,
  getOwnedAccount,
  listAccounts,
  listMessages,
  sendMessage,
  setDefaultAccount,
} from '../services/gmail.js';

const env = {
  GOOGLE_CLIENT_ID: 'cid',
  GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_REDIRECT_URI: 'https://crm.example/api/email/oauth/callback',
  EMAIL_TOKEN_ENCRYPTION_KEY: 'a-long-random-test-key-1234567890',
};
Object.assign(process.env, env);

const tag = String(Date.now()).slice(-7);
let adminId;
let otherAdmin;

function json(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** A fake Google: token exchange, refresh, userinfo, Gmail list/get/send. */
function fakeGoogle(email, calls = []) {
  return async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const u = String(url);
    if (u === 'https://oauth2.googleapis.com/token') {
      const body = new URLSearchParams(init.body);
      if (body.get('grant_type') === 'authorization_code') {
        return json(200, { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 });
      }
      return json(200, { access_token: 'at-2', expires_in: 3600 });
    }
    if (u.startsWith('https://openidconnect.googleapis.com/v1/userinfo')) return json(200, { email });
    if (u.includes('/messages/send')) return json(200, { id: 'sent-1', threadId: 't-1' });
    if (u.includes('/messages?')) return json(200, { messages: [{ id: 'm1' }], nextPageToken: 'next' });
    if (u.includes('/messages/m1?format=metadata')) {
      return json(200, { id: 'm1', threadId: 't1', snippet: 'Hello', labelIds: ['INBOX', 'UNREAD'],
        payload: { headers: [{ name: 'From', value: 'Rana <rana@example.com>' }, { name: 'Subject', value: 'Booking' }] } });
    }
    if (u.includes('/messages/m1?format=full')) {
      return json(200, { id: 'm1', threadId: 't1', labelIds: [], payload: { mimeType: 'multipart/mixed', headers: [{ name: 'Subject', value: 'Booking' }], parts: [
        { mimeType: 'text/plain', body: { data: Buffer.from('مرحبا').toString('base64url') } },
        { mimeType: 'application/pdf', filename: 'ticket.pdf', body: { attachmentId: 'att1', size: 1200 } },
      ] } });
    }
    return json(404, { error: { message: 'not found' } });
  };
}

describe('gmail port', () => {
  before(async () => {
    await pingDb();
    await runMigrations();
    for (const n of ['a', 'b']) {
      const { rows } = await query(
        `INSERT INTO admins (email, password_hash, role, approval_status) VALUES ($1, 'x', 'agent', 'approved') RETURNING id`,
        [`gmail-${n}-${tag}@test.local`],
      );
      if (n === 'a') adminId = rows[0].id; else otherAdmin = rows[0].id;
    }
  });

  after(async () => {
    await query(`DELETE FROM admins WHERE id = ANY($1::uuid[])`, [[adminId, otherAdmin]]);
    await pool.end();
  });

  it('encrypts tokens so they are not stored in plain text', () => {
    const enc = encrypt('secret-token', env);
    assert.notEqual(enc, 'secret-token');
    assert.equal(decrypt(enc, env), 'secret-token');
    assert.throws(() => decrypt(enc, { EMAIL_TOKEN_ENCRYPTION_KEY: 'another-long-random-key-0000000' }));
  });

  it('builds the Google URL with a single-use state tied to the employee', async () => {
    const url = new URL(await createAuthUrl(adminId, env));
    assert.equal(url.hostname, 'accounts.google.com');
    assert.equal(url.searchParams.get('access_type'), 'offline');
    assert.match(url.searchParams.get('scope'), /gmail\.readonly/);
    const state = url.searchParams.get('state');
    assert.equal(await consumeState(state), adminId);
    assert.equal(await consumeState(state), null, 'state cannot be reused');
    assert.equal(await consumeState('not-a-state'), null);
  });

  it('connects accounts, keeps one default, and only the owner can use them', async () => {
    const first = await connectAccount({ code: 'c1', adminId, env, fetchImpl: fakeGoogle('First@Agency.com') });
    assert.deepEqual([first.email, first.is_default], ['first@agency.com', true]);
    const second = await connectAccount({ code: 'c2', adminId, env, fetchImpl: fakeGoogle('second@agency.com') });
    assert.equal(second.is_default, false);
    const stored = await getOwnedAccount(adminId, first.id);
    assert.notEqual(stored.access_token_enc, 'at-1', 'tokens are encrypted at rest');
    assert.equal(await getOwnedAccount(otherAdmin, first.id), null, 'another employee cannot use it');

    assert.equal(await setDefaultAccount(adminId, second.id), true);
    assert.equal((await defaultAccount(adminId)).id, second.id);
    assert.equal(await disconnectAccount(otherAdmin, second.id), false);
    assert.equal(await disconnectAccount(adminId, second.id), true);
    const left = await listAccounts(adminId);
    assert.deepEqual(left.map((a) => [a.email, a.is_default]), [['first@agency.com', true]], 'default moves to the remaining account');
  });

  it('lists, reads and sends through Gmail, refreshing an expired token', async () => {
    const acc = await defaultAccount(adminId);
    await query(`UPDATE email_accounts SET token_expiry = NOW() - INTERVAL '1 hour' WHERE id = $1`, [acc.id]);
    const calls = [];
    const fetchImpl = fakeGoogle('first@agency.com', calls);
    const list = await listMessages(await getOwnedAccount(adminId, acc.id), { q: addressQuery('rana@example.com'), env, fetchImpl });
    assert.equal(list.messages[0].subject, 'Booking');
    assert.equal(list.messages[0].isUnread, true);
    assert.equal(list.nextPageToken, 'next');
    assert.ok(calls.some((c) => c.url === 'https://oauth2.googleapis.com/token'), 'token was refreshed');
    assert.equal(new URL(calls.find((c) => c.url.includes('/messages?')).url).searchParams.get('q'), '(from:"rana@example.com" OR to:"rana@example.com")');

    const fresh = await getOwnedAccount(adminId, acc.id);
    assert.ok(new Date(fresh.token_expiry) > new Date(), 'new expiry saved');
    const msg = await getMessage(fresh, 'm1', { env, fetchImpl });
    assert.equal(msg.body.text, 'مرحبا');
    assert.deepEqual(msg.attachments.map((a) => a.filename), ['ticket.pdf']);

    const sent = await sendMessage(fresh, { to: 'rana@example.com', subject: 'عرض السعر', body: 'مرحبا رنا' }, { env, fetchImpl });
    assert.equal(sent.id, 'sent-1');
    await assert.rejects(() => sendMessage(fresh, { to: 'a@b.com, c@d.com', body: 'x' }, { env, fetchImpl }), /one valid email/);
  });

  it('refuses header injection and encodes Arabic subjects', () => {
    assert.throws(() => buildRawMessage({ from: 'a@b.c', to: 'x@y.z\r\nBcc: evil@x.y', subject: 's', body: 'b' }), /Invalid characters/);
    const raw = Buffer.from(buildRawMessage({ from: 'a@b.c', to: 'x@y.z', subject: 'عرض', body: 'نص' }), 'base64url').toString('utf8');
    assert.match(raw, /Subject: =\?UTF-8\?B\?/);
    assert.match(raw, /\r\n\r\nنص$/);
  });
});
