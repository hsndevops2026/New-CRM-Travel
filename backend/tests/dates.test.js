import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  coerceFutureDateParts,
  coerceFutureIsoDate,
  mergeCollected,
  normalizeTravelDates,
} from '../services/openaiLead.js';

describe('travel date year coercion', () => {
  it('maps yearless month/day to current or next year', () => {
    assert.equal(coerceFutureDateParts(8, 15, '2026-08-13'), '2026-08-15');
    assert.equal(coerceFutureDateParts(8, 11, '2026-08-13'), '2027-08-11');
  });

  it('rewrites stale 2023 dates to the next future occurrence', () => {
    assert.equal(coerceFutureIsoDate('2023-08-15', '2026-08-13'), '2026-08-15');
    assert.equal(coerceFutureIsoDate('2023-08-10', '2026-08-13'), '2027-08-10');
  });

  it('keeps already-future dates', () => {
    assert.equal(coerceFutureIsoDate('2026-11-01', '2026-08-13'), '2026-11-01');
  });

  it('normalizes travel/return pairs and keeps return after travel', () => {
    const normalized = normalizeTravelDates(
      { travel_date: '2023-08-15', return_date: '2023-08-16' },
      '2026-08-13',
    );
    assert.deepEqual(normalized, {
      travel_date: '2026-08-15',
      return_date: '2026-08-16',
    });
  });

  it('mergeCollected coerces OpenAI past years', () => {
    const merged = mergeCollected(
      {},
      {
        booking_type: 'hotel',
        destination: 'Dubai',
        travel_date: '2023-08-15',
        return_date: '2023-08-16',
        adults_count: 2,
        children_count: 0,
      },
    );
    const today = new Date().toISOString().slice(0, 10);
    assert.ok(merged.travel_date >= today);
    assert.ok(merged.return_date >= merged.travel_date);
    assert.notEqual(merged.travel_date.slice(0, 4), '2023');
  });
});
