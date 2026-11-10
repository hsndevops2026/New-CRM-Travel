import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { createApp } from '../createApp.js';
import { pingDb, pool, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import { createAdmin } from '../services/admins.js';
import { createLeadFromInput, updateLeadStatus } from '../services/leads.js';
import { ensureCustomerAccount } from '../services/customers.js';
import { createBookingDocument } from '../services/bookingDocuments.js';
import { saveMessage } from '../services/messages.js';
import { getHotelQuoteQueue } from '../queues/hotelQuoteQueue.js';
import { issueTokenPair } from '../services/authTokens.js';

describe('customer portal', () => {
  let server;
  let baseUrl;
  const tag = String(Date.now()).slice(-8);
  const staffEmail = `portal-admin-${tag}@example.test`;
  const customerEmail = `portal-customer-${tag}@example.test`;
  const password = 'password123';
  const phone = `97150${tag}`;
  let staff;
  let staffToken;
  let leadId;
  let contactId;
  let customerId;
  let customerPassword;

  before(async () => {
    await pingDb();
    await runMigrations();
    staff = await createAdmin({
      email: staffEmail,
      password,
      role: 'admin',
      approvalStatus: 'approved',
    });
    const tokens = await issueTokenPair(staff);
    staffToken = tokens.accessToken;

    const { lead } = await createLeadFromInput({
      phone,
      booking_type: 'hotel',
      destination: 'Maldives',
      travel_date: '2027-01-10',
      return_date: '2027-01-17',
      adults_count: 2,
      children_count: 0,
    });
    leadId = lead.id;

    const sent = [];
    const booked = await updateLeadStatus(leadId, 'booked', {
      contact_name: 'Portal Guest',
      contact_email: customerEmail,
    });
    contactId = booked.contact_id;
    assert.ok(contactId);

    // Re-provision with a captured password (booking already created the account;
    // forceResend regenerates so the test can log in).
    const provision = await ensureCustomerAccount(
      {
        contactId,
        email: customerEmail,
        contactName: 'Portal Guest',
        sendMailFn: async (payload) => {
          sent.push(payload);
        },
      },
      { forceResend: true },
    );
    customerPassword = provision.password;
    customerId = provision.customer.id;
    assert.ok(customerPassword);
    assert.equal(sent.length, 1);

    await createBookingDocument({
      leadId,
      title: 'Flight ticket',
      fileUrl: 'https://example.test/ticket.pdf',
      fileName: 'ticket.pdf',
      mimeType: 'application/pdf',
      uploadedBy: staff.id,
    });
    await saveMessage({
      leadId,
      direction: 'outbound',
      channel: 'whatsapp',
      body: 'Your Maldives trip is confirmed.',
      status: 'sent',
    });

    server = createServer(createApp());
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await query(`DELETE FROM booking_documents WHERE lead_id = $1`, [leadId]);
    await query(`DELETE FROM messages WHERE lead_id = $1`, [leadId]);
    await query(`DELETE FROM leads WHERE id = $1`, [leadId]);
    await query(`DELETE FROM admins WHERE id = ANY($1::uuid[])`, [[staff.id, customerId]]);
    await query(`DELETE FROM contacts WHERE id = $1`, [contactId]);
    try {
      await Promise.race([
        getHotelQuoteQueue().close(),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    } catch {
      /* ignore */
    }
    await pool.end();
  });

  async function request(path, { method = 'GET', body, token } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  it('lets the customer sign in and load bookings, documents, and chats', async () => {
    const login = await request('/api/auth/login', {
      method: 'POST',
      body: { email: customerEmail, password: customerPassword },
    });
    assert.equal(login.response.status, 200);
    assert.equal(login.data.admin.role, 'customer');
    assert.equal(login.data.admin.contact_id, contactId);

    const portal = await request('/api/portal/home', { token: login.data.access_token });
    assert.equal(portal.response.status, 200);
    assert.equal(portal.data.customer.email, customerEmail);
    assert.equal(portal.data.bookings.length, 1);
    assert.equal(portal.data.bookings[0].destination, 'Maldives');
    assert.equal(portal.data.documents.length, 1);
    assert.equal(portal.data.documents[0].title, 'Flight ticket');
    assert.equal(portal.data.chats.length, 1);
    assert.match(portal.data.chats[0].messages[0].body, /Maldives/);
  });

  it('blocks staff from the customer portal and customers from staff leads', async () => {
    const staffDenied = await request('/api/portal/home', { token: staffToken });
    assert.equal(staffDenied.response.status, 403);

    const login = await request('/api/auth/login', {
      method: 'POST',
      body: { email: customerEmail, password: customerPassword },
    });
    const leads = await request('/api/leads', { token: login.data.access_token });
    assert.equal(leads.response.status, 403);
  });
});
