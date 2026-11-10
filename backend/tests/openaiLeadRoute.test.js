import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyFieldAwareFixes, parseRoute } from '../services/openaiLead.js';

describe('parseRoute', () => {
  it('reads a terse route', () => {
    assert.deepEqual(parseRoute('Mumbai to London'), { origin: 'Mumbai', destination: 'London', bare: true });
    assert.deepEqual(parseRoute('from Mumbai to London'), { origin: 'Mumbai', destination: 'London', bare: true });
    assert.deepEqual(parseRoute('New York to Los Angeles'), { origin: 'New York', destination: 'Los Angeles', bare: true });
    assert.deepEqual(parseRoute('Abu Dhabi to Cairo'), { origin: 'Abu Dhabi', destination: 'Cairo', bare: true });
  });

  it('reads an Arabic route', () => {
    assert.deepEqual(parseRoute('من دبي إلى لندن'), { origin: 'دبي', destination: 'لندن', bare: true });
  });

  it('drops trailing punctuation from the destination', () => {
    assert.equal(parseRoute('Mumbai → London.').destination, 'London');
  });

  it('marks a route with extra words as not bare', () => {
    const route = parseRoute('Mumbai to London on 12 January');
    assert.deepEqual(route, { origin: 'Mumbai', destination: 'London', bare: false });
  });

  // The word "to" appears in nearly every spoken request. None of these are routes.
  const sentences = [
    'Hi, I would like to book a hotel in Dubai.',
    'I want to go',
    'we are planning to visit paris next month',
    'I need a hotel in Istanbul from the first of November to the fifth of November, two adults, no children.',
    'Hello, I need a flight from Mumbai to London on the twelfth of January, returning on the twentieth of January, for three adults.',
    'I would like to travel from 10 December to 15 December',
    'أريد أن أحجز فندق إلى دبي',
  ];
  for (const sentence of sentences) {
    it(`does not mistake a sentence for a route: "${sentence.slice(0, 48)}"`, () => {
      assert.equal(parseRoute(sentence), null);
    });
  }
});

describe('applyFieldAwareFixes — the LLM answer survives', () => {
  const existing = {};

  it('keeps the LLM destination for a natural sentence (the reported voice-note bug)', () => {
    const fixed = applyFieldAwareFixes(
      'Hi, I would like to book a hotel in Dubai.',
      existing,
      { booking_type: 'hotel', destination: 'Dubai', origin: null },
    );
    assert.equal(fixed.destination, 'Dubai');
    assert.equal(fixed.origin, null);
  });

  it('does not turn a date range into a destination', () => {
    const fixed = applyFieldAwareFixes(
      'I need a hotel in Istanbul from the first of November to the fifth of November, two adults.',
      existing,
      { booking_type: 'hotel', destination: 'Istanbul', travel_date: '2026-11-01', return_date: '2026-11-05' },
    );
    assert.equal(fixed.destination, 'Istanbul');
    assert.equal(fixed.origin, undefined);
  });

  it('keeps LLM origin and destination for a flight sentence', () => {
    const fixed = applyFieldAwareFixes(
      'Hello, I need a flight from Mumbai to London on the twelfth of January, for three adults.',
      existing,
      { booking_type: 'flight', origin: 'Mumbai', destination: 'London' },
    );
    assert.equal(fixed.origin, 'Mumbai');
    assert.equal(fixed.destination, 'London');
  });

  it('keeps an Arabic LLM destination', () => {
    const fixed = applyFieldAwareFixes(
      'أريد حجز فندق في دبي من العاشر من ديسمبر إلى الخامس عشر من ديسمبر',
      existing,
      { booking_type: 'hotel', destination: 'Dubai' },
    );
    assert.equal(fixed.destination, 'Dubai');
  });
});

describe('applyFieldAwareFixes — terse routes still work', () => {
  it('a bare "A to B" message overrides a confused LLM answer', () => {
    const fixed = applyFieldAwareFixes('Mumbai to London', {}, { origin: 'London', destination: 'Mumbai' });
    assert.equal(fixed.origin, 'Mumbai');
    assert.equal(fixed.destination, 'London');
  });

  it('fills a missing side from a short route that the LLM missed', () => {
    const fixed = applyFieldAwareFixes('Mumbai to London on 12 January', {}, { origin: null, destination: null });
    assert.equal(fixed.origin, 'Mumbai');
    assert.equal(fixed.destination, 'London');
  });

  it('never overwrites a side the LLM did extract, outside a bare route', () => {
    const fixed = applyFieldAwareFixes('Mumbai to London on 12 January', {}, { origin: 'Pune', destination: null });
    assert.equal(fixed.origin, 'Pune');
    assert.equal(fixed.destination, 'London');
  });
});
