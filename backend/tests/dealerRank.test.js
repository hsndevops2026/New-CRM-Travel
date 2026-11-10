import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickBestDealerOffer } from '../services/dealerRank.js';

describe('dealer offer ranking', () => {
  it('picks the lowest total price, then better board and cancellation', () => {
    const cheap = {
      id: 'cheap',
      extracted: {
        hotel_name: 'City Inn',
        total_price: 400,
        board_name: 'Breakfast',
        cancellation_terms: 'Free cancellation',
      },
    };
    const pricey = {
      id: 'pricey',
      extracted: {
        hotel_name: 'Palace',
        total_price: 900,
        board_name: 'All inclusive',
        cancellation_terms: 'Free cancellation',
      },
    };
    const nonRefund = {
      id: 'locked',
      extracted: {
        hotel_name: 'City Inn',
        total_price: 400,
        board_name: 'Room only',
        cancellation_terms: 'Non-refundable',
      },
    };

    assert.equal(pickBestDealerOffer([pricey, cheap])?.id, 'cheap');
    assert.equal(pickBestDealerOffer([nonRefund, cheap])?.id, 'cheap');
    assert.equal(pickBestDealerOffer([]), null);
  });
});
