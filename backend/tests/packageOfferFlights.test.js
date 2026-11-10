import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  findMatchingHotelPackage,
  findMatchingPackage,
  flightRouteScore,
  formatPackageOfferMessage,
  quoteTravelWindow,
  searchLabel,
} from '../services/packageOffer.js';

/* ---------------------------------------------------------------- *
 * Fixtures
 * ---------------------------------------------------------------- */

const outbound = {
  item_type: 'flight', direction: 'outbound', airline: 'Emirates', flight_number: 'EK501',
  departure_airport: 'BOM', arrival_airport: 'LHR', departure_city: 'Mumbai', arrival_city: 'London',
  departure_time: '2027-01-10 02:30', arrival_time: '2027-01-10 07:55', duration: '9h 55m', stops: 0,
};
const inbound = {
  item_type: 'flight', direction: 'return', airline: 'Emirates', flight_number: 'EK502',
  departure_airport: 'LHR', arrival_airport: 'BOM', departure_city: 'London', arrival_city: 'Mumbai',
  departure_time: '2027-01-20 14:00', arrival_time: '2027-01-21 03:30', duration: '9h 30m', stops: 0,
};

const flightQuote = (overrides = {}) => ({
  id: 'flight-1', quote_type: 'flight', title: 'Mumbai ⇄ London January',
  origin: 'Mumbai', destination: 'London', travel_date: '2027-01-10', return_date: '2027-01-20',
  currency: 'USD', total_price: 780, items: [outbound, inbound], updated_at: '2026-10-01', ...overrides,
});
const hotelQuote = (overrides = {}) => ({
  id: 'hotel-1', quote_type: 'hotel', title: 'Dubai Palm Getaway', destination: 'Dubai',
  travel_date: '2027-01-10', return_date: '2027-01-14', currency: 'AED', total_price: 4800,
  items: [{ item_type: 'hotel', hotel_name: 'Palm Resort', check_in: '2027-01-10', check_out: '2027-01-14' }],
  updated_at: '2026-10-01', ...overrides,
});
const bundleQuote = (overrides = {}) => ({
  id: 'bundle-1', quote_type: 'package', title: 'London Break', origin: 'Mumbai', destination: 'London',
  travel_date: '2027-01-10', return_date: '2027-01-20', currency: 'USD', total_price: 1900,
  items: [outbound, inbound, { item_type: 'hotel', hotel_name: 'Strand Hotel', check_in: '2027-01-10', check_out: '2027-01-20', nights: 10 }],
  updated_at: '2026-10-01', ...overrides,
});

const flightDemand = (overrides = {}) => ({
  booking_type: 'flight', origin: 'Mumbai', destination: 'London',
  travel_date: '2027-01-10', return_date: '2027-01-20', ...overrides,
});
const hotelDemand = (overrides = {}) => ({
  booking_type: 'hotel', destination: 'Dubai', travel_date: '2027-01-10', return_date: '2027-01-14', ...overrides,
});

const match = (demand, quotes) => findMatchingPackage(demand, { quotes });
const idOf = async (demand, quotes) => (await match(demand, quotes))?.id ?? null;

/* ---------------------------------------------------------------- *
 * Dates read from flight legs
 * ---------------------------------------------------------------- */

describe('quoteTravelWindow — flights', () => {
  it('uses the outbound departure and the return-flight departure', () => {
    assert.deepEqual(
      quoteTravelWindow({ items: [outbound, inbound] }),
      { travel_date: '2027-01-10', return_date: '2027-01-20' },
    );
  });

  it('prefers the dates set on the package itself', () => {
    assert.deepEqual(
      quoteTravelWindow({ travel_date: '2027-02-01', return_date: '2027-02-09', items: [outbound, inbound] }),
      { travel_date: '2027-02-01', return_date: '2027-02-09' },
    );
  });

  it('ignores a time-only departure instead of inventing a date', () => {
    const window = quoteTravelWindow({ items: [{ item_type: 'flight', direction: 'outbound', departure_time: '08:30' }] });
    assert.deepEqual(window, { travel_date: null, return_date: null });
  });

  it('does not guess a return date from an unmarked second flight', () => {
    // Without direction="return" or a package return date there is no safe return date.
    const unmarked = [
      { item_type: 'flight', departure_time: '2027-01-10 02:30' },
      { item_type: 'flight', departure_time: '2027-01-20 14:00' },
    ];
    assert.equal(quoteTravelWindow({ items: unmarked }).return_date, null);
  });

  it('leaves hotel-only packages exactly as before', () => {
    assert.deepEqual(
      quoteTravelWindow({ items: [{ item_type: 'hotel', check_in: '2027-01-10', check_out: '2027-01-14' }] }),
      { travel_date: '2027-01-10', return_date: '2027-01-14' },
    );
  });
});

/* ---------------------------------------------------------------- *
 * Matching a flight request
 * ---------------------------------------------------------------- */

describe('findMatchingPackage — flight requests', () => {
  it('offers a flight package for the same route and dates', async () => {
    assert.equal(await idOf(flightDemand(), [flightQuote()]), 'flight-1');
  });

  it('matches on city names or airport codes, in either form', async () => {
    assert.equal(await idOf(flightDemand({ origin: 'BOM', destination: 'LHR' }), [flightQuote()]), 'flight-1');
    assert.equal(await idOf(flightDemand({ origin: 'Mumbai (BOM)' }), [flightQuote()]), 'flight-1');
    assert.equal(await idOf(flightDemand({ destination: 'London Heathrow' }), [flightQuote()]), 'flight-1');
  });

  it('does not offer the package for the reversed route', async () => {
    // A Mumbai→London package must not be offered to someone flying London→Mumbai.
    assert.equal(await idOf(flightDemand({ origin: 'London', destination: 'Mumbai' }), [flightQuote()]), null);
  });

  it('needs BOTH ends of the route to match', async () => {
    assert.equal(await idOf(flightDemand({ origin: 'Delhi' }), [flightQuote()]), null);
    assert.equal(await idOf(flightDemand({ destination: 'Paris' }), [flightQuote()]), null);
  });

  it('needs exactly the same departure and return dates', async () => {
    assert.equal(await idOf(flightDemand({ travel_date: '2027-01-11' }), [flightQuote()]), null);
    assert.equal(await idOf(flightDemand({ return_date: '2027-01-21' }), [flightQuote()]), null);
    assert.equal(await idOf(flightDemand({ return_date: null }), [flightQuote()]), null);
  });

  it('treats a three-letter code as a whole word, not a fragment of a city', async () => {
    const istanbul = flightQuote({
      id: 'ist', origin: 'Istanbul', destination: 'Dubai',
      items: [{ ...outbound, departure_city: 'Istanbul', departure_airport: 'IST', arrival_city: 'Dubai', arrival_airport: 'DXB' }, inbound],
    });
    assert.equal(await idOf(flightDemand({ origin: 'IST', destination: 'Dubai' }), [istanbul]), 'ist');
    // "ist" typed lowercase is the airport code, but "listing" / "artist" are not.
    assert.equal(await idOf(flightDemand({ origin: 'artist', destination: 'Dubai' }), [istanbul]), null);
  });

  it('can match on the flight legs when the package has no origin/destination of its own', async () => {
    const bare = flightQuote({ origin: '', destination: '', title: 'Special fare' });
    assert.equal(await idOf(flightDemand(), [bare]), 'flight-1');
  });

  it('also offers a flight+hotel bundle that covers the route', async () => {
    assert.equal(await idOf(flightDemand(), [bundleQuote()]), 'bundle-1');
  });

  it('prefers a pure flight package over a bundle when both fit equally', async () => {
    assert.equal(await idOf(flightDemand(), [bundleQuote(), flightQuote()]), 'flight-1');
  });

  it('prefers the better route match, then the most recently updated', async () => {
    const exact = flightQuote({ id: 'exact', updated_at: '2026-01-01' });
    const partial = flightQuote({ id: 'partial', origin: 'Mumbai Intl', updated_at: '2026-12-01', items: [{ ...outbound, departure_city: 'Mumbai Intl', departure_airport: '' }, inbound] });
    assert.equal(await idOf(flightDemand(), [partial, exact]), 'exact');
    const newer = flightQuote({ id: 'newer', updated_at: '2026-11-01' });
    assert.equal(await idOf(flightDemand(), [exact, newer]), 'newer');
  });

  it('never offers a hotel-only package to a flight request', async () => {
    const dubaiFlight = flightDemand({ origin: 'Mumbai', destination: 'Dubai', return_date: '2027-01-14' });
    assert.equal(await idOf(dubaiFlight, [hotelQuote()]), null);
  });

  it('returns nothing when the request is missing what it needs', async () => {
    assert.equal(await idOf(flightDemand({ origin: '' }), [flightQuote()]), null);
    assert.equal(await idOf(flightDemand({ destination: '' }), [flightQuote()]), null);
    assert.equal(await idOf(flightDemand({ travel_date: null }), [flightQuote()]), null);
  });

  it('scores a missing route end as no match at all', () => {
    assert.equal(flightRouteScore({ origin: 'Mumbai', destination: 'Paris' }, flightQuote()), 0);
    assert.ok(flightRouteScore(flightDemand(), flightQuote()) > 0);
  });
});

describe('findMatchingPackage — hotel requests are unchanged', () => {
  it('still offers a hotel package for the same destination and dates', async () => {
    assert.equal(await idOf(hotelDemand(), [hotelQuote()]), 'hotel-1');
  });

  it('never offers a flight-only package to a hotel request', async () => {
    const aimedAtLondon = hotelDemand({ destination: 'London', travel_date: '2027-01-10', return_date: '2027-01-20' });
    assert.equal(await idOf(aimedAtLondon, [flightQuote()]), null);
  });

  it('still offers a bundle to a hotel request', async () => {
    const london = hotelDemand({ destination: 'London', return_date: '2027-01-20' });
    assert.equal(await idOf(london, [bundleQuote()]), 'bundle-1');
  });

  it('treats a request with no booking type as a hotel request, as before', async () => {
    assert.equal(await idOf({ destination: 'Dubai', travel_date: '2027-01-10', return_date: '2027-01-14' }, [hotelQuote()]), 'hotel-1');
  });

  it('keeps the old function name working', () => {
    assert.equal(findMatchingHotelPackage, findMatchingPackage);
  });
});

/* ---------------------------------------------------------------- *
 * What the customer reads
 * ---------------------------------------------------------------- */

describe('formatPackageOfferMessage — flights', () => {
  const text = formatPackageOfferMessage(flightQuote(), 'en', { kind: 'flight' });

  it('introduces a flight-only package as a flight package', () => {
    assert.match(text, /We have a ready flight package for London:/);
    assert.match(text, /\*Mumbai ⇄ London January\*/);
  });

  it('lists each leg with airline, flight number, route, times, duration and stops', () => {
    assert.match(text, /Flights:/);
    assert.match(text, /• Outbound: Emirates EK501 · BOM 10 Jan 02:30 → LHR 10 Jan 07:55 \(9h 55m, nonstop\)/);
    assert.match(text, /• Return: Emirates EK502 · LHR 20 Jan 14:00 → BOM 21 Jan 03:30 \(9h 30m, nonstop\)/);
  });

  it('shows no Hotels section for a flight-only package', () => {
    assert.doesNotMatch(text, /Hotels:/);
  });

  it('asks the customer to search FLIGHTS if they decline — not hotels', () => {
    assert.match(text, /Reply YES to take it, or NO to search flights as usual\./);
    assert.doesNotMatch(text, /search hotels/);
  });

  it('does not claim hotel nights for a flight-only package', () => {
    // The package dates are 10 days apart, which is how `nights` gets filled in — but no
    // accommodation is included, so "10 nights" would mislead.
    const flightOnly = formatPackageOfferMessage(flightQuote({ nights: 10 }), 'en', { kind: 'flight' });
    assert.doesNotMatch(flightOnly, /nights/);
    assert.match(flightOnly, /10 Jan 2027 → 20 Jan 2027/);
  });

  it('still shows the nights when a hotel is part of the package', () => {
    assert.match(formatPackageOfferMessage(bundleQuote({ nights: 10 }), 'en', { kind: 'package' }), /10 nights/);
    assert.match(formatPackageOfferMessage(hotelQuote({ nights: 4 }), 'en'), /4 nights/);
  });

  it('shows the price and dates', () => {
    assert.match(text, /10 Jan 2027 → 20 Jan 2027/);
    assert.match(text, /USD 780/);
  });

  it('describes stops when there are some', () => {
    const connecting = formatPackageOfferMessage(
      flightQuote({ items: [{ ...outbound, stops: 1 }, { ...inbound, stops: 2 }] }), 'en', { kind: 'flight' });
    assert.match(connecting, /9h 55m, 1 stop\)/);
    assert.match(connecting, /9h 30m, 2 stops\)/);
  });

  it('copes with a sparse flight item', () => {
    const sparse = formatPackageOfferMessage(
      flightQuote({ items: [{ item_type: 'flight', title: 'Weekend special fare' }] }), 'en', { kind: 'flight' });
    assert.match(sparse, /• Weekend special fare/);
  });

  it('lists flights and hotels for a bundle, and says so when declining', () => {
    const bundle = formatPackageOfferMessage(bundleQuote(), 'en', { kind: 'package' });
    assert.match(bundle, /We have a ready package for London:/);
    assert.match(bundle, /Flights:/);
    assert.match(bundle, /Hotels:/);
    assert.match(bundle, /• Strand Hotel/);
    assert.match(bundle, /NO to search flights and hotels as usual/);
  });

  it('is written in Arabic for an Arabic conversation', () => {
    const ar = formatPackageOfferMessage(flightQuote(), 'ar', { kind: 'flight' });
    assert.match(ar, /لدينا باقة طيران جاهزة إلى London:/);
    assert.match(ar, /الرحلات:/);
    assert.match(ar, /الذهاب: Emirates EK501/);
    assert.match(ar, /العودة: Emirates EK502/);
    assert.match(ar, /مباشرة/);
    assert.match(ar, /للبحث عن رحلات كالمعتاد/);
  });
});

describe('formatPackageOfferMessage — hotels are unchanged', () => {
  it('still says "search hotels" by default', () => {
    const text = formatPackageOfferMessage(hotelQuote(), 'en');
    assert.match(text, /We have a ready package for Dubai:/);
    assert.match(text, /Hotels:/);
    assert.match(text, /NO to search hotels as usual\./);
    assert.doesNotMatch(text, /Flights:/);
  });
});

describe('searchLabel', () => {
  it('names what "search as usual" means for each request, in both languages', () => {
    assert.equal(searchLabel('hotel'), 'hotels');
    assert.equal(searchLabel('flight'), 'flights');
    assert.equal(searchLabel('package'), 'flights and hotels');
    assert.equal(searchLabel('flight', 'ar'), 'رحلات');
    assert.equal(searchLabel(undefined), 'hotels');
  });
});
