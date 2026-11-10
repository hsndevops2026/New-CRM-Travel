import './support/isolatedRedis.js';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, pool } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import {
  availabilityMatches,
  findMatchingPackage,
  formatMonthList,
  formatPackageOfferMessage,
  monthsTouched,
  periodMatches,
} from '../services/packageOffer.js';
import {
  createPredefinedQuote,
  deletePredefinedQuote,
  getPredefinedQuote,
  normalizeMonths,
  normalizeQuoteInput,
  updatePredefinedQuote,
} from '../services/predefinedQuotes.js';

const hotel = { item_type: 'hotel', hotel_name: 'Atlantis', title: 'Atlantis', price: 900 };
const fixedDubai = { id: 'fixed', quote_type: 'hotel', destination: 'Dubai', availability_mode: 'fixed', travel_date: '2026-10-10', return_date: '2026-10-20', items: [hotel] };
const periodDubai = { id: 'period', quote_type: 'hotel', destination: 'Dubai', availability_mode: 'period', available_months: [1, 2, 10], items: [hotel] };

describe('monthsTouched', () => {
  it('is the one month for a trip inside a month, and for a one-way trip', () => {
    assert.deepEqual(monthsTouched('2026-10-10', '2026-10-19'), [10]);
    assert.deepEqual(monthsTouched('2026-10-10', null), [10]);
    assert.deepEqual(monthsTouched('2026-10-10', '2026-10-10'), [10]);
  });
  it('lists every month a longer trip crosses, across a new year too', () => {
    assert.deepEqual(monthsTouched('2026-10-28', '2026-11-03'), [10, 11]);
    assert.deepEqual(monthsTouched('2026-12-28', '2027-01-04'), [1, 12]);
    assert.deepEqual(monthsTouched('2026-01-20', '2026-03-05'), [1, 2, 3]);
  });
  it('is empty without a start date', () => {
    assert.deepEqual(monthsTouched(null, '2026-10-19'), []);
    assert.deepEqual(monthsTouched('', ''), []);
  });
});

describe('period packages', () => {
  it('match any dates inside the months, not just particular days', () => {
    assert.equal(periodMatches({ travel_date: '2026-10-10', return_date: '2026-10-19' }, periodDubai), true);
    assert.equal(periodMatches({ travel_date: '2026-10-02', return_date: '2026-10-30' }, periodDubai), true);
    assert.equal(periodMatches({ travel_date: '2027-02-14', return_date: '2027-02-18' }, periodDubai), true, 'any year');
  });

  it('do not match a month that is not offered', () => {
    assert.equal(periodMatches({ travel_date: '2026-03-10', return_date: '2026-03-15' }, periodDubai), false);
  });

  it('do not match a trip that runs into a month that is not offered', () => {
    assert.equal(periodMatches({ travel_date: '2026-10-28', return_date: '2026-11-03' }, periodDubai), false);
    assert.equal(periodMatches({ travel_date: '2026-01-28', return_date: '2026-02-03' }, periodDubai), true, 'Jan and Feb are both offered');
  });

  it('match a one-way request on the month it starts in', () => {
    assert.equal(periodMatches({ travel_date: '2026-10-12' }, periodDubai), true);
  });

  it('match nothing when no months were chosen, or the request has no date', () => {
    assert.equal(periodMatches({ travel_date: '2026-10-12' }, { available_months: [] }), false);
    assert.equal(periodMatches({}, periodDubai), false);
  });

  it('are chosen by availabilityMatches only for period packages — fixed ones still need exact dates', () => {
    const request = { travel_date: '2026-10-12', return_date: '2026-10-18' };
    assert.equal(availabilityMatches(request, periodDubai), true);
    assert.equal(availabilityMatches(request, fixedDubai), false, 'inside 10–20 Oct but not the same dates');
    assert.equal(availabilityMatches({ travel_date: '2026-10-10', return_date: '2026-10-20' }, fixedDubai), true);
  });
});

describe('findMatchingPackage with fixed and period packages', () => {
  const demand = { booking_type: 'hotel', destination: 'Dubai', travel_date: '2026-10-10', return_date: '2026-10-20' };

  it('offers a period package for dates inside its months', async () => {
    const found = await findMatchingPackage({ ...demand, return_date: '2026-10-19' }, { quotes: [periodDubai] });
    assert.equal(found.id, 'period');
  });

  it('still needs the destination to match', async () => {
    const found = await findMatchingPackage({ ...demand, destination: 'Paris' }, { quotes: [periodDubai] });
    assert.equal(found, null);
  });

  it('prefers the exact-date package over a period one for the same trip', async () => {
    const newerPeriod = { ...periodDubai, updated_at: '2026-10-05T00:00:00Z' };
    const olderFixed = { ...fixedDubai, updated_at: '2026-01-01T00:00:00Z' };
    const found = await findMatchingPackage(demand, { quotes: [newerPeriod, olderFixed] });
    assert.equal(found.id, 'fixed');
  });

  it('falls back to the period package when the dates are not the fixed ones', async () => {
    const found = await findMatchingPackage({ ...demand, travel_date: '2026-10-12', return_date: '2026-10-16' }, { quotes: [fixedDubai, periodDubai] });
    assert.equal(found.id, 'period');
  });

  it('works for a flight request against a period flight package', async () => {
    const flight = { id: 'f', quote_type: 'flight', origin: 'Mumbai', destination: 'Dubai', availability_mode: 'period', available_months: [10], items: [{ item_type: 'flight', direction: 'outbound', departure_city: 'Mumbai', arrival_city: 'Dubai' }] };
    const found = await findMatchingPackage({ booking_type: 'flight', origin: 'Mumbai', destination: 'Dubai', travel_date: '2026-10-05' }, { quotes: [flight] });
    assert.equal(found.id, 'f');
  });
});

describe('what the customer is told', () => {
  it('names the months a period package is available in, instead of dates', () => {
    const text = formatPackageOfferMessage({ ...periodDubai, title: 'Dubai Winter Escape', currency: 'USD' });
    assert.match(text, /Available: January, February, October/);
    assert.doesNotMatch(text, /\d{4}/, 'no stray dates');
  });

  it('still shows exact dates for a fixed package', () => {
    const text = formatPackageOfferMessage({ ...fixedDubai, title: 'Dubai October', currency: 'USD' });
    assert.match(text, /10 Oct 2026 → 20 Oct 2026/);
  });

  it('formats a month list in either language, in calendar order, ignoring junk', () => {
    assert.equal(formatMonthList([10, 1, 2, 2, 13, 0]), 'Available: January, February, October');
    assert.match(formatMonthList([1], 'ar'), /^متاحة في: يناير$/);
    assert.equal(formatMonthList([]), null);
  });
});

describe('saving the choice', () => {
  const items = [hotel];

  it('normalizes the month list', () => {
    assert.deepEqual(normalizeMonths([10, '2', 2, 0, 13, 'x', 1.5]), [2, 10]);
    assert.deepEqual(normalizeMonths(undefined), []);
  });

  it('defaults to fixed dates, which is how every existing package already behaves', () => {
    const payload = normalizeQuoteInput({ title: 'T', items, travel_date: '2026-10-10', return_date: '2026-10-20' });
    assert.equal(payload.availability_mode, 'fixed');
    assert.deepEqual(payload.available_months, []);
    assert.equal(payload.travel_date, '2026-10-10');
  });

  it('keeps the months for a period package and drops any single travel window', () => {
    const payload = normalizeQuoteInput({ title: 'T', items, availability_mode: 'period', available_months: [10, 1], travel_date: '2026-10-10' });
    assert.deepEqual(payload.available_months, [1, 10]);
    assert.equal(payload.travel_date, null);
    assert.equal(payload.return_date, null);
  });

  it('takes a period package’s length from its hotel stays, since there are no dates to count', () => {
    const stays = [{ ...hotel, nights: 3 }, { ...hotel, hotel_name: 'Second', title: 'Second', nights: 4 }];
    const payload = normalizeQuoteInput({ title: 'T', items: stays, availability_mode: 'period', available_months: [10], nights: 99 });
    assert.equal(payload.nights, 7);
  });

  it('does not take months with it when switching back to fixed', () => {
    const payload = normalizeQuoteInput({ title: 'T', items, availability_mode: 'fixed', available_months: [1, 2], travel_date: '2026-10-10' });
    assert.deepEqual(payload.available_months, []);
  });

  it('refuses a period package with no months, and an unknown mode', () => {
    assert.throws(() => normalizeQuoteInput({ title: 'T', items, availability_mode: 'period', available_months: [] }), (e) => e.status === 400);
    assert.throws(() => normalizeQuoteInput({ title: 'T', items, availability_mode: 'weekly' }), (e) => e.status === 400);
  });

  describe('in the database', () => {
    const ids = [];
    before(async () => {
      await pingDb();
      await runMigrations();
    });
    after(async () => {
      for (const id of ids) await deletePredefinedQuote(id);
      await pool.end();
    });

    it('round-trips a period package and can be switched to fixed dates and back', async () => {
      const created = await createPredefinedQuote({ title: 'Period test package', destination: 'Dubai', items, availability_mode: 'period', available_months: [10, 1, 2] });
      ids.push(created.id);
      assert.equal(created.availability_mode, 'period');
      assert.deepEqual(created.available_months, [1, 2, 10]);

      const fixed = await updatePredefinedQuote(created.id, { availability_mode: 'fixed', travel_date: '2026-10-10', return_date: '2026-10-20' });
      assert.equal(fixed.availability_mode, 'fixed');
      assert.deepEqual(fixed.available_months, []);
      assert.equal(String(fixed.travel_date).slice(0, 10), '2026-10-10');

      const back = await updatePredefinedQuote(created.id, { availability_mode: 'period', available_months: [3] });
      assert.deepEqual((await getPredefinedQuote(created.id)).available_months, [3]);
      assert.equal(back.travel_date, null);
    });

    it('treats a package saved before this feature as fixed dates', async () => {
      const created = await createPredefinedQuote({ title: 'Legacy test package', destination: 'Dubai', items, travel_date: '2026-12-01', return_date: '2026-12-04' });
      ids.push(created.id);
      assert.equal(created.availability_mode, 'fixed');
      assert.equal(availabilityMatches({ travel_date: '2026-12-01', return_date: '2026-12-04' }, created), true);
    });
  });
});
