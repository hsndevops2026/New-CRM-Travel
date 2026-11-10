import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapHotelbedsPlace, searchHotelDestination } from '../services/hotels.js';

test('Hotelbeds preserves explicitly entered destination codes', async () => {
  const code = await searchHotelDestination('LON');
  assert.equal(code.code, 'LON');
});

test('Hotelbeds uses map coordinates for worldwide place names', () => {
  const parisTexas = mapHotelbedsPlace('Paris, Texas, USA', {
    title: 'Paris', address: 'Texas, USA',
    gps_coordinates: { latitude: 33.6609389, longitude: -95.555513 },
  });
  assert.equal(parisTexas.code, null);
  assert.equal(parisTexas.source, 'google-maps-serpapi');
  assert.deepEqual(parisTexas.geolocation, {
    latitude: 33.6609389, longitude: -95.555513, radius: 30, unit: 'km',
  });
  assert.throws(() => mapHotelbedsPlace('unknown', {}), /Could not locate/);
});
