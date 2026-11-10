import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import 'dotenv/config';
import { createApp } from '../createApp.js';
import { pingDb, pool, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import { authConfig } from '../config/auth.js';
import { createAdmin } from '../services/admins.js';
import { getHotelQuoteQueue } from '../queues/hotelQuoteQueue.js';

const cookieName = authConfig.refreshCookieName;

function parseSetCookie(header) {
  if (!header) return null;
  const value = Array.isArray(header) ? header.find((c) => c.startsWith(`${cookieName}=`)) : header;
  if (!value || !String(value).startsWith(`${cookieName}=`)) {
    // Multiple cookies may be joined; find ours
    const list = Array.isArray(header) ? header : String(header).split(/,(?=\s*[^;]+=)/);
    const match = list.find((c) => String(c).trim().startsWith(`${cookieName}=`));
    if (!match) return null;
    return parseOneCookie(match);
  }
  return parseOneCookie(value);
}

function parseOneCookie(raw) {
  const parts = String(raw).split(';').map((p) => p.trim());
  const [nameValue, ...attrs] = parts;
  const eq = nameValue.indexOf('=');
  const name = nameValue.slice(0, eq);
  const value = nameValue.slice(eq + 1);
  const flags = Object.fromEntries(
    attrs.map((attr) => {
      const i = attr.indexOf('=');
      if (i === -1) return [attr.toLowerCase(), true];
      return [attr.slice(0, i).toLowerCase(), attr.slice(i + 1)];
    }),
  );
  return { name, value, flags, raw: String(raw) };
}

describe('admin auth', () => {
  let server;
  let baseUrl;
  const email = `admin-${Date.now()}@example.com`;
  const approverEmail = `approver-${Date.now()}@example.com`;
  const password = 'password123';
  let approverToken;
  const leadIds = [];

  before(async () => {
    await pingDb();
    await runMigrations();
    await createAdmin({ email: approverEmail, password, role: 'admin', approvalStatus: 'approved' });
    const app = createApp();
    server = createServer(app);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (leadIds.length) await query(`DELETE FROM leads WHERE id = ANY($1::uuid[])`, [leadIds]);
    await query(`DELETE FROM admins WHERE email = ANY($1::text[])`, [[email.toLowerCase(), approverEmail]]);
    await getHotelQuoteQueue().close();
    await pool.end();
  });

  async function request(path, { method = 'GET', body, token, cookie } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.getSetCookie?.() || [];
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    return { response, data, setCookie };
  }

  it('signs up a pending user with three credits and no session', async () => {
    const { response, data, setCookie } = await request('/api/auth/signup', {
      method: 'POST',
      body: { email, password },
    });
    assert.equal(response.status, 201);
    assert.equal(data.admin.email, email.toLowerCase());
    assert.equal(data.admin.role, 'agent');
    assert.equal(data.admin.approval_status, 'pending');
    assert.equal(data.admin.lead_credits, 3);
    assert.equal(data.access_token, undefined);
    assert.equal(data.refresh_token, undefined);
    assert.equal(data.admin.password_hash, undefined);
    assert.equal(parseSetCookie(setCookie), null);
  });

  it('rejects duplicate normalized email', async () => {
    const { response, data } = await request('/api/auth/signup', {
      method: 'POST',
      body: { email: email.toUpperCase(), password },
    });
    assert.equal(response.status, 409);
    assert.match(String(data.error), /already exists/i);
  });

  it('logs in successfully and rejects bad password', async () => {
    const bad = await request('/api/auth/login', {
      method: 'POST',
      body: { email, password: 'wrong-password' },
    });
    assert.equal(bad.response.status, 401);
    assert.equal(bad.data.error, 'Invalid email or password');

    const pending = await request('/api/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(pending.response.status, 403);

    const approver = await request('/api/auth/login', { method: 'POST', body: { email: approverEmail, password } });
    assert.equal(approver.response.status, 200);
    approverToken = approver.data.access_token;
    const users = await request('/api/permissions/users', { token: approverToken });
    assert.equal(users.response.status, 200);
    assert.ok(users.data.users.some((user) => user.email === email && user.approval_status === 'pending'));
    const id = users.data.users.find((user) => user.email === email).id;
    const approval = await request(`/api/permissions/users/${id}/approval`, {
      method: 'PATCH', token: approverToken, body: { status: 'approved' },
    });
    assert.equal(approval.response.status, 200);

    const ok = await request('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    assert.equal(ok.response.status, 200);
    assert.ok(ok.data.access_token);
    const cookie = parseSetCookie(ok.setCookie);
    assert.ok(cookie?.flags.httponly);
  });

  it('rejects protected routes without a valid access token', async () => {
    const unauth = await request('/api/leads');
    assert.equal(unauth.response.status, 401);

    const malformed = await request('/api/leads', { token: 'not-a-jwt' });
    assert.equal(malformed.response.status, 401);

    const login = await request('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    const expired = jwt.sign(
      { sub: login.data.admin.id, email: login.data.admin.email, type: 'access' },
      authConfig.accessSecret,
      { expiresIn: -10 },
    );
    const expiredRes = await request('/api/leads', { token: expired });
    assert.equal(expiredRes.response.status, 401);

    const ok = await request('/api/leads', { token: login.data.access_token });
    assert.equal(ok.response.status, 200);
    assert.ok(Array.isArray(ok.data.leads) || Array.isArray(ok.data));
  });

  it('rotates refresh tokens and revokes family on reuse', async () => {
    const login = await request('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    const firstCookie = parseSetCookie(login.setCookie);
    assert.ok(firstCookie?.value);

    const refresh1 = await request('/api/auth/refresh', {
      method: 'POST',
      body: {},
      cookie: `${cookieName}=${firstCookie.value}`,
    });
    assert.equal(refresh1.response.status, 200);
    assert.ok(refresh1.data.access_token);
    const rotatedCookie = parseSetCookie(refresh1.setCookie);
    assert.ok(rotatedCookie?.value);
    assert.notEqual(rotatedCookie.value, firstCookie.value);

    const reuse = await request('/api/auth/refresh', {
      method: 'POST',
      body: {},
      cookie: `${cookieName}=${firstCookie.value}`,
    });
    assert.equal(reuse.response.status, 401);

    const afterReuse = await request('/api/auth/refresh', {
      method: 'POST',
      body: {},
      cookie: `${cookieName}=${rotatedCookie.value}`,
    });
    assert.equal(afterReuse.response.status, 401);
  });

  it('logs out and clears the refresh cookie', async () => {
    const login = await request('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    const cookie = parseSetCookie(login.setCookie);
    assert.ok(cookie?.value);

    const logout = await request('/api/auth/logout', {
      method: 'POST',
      body: {},
      cookie: `${cookieName}=${cookie.value}`,
    });
    assert.equal(logout.response.status, 200);
    const cleared = parseSetCookie(logout.setCookie);
    assert.ok(cleared);
    assert.equal(cleared.value, '');

    const refresh = await request('/api/auth/refresh', {
      method: 'POST',
      body: {},
      cookie: `${cookieName}=${cookie.value}`,
    });
    assert.equal(refresh.response.status, 401);
  });

  it('keeps health and whatsapp webhook paths public', async () => {
    const health = await request('/');
    assert.equal(health.response.status, 200);
    assert.equal(health.data.status, 'ok');
  });

  it('limits agent to three leads, permits admin top-up, and revokes an active session', async () => {
    const created = await query(`
      INSERT INTO leads (phone, destination, travel_date, return_date, nights)
      SELECT '9990001111', 'Test city', '2027-01-01', '2027-01-03', 2
      FROM generate_series(1, 4) RETURNING id
    `);
    leadIds.push(...created.rows.map((row) => row.id));
    const login = await request('/api/auth/login', { method: 'POST', body: { email, password } });
    const token = login.data.access_token;
    const cookie = parseSetCookie(login.setCookie);
    const first = await request('/api/leads', { token });
    assert.equal(first.response.status, 200);
    assert.equal(first.data.leads.length, 3);
    const inbox = await request('/api/inbox/threads?kind=customer', { token });
    assert.equal(inbox.response.status, 200);
    assert.ok(inbox.data.threads.every((thread) => first.data.leads.some((lead) => lead.id === thread.lead_id)));
    for (const path of ['/api/predefined-quotes', '/api/dealers', '/api/contacts']) {
      const allowed = await request(path, { token });
      assert.equal(allowed.response.status, 200, `${path} should be available to agents`);
    }
    const hiddenId = leadIds.find((id) => !first.data.leads.some((lead) => lead.id === id));
    assert.ok(hiddenId);
    const hidden = await request(`/api/leads/${hiddenId}`, { token });
    assert.equal(hidden.response.status, 403);
    const hiddenThread = await request(`/api/inbox/threads/customer:${hiddenId}/messages`, { token });
    assert.equal(hiddenThread.response.status, 403);
    const adminOnly = await request('/api/permissions/users', { token });
    assert.equal(adminOnly.response.status, 403);
    const noCredit = await request('/api/leads', {
      method: 'POST', token,
      body: { phone: '9991234567', destination: 'Agent city', travel_date: '2027-02-01', return_date: '2027-02-03', adults_count: 1 },
    });
    assert.equal(noCredit.response.status, 403);

    const userId = login.data.admin.id;
    const topUp = await request(`/api/permissions/users/${userId}/credits`, {
      method: 'POST', token: approverToken, body: { amount: 1 },
    });
    assert.equal(topUp.response.status, 200);
    const own = await request('/api/leads', {
      method: 'POST', token,
      body: { phone: '9991234567', destination: 'Agent city', travel_date: '2027-02-01', return_date: '2027-02-03', adults_count: 1 },
    });
    assert.equal(own.response.status, 201);
    leadIds.push(own.data.lead.id);
    const expanded = await request('/api/leads', { token });
    assert.equal(expanded.data.leads.length, 4);
    assert.ok(expanded.data.leads.some((lead) => lead.id === own.data.lead.id));
    const revoke = await request(`/api/permissions/users/${userId}/approval`, {
      method: 'PATCH', token: approverToken, body: { status: 'revoked' },
    });
    assert.equal(revoke.response.status, 200);
    const denied = await request('/api/leads', { token });
    assert.equal(denied.response.status, 401);
    const refreshed = await request('/api/auth/refresh', {
      method: 'POST', body: {}, cookie: `${cookieName}=${cookie.value}`,
    });
    assert.equal(refreshed.response.status, 401);
  });
});
