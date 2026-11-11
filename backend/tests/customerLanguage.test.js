import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, pool, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import { customerLanguage, formatCustomerDate } from '../services/customerLanguage.js';
import { buildReminderWhatsAppMessage } from '../services/reminders.js';
import { buildWhatsAppMessage } from '../services/quoteDelivery.js';
import { updateContact } from '../services/contacts.js';

const tag = String(Date.now()).slice(-7);
const phone = `97257${tag}`;
let contactId;

describe('customer language', () => {
  before(async () => {
    await pingDb();
    await runMigrations();
    contactId = (await query(`INSERT INTO contacts (phone, name) VALUES ($1, 'Lina') RETURNING id`, [phone])).rows[0].id;
  });

  after(async () => {
    await query(`DELETE FROM conversations WHERE phone = $1`, [phone]);
    await query(`DELETE FROM contacts WHERE id = $1`, [contactId]);
    await pool.end();
  });

  it('defaults to Arabic, follows the WhatsApp conversation, and staff can override', async () => {
    assert.equal(await customerLanguage(phone), 'ar');
    await query(`INSERT INTO conversations (phone, status, language) VALUES ($1, 'active', 'en')`, [phone]);
    assert.equal(await customerLanguage(`+${phone}`), 'en');
    await updateContact(contactId, { preferred_language: 'ar' });
    assert.equal(await customerLanguage(phone), 'ar');
    await updateContact(contactId, { preferred_language: null });
    assert.equal(await customerLanguage(phone), 'en');
    await assert.rejects(() => updateContact(contactId, { preferred_language: 'fr' }), /ar or en/);
  });

  it('writes reminders in Arabic or English', () => {
    const reminder = { contact_name: 'Lina', text: 'جواز السفر', remind_at: '2026-12-01T08:00:00Z' };
    const ar = buildReminderWhatsAppMessage(reminder, 'ar');
    assert.match(ar, /^مرحباً Lina،/);
    assert.match(ar, /تذكير:\nجواز السفر/);
    assert.match(ar, /الموعد: .*ديسمبر/);
    assert.match(ar, /2026/, 'Western digits for dates');
    const en = buildReminderWhatsAppMessage(reminder, 'en');
    assert.match(en, /^Hi Lina,/);
    assert.match(en, /When: .*December/);
    assert.match(formatCustomerDate('2026-12-01T08:00:00Z', 'en'), /10:00/, 'shown in the agency time zone');
  });

  it('writes the quote message in Arabic with an Arabic link', () => {
    const msg = buildWhatsAppMessage(
      { lead: { destination: 'Istanbul', travel_date: '2026-12-10' }, pricing: { selling_price: 2298 }, currency: 'USD', valid_until: '2026-12-01' },
      'tok123',
      { agency_name: 'Horizon' },
      'ar',
    );
    assert.match(msg, /عرض سعر رحلتك من Horizon/);
    assert.match(msg, /المجموع: \*/);
    assert.match(msg, /\/quote\/tok123\?lang=ar/);
    const en = buildWhatsAppMessage({ lead: {}, pricing: {}, currency: 'USD' }, 'tok123', { agency_name: 'Horizon' }, 'en');
    assert.match(en, /View & accept your quote/);
    assert.doesNotMatch(en, /lang=ar/);
  });
});
