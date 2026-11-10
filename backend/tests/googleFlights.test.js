import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  airportSpread,
  mapGoogleFlightOffer,
  mapItinerary,
  mapFlightSuggestion,
  parseDistance,
  pickAirportId,
} from '../services/googleFlights.js';

const connectingItinerary = {
  flights: [
    {
      departure_airport: {
        name: 'Austin-Bergstrom International Airport',
        id: 'AUS',
        time: '2026-05-08 06:00',
      },
      arrival_airport: {
        name: 'Dallas/Fort Worth International Airport',
        id: 'DFW',
        time: '2026-05-08 07:07',
      },
      duration: 67,
      airplane: 'Boeing 737',
      airline: 'American',
      airline_logo: 'https://www.gstatic.com/flights/airline_logos/70px/AA.png',
      travel_class: 'Economy',
      flight_number: 'AA 2013',
      legroom: '30 in',
      often_delayed_by_over_30_min: true,
    },
    {
      departure_airport: {
        name: 'Dallas/Fort Worth International Airport',
        id: 'DFW',
        time: '2026-05-08 08:34',
      },
      arrival_airport: {
        name: "Chicago O'Hare International Airport",
        id: 'ORD',
        time: '2026-05-08 10:49',
      },
      duration: 135,
      airplane: 'Boeing 737MAX 8 Passenger',
      airline: 'American',
      travel_class: 'Economy',
      flight_number: 'AA 1517',
      legroom: '30 in',
      overnight: false,
    },
  ],
  layovers: [
    { duration: 87, name: 'Dallas/Fort Worth International Airport', id: 'DFW', overnight: false },
  ],
  total_duration: 289,
  carbon_emissions: {
    this_flight: 127000,
    typical_for_this_route: 101000,
    difference_percent: 26,
  },
  price: 197,
  type: 'Round trip',
  airline_logo: 'https://www.gstatic.com/flights/airline_logos/70px/AA.png',
  departure_token: 'WyJDalJJZEdOb2VtSjNSVXRC',
  booking_token: 'WyJDalJJZEdOb2VtSjNSVXRDIn0=',
  extensions: ['Checked baggage for a fee'],
};

describe('mapItinerary', () => {
  it('collapses a multi-leg itinerary into origin, destination, and stop count', () => {
    const segment = mapItinerary(connectingItinerary);

    assert.equal(segment.departure_airport, 'AUS');
    assert.equal(segment.arrival_airport, 'ORD');
    assert.equal(segment.departure_time, '2026-05-08 06:00');
    assert.equal(segment.arrival_time, '2026-05-08 10:49');
    assert.equal(segment.stops, 1);
    assert.equal(segment.duration, '4h 49m');
    assert.equal(segment.airline, 'American');
    assert.equal(segment.legs.length, 2);
    assert.equal(segment.legs[0].duration, '1h 7m');
    assert.equal(segment.legs[0].often_delayed, true);
    assert.equal(segment.layovers[0].airport, 'DFW');
    assert.equal(segment.layovers[0].duration, '1h 27m');
  });

  it('returns null when there are no flight segments', () => {
    assert.equal(mapItinerary({ flights: [] }), null);
    assert.equal(mapItinerary(null), null);
  });
});

describe('mapGoogleFlightOffer', () => {
  it('maps a one-way offer into the shared quote shape', () => {
    const quote = mapGoogleFlightOffer(connectingItinerary, 0, {
      currency: 'USD',
      roundTrip: false,
    });

    assert.equal(quote.id, 'WyJDalJJZEdOb2VtSjNSVXRDIn0=');
    assert.equal(quote.price, 197);
    assert.equal(quote.currency, 'USD');
    assert.equal(quote.provider, 'google_flights');
    assert.equal(quote.cabin_class, 'Economy');
    assert.equal(quote.outbound.departure_airport, 'AUS');
    assert.equal(quote.inbound, null);
    assert.equal(quote.outbound_only, false);
    assert.equal(quote.carbon_emissions.difference_percent, 26);
  });

  it('flags round-trip offers as outbound-only until the return is resolved', () => {
    const quote = mapGoogleFlightOffer(connectingItinerary, 0, {
      currency: 'AED',
      roundTrip: true,
    });

    assert.equal(quote.outbound_only, true);
    assert.equal(quote.inbound, null);
    assert.equal(quote.currency, 'AED');
    assert.equal(quote.departure_token, 'WyJDalJJZEdOb2VtSjNSVXRC');
  });

  it('falls back to an index-based id when no tokens are returned', () => {
    const quote = mapGoogleFlightOffer(
      { ...connectingItinerary, booking_token: null, departure_token: null },
      3,
      {},
    );
    assert.equal(quote.id, 'google-offer-3');
  });
});

describe('parseDistance', () => {
  it('parses the display string the API actually returns', () => {
    // Live responses send "6 mi", not 6 — a bare Number() yields NaN.
    assert.equal(parseDistance('6 mi'), 6);
    assert.equal(parseDistance('16 mi'), 16);
    assert.equal(parseDistance('12.5 km'), 12.5);
    assert.equal(parseDistance(21), 21);
    assert.equal(parseDistance(null), null);
    assert.equal(parseDistance('unknown'), null);
  });
});

describe('pickAirportId', () => {
  it('prefers the closest airport with a real IATA code', () => {
    const id = pickAirportId({
      id: '/m/02_286',
      airports: [
        { id: 'EWR', name: 'Newark Liberty', distance: 26 },
        { id: 'JFK', name: 'John F. Kennedy', distance: 12 },
      ],
    });
    assert.equal(id, 'JFK');
  });

  it('sorts on distance strings rather than falling back to array order', () => {
    // Palm Jumeirah: DXB is listed first but DWC is nearer.
    const id = pickAirportId({
      id: '/m/025smcz',
      airports: [
        { id: 'DXB', name: 'Dubai International Airport', distance: '16 mi' },
        { id: 'AUH', name: 'Zayed International Airport', distance: '55 mi' },
        { id: 'DWC', name: 'Al Maktoum International Airport', distance: '13 mi' },
      ],
    });
    assert.equal(id, 'DWC');
  });

  it('falls back to a knowledge graph id when no airport codes exist', () => {
    assert.equal(pickAirportId({ id: '/m/02_286', airports: [] }), '/m/02_286');
  });

  it('returns null when nothing usable is present', () => {
    assert.equal(pickAirportId({ id: 'new york', airports: [] }), null);
  });
});

describe('airportSpread', () => {
  // Real spreads: metro search is safe under ~40mi and unsafe above it.
  it('measures a tight metro (New York)', () => {
    const spread = airportSpread({
      airports: [
        { id: 'JFK', distance: '12 mi' },
        { id: 'LGA', distance: '8 mi' },
        { id: 'EWR', distance: '8 mi' },
      ],
    });
    assert.equal(spread, 12);
  });

  it('measures a spread-out metro that still reads as one city (London)', () => {
    const spread = airportSpread({
      airports: [
        { id: 'LHR', distance: '14 mi' },
        { id: 'LGW', distance: '25 mi' },
        { id: 'STN', distance: '30 mi' },
        { id: 'SEN', distance: '35 mi' },
      ],
    });
    assert.equal(spread, 35);
  });

  it('flags a metro that crosses into another city (Dubai → Abu Dhabi)', () => {
    const spread = airportSpread({
      airports: [
        { id: 'DXB', distance: '6 mi' },
        { id: 'SHJ', distance: '17 mi' },
        { id: 'AUH', distance: '66 mi' },
      ],
    });
    assert.equal(spread, 66);
  });

  it('returns null when no distances are usable', () => {
    assert.equal(airportSpread({ airports: [{ id: 'DEL' }] }), null);
    assert.equal(airportSpread({ airports: [] }), null);
    assert.equal(airportSpread(null), null);
  });
});

describe('mapFlightSuggestion', () => {
  it('normalizes an autocomplete suggestion', () => {
    const suggestion = mapFlightSuggestion({
      position: 1,
      name: 'New York',
      type: 'city',
      description: 'New York, NY, USA',
      id: '/m/02_286',
      airports: [{ name: 'John F. Kennedy', id: 'JFK', city: 'New York', distance: '12 mi' }],
    });

    assert.equal(suggestion.name, 'New York');
    assert.equal(suggestion.type, 'city');
    assert.equal(suggestion.airports[0].id, 'JFK');
    // Raw string kept for display, parsed value alongside it for sorting.
    assert.equal(suggestion.airports[0].distance, '12 mi');
    assert.equal(suggestion.airports[0].distance_value, 12);
  });
});
