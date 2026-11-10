import { serpGet } from './serpClient.js';
import { searchHotelSuggestions } from './googleHotels.js';
import { searchGoogleFlightQuotes } from './googleFlights.js';
import { searchHotelQuotes } from './hotels.js';
import { searchBookingHotels } from './bookingHotels.js';
import { searchAirbnbHotels } from './airbnbHotels.js';

const bounded = (value, fallback) => Math.min(20, Math.max(1, Number(value) || fallback));
const date = (value) => String(value || '').slice(0, 10);
const numericPrice = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
  ? Number(value) : null;

export function mapGoogleHotel(property, currency = 'USD') {
  const listing = property.prices?.[0] || {};
  const total = numericPrice(property.total_rate?.extracted_lowest ?? listing.total_rate?.extracted_lowest);
  const nightly = numericPrice(property.rate_per_night?.extracted_lowest
    ?? listing.rate_per_night?.extracted_lowest ?? property.extracted_price);
  const price = total ?? nightly;
  const totalText = property.total_rate?.lowest || listing.total_rate?.lowest;
  const nightlyText = property.rate_per_night?.lowest || listing.rate_per_night?.lowest || property.price;
  const priceText = total != null ? totalText : nightly != null ? nightlyText : totalText || nightlyText;
  const priceBasis = total != null || (price == null && totalText)
    ? 'total stay' : 'per night';
  return {
    id: property.property_token || property.name,
    title: property.name || 'Hotel',
    provider: 'Google · SerpApi',
    seller: property.source || listing.source || null,
    kind: 'hotel',
    price,
    price_text: priceText || null,
    price_basis: price != null || priceText ? priceBasis : null,
    currency,
    rating: property.overall_rating ?? null,
    review_count: property.reviews ?? null,
    image: property.thumbnail || null,
    url: property.link || null,
    property_token: property.property_token || null,
    description: price != null || priceText ? 'Taxes and fees may vary' : property.type || null,
  };
}

function mapQuote(quote, provider, kind) {
  return {
    id: quote.id || quote.external_id || quote.hotel_name,
    title: kind === 'flight'
      ? (quote.outbound?.airline || quote.airline || 'Flight')
      : (quote.hotel_name || quote.name || 'Hotel'),
    provider,
    kind,
    price: quote.price ?? null,
    currency: quote.currency || 'USD',
    rating: quote.review_score ?? null,
    review_count: quote.review_count ?? null,
    image: quote.photo_url || null,
    url: quote.link || null,
    description: kind === 'flight'
      ? `${[quote.outbound?.departure_airport, quote.outbound?.arrival_airport].filter(Boolean).join(' → ')}${quote.outbound_only ? ' · outbound only' : ''}`
      : [quote.room_name, quote.board_name].filter(Boolean).join(' · '),
  };
}

export async function searchMarket(lead, input = {}) {
  const provider = String(input.provider || 'google').toLowerCase();
  const kind = input.kind === 'flight' ? 'flight' : 'hotel';
  const query = String(input.query || lead.destination || '').trim().slice(0, 160);
  const currency = String(input.currency_code || 'USD').toUpperCase();
  const limit = bounded(input.limit, 10);
  const checkIn = date(input.travel_date ?? lead.travel_date);
  const checkOut = date(input.return_date ?? lead.return_date);
  if (!query) throw Object.assign(new Error('Search query is required'), { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn)) {
    throw Object.assign(new Error('Choose a valid departure or check-in date'), { status: 400 });
  }
  if (checkOut && checkOut <= checkIn) {
    throw Object.assign(new Error('Return or check-out must be after the start date'), { status: 400 });
  }
  if (kind === 'hotel' && !checkOut) {
    throw Object.assign(new Error('Choose a check-out date'), { status: 400 });
  }

  if (kind === 'flight') {
    if (provider !== 'google') throw Object.assign(new Error('Select Google · SerpApi for live flight search'), { status: 400 });
    const result = await searchGoogleFlightQuotes({
      origin: input.origin || lead.origin,
      destination: query,
      travel_date: checkIn,
      return_date: checkOut || undefined,
      adults_count: lead.adults_count,
      children_count: lead.children_count,
      currency_code: currency,
      limit,
      return_lookups: 2,
    });
    return { provider: 'Google · SerpApi', kind, query, results: result.quotes.map((q) => mapQuote(q, 'Google · SerpApi', kind)), airports: result.airports || [], price_insights: result.price_insights || null };
  }

  const params = {
    destination: query,
    travel_date: checkIn,
    return_date: checkOut,
    adults_count: lead.adults_count,
    children_count: lead.children_count,
    children_ages: lead.children_ages,
    currency_code: currency,
    rooms: 1,
    limit,
  };
  if (provider === 'google') {
    const [suggestions, data] = await Promise.all([
      searchHotelSuggestions(query, { currency_code: currency }).catch(() => ({ suggestions: [] })),
      serpGet('google_hotels', {
        q: query, check_in_date: checkIn, check_out_date: checkOut,
        adults: Math.max(1, Number(lead.adults_count) || 1),
        children: Math.max(0, Number(lead.children_count) || 0), currency,
      }),
    ]);
    const properties = data.properties || (data.property ? [data.property] : []);
    return { provider: 'Google · SerpApi', kind, query, suggestions: suggestions.suggestions.slice(0, 10), results: properties.slice(0, limit).map((p) => mapGoogleHotel(p, currency)) };
  }
  if (provider === 'tripadvisor') {
    const data = await serpGet('tripadvisor', { q: query, ssrc: 'h', limit });
    return {
      provider: 'Tripadvisor · SerpApi', kind, query,
      results: (data.places || []).slice(0, limit).map((p) => ({
        id: String(p.place_id), title: p.title, provider: 'Tripadvisor · SerpApi', kind: 'place',
        price: null, currency, rating: p.rating ?? null, review_count: p.reviews ?? null,
        image: p.thumbnail || null, url: p.link || null, place_id: String(p.place_id),
        description: p.location || p.description || null,
      })),
    };
  }
  const source = {
    hotelbeds: () => searchHotelQuotes(params),
    booking: () => searchBookingHotels(params),
    airbnb: () => searchAirbnbHotels(params),
  }[provider];
  if (!source) throw Object.assign(new Error('Unknown market provider'), { status: 400 });
  const result = await source();
  const label = { hotelbeds: 'Hotelbeds', booking: 'Booking.com', airbnb: 'Airbnb' }[provider];
  return { provider: label, kind, query, results: (result.quotes || []).slice(0, limit).map((q) => mapQuote(q, label, kind)) };
}

export async function getGoogleHotelReviews(propertyToken) {
  if (!propertyToken) throw Object.assign(new Error('property_token is required'), { status: 400 });
  const data = await serpGet('google_hotels_reviews', { property_token: propertyToken });
  return { provider: 'Google · SerpApi', reviews: (data.reviews || []).slice(0, 10).map((r) => ({ author: r.user?.name || null, rating: r.rating ?? null, date: r.date || null, text: r.snippet || null })) };
}

export async function getTripadvisorPlace(placeId) {
  if (!/^[0-9]+$/.test(String(placeId || ''))) throw Object.assign(new Error('Valid place_id is required'), { status: 400 });
  const data = await serpGet('tripadvisor_place', { place_id: placeId });
  const place = data.place_result || {};
  return { provider: 'Tripadvisor · SerpApi', place: {
    name: place.name || null, description: place.description || null,
    rating: place.rating ?? null, reviews: place.reviews ?? null,
    address: place.address || null, url: place.link || null,
    hotels: (place.hotel_suggestions?.items || []).slice(0, 8).map((h) => ({ name: h.name, rating: h.rating ?? null, url: h.link || null })),
  } };
}
