import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hotelSourcesOutcome, mapBookingHotel } from '../services/bookingHotels.js';

describe('mapBookingHotel', () => {
  it('maps Booking.com RapidAPI property payload', () => {
    const quote = mapBookingHotel(
      {
        property: {
          id: 12345,
          name: 'Marina Bay Hotel',
          reviewScore: 8.7,
          reviewCount: 2100,
          reviewScoreWord: 'Excellent',
          photoUrls: ['https://example.com/photo.jpg'],
          priceBreakdown: { grossPrice: { value: 412.4, currency: 'USD' } },
          isFreeCancellable: true,
          propertyClass: 4,
          latitude: 1.28,
          longitude: 103.85,
        },
      },
      'USD',
    );

    assert.equal(quote.id, '12345');
    assert.equal(quote.hotel_name, 'Marina Bay Hotel');
    assert.equal(quote.price, 412.4);
    assert.equal(quote.currency, 'USD');
    assert.equal(quote.review_score, 8.7);
    assert.equal(quote.photo_url, 'https://example.com/photo.jpg');
    assert.equal(quote.free_cancellation, true);
    assert.equal(quote.provider, 'booking.com');
    assert.equal(quote.category, '4 star');
  });
});

describe('hotelSourcesOutcome', () => {
  const failed = { ok: false, error: 'Booking.com failed', count: 0 };
  const emptyOk = { ok: true, error: null, count: 0 };
  const withQuotes = { ok: true, error: null, count: 3 };

  it('stays completed until every source has been attempted and at least one succeeded', () => {
    const outcome = hotelSourcesOutcome({
      hotelbeds: withQuotes,
      booking: failed,
      airbnb: emptyOk,
    });
    assert.equal(outcome.status, 'completed');
    assert.equal(outcome.error, null);
  });

  it('is error only when Hotelbeds, Booking.com, and Airbnb all fail', () => {
    const outcome = hotelSourcesOutcome({
      hotelbeds: failed,
      booking: { ok: false, error: 'rate limited', count: 0 },
      airbnb: { ok: false, error: 'not subscribed', count: 0 },
    });
    assert.equal(outcome.status, 'error');
    assert.match(outcome.error, /Booking.com failed/);
    assert.match(outcome.error, /not subscribed/);
  });
});
