import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import {
  customerMessage,
  handleRatingReply,
  parseRating,
  runLeadWaitAlerts,
  runQuoteFollowups,
  runTripMessages,
  tripMessageDue,
} from '../services/automations.js';
import { setDraftItems, upsertDraft } from '../services/quoteDrafts.js';
import { createShareToken, lockQuoteVersion, resolveShareToken } from '../services/quoteVersions.js';
import { listNotifications } from '../services/notifications.js';

const tag = String(Date.now()).slice(-7);
const phone = `97255${tag}`;
const phone2 = `97256${tag}`;
const ids = {};
const outbox = [];
const send = async (to, text) => { outbox.push({ to, text }); };
// 12:00 in Jerusalem, inside sending hours.
const noon = (day) => new Date(`${day}T10:00:00Z`);
const addDays = (day, n) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

describe('automations', () => {
  before(async () => {
    await pingDb();
    await runMigrations();
    ids.admin = (await query(
      `INSERT INTO admins (email, password_hash, role, approval_status) VALUES ($1, 'x', 'admin', 'approved') RETURNING id`,
      [`auto-${tag}@test.local`],
    )).rows[0].id;
    await query(`INSERT INTO contacts (phone, name) VALUES ($1, 'Lina') ON CONFLICT DO NOTHING`, [phone]);
  });

  after(async () => {
    await query(`DELETE FROM leads WHERE phone = ANY($1)`, [[phone, phone2]]);
    await query(`DELETE FROM messages WHERE to_number = ANY($1) OR from_number = ANY($1)`, [[phone, phone2]]);
    await query(`DELETE FROM contacts WHERE phone = $1`, [phone]);
    await query(`DELETE FROM notifications WHERE admin_id = $1`, [ids.admin]);
    await query(`DELETE FROM admins WHERE id = $1`, [ids.admin]);
  });

  it('picks the right trip message for the day', () => {
    const trip = { travelDate: '2026-12-12', returnDate: '2026-12-18' };
    assert.equal(tripMessageDue({ ...trip, today: '2026-12-01' }), null);
    assert.equal(tripMessageDue({ ...trip, today: '2026-12-05' }), 'week');
    assert.equal(tripMessageDue({ ...trip, today: '2026-12-10' }), 'two_days');
    assert.equal(tripMessageDue({ ...trip, today: '2026-12-12' }), 'departure');
    assert.equal(tripMessageDue({ ...trip, today: '2026-12-15' }), null);
    assert.equal(tripMessageDue({ ...trip, today: '2026-12-19' }), 'welcome_back');
    assert.equal(tripMessageDue({ ...trip, today: '2026-12-25' }), null);
  });

  it('writes the messages in the customer language', () => {
    assert.match(customerMessage('departure', 'ar', { name: 'لينا', emergency: '+972 50' }), /^مرحباً لينا،\n\nنتمنى لك رحلة سعيدة/);
    assert.match(customerMessage('welcome_back', 'en', {}), /rate it from 1 to 5/);
    assert.equal(parseRating(' ٤ '), 4);
    assert.equal(parseRating('5 stars'), null);
  });

  it('sends each trip message once, only when turned on, and asks for a rating after the trip', async () => {
    const today = '2026-12-05';
    ids.trip = (await query(
      `INSERT INTO leads (phone, destination, travel_date, return_date, nights, source, lifecycle_status)
       VALUES ($1, 'Antalya', $2, $3, 5, 'web', 'booked') RETURNING id`,
      [phone, addDays(today, 6), addDays(today, 11)],
    )).rows[0].id;

    assert.deepEqual(await runTripMessages({ settings: { auto_trip_messages: false }, now: noon(today), send }), []);
    const first = await runTripMessages({ settings: { auto_trip_messages: true, emergency_phone: '+972501112222' }, now: noon(today), send });
    assert.deepEqual(first.filter((s) => s.lead_id === ids.trip).map((s) => s.key), ['week']);
    const again = await runTripMessages({ settings: { auto_trip_messages: true }, now: noon(today), send });
    assert.equal(again.filter((s) => s.lead_id === ids.trip).length, 0, 'not twice');
    assert.ok(outbox.some((m) => m.to === phone && m.text.includes('Antalya') && m.text.includes('/portal')));

    const night = new Date(`${addDays(today, 6)}T22:30:00Z`);
    assert.deepEqual(await runTripMessages({ settings: { auto_trip_messages: true }, now: night, send }), [], 'no messages at night');

    const back = addDays(today, 12);
    const late = await runTripMessages({ settings: { auto_trip_messages: true }, now: noon(back), send });
    assert.deepEqual(late.filter((s) => s.lead_id === ids.trip).map((s) => s.key), ['welcome_back']);
    assert.equal((await query(`SELECT rating FROM trip_ratings WHERE lead_id = $1`, [ids.trip])).rows[0].rating, null);
  });

  it('a low rating alerts the managers; a reply that is not a rating is left alone', async () => {
    assert.equal(await handleRatingReply(phone, 'thanks!', { send }), false);
    assert.equal(await handleRatingReply(phone, '2', { send }), true);
    assert.equal((await query(`SELECT rating FROM trip_ratings WHERE lead_id = $1`, [ids.trip])).rows[0].rating, 2);
    const alert = (await listNotifications(ids.admin)).notifications.find((n) => n.kind === 'low_rating' && n.lead_id === ids.trip);
    assert.equal(alert.data.rating, 2);
    assert.match(outbox.at(-1).text, /نأسف|sorry/);
    assert.equal(await handleRatingReply(phone, '5', { send }), false, 'already rated');
  });

  it('alerts managers once about a new lead nobody has answered', async () => {
    const lead = (await query(
      `INSERT INTO leads (phone, destination, travel_date, return_date, nights, source, created_at)
       VALUES ($1, 'Rome', CURRENT_DATE + 40, CURRENT_DATE + 44, 4, 'whatsapp', NOW() - INTERVAL '20 minutes') RETURNING id`,
      [phone2],
    )).rows[0].id;
    assert.ok((await runLeadWaitAlerts({ settings: { lead_wait_alert_minutes: 15 } })).includes(lead));
    assert.ok(!(await runLeadWaitAlerts({ settings: { lead_wait_alert_minutes: 15 } })).includes(lead));
    assert.deepEqual(await runLeadWaitAlerts({ settings: { lead_wait_alert_minutes: 0 } }), []);
    assert.ok((await listNotifications(ids.admin)).notifications.some((n) => n.kind === 'lead_waiting' && n.lead_id === lead));
  });

  it('follows up once on a sent quote with no answer, and tells staff when it is first opened', async () => {
    const lead = (await query(
      `INSERT INTO leads (phone, destination, travel_date, return_date, nights, source, lifecycle_status)
       VALUES ($1, 'Paris', CURRENT_DATE + 30, CURRENT_DATE + 34, 4, 'web', 'sent') RETURNING id`,
      [phone],
    )).rows[0].id;
    await upsertDraft(lead, { currency: 'USD', markup_type: 'percent', markup_value: 10 });
    await setDraftItems(lead, [{ source_type: 'manual', source_id: 'x', label: 'Hotel', net_cost: 800, currency: 'USD' }]);
    const { version } = await lockQuoteVersion(lead, { actorRole: 'admin' });
    const token = await createShareToken(version.id);
    await query(
      `INSERT INTO quote_deliveries (quote_version_id, channel, recipient, status, sent_at) VALUES ($1, 'whatsapp', $2, 'sent', NOW() - INTERVAL '50 hours')`,
      [version.id, `+${phone}`],
    );
    const settings = { auto_quote_followup: true, quote_followup_hours: 48 };
    assert.deepEqual(await runQuoteFollowups({ settings: { ...settings, auto_quote_followup: false }, send }), []);
    assert.ok((await runQuoteFollowups({ settings, send })).includes(lead));
    assert.ok(!(await runQuoteFollowups({ settings, send })).includes(lead), 'once');
    assert.ok(outbox.at(-1).text.includes(`/quote/${token.token}`));

    await resolveShareToken(token.token);
    await new Promise((r) => setTimeout(r, 200));
    assert.ok((await listNotifications(ids.admin)).notifications.some((n) => n.kind === 'quote_viewed' && n.lead_id === lead));
  });
});
