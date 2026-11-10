import './support/isolatedRedis.js';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, pool, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import {
  acceptPackageOffer,
  createLead,
  createLeadFromInput,
  declinePackageOffer,
  getLeadById,
  startQuoteFetchForLead,
} from '../services/leads.js';
import { createPredefinedQuote, deletePredefinedQuote, normalizeQuoteInput } from '../services/predefinedQuotes.js';
import { getQuoteQueue } from '../queues/quoteQueue.js';
import { getHotelQuoteQueue } from '../queues/hotelQuoteQueue.js';

/**
 * When a customer (or agent) turns a predefined package down, the normal API search must
 * start — for what they ASKED for. Declining used to start a hotel search for anything
 * that was not a flight+hotel package, so a flight request would have searched hotels.
 */
describe('declining a predefined package starts the right search', () => {
  const phone = `99900${String(Date.now()).slice(-6)}`;
  const leadIds = [];
  const quoteIds = [];
  const flightQueue = () => getQuoteQueue();
  const hotelQueue = () => getHotelQuoteQueue();

  before(async () => {
    await pingDb();
    await runMigrations();
  });

  after(async () => {
    for (const id of leadIds) {
      await (await flightQueue().getJob(`lead-${id}`))?.remove().catch(() => {});
      await (await hotelQueue().getJob(`hotel-lead-${id}`))?.remove().catch(() => {});
    }
    await query(`DELETE FROM leads WHERE id = ANY($1::uuid[])`, [leadIds]);
    for (const id of quoteIds) await deletePredefinedQuote(id);
    // This test owns its (isolated, non-zero) Redis database, so leave nothing behind.
    await flightQueue().obliterate({ force: true }).catch(() => {});
    await hotelQueue().obliterate({ force: true }).catch(() => {});
    await flightQueue().close();
    await hotelQueue().close();
    await pool.end();
  });

  async function offerFor(bookingType) {
    const quote = await createPredefinedQuote(
      normalizeQuoteInput({
        title: `ZZ-TEST ${bookingType} package ${phone}`, origin: 'Mumbai', destination: 'London',
        currency: 'USD', total_price: 800, travel_date: '2027-01-10', return_date: '2027-01-20',
        items: bookingType === 'hotel'
          ? [{ item_type: 'hotel', hotel_name: 'Test Hotel', check_in: '2027-01-10', check_out: '2027-01-20' }]
          : [{ item_type: 'flight', direction: 'outbound', airline: 'Test Air', departure_airport: 'BOM', arrival_airport: 'LHR', departure_time: '2027-01-10 02:30' },
             { item_type: 'flight', direction: 'return', airline: 'Test Air', departure_airport: 'LHR', arrival_airport: 'BOM', departure_time: '2027-01-20 14:00' }],
      }),
      {},
    );
    quoteIds.push(quote.id);

    const lead = await createLead({
      phone: `${phone}${leadIds.length}`,
      collected: {
        booking_type: bookingType, origin: bookingType === 'hotel' ? null : 'Mumbai', destination: 'London',
        travel_date: '2027-01-10', return_date: '2027-01-20', adults_count: 2, children_count: 0, children_ages: [],
      },
      summary: 'test', status: 'new', source: 'whatsapp',
      skipQuoteFetch: true, pendingPackageOfferId: quote.id,
    });
    leadIds.push(lead.id);
    return { lead, quote };
  }

  it('a declined FLIGHT offer starts a flight search — and no hotel search', async () => {
    const { lead } = await offerFor('flight');
    assert.ok(lead.pending_package_offer_id, 'the offer is pending');

    const after = await declinePackageOffer(lead.id);

    assert.equal(after.pending_package_offer_id, null);
    assert.equal(after.quote_status, 'processing');
    assert.ok(await flightQueue().getJob(`lead-${lead.id}`), 'a flight quote job was queued');
    assert.equal(await hotelQueue().getJob(`hotel-lead-${lead.id}`), undefined, 'no hotel job was queued');
  });

  it('a declined HOTEL offer still starts a hotel search', async () => {
    const { lead } = await offerFor('hotel');
    await declinePackageOffer(lead.id);

    assert.ok(await hotelQueue().getJob(`hotel-lead-${lead.id}`), 'a hotel quote job was queued');
    assert.equal(await flightQueue().getJob(`lead-${lead.id}`), undefined, 'no flight job was queued');
  });

  it('a declined flight+hotel PACKAGE offer starts with flights, as before', async () => {
    const { lead } = await offerFor('package');
    await declinePackageOffer(lead.id);

    assert.ok(await flightQueue().getJob(`lead-${lead.id}`), 'flights are fetched first');
    const refreshed = await getLeadById(lead.id);
    assert.equal(refreshed.quote_status, 'processing');
    assert.equal(refreshed.quote_search?.phase, 'flights');
  });

  it('accepting a flight offer attaches the package and starts no search', async () => {
    const { lead, quote } = await offerFor('flight');
    const accepted = await acceptPackageOffer(lead.id);

    assert.equal(accepted.predefined_quote_id, quote.id);
    assert.equal(accepted.quote_status, 'package');
    assert.equal(accepted.pending_package_offer_id, null);
    assert.equal(await flightQueue().getJob(`lead-${lead.id}`), undefined);
    assert.equal(await hotelQueue().getJob(`hotel-lead-${lead.id}`), undefined);
  });

  it('the CRM add-lead path offers a flight package for a matching flight lead', async () => {
    const { quote } = await offerFor('flight');
    const input = {
      phone: `${phone}9`, booking_type: 'flight', origin: 'Mumbai', destination: 'London',
      travel_date: '2027-01-10', return_date: '2027-01-20', adults_count: 2, children_count: 0,
    };

    const { lead, suggested_package } = await createLeadFromInput(input);
    leadIds.push(lead.id);

    assert.equal(suggested_package?.id, quote.id);
    assert.equal(lead.pending_package_offer_id, quote.id);
    // The offer is pending, so the normal flight search is held back until it is answered.
    assert.equal(await flightQueue().getJob(`lead-${lead.id}`), undefined);
  });

  it('the CRM add-lead path starts the normal flight search when nothing matches', async () => {
    await offerFor('flight');
    const { lead, suggested_package } = await createLeadFromInput({
      phone: `${phone}8`, booking_type: 'flight', origin: 'Delhi', destination: 'Paris',
      travel_date: '2027-03-01', return_date: '2027-03-09', adults_count: 1, children_count: 0,
    });
    leadIds.push(lead.id);

    assert.equal(suggested_package, null);
    assert.equal(lead.pending_package_offer_id, null);
    assert.ok(await flightQueue().getJob(`lead-${lead.id}`), 'flight search queued as usual');
  });

  it('startQuoteFetchForLead picks the search by what the lead asked for', async () => {
    const { lead: flightLead } = await offerFor('flight');
    await startQuoteFetchForLead(flightLead.id);
    assert.ok(await flightQueue().getJob(`lead-${flightLead.id}`));
    assert.equal(await hotelQueue().getJob(`hotel-lead-${flightLead.id}`), undefined);

    assert.equal(await startQuoteFetchForLead('00000000-0000-0000-0000-000000000000'), null);
  });
});
