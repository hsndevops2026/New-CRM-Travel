import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import {
  deleteContact,
  getContactByPhone,
  listContacts,
  normalizeContactPhone,
  updateContact,
  upsertContact,
} from '../services/contacts.js';
import { createLeadFromInput, listLeads, updateLeadStatus } from '../services/leads.js';

describe('normalizeContactPhone', () => {
  it('keeps digits only so +971 and 971 match', () => {
    assert.equal(normalizeContactPhone('+971 50 123 4567'), '971501234567');
    assert.equal(normalizeContactPhone('971501234567'), '971501234567');
  });
});

describe('contacts', () => {
  const phone = `97150${String(Date.now()).slice(-8)}`;
  const createdIds = [];

  before(async () => {
    await pingDb();
    await runMigrations();
  });

  after(async () => {
    if (createdIds.length) {
      await query(`DELETE FROM contacts WHERE id = ANY($1::uuid[])`, [createdIds]);
    }
    await query(`DELETE FROM leads WHERE phone LIKE $1`, [`%${phone.slice(-8)}%`]);
    try {
      const { getHotelQuoteQueue } = await import('../queues/hotelQuoteQueue.js');
      await Promise.race([
        getHotelQuoteQueue().close(),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    } catch {
      /* ignore */
    }
  });

  it('creates and looks up a contact by WhatsApp number', async () => {
    const contact = await upsertContact({ phone: `+${phone}`, name: 'Aisha Khan' });
    createdIds.push(contact.id);
    assert.equal(contact.phone, phone);
    assert.equal(contact.name, 'Aisha Khan');

    const found = await getContactByPhone(phone);
    assert.equal(found.id, contact.id);
    assert.equal(found.name, 'Aisha Khan');
  });

  it('updates the name when the same number is upserted', async () => {
    const contact = await upsertContact({ phone, name: 'Aisha' });
    assert.equal(contact.name, 'Aisha');
    const listed = await listContacts({ query: 'Aisha' });
    assert.equal(listed.some((row) => row.phone === phone), true);
  });

  it('rejects a contact without a name', async () => {
    await assert.rejects(() => upsertContact({ phone: `${phone}9`, name: '  ' }), /name is required/i);
  });

  it('rejects numbers that are too short to include a country code', async () => {
    await assert.rejects(
      () => upsertContact({ phone: '501234', name: 'Short' }),
      /country code/i,
    );
  });

  it('edits and deletes a contact', async () => {
    const extraPhone = `${phone}1`;
    const contact = await upsertContact({ phone: extraPhone, name: 'Temp' });
    createdIds.push(contact.id);
    const updated = await updateContact(contact.id, { name: 'Temp Two' });
    assert.equal(updated.name, 'Temp Two');
    const deleted = await deleteContact(contact.id);
    assert.equal(deleted.id, contact.id);
    assert.equal(await getContactByPhone(extraPhone), null);
  });

  it('requires a customer name when booking a lead that is not in contacts', async () => {
    const leadPhone = `${phone}3`;
    // createLeadFromInput returns { lead, suggested_package }.
    const { lead } = await createLeadFromInput({
      phone: leadPhone,
      booking_type: 'hotel',
      destination: 'Dubai',
      travel_date: '2026-11-01',
      return_date: '2026-11-05',
      adults_count: 2,
      children_count: 0,
    });
    await assert.rejects(
      () => updateLeadStatus(lead.id, 'booked', { contact_email: 'guest@example.test' }),
      /customer name is required/i,
    );
  });

  it('requires a customer email when booking a lead', async () => {
    const leadPhone = `${phone}4`;
    const { lead } = await createLeadFromInput({
      phone: leadPhone,
      booking_type: 'hotel',
      destination: 'Paris',
      travel_date: '2026-11-10',
      return_date: '2026-11-14',
      adults_count: 2,
      children_count: 0,
    });
    await assert.rejects(
      () => updateLeadStatus(lead.id, 'booked', { contact_name: 'No Email' }),
      /customer email is required/i,
    );
  });

  it('saves the WhatsApp number, name and email into contacts when a lead is booked', async () => {
    const leadPhone = `${phone}2`;
    const email = `omar-${phone.slice(-6)}@example.test`;
    const { lead } = await createLeadFromInput({
      phone: leadPhone,
      booking_type: 'hotel',
      destination: 'London',
      travel_date: '2026-12-01',
      return_date: '2026-12-06',
      adults_count: 1,
      children_count: 0,
    });
    const booked = await updateLeadStatus(lead.id, 'booked', {
      contact_name: 'Omar Ali',
      contact_email: email,
    });
    assert.equal(booked.status, 'booked');
    assert.equal(booked.contact_name, 'Omar Ali');
    assert.equal(booked.contact_email, email);

    const contact = await getContactByPhone(leadPhone);
    createdIds.push(contact.id);
    assert.equal(contact.name, 'Omar Ali');
    assert.equal(contact.email, email);

    const listed = await listLeads(200);
    const row = listed.find((item) => item.id === lead.id);
    assert.equal(row.contact_name, 'Omar Ali');

    const account = await query(
      `SELECT id, role, email FROM admins WHERE contact_id = $1 AND role = 'customer'`,
      [contact.id],
    );
    assert.equal(account.rowCount, 1);
    assert.equal(account.rows[0].email, email);
    await query(`DELETE FROM admins WHERE id = $1`, [account.rows[0].id]);
  });
});
