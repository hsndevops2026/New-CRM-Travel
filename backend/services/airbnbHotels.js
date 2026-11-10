import { rapidApiConfig } from '../config/rapidapi.js';
import { rapidGet } from './rapidClient.js';

function roundMoney(value) {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function airbnbGet(path, params = {}) {
  return rapidGet(path, params, {
    key: rapidApiConfig.airbnbKey,
    host: rapidApiConfig.airbnbHost,
    baseUrl: rapidApiConfig.airbnbBaseUrl,
    product: 'Airbnb (airbnb19)',
    envName: 'RAPIDAPI_AIRBNB_KEY or RAPIDAPI_KEY',
  });
}

function parseAirbnbMoney(value, fallbackCurrency) {
  if (value == null || value === '') return { price: null, currency: fallbackCurrency };
  if (typeof value === 'number') return { price: roundMoney(value), currency: fallbackCurrency };
  if (typeof value === 'object') {
    return {
      price: roundMoney(value.amount ?? value.value ?? value.price ?? value.total),
      currency: value.currency || value.currency_code || fallbackCurrency,
    };
  }

  const text = String(value);
  const currency = (text.match(/\b([A-Z]{3})\b/) || [])[1] || fallbackCurrency;
  const match = text.match(/([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)/);
  return {
    price: roundMoney(match ? match[1].replace(/,/g, '') : null),
    currency,
  };
}

function parseAirbnbRating(entry) {
  const localized = String(entry?.avgRatingLocalized || entry?.avgRatingA11yLabel || '');
  const scoreMatch = localized.match(/([0-9]+(?:\.[0-9]+)?)/);
  const countMatch = localized.match(/\(([0-9,]+)\)/) || localized.match(/([0-9,]+)\s+reviews/i);
  const statsCount =
    entry?.demandStayListing?.listingRatingStats?.overallRatingStats?.ratingCount;

  const review_score =
    scoreMatch != null
      ? Number(scoreMatch[1])
      : entry?.avgRating != null
        ? Number(entry.avgRating)
        : null;
  const review_count =
    countMatch != null
      ? Number(String(countMatch[1]).replace(/,/g, ''))
      : statsCount != null
        ? Number(statsCount)
        : entry?.reviewsCount != null
          ? Number(entry.reviewsCount)
          : null;

  return {
    review_score: Number.isFinite(review_score) ? review_score : null,
    review_count: Number.isFinite(review_count) ? review_count : null,
  };
}

function firstPhoto(entry, listing) {
  const photos =
    entry?.contextualPictures || listing?.images || entry?.images || entry?.photos || [];
  if (!Array.isArray(photos) || !photos.length) return listing?.picture || entry?.picture || null;
  const first = photos[0];
  if (typeof first === 'string') return first;
  return first?.picture || first?.url || first?.src || null;
}

export function mapAirbnbHotel(entry, currency_code = 'USD') {
  const listing = entry?.listing || entry || {};
  const coord =
    listing.coordinate ||
    entry?.demandStayListing?.location?.coordinate ||
    {};
  const primary = entry?.structuredDisplayPrice?.primaryLine || {};
  const { price, currency } = parseAirbnbMoney(
    primary.discountedPrice ||
      primary.price ||
      primary.originalPrice ||
      primary.accessibilityLabel ||
      entry?.price ||
      listing.price,
    currency_code,
  );
  const { review_score, review_count } = parseAirbnbRating(entry);
  const hotel_name =
    listing.name ||
    entry?.subtitle ||
    entry?.nameLocalized?.localizedStringWithTranslationPreference ||
    entry?.title ||
    listing.title ||
    'Airbnb listing';

  return {
    id: String(listing.id || entry?.id || entry?.propertyId || ''),
    hotel_name,
    category: listing.title || entry?.title || entry?.roomType || null,
    destination_code: null,
    destination_name: listing.city || listing.localizedCityName || entry?.city || null,
    zone_name: listing.title || entry?.publicAddress || null,
    latitude: coord.latitude != null ? Number(coord.latitude) : listing.latitude != null ? Number(listing.latitude) : null,
    longitude:
      coord.longitude != null
        ? Number(coord.longitude)
        : listing.longitude != null
          ? Number(listing.longitude)
          : null,
    price,
    currency,
    room_code: null,
    room_name: null,
    rate_key: null,
    rate_type: null,
    rate_class: null,
    board_code: null,
    board_name: null,
    review_score,
    review_count,
    review_word: null,
    photo_url: firstPhoto(entry, listing),
    refundable: null,
    free_cancellation: null,
    cancellation_summary: null,
    cancellation_policies: null,
    provider: 'airbnb',
  };
}

function listingListFromResponse(data) {
  if (Array.isArray(data?.data?.list)) return data.data.list;
  if (Array.isArray(data?.data?.listings)) return data.data.listings;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.list)) return data.list;
  if (Array.isArray(data?.result)) return data.result;
  return [];
}

export async function searchAirbnbHotels({
  destination,
  travel_date,
  return_date,
  adults_count = 1,
  children_count = 0,
  currency_code = 'USD',
  limit = 8,
}) {
  if (!destination || !travel_date || !return_date) {
    const error = new Error('destination, travel_date, and return_date are required');
    error.status = 400;
    throw error;
  }

  const destinationName = String(destination).trim();
  const childCount = Math.max(0, Number(children_count) || 0);
  const data = await airbnbGet('/api/v2/searchPropertyByLocation', {
    query: destinationName,
    checkin: String(travel_date).slice(0, 10),
    checkout: String(return_date).slice(0, 10),
    adults: Math.max(1, Number(adults_count) || 1),
    children: childCount || undefined,
    currency: currency_code,
  });

  const listings = listingListFromResponse(data);
  const quotes = listings.slice(0, limit).map((hotel) => mapAirbnbHotel(hotel, currency_code));

  if (!quotes.length) {
    const error = new Error(
      `No Airbnb listings available for "${destinationName}" on these dates.`,
    );
    error.status = 404;
    throw error;
  }

  return {
    destination: { name: destinationName },
    search: {
      destination: destinationName,
      travel_date: String(travel_date).slice(0, 10),
      return_date: String(return_date).slice(0, 10),
      adults: Math.max(1, Number(adults_count) || 1),
      children: childCount,
      currency_code,
      provider: 'airbnb',
    },
    count: quotes.length,
    quotes,
  };
}
