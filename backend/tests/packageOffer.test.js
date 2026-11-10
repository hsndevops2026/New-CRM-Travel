import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import { handleIncomingLeadMessage } from '../controllers/whatsappLead.js';
import {
  createConversation,
  createLead,
  getLeadById,
  updateConversation,
} from '../services/leads.js';
import {
  datesMatch,
  findMatchingHotelPackage,
  formatHotelOptionQuestion,
  formatPackageOfferMessage,
  nextHotelOptionChoice,
  normalizePlace,
  parseHotelOptionChoice,
  parsePackageDecision,
  placeMatches,
  tailorPackageQuote,
} from '../services/packageOffer.js';
import { createPredefinedQuote, deletePredefinedQuote } from '../services/predefinedQuotes.js';
import { getComparisonItems } from '../services/comparisonNormalizer.js';

describe('package place matching', () => {
  it('treats Dubai and dubai marina as the same place', () => {
    assert.equal(normalizePlace('  Dubai, UAE '), 'dubai uae');
    assert.equal(placeMatches('Dubai', 'dubai'), true);
    assert.equal(placeMatches('Dubai marina', 'Dubai'), true);
    assert.equal(placeMatches('Paris', 'Dubai'), false);
  });

  it('requires both destination dates to match the package window', () => {
    const quote = {
      destination: 'Dubai',
      travel_date: '2026-12-01',
      return_date: '2026-12-04',
    };
    assert.equal(
      datesMatch({ travel_date: '2026-12-01', return_date: '2026-12-04' }, quote),
      true,
    );
    assert.equal(
      datesMatch({ travel_date: '2026-12-01', return_date: '2026-12-08' }, quote),
      false,
    );
    assert.equal(datesMatch({ travel_date: '2026-11-01', return_date: '2026-11-04' }, quote), false);
    assert.equal(datesMatch({ travel_date: '2026-12-01' }, quote), false);
    assert.equal(datesMatch({}, quote), false);
    assert.equal(
      datesMatch(
        { travel_date: '2026-12-01', return_date: '2026-12-04' },
        { destination: 'Dubai' },
      ),
      false,
    );
    assert.equal(
      datesMatch(
        { travel_date: '2026-12-10', return_date: '2026-12-15' },
        {
          items: [{ item_type: 'hotel', check_in: '2026-12-10', check_out: '2026-12-15' }],
        },
      ),
      true,
    );
    assert.equal(
      datesMatch(
        { travel_date: '2026-11-01', return_date: '2026-11-08' },
        {
          items: [
            { item_type: 'hotel', check_in: '2026-11-01', check_out: '2026-11-04' },
            { item_type: 'hotel', check_in: '2026-11-04', check_out: '2026-11-08' },
          ],
        },
      ),
      true,
    );
  });

  it('reads yes/no replies in English and Arabic', () => {
    assert.equal(parsePackageDecision('Yes'), 'yes');
    assert.equal(parsePackageDecision('take it'), 'yes');
    assert.equal(parsePackageDecision('نعم'), 'yes');
    assert.equal(parsePackageDecision('no'), 'no');
    assert.equal(parsePackageDecision('search hotels'), 'no');
    assert.equal(parsePackageDecision('لا'), 'no');
    assert.equal(parsePackageDecision('2 adults'), null);
  });

  it('formats a WhatsApp package offer with hotels and a yes/no prompt', () => {
    const message = formatPackageOfferMessage(
      {
        title: 'Dubai family stay',
        destination: 'Dubai',
        travel_date: '2026-11-01',
        return_date: '2026-11-08',
        nights: 7,
        currency: 'USD',
        total_price: 4320,
        items: [
          { item_type: 'hotel', hotel_name: 'Atlantis The Palm', nights: 3, board_name: 'Half board' },
          { item_type: 'hotel', hotel_name: 'Jumeirah Beach Hotel', nights: 2 },
        ],
      },
      'en',
    );
    assert.match(message, /Dubai family stay/);
    assert.match(message, /Atlantis The Palm/);
    assert.match(message, /YES/i);
    assert.match(message, /NO/i);
  });

  it('asks for one option per hotel and prices only the selected options', () => {
    const quote = {
      title: 'Two-hotel stay',
      destination: 'Dubai',
      currency: 'USD',
      total_price: 2100,
      items: [
        { id: 'a1', item_type: 'hotel', hotel_name: 'Palm Resort', room_name: 'Standard', price: 500, sort_order: 0 },
        { id: 'a2', item_type: 'hotel', hotel_name: 'Palm Resort', room_name: 'Family Suite', price: 800, sort_order: 1, extra: { max_occupancy: 4 } },
        { id: 'b1', item_type: 'hotel', hotel_name: 'Creek Hotel', room_name: 'Deluxe', price: 600, sort_order: 2 },
        { id: 'b2', item_type: 'hotel', hotel_name: 'Creek Hotel', room_name: 'Club', price: 900, sort_order: 3 },
      ],
    };
    const demand = { adults_count: 2, children_count: 2 };
    const choice = nextHotelOptionChoice(quote, demand);

    assert.equal(choice.hotel_name, 'Palm Resort');
    assert.equal(choice.options[0].id, 'a2');
    assert.match(formatHotelOptionQuestion(choice), /recommended for you/i);
    assert.equal(parseHotelOptionChoice('option 2', choice).id, 'a1');
    assert.equal(nextHotelOptionChoice(quote, demand, ['a2']).hotel_name, 'Creek Hotel');

    const tailored = tailorPackageQuote(quote, demand, ['a2', 'b1']);
    assert.deepEqual(tailored.items.map((item) => item.id), ['a2', 'b1']);
    assert.equal(tailored.display_total, 1400);
    assert.deepEqual(tailored.selected_item_ids, ['a2', 'b1']);
  });
});

describe('WhatsApp hotel package offer', () => {
  const createdQuoteIds = [];
  const phones = [];

  before(async () => {
    await pingDb();
    await runMigrations();
  });

  after(async () => {
    if (phones.length) {
      await query(`DELETE FROM leads WHERE phone = ANY($1::text[])`, [phones]);
      await query(`DELETE FROM conversations WHERE phone = ANY($1::text[])`, [phones]);
    }
    for (const id of createdQuoteIds) {
      await deletePredefinedQuote(id);
    }
    try {
      const { getHotelQuoteQueue } = await import('../queues/hotelQuoteQueue.js');
      await getHotelQuoteQueue().close();
    } catch {
      /* ignore */
    }
  });

  it('finds a hotel package only when destination and dates both match', async () => {
    const destination = `PkgCity${Date.now()}`;
    const demand = {
      destination,
      travel_date: '2026-12-01',
      return_date: '2026-12-04',
    };
    const quote = await createPredefinedQuote({
      title: `${destination} weekend`,
      destination,
      travel_date: demand.travel_date,
      return_date: demand.return_date,
      adults_count: 2,
      items: [{ item_type: 'hotel', hotel_name: 'Harbor Inn', price: 400 }],
    });
    createdQuoteIds.push(quote.id);

    const match = await findMatchingHotelPackage(demand);
    assert.ok(match);
    assert.equal(match.id, quote.id);

    assert.equal(
      await findMatchingHotelPackage({ ...demand, destination: 'SomewhereElseXYZ' }),
      null,
    );

    const neighborhood = await findMatchingHotelPackage({
      ...demand,
      destination: `${destination} marina`,
    });
    assert.ok(neighborhood);
    assert.equal(neighborhood.id, quote.id);

    assert.equal(
      await findMatchingHotelPackage({
        destination,
        travel_date: '2026-12-10',
        return_date: '2026-12-14',
      }),
      null,
    );
  });

  it('creates a hotel lead first, offers the matching package, then attaches it on yes', async () => {
    const destination = `OfferCity${Date.now()}`;
    const phone = `97150${String(Date.now()).slice(-8)}`;
    phones.push(phone);

    const quote = await createPredefinedQuote({
      title: `${destination} resort`,
      destination,
      travel_date: '2026-12-10',
      return_date: '2026-12-15',
      adults_count: 2,
      items: [{ item_type: 'hotel', hotel_name: 'Palm Resort', price: 900, nights: 5 }],
    });
    createdQuoteIds.push(quote.id);

    const conversation = await createConversation(phone);
    await updateConversation(conversation.id, {
      collected: {
        booking_type: 'hotel',
        destination,
        travel_date: '2026-12-10',
        return_date: '2026-12-15',
        nights: 5,
        adults_count: 2,
        children_count: 0,
        children_ages: [],
      },
      language: 'en',
      status: 'active',
    });

    const offered = await handleIncomingLeadMessage({
      from: phone,
      text: 'please book this',
      skipWhatsApp: true,
    });

    assert.equal(offered.awaiting_package, true);
    assert.equal(offered.complete, false);
    assert.ok(offered.lead);
    assert.equal(offered.lead.quote_status, null);
    assert.equal(offered.lead.predefined_quote_id, null);
    assert.match(offered.reply, /Palm Resort/);
    assert.equal(offered.predefined_quote.id, quote.id);

    const accepted = await handleIncomingLeadMessage({
      from: phone,
      text: 'yes',
      skipWhatsApp: true,
    });

    assert.equal(accepted.complete, true);
    assert.equal(accepted.awaiting_package, false);
    assert.equal(accepted.lead.predefined_quote_id, quote.id);
    assert.equal(accepted.lead.quote_status, 'package');
    assert.equal(accepted.lead.predefined_quote_title, quote.title);
  });

  it('asks about hotel alternatives before sending a tailored multi-hotel price', async () => {
    const destination = `OptionsCity${Date.now()}`;
    const phone = `97152${String(Date.now()).slice(-8)}`;
    phones.push(phone);

    const quote = await createPredefinedQuote({
      title: `${destination} split stay`,
      destination,
      travel_date: '2026-12-20',
      return_date: '2026-12-27',
      adults_count: 2,
      total_price: 1900,
      items: [
        { item_type: 'hotel', hotel_name: 'Palm Resort', room_name: 'Standard', price: 500, nights: 4, extra: { max_occupancy: 2 } },
        { item_type: 'hotel', hotel_name: 'Palm Resort', room_name: 'Suite', price: 800, nights: 4, extra: { max_occupancy: 4 } },
        { item_type: 'hotel', hotel_name: 'Creek Hotel', room_name: 'Deluxe', price: 600, nights: 3 },
      ],
    });
    createdQuoteIds.push(quote.id);

    const conversation = await createConversation(phone);
    await updateConversation(conversation.id, {
      collected: {
        booking_type: 'hotel',
        destination,
        travel_date: '2026-12-20',
        return_date: '2026-12-27',
        nights: 7,
        adults_count: 2,
        children_count: 0,
        children_ages: [],
      },
      language: 'en',
      status: 'active',
    });

    const asked = await handleIncomingLeadMessage({ from: phone, text: 'show me', skipWhatsApp: true });
    assert.equal(asked.awaiting_hotel_option, true);
    assert.match(asked.reply, /Palm Resort has multiple options/i);
    assert.match(asked.reply, /recommended for you/i);
    assert.doesNotMatch(asked.reply, /Would you like this package/i);

    const priced = await handleIncomingLeadMessage({ from: phone, text: '2', skipWhatsApp: true });
    assert.equal(priced.awaiting_hotel_option, false);
    assert.equal(priced.awaiting_package, true);
    assert.match(priced.reply, /Suite/);
    assert.match(priced.reply, /Creek Hotel/);
    assert.match(priced.reply, /USD 1,400/);
    assert.doesNotMatch(priced.reply, /Standard/);

    const accepted = await handleIncomingLeadMessage({ from: phone, text: 'yes', skipWhatsApp: true });
    assert.equal(accepted.complete, true);
    assert.equal(accepted.lead.predefined_quote_id, quote.id);
    assert.equal(accepted.lead.raw_collected._selected_package_item_ids.length, 2);

    const comparison = await getComparisonItems(accepted.lead.id);
    const attached = comparison.items.find((item) => item.id === `predefined:${quote.id}`);
    assert.equal(attached.net_cost, 1400);
    assert.match(attached.description, /Palm Resort \+ Creek Hotel/);
  });

  it('keeps the lead as a normal hotel search when the user declines the package', async () => {
    const destination = `DeclineCity${Date.now()}`;
    const phone = `97156${String(Date.now()).slice(-8)}`;
    phones.push(phone);

    const quote = await createPredefinedQuote({
      title: `${destination} stay`,
      destination,
      items: [{ item_type: 'hotel', hotel_name: 'City Hotel', price: 200 }],
    });
    createdQuoteIds.push(quote.id);

    const lead = await createLead({
      phone,
      collected: {
        booking_type: 'hotel',
        destination,
        travel_date: '2026-12-01',
        return_date: '2026-12-04',
        nights: 3,
        adults_count: 2,
        children_count: 0,
      },
      summary: `HOTEL: ${destination}`,
      skipQuoteFetch: true,
    });
    assert.equal(lead.quote_status, null);

    const conversation = await createConversation(phone);
    await updateConversation(conversation.id, {
      collected: {
        booking_type: 'hotel',
        destination,
        travel_date: '2026-12-01',
        return_date: '2026-12-04',
        nights: 3,
        adults_count: 2,
        children_count: 0,
        children_ages: [],
        _pending_package_id: quote.id,
        _pending_lead_id: lead.id,
      },
      language: 'en',
      status: 'active',
    });

    const declined = await handleIncomingLeadMessage({
      from: phone,
      text: 'no',
      skipWhatsApp: true,
    });

    assert.equal(declined.complete, true);
    const updated = await getLeadById(lead.id);
    assert.equal(updated.predefined_quote_id, null);
    assert.ok(updated.quote_status === 'processing' || updated.quote_status === 'error');
  });
});
