import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapAirbnbHotel } from '../services/airbnbHotels.js';

const londonListing = {
  listing: {
    city: 'London',
    coordinate: { latitude: 51.5207, longitude: -0.103 },
    id: '16344377',
    name: 'Clerkenwell Farringdon Studio Apartment S',
    title: 'Apartment in Clerkenwell',
  },
  demandStayListing: {
    listingRatingStats: {
      overallRatingStats: { ratingCount: '35' },
    },
  },
  title: 'Apartment in Clerkenwell',
  subtitle: 'Clerkenwell Farringdon Studio Apartment S',
  contextualPictures: [
    {
      picture:
        'https://a0.muscache.com/im/pictures/hosting/Hosting-16344377/original/photo.jpeg',
    },
  ],
  structuredDisplayPrice: {
    primaryLine: {
      accessibilityLabel: '$1,015 USD total',
      price: '$1,015 USD',
      qualifier: 'total',
    },
  },
  avgRatingLocalized: '4.71 (35)',
};

describe('mapAirbnbHotel', () => {
  it('maps RapidAPI airbnb19 searchPropertyByLocation listing', () => {
    const quote = mapAirbnbHotel(londonListing, 'USD');

    assert.equal(quote.id, '16344377');
    assert.equal(quote.hotel_name, 'Clerkenwell Farringdon Studio Apartment S');
    assert.equal(quote.category, 'Apartment in Clerkenwell');
    assert.equal(quote.destination_name, 'London');
    assert.equal(quote.price, 1015);
    assert.equal(quote.currency, 'USD');
    assert.equal(quote.review_score, 4.71);
    assert.equal(quote.review_count, 35);
    assert.equal(
      quote.photo_url,
      'https://a0.muscache.com/im/pictures/hosting/Hosting-16344377/original/photo.jpeg',
    );
    assert.equal(quote.latitude, 51.5207);
    assert.equal(quote.longitude, -0.103);
    assert.equal(quote.provider, 'airbnb');
  });

  it('uses discountedPrice instead of concatenating original and sale amounts', () => {
    const quote = mapAirbnbHotel(
      {
        listing: {
          id: '740291923139970756',
          name: 'Cosy & Bright Gem',
          title: 'Apartment in Battersea',
          city: 'London',
          coordinate: { latitude: 51.48, longitude: -0.16 },
        },
        structuredDisplayPrice: {
          primaryLine: {
            accessibilityLabel: '$1,045 USD total, originally $1,278 USD',
            discountedPrice: '$1,045 USD',
            originalPrice: '$1,278 USD',
            qualifier: 'total',
          },
        },
        avgRatingLocalized: '4.93 (27)',
      },
      'USD',
    );

    assert.equal(quote.price, 1045);
    assert.equal(quote.currency, 'USD');
  });
});
