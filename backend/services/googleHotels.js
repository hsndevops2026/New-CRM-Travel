/**
 * Google Hotels Autocomplete via SerpApi (engine: google_hotels_autocomplete).
 *
 * Used to turn free-text a lead typed on WhatsApp ("bali", "burj al arab")
 * into a concrete destination or property before hotel sourcing runs, and to
 * power destination typeaheads in the CRM.
 *
 * Suggestions are either places (city / region) or individual properties;
 * properties carry a `property_token` that identifies the hotel on Google.
 */

import { serpGet } from './serpClient.js';

/**
 * Normalizes one `suggestions[]` entry from google_hotels_autocomplete.
 *
 * Live responses tag every entry `type: "accommodation"`, so `type` carries no
 * signal. The only reliable marker of a real, bookable property is
 * `property_token` — everything else is a Google search-box completion
 * ("paris hotels", "bali resorts") rather than a place or a hotel.
 */
export function mapHotelSuggestion(entry) {
  const propertyToken = entry?.property_token || null;

  return {
    position: entry?.position ?? null,
    value: entry?.value || entry?.autocomplete_suggestion || null,
    suggestion: entry?.autocomplete_suggestion || entry?.value || null,
    type: entry?.type || null,
    location: entry?.location || null,
    thumbnail: entry?.thumbnail || null,
    property_token: propertyToken,
    kgmid: entry?.kgmid || null,
    data_cid: entry?.data_cid || null,
    is_property: Boolean(propertyToken),
    highlighted_words: Array.isArray(entry?.highlighted_words) ? entry.highlighted_words : [],
  };
}

/** Autocomplete suggestions for a hotel destination or property name. */
export async function searchHotelSuggestions(query, options = {}) {
  const raw = String(query || '').trim();
  if (!raw) {
    const error = new Error('query is required');
    error.status = 400;
    throw error;
  }

  const data = await serpGet(
    'google_hotels_autocomplete',
    { q: raw, currency: options.currency_code },
    options,
  );

  const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
  const mapped = suggestions.map(mapHotelSuggestion);

  return {
    query: raw,
    count: mapped.length,
    suggestions: mapped,
    // "places" are free-text completions, not resolved locations — see mapHotelSuggestion.
    places: mapped.filter((item) => !item.is_property),
    properties: mapped.filter((item) => item.is_property),
  };
}

/**
 * Resolves free text to a destination or a specific property.
 *
 * Autocomplete is ranked for Google's search box, not for us: querying "paris"
 * returns "paris hotel las vegas" at position 1. Taking the top suggestion
 * would silently send a Paris lead to Las Vegas, so a suggestion is only
 * accepted when it actually corresponds to the query — an exact match, or a
 * real property (one carrying a property_token) that starts with it. Otherwise
 * the caller's own text is returned unchanged, which downstream hotel providers
 * resolve on their own anyway.
 */
export async function resolveHotelDestination(query, options = {}) {
  const raw = String(query || '').trim();
  const normalized = raw.toLowerCase();
  const { suggestions, properties } = await searchHotelSuggestions(raw, options);

  const exact = suggestions.find(
    (item) => String(item.value || '').trim().toLowerCase() === normalized,
  );
  const namedProperty = properties.find((item) =>
    String(item.value || '').trim().toLowerCase().startsWith(normalized),
  );
  const best = exact || namedProperty || null;

  if (!best) {
    return {
      name: raw,
      location: null,
      type: null,
      property_token: null,
      kgmid: null,
      is_property: false,
      matched: false,
      provider: 'google_hotels',
      raw: null,
    };
  }

  return {
    name: best.value || raw,
    location: best.location || null,
    type: best.type || null,
    property_token: best.property_token || null,
    kgmid: best.kgmid || null,
    is_property: best.is_property,
    matched: true,
    provider: 'google_hotels',
    raw: best,
  };
}
