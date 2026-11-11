import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, pool, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import {
  addTripPlanItems,
  deleteTripPlanItem,
  formatTripPlanMessage,
  listTripPlan,
  updateTripPlanItem,
} from '../services/tripPlan.js';

const tag = String(Date.now()).slice(-7);
const phone = `97254${tag}`;
let leadId;
let pkgId;

describe('trip program', () => {
  before(async () => {
    await pingDb();
    await runMigrations();
    await query(`INSERT INTO contacts (phone, name) VALUES ($1, 'Rana') ON CONFLICT (phone) DO NOTHING`, [phone]);
    leadId = (await query(
      `INSERT INTO leads (phone, destination, travel_date, return_date, nights)
       VALUES ($1, 'Istanbul', CURRENT_DATE + 30, CURRENT_DATE + 35, 5) RETURNING id`,
      [phone],
    )).rows[0].id;
    pkgId = (await query(
      `INSERT INTO predefined_quotes (title, destination, total_price, currency) VALUES ($1, 'Istanbul', 1890, 'USD') RETURNING id`,
      [`Pkg ${tag}`],
    )).rows[0].id;
  });

  after(async () => {
    await query(`DELETE FROM leads WHERE id = $1`, [leadId]);
    await query(`DELETE FROM predefined_quotes WHERE id = $1`, [pkgId]);
    await query(`DELETE FROM contacts WHERE phone = $1`, [phone]);
    await pool.end();
  });

  it('adds items; prices only come from a real package', async () => {
    const items = await addTripPlanItems(leadId, [
      { title: 'Bosphorus cruise', details: 'Evening', kind: 'activity', source: 'general', price: 40, currency: 'USD', day_number: 2 },
      { title: 'Family package', kind: 'package', source: 'system', package_id: pkgId, price: 1, day_number: 1 },
      { title: 'Fake', kind: 'package', source: 'system', package_id: '00000000-0000-0000-0000-000000000000' },
    ]);
    assert.equal(items.length, 3);
    const [pkg, cruise, fake] = items;
    assert.deepEqual([pkg.title, pkg.source, pkg.price, pkg.currency], ['Family package', 'system', 1890, 'USD']);
    assert.deepEqual([cruise.source, cruise.price], ['general', null]);
    assert.deepEqual([fake.source, fake.price, fake.day_number], ['general', null, null]);
  });

  it('edits, moves to another day and deletes', async () => {
    const [first] = await listTripPlan(leadId);
    const edited = await updateTripPlanItem(leadId, first.id, { title: 'Family package 5 nights', day_number: 3 });
    const moved = edited.find((i) => i.id === first.id);
    assert.equal(moved.title, 'Family package 5 nights');
    assert.equal(moved.day_number, 3);
    assert.equal(moved.price, 1890, 'editing never changes the package price');
    await assert.rejects(() => updateTripPlanItem(leadId, first.id, { day_number: 99 }), /between 1 and 60/);
    const fake = edited.find((i) => i.title === 'Fake');
    const after = await deleteTripPlanItem(leadId, fake.id);
    assert.equal(after.length, 2);
  });

  it('formats the customer message by day in Arabic and English', async () => {
    const items = await listTripPlan(leadId);
    const ar = formatTripPlanMessage(items, { lang: 'ar', customerName: 'Rana', destination: 'Istanbul' });
    assert.match(ar, /مرحباً Rana/);
    assert.match(ar, /اليوم 2:\n• Bosphorus cruise/);
    assert.match(ar, /اليوم 3:\n• Family package 5 nights \(1,890 USD\)/);
    assert.ok(ar.indexOf('اليوم 2') < ar.indexOf('اليوم 3'));
    const en = formatTripPlanMessage(items, { lang: 'en', customerName: 'Rana', destination: 'Istanbul' });
    assert.match(en, /Here is your suggested trip program for Istanbul/);
  });

  it('refuses an empty title and an unknown lead', async () => {
    await assert.rejects(() => addTripPlanItems(leadId, [{ title: '  ' }]), /title is required/);
    await assert.rejects(() => addTripPlanItems('00000000-0000-0000-0000-000000000000', [{ title: 'x' }]), /Lead not found/);
  });
});
