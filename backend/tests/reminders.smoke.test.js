import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, pool, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import { createAdmin } from '../services/admins.js';
import { upsertContact } from '../services/contacts.js';
import {
  createReminder,
  listRemindersForContact,
  listRemindersInRange,
  sendDueCustomerReminders,
  updateReminder,
} from '../services/reminders.js';
import { getNavCounts } from '../services/navCounts.js';
import { getHotelQuoteQueue } from '../queues/hotelQuoteQueue.js';

describe('reminders smoke', () => {
  const tag = String(Date.now()).slice(-8);
  let admin;
  let contact;
  let reminderId;

  before(async () => {
    await pingDb();
    await runMigrations();
    admin = await createAdmin({
      email: `rem-smoke-${tag}@example.test`,
      password: 'password123',
      role: 'admin',
      approvalStatus: 'approved',
    });
    contact = await upsertContact({
      phone: `97150${tag}`,
      name: 'Reminder Smoke',
    });
  });

  const extraIds = [];

  after(async () => {
    if (extraIds.length) await query(`DELETE FROM contact_reminders WHERE id = ANY($1::uuid[])`, [extraIds]);
    if (reminderId) await query(`DELETE FROM contact_reminders WHERE id = $1`, [reminderId]);
    if (contact?.id) await query(`DELETE FROM contacts WHERE id = $1`, [contact.id]);
    if (admin?.id) await query(`DELETE FROM admins WHERE id = $1`, [admin.id]);
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

  it('creates, lists, and counts open reminders', async () => {
    const at = new Date();
    at.setHours(10, 0, 0, 0);
    const waCalls = [];
    const reminder = await createReminder(
      contact.id,
      { text: 'Call back', remind_at: at.toISOString() },
      admin.id,
    );
    reminderId = reminder.id;
    assert.equal(reminder.contact_name, 'Reminder Smoke');
    assert.equal(reminder.notify_customer, false);
    assert.equal(waCalls.length, 0, 'creating a reminder must not message the customer');

    const listed = await listRemindersForContact(contact.id);
    assert.equal(listed.length, 1);

    const dayStart = new Date(at);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const range = await listRemindersInRange({
      from: dayStart.toISOString(),
      to: dayEnd.toISOString(),
    });
    assert.ok(range.some((row) => row.id === reminder.id));

    const counts = await getNavCounts(admin, {
      listThreadsFn: async () => ({ threads: [] }),
    });
    assert.ok(counts.reminders_open >= 1);

    await updateReminder(reminder.id, { done: true });
    const afterDone = await getNavCounts(admin, {
      listThreadsFn: async () => ({ threads: [] }),
    });
    assert.ok(afterDone.reminders_open >= 0);
  });

  it('never sends internal reminders to the customer', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const internal = await createReminder(contact.id, { text: 'Internal note', remind_at: past }, admin.id);
    extraIds.push(internal.id);
    const calls = [];
    await sendDueCustomerReminders({ sendWhatsApp: async (row) => { calls.push(row.id); return { sent: true }; } });
    assert.equal(calls.includes(internal.id), false);
  });

  it('sends an opted-in reminder once, only after its time', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const reminder = await createReminder(
      contact.id,
      { text: 'Passport copy please', remind_at: future, notify_customer: true },
      admin.id,
    );
    extraIds.push(reminder.id);
    assert.equal(reminder.notify_customer, true);

    const calls = [];
    const send = async (row) => { calls.push(row.id); return { sent: true }; };
    await sendDueCustomerReminders({ sendWhatsApp: send });
    assert.equal(calls.includes(reminder.id), false, 'not before remind_at');

    const later = new Date(Date.now() + 2 * 3_600_000);
    await sendDueCustomerReminders({ now: later, sendWhatsApp: send });
    await sendDueCustomerReminders({ now: later, sendWhatsApp: send });
    assert.equal(calls.filter((id) => id === reminder.id).length, 1, 'sent exactly once');
  });

  it('retries on the next sweep when the send fails', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const reminder = await createReminder(
      contact.id,
      { text: 'Retry me', remind_at: past, notify_customer: true },
      admin.id,
    );
    extraIds.push(reminder.id);
    await sendDueCustomerReminders({ sendWhatsApp: async (row) => {
      if (row.id === reminder.id) throw new Error('wasender down');
      return { sent: true };
    } });
    const calls = [];
    await sendDueCustomerReminders({ sendWhatsApp: async (row) => { calls.push(row.id); return { sent: true }; } });
    assert.equal(calls.filter((id) => id === reminder.id).length, 1);
  });
});
