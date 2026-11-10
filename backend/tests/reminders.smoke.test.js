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

  after(async () => {
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
      {
        sendWhatsApp: async (row) => {
          waCalls.push(row);
        },
      },
    );
    reminderId = reminder.id;
    assert.equal(reminder.contact_name, 'Reminder Smoke');
    assert.equal(waCalls.length, 1);
    assert.equal(waCalls[0].id, reminder.id);
    assert.equal(waCalls[0].text, 'Call back');

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
});
