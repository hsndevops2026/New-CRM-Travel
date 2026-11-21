import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pool, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import { createApp } from '../createApp.js';
import { createAdmin } from '../services/admins.js';
import { signAccessToken } from '../services/authTokens.js';
import { createLead } from '../services/leads.js';
import { assignLeadToUser } from '../services/permissions.js';

/** Things staff create can also be deleted: group trips, visa notes and dealer quote requests. */
describe('deleting what staff created', () => {
  const tag = `${Date.now()}`.slice(-7);
  const phone = `97254${tag}`;
  const destination = `Testland ${tag}`;
  let server;
  let base;
  let admin;
  let agent;
  let otherAgent;
  let lead;

  const api = async (method, path, user, body) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${signAccessToken(user)}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };

  before(async () => {
    await runMigrations();
    const make = (role, name) => createAdmin({ email: `del-${name}-${tag}@example.com`, password: 'password123', role, approvalStatus: 'approved' });
    admin = await make('admin', 'admin');
    agent = await make('agent', 'agent');
    otherAgent = await make('agent', 'other');
    lead = await createLead({
      phone,
      collected: { booking_type: 'hotel', destination, travel_date: '2027-05-01', return_date: '2027-05-05', adults_count: 2, children_count: 0 },
      summary: 'test',
      source: 'crm',
      skipQuoteFetch: true,
    });
    await assignLeadToUser(agent.id, lead.id);
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await query(`DELETE FROM messages WHERE to_number = $1`, [phone]);
    await query(`DELETE FROM leads WHERE id = $1`, [lead.id]);
    await query(`DELETE FROM visa_rules WHERE destination = $1`, [destination]);
    await query(`DELETE FROM group_trips WHERE title LIKE $1`, [`Delete test ${tag}%`]);
    await query(`DELETE FROM admins WHERE id = ANY($1::uuid[])`, [[admin.id, agent.id, otherAgent.id]]);
    await pool.end();
  });

  it('an admin deletes a group trip; its bookings stay and leave the group', async () => {
    const created = await api('POST', '/group-trips', admin, { title: `Delete test ${tag}`, seats_total: 10 });
    assert.equal(created.status, 201);
    const groupId = created.data.group.id;
    assert.equal((await api('PUT', `/leads/${lead.id}/group`, admin, { group_trip_id: groupId, room: 'A1' })).status, 200);

    assert.equal((await api('DELETE', `/group-trips/${groupId}`, agent)).status, 403);
    assert.equal((await api('DELETE', `/group-trips/${groupId}`, admin)).status, 204);
    assert.equal((await api('GET', `/group-trips/${groupId}`, admin)).status, 404);

    const { rows } = await query(`SELECT group_trip_id, group_room FROM leads WHERE id = $1`, [lead.id]);
    assert.deepEqual(rows[0], { group_trip_id: null, group_room: null });
    assert.equal((await api('DELETE', `/group-trips/${groupId}`, admin)).status, 404);
  });

  it('an admin deletes the visa notes of a destination', async () => {
    assert.equal((await api('PUT', '/visa-rules', admin, { destination, requires_visa: true, documents: 'Passport' })).status, 200);
    assert.equal((await api('DELETE', `/visa-rules?destination=${encodeURIComponent(destination)}`, agent)).status, 403);
    assert.equal((await api('DELETE', `/visa-rules?destination=${encodeURIComponent(destination)}`, admin)).status, 204);
    const { rowCount } = await query(`SELECT 1 FROM visa_rules WHERE destination = $1`, [destination]);
    assert.equal(rowCount, 0);
    assert.equal((await api('DELETE', `/visa-rules?destination=${encodeURIComponent(destination)}`, admin)).status, 404);
  });

  it('the agent on a lead deletes its dealer request and the offers; the WhatsApp message stays', async () => {
    const { rows: [rfq] } = await query(
      `INSERT INTO dealer_requests (lead_id, request_code, message_body, status)
       VALUES ($1, $2, 'Need a hotel', 'sent') RETURNING id`,
      [lead.id, `REQ-D${tag}`],
    );
    await query(`INSERT INTO dealer_responses (dealer_request_id, raw_text) VALUES ($1, 'USD 500')`, [rfq.id]);
    const { rows: [message] } = await query(
      `INSERT INTO messages (lead_id, direction, channel, to_number, body, status, dealer_request_id)
       VALUES ($1, 'outbound', 'whatsapp', $2, 'Need a hotel', 'sent', $3) RETURNING id`,
      [lead.id, phone, rfq.id],
    );

    assert.equal((await api('DELETE', `/dealer-requests/${rfq.id}`, otherAgent)).status, 403);
    assert.equal((await api('DELETE', `/dealer-requests/${rfq.id}`, agent)).status, 204);

    assert.equal((await query(`SELECT 1 FROM dealer_requests WHERE id = $1`, [rfq.id])).rowCount, 0);
    assert.equal((await query(`SELECT 1 FROM dealer_responses WHERE dealer_request_id = $1`, [rfq.id])).rowCount, 0);
    const kept = await query(`SELECT dealer_request_id FROM messages WHERE id = $1`, [message.id]);
    assert.equal(kept.rows[0].dealer_request_id, null);
    assert.equal((await api('DELETE', `/dealer-requests/${rfq.id}`, admin)).status, 404);
  });
});
