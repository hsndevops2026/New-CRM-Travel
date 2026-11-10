import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { createApp } from '../createApp.js';
import { pool, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import { createAdmin } from '../services/admins.js';
import { signAccessToken } from '../services/authTokens.js';
import { getAgencySettings, publicAgencySettings, updateAgencySettings } from '../services/agencySettings.js';

describe('agency settings API', () => {
  let server;
  let baseUrl;
  let original;
  let admin;
  let agent;
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  before(async () => {
    await runMigrations();
    original = await getAgencySettings();
    admin = await createAdmin({ email: `brand-admin-${suffix}@example.com`, password: 'password123', role: 'admin', approvalStatus: 'approved' });
    agent = await createAdmin({ email: `brand-agent-${suffix}@example.com`, password: 'password123', role: 'agent', approvalStatus: 'approved' });
    server = createServer(createApp());
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (original) await updateAgencySettings(publicAgencySettings(original));
    await query('DELETE FROM admins WHERE id = ANY($1::uuid[])', [[admin.id, agent.id]]);
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });

  async function request(method, token, body) {
    const response = await fetch(`${baseUrl}/api/agency-settings`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { response, data: await response.json() };
  }

  it('lets authenticated employees read branding but only admins update it', async () => {
    const agentToken = signAccessToken(agent);
    const adminToken = signAccessToken(admin);

    const read = await request('GET', agentToken);
    assert.equal(read.response.status, 200);
    assert.ok(read.data.agency.agency_name);

    const denied = await request('PATCH', agentToken, { agency_name: 'Not allowed' });
    assert.equal(denied.response.status, 403);

    const saved = await request('PATCH', adminToken, {
      agency_name: 'API Verified Travel',
      primary_color: '#334455',
      quotation_template: 'modern',
    });
    assert.equal(saved.response.status, 200);
    assert.equal(saved.data.agency.agency_name, 'API Verified Travel');
    assert.equal(saved.data.agency.primary_color, '#334455');
  });
});
