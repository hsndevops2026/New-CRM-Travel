import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapHotelSuggestion } from '../services/googleHotels.js';

describe('mapHotelSuggestion', () => {
  it('treats a bare query completion as a non-property', () => {
    // Live API tags EVERY entry type:"accommodation" — only property_token
    // separates a real hotel from a Google search-box completion.
    const suggestion = mapHotelSuggestion({
      position: 3,
      value: 'paris hotels',
      type: 'accommodation',
      autocomplete_suggestion: 'paris hotels',
      highlighted_words: ['hotels'],
    });

    assert.equal(suggestion.value, 'paris hotels');
    assert.equal(suggestion.is_property, false);
    assert.equal(suggestion.property_token, null);
  });

  it('flags a property suggestion carrying a property_token', () => {
    const suggestion = mapHotelSuggestion({
      position: 2,
      value: 'Jumeirah Burj Al Arab',
      type: 'accommodation',
      thumbnail: 'https://encrypted-tbn3.gstatic.com/images?q=tbn:ANd9Gc',
      autocomplete_suggestion: 'burj al arab hotel',
      kgmid: '/m/02mzm9',
      data_cid: '12959795914845773880',
      property_token: 'ChYIuMDDz4e3nO2zARoJL20vMDJtem05EAE',
    });

    assert.equal(suggestion.is_property, true);
    assert.equal(suggestion.property_token, 'ChYIuMDDz4e3nO2zARoJL20vMDJtem05EAE');
    assert.equal(suggestion.kgmid, '/m/02mzm9');
    assert.equal(suggestion.suggestion, 'burj al arab hotel');
  });

  it('does not infer a property from the type field alone', () => {
    const suggestion = mapHotelSuggestion({ value: 'bali resorts', type: 'accommodation' });
    assert.equal(suggestion.is_property, false);
  });

  it('tolerates a sparse suggestion', () => {
    const suggestion = mapHotelSuggestion({});
    assert.equal(suggestion.value, null);
    assert.equal(suggestion.is_property, false);
    assert.deepEqual(suggestion.highlighted_words, []);
  });
});
