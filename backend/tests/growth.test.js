import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import {
  listPastCustomers,
  listPublicOffers,
  requestOffer,
  sendOfferToCustomer,
  setOfferPublic,
  travelHistory,
} from '../services/growth.js';

const tag = String(Date.now()).slice(-7);
const visitor = `97258${tag}`;
const pastPhone = `97259${tag}`;
const ids = {};

describe('growth', () => {
  before(async () => {
    await pingDb();
    await runMigrations();
    ids.offer = (await query(
      `INSERT INTO predefined_quotes (title, quote_type, destination, currency, total_price, client_name, notes, nights)
       VALUES ($1, 'package', 'Sharm', 'USD', 899, 'Private client', 'internal note', 4) RETURNING id`,
      [`Sharm week ${tag}`],
    )).rows[0].id;
    ids.past = (await query(
      `INSERT INTO leads (phone, destination, travel_date, return_date, nights, source, lifecycle_status)
       VALUES ($1, 'Antalya', (DATE_TRUNC('year', CURRENT_DATE) - INTERVAL '1 year' + INTERVAL '6 months')::date,
               (DATE_TRUNC('year', CURRENT_DATE) - INTERVAL '1 year' + INTERVAL '6 months' + INTERVAL '5 days')::date, 5, 'whatsapp', 'booked')
       RETURNING id`,
      [pastPhone],
    )).rows[0].id;
    await query(`INSERT INTO contacts (phone, name) VALUES ($1, 'Nour') ON CONFLICT DO NOTHING`, [pastPhone]);
  });

  after(async () => {
    await query(`DELETE FROM leads WHERE phone = ANY($1)`, [[visitor, pastPhone]]);
    await query(`DELETE FROM customer_outreach WHERE phone = $1`, [pastPhone]);
    await query(`DELETE FROM messages WHERE to_number = $1`, [pastPhone]);
    await query(`DELETE FROM contacts WHERE phone = ANY($1)`, [[visitor, pastPhone]]);
    await query(`DELETE FROM predefined_quotes WHERE id = $1`, [ids.offer]);
  });

  it('shows only packages marked public, without internal fields', async () => {
    assert.ok(!(await listPublicOffers()).offers.some((o) => o.id === ids.offer));
    await setOfferPublic(ids.offer, true);
    const offer = (await listPublicOffers()).offers.find((o) => o.id === ids.offer);
    assert.equal(offer.price, 899);
    assert.equal(offer.client_name, undefined);
    assert.equal(offer.notes, undefined);
  });

  it('"I want this" creates one web lead with the package attached', async () => {
    await assert.rejects(requestOffer(ids.offer, { name: '', phone: visitor }), { status: 400 });
    await assert.rejects(requestOffer(ids.offer, { name: 'Ali', phone: '123' }), { status: 400 });
    await assert.rejects(requestOffer(ids.offer, { name: 'Ali', phone: visitor }), { status: 400 }, 'needs a date');
    const first = await requestOffer(ids.offer, { name: 'Ali', phone: `+${visitor}`, adults: 2, children: 1, travel_date: '2027-05-01' });
    const lead = (await query(`SELECT * FROM leads WHERE id = $1`, [first.lead_id])).rows[0];
    assert.equal(lead.source, 'web');
    assert.equal(lead.predefined_quote_id, ids.offer);
    assert.equal(lead.phone, visitor);
    assert.equal((await requestOffer(ids.offer, { name: 'Ali', phone: visitor })).duplicate, true);
    await setOfferPublic(ids.offer, false);
    await assert.rejects(requestOffer(ids.offer, { name: 'Ali', phone: visitor }), { status: 404 });
  });

  it('finds past customers by month and destination', async () => {
    const july = await listPastCustomers({ month: 7 });
    const row = july.find((c) => c.phone === pastPhone);
    assert.equal(row.name, 'Nour');
    assert.equal(row.last_destination, 'Antalya');
    assert.ok(!(await listPastCustomers({ month: 1 })).some((c) => c.phone === pastPhone));
    assert.ok((await listPastCustomers({ destination: 'antal' })).some((c) => c.phone === pastPhone));
  });

  it('sends one offer per customer per week', async () => {
    const outbox = [];
    const send = async (to, text) => outbox.push({ to, text });
    await assert.rejects(sendOfferToCustomer({ phone: pastPhone, text: ' ', send }), { status: 400 });
    await sendOfferToCustomer({ phone: pastPhone, text: 'Antalya again this summer?', offerId: ids.offer, send });
    assert.equal(outbox.length, 1);
    await assert.rejects(sendOfferToCustomer({ phone: pastPhone, text: 'again', send }), { status: 409 });
    assert.ok((await listPastCustomers({ month: 7 })).find((c) => c.phone === pastPhone).last_offer_at);
  });

  it('builds the travel history with totals', async () => {
    const history = await travelHistory(pastPhone);
    assert.equal(history.trips.length, 1);
    assert.equal(history.trips[0].destination, 'Antalya');
    assert.deepEqual(history.totals, []);
  });
});
