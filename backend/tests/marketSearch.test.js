import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapGoogleHotel } from '../services/marketSearch.js';

describe('Google Hotels market results', () => {
  it('uses the total stay rate and preserves the listing source', () => {
    const result = mapGoogleHotel({
      name: 'Example Hotel', property_token: 'property-1',
      rate_per_night: { extracted_lowest: 100 },
      total_rate: { extracted_lowest: 215, lowest: '$215' },
      prices: [{ source: 'Booking.com' }],
      overall_rating: 4.5, reviews: 29,
    });
    assert.equal(result.price, 215);
    assert.equal(result.price_basis, 'total stay');
    assert.equal(result.seller, 'Booking.com');
    assert.equal(result.provider, 'Google · SerpApi');
    assert.equal(result.property_token, 'property-1');
  });

  it('uses the nightly rate when a total stay price is absent', () => {
    const result = mapGoogleHotel({ name: 'Nightly Hotel', rate_per_night: { extracted_lowest: 89, lowest: '$89' } });
    assert.equal(result.price, 89);
    assert.equal(result.price_text, '$89');
    assert.equal(result.price_basis, 'per night');
  });

  it('does not turn a missing rate into a zero price', () => {
    const result = mapGoogleHotel({ name: 'Unavailable Hotel' });
    assert.equal(result.price, null);
    assert.equal(result.price_text, null);
    assert.equal(result.price_basis, null);
  });

  it('uses a listing rate when the property rate is absent', () => {
    const result = mapGoogleHotel({ name: 'Listed Hotel', prices: [{ source: 'Booking.com', rate_per_night: { extracted_lowest: 120 } }] });
    assert.equal(result.price, 120);
    assert.equal(result.seller, 'Booking.com');
    assert.equal(result.price_basis, 'per night');
  });

  it('retains a formatted total when SerpApi omits the extracted number', () => {
    const result = mapGoogleHotel({ name: 'Text Hotel', total_rate: { lowest: '$1,250' } });
    assert.equal(result.price, null);
    assert.equal(result.price_text, '$1,250');
    assert.equal(result.price_basis, 'total stay');
  });
});
