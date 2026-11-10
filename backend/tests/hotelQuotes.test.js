import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { groupHotelQuotesBySource, normalizeHotelProvider } from '../services/hotelQuotes.js';

describe('normalizeHotelProvider', () => {
  it('keeps airbnb distinct from hotelbeds and booking.com', () => {
    assert.equal(normalizeHotelProvider('airbnb'), 'airbnb');
    assert.equal(normalizeHotelProvider('Airbnb'), 'airbnb');
    assert.equal(normalizeHotelProvider('booking.com'), 'booking.com');
    assert.equal(normalizeHotelProvider('hotelbeds'), 'hotelbeds');
  });
});

describe('groupHotelQuotesBySource', () => {
  it('groups persisted airbnb quotes into their own source', () => {
    const grouped = groupHotelQuotesBySource(
      [
        { provider: 'hotelbeds', hotel_name: 'HB' },
        { provider: 'booking.com', hotel_name: 'BK' },
        { provider: 'airbnb', hotel_name: 'AB' },
      ],
      { sources: { airbnb: { error: null } } },
    );

    assert.equal(grouped.airbnb.ok, true);
    assert.equal(grouped.airbnb.count, 1);
    assert.equal(grouped.airbnb.quotes[0].hotel_name, 'AB');
    assert.equal(grouped.booking.count, 1);
    assert.equal(grouped.hotelbeds.count, 1);
  });
});
