import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pool } from '../config/database.js';
import { createApp } from '../createApp.js';

describe('gmail routes', () => {
  let server;
  let base;
  before(async () => {
    process.env.FRONTEND_URL = 'https://crm.example';
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });

  it('accepts Google\'s redirect without login but rejects an unknown state', async () => {
    const res = await fetch(`${base}/api/email/oauth/callback?code=x&state=${'a'.repeat(48)}`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), 'https://crm.example/email?error=invalid_state');
    const denied = await fetch(`${base}/api/email/oauth/callback?error=access_denied`, { redirect: 'manual' });
    assert.equal(denied.headers.get('location'), 'https://crm.example/email?error=access_denied');
  });

  it('keeps every other email route behind login', async () => {
    for (const path of ['/api/email/accounts', '/api/email/messages?accountId=x', '/api/email/status']) {
      assert.equal((await fetch(`${base}${path}`)).status, 401, path);
    }
  });
});
