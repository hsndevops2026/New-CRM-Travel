import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import { demoDubaiQuoteInput, demoNewYorkQuoteInput, DEMO_NYC_QUOTE_TITLE } from '../db/seedPredefinedQuotes.js';
import { signCloudinaryParams } from '../services/uploads.js';
import {
  createPredefinedQuote,
  deletePredefinedQuote,
  deriveQuoteType,
  displayTotal,
  getPredefinedQuote,
  listPredefinedQuotes,
  nightsBetween,
  normalizeQuoteInput,
  quoteFilename,
  updatePredefinedQuote,
} from '../services/predefinedQuotes.js';

describe('predefined quote helpers', () => {
  it('derives hotel, flight, and package types from items', () => {
    assert.equal(deriveQuoteType([{ item_type: 'hotel' }]), 'hotel');
    assert.equal(deriveQuoteType([{ item_type: 'flight' }]), 'flight');
    assert.equal(
      deriveQuoteType([{ item_type: 'hotel' }, { item_type: 'flight' }]),
      'package',
    );
  });

  it('counts nights between dates and names the PDF file from the title', () => {
    assert.equal(nightsBetween('2026-11-01', '2026-11-05'), 4);
    assert.equal(quoteFilename({ title: 'Dubai Family Package!' }), 'dubai-family-package.pdf');
  });

  it('uses an explicit total when set, otherwise sums item prices', () => {
    assert.equal(
      displayTotal({
        total_price: 1200,
        items: [{ price: 400 }, { price: 500 }],
      }),
      1200,
    );
    assert.equal(
      displayTotal({
        total_price: null,
        items: [{ price: 400 }, { price: 500 }],
      }),
      900,
    );
  });

  it('requires a title and at least one hotel or flight', () => {
    assert.throws(() => normalizeQuoteInput({ title: '  ', items: [] }), /title/i);
    assert.throws(() => normalizeQuoteInput({ title: 'Dubai', items: [] }), /at least one/i);
    assert.throws(
      () => normalizeQuoteInput({ title: 'Dubai', items: [{ item_type: 'hotel' }] }),
      /hotel name/i,
    );
  });

  it('stores per-hotel city/country and derives destination from the first hotel city', () => {
    const quote = normalizeQuoteInput({
      title: 'NYC split stay',
      travel_date: '2026-10-10',
      return_date: '2026-10-20',
      items: [
        {
          item_type: 'hotel',
          hotel_name: 'Hotel Midtown',
          city: 'New York',
          country: 'United States',
          check_in: '2026-10-10',
          check_out: '2026-10-15',
          price: 900,
        },
        {
          item_type: 'hotel',
          hotel_name: 'Hotel Brooklyn',
          city: 'New York',
          country: 'United States',
          check_in: '2026-10-15',
          check_out: '2026-10-20',
          price: 700,
        },
      ],
    });
    assert.equal(quote.quote_type, 'hotel');
    assert.equal(quote.destination, 'New York');
    assert.equal(quote.items[0].city, 'New York');
    assert.equal(quote.items[0].country, 'United States');
    assert.equal(quote.items[1].check_in, '2026-10-15');
  });

  it('rejects hotel stays where check-out is not after check-in', () => {
    assert.throws(
      () =>
        normalizeQuoteInput({
          title: 'Bad stay',
          items: [
            {
              item_type: 'hotel',
              hotel_name: 'Bad Hotel',
              city: 'Paris',
              country: 'France',
              check_in: '2026-10-15',
              check_out: '2026-10-15',
            },
          ],
        }),
      /check-out must be after check-in/i,
    );
  });

  it('normalizes a flight quote with outbound and return legs', () => {
    const quote = normalizeQuoteInput({
      title: 'DXB to JFK',
      origin: 'DXB',
      destination: 'New York',
      travel_date: '2026-12-12',
      return_date: '2026-12-18',
      items: [
        {
          item_type: 'flight',
          airline: 'Emirates',
          departure_airport: 'DXB',
          arrival_airport: 'JFK',
          direction: 'outbound',
          price: 900,
        },
        {
          item_type: 'flight',
          airline: 'Emirates',
          departure_airport: 'JFK',
          arrival_airport: 'DXB',
          direction: 'return',
          price: 900,
        },
      ],
    });
    assert.equal(quote.quote_type, 'flight');
    assert.equal(quote.origin, 'DXB');
    assert.equal(quote.destination, 'New York');
    assert.equal(quote.items.map((item) => item.direction).join(','), 'outbound,return');
  });

  it('signs Cloudinary params the way the upload API expects', () => {
    const signature = signCloudinaryParams(
      { folder: 'travel/quotes', timestamp: 1700000000 },
      'secret',
    );
    assert.equal(signature, 'b915a5726fc8e4851ac030156e00a1afa3d3943c');
  });
});

describe('predefined quotes', () => {
  const createdIds = [];

  before(async () => {
    await pingDb();
    await runMigrations();
  });

  after(async () => {
    if (createdIds.length) {
      await query(`DELETE FROM predefined_quotes WHERE id = ANY($1::uuid[])`, [createdIds]);
    }
  });

  it('creates a package with multiple hotels and flights, then updates and deletes it', async () => {
    const created = await createPredefinedQuote({
      title: 'Bali weekender',
      destination: 'Bali',
      origin: 'DXB',
      travel_date: '2026-11-01',
      return_date: '2026-11-06',
      adults_count: 2,
      items: [
        {
          item_type: 'hotel',
          hotel_name: 'Ubud Villas',
          city: 'Ubud',
          country: 'Indonesia',
          category: '5 star',
          check_in: '2026-11-01',
          check_out: '2026-11-04',
          price: 900,
        },
        {
          item_type: 'hotel',
          hotel_name: 'Seminyak Suites',
          city: 'Seminyak',
          country: 'Indonesia',
          check_in: '2026-11-04',
          check_out: '2026-11-06',
          price: 400,
        },
        {
          item_type: 'flight',
          airline: 'Emirates',
          departure_airport: 'DXB',
          arrival_airport: 'DPS',
          direction: 'outbound',
          price: 650,
        },
      ],
    });
    createdIds.push(created.id);

    assert.equal(created.quote_type, 'package');
    assert.equal(created.nights, 5);
    assert.equal(created.items.length, 3);
    assert.equal(created.display_total, 1950);
    assert.equal(created.items[0].city, 'Ubud');
    assert.equal(created.items[0].country, 'Indonesia');

    const listed = await listPredefinedQuotes({ query: 'Bali' });
    assert.equal(listed.some((row) => row.id === created.id), true);

    const updated = await updatePredefinedQuote(created.id, {
      title: 'Bali weekender plus',
      items: [
        { item_type: 'hotel', hotel_name: 'Ubud Villas', price: 950 },
        { item_type: 'flight', airline: 'Emirates', departure_airport: 'DXB', arrival_airport: 'DPS' },
      ],
    });
    assert.equal(updated.title, 'Bali weekender plus');
    assert.equal(updated.quote_type, 'package');
    assert.equal(updated.items.length, 2);

    const loaded = await getPredefinedQuote(created.id);
    assert.equal(loaded.items[0].hotel_name, 'Ubud Villas');

    const deleted = await deletePredefinedQuote(created.id);
    assert.equal(deleted.id, created.id);
    assert.equal(await getPredefinedQuote(created.id), null);
  });

  it('seeds an end-to-end New York package with flights and hotels', async () => {
    const listed = await listPredefinedQuotes({ query: 'New York' });
    const nyc = listed.find((row) => row.title === DEMO_NYC_QUOTE_TITLE);
    assert.ok(nyc, 'New York demo package should be seeded');
    assert.equal(nyc.quote_type, 'package');
    assert.equal(nyc.destination, 'New York');
    assert.equal(nyc.items.filter((item) => item.item_type === 'hotel').length, 2);
    assert.equal(nyc.items.filter((item) => item.item_type === 'flight').length, 2);
  });
});

describe('demo predefined quote', () => {
  it('includes three hotels with stay, room, board, dates, price, and photo', () => {
    const input = demoDubaiQuoteInput();
    const hotels = input.items.filter((item) => item.item_type === 'hotel');
    assert.equal(hotels.length, 3);
    for (const hotel of hotels) {
      assert.ok(hotel.hotel_name);
      assert.ok(hotel.category);
      assert.ok(hotel.room_name);
      assert.ok(hotel.board_name);
      assert.ok(hotel.check_in);
      assert.ok(hotel.check_out);
      assert.ok(hotel.nights > 0);
      assert.ok(hotel.price > 0);
      assert.ok(hotel.image_url);
      assert.ok(hotel.description);
    }
    const quote = normalizeQuoteInput(input);
    assert.equal(quote.quote_type, 'hotel');
    assert.equal(quote.nights, 7);
    assert.equal(quote.items.length, 3);
  });

  it('builds an end-to-end New York package with flights and two hotels', () => {
    const input = demoNewYorkQuoteInput();
    const hotels = input.items.filter((item) => item.item_type === 'hotel');
    const flights = input.items.filter((item) => item.item_type === 'flight');
    assert.equal(hotels.length, 2);
    assert.equal(flights.length, 2);
    assert.equal(input.destination, 'New York');
    assert.equal(
      flights.map((item) => item.direction).sort().join(','),
      'outbound,return',
    );
    for (const hotel of hotels) {
      assert.ok(hotel.hotel_name);
      assert.ok(hotel.room_name);
      assert.ok(hotel.board_name);
      assert.ok(hotel.check_in);
      assert.ok(hotel.check_out);
      assert.ok(hotel.nights > 0);
      assert.ok(hotel.price > 0);
      assert.ok(hotel.image_url);
    }
    const quote = normalizeQuoteInput(input);
    assert.equal(quote.quote_type, 'package');
    assert.equal(quote.nights, 6);
    assert.equal(quote.items.length, 4);
    assert.equal(quote.destination, 'New York');
  });
});
