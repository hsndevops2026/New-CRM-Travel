import { rapidGet } from './rapidClient.js';
import { minutesToDuration } from '../utils/duration.js';

function pickLocation(results, query) {
  const list = Array.isArray(results) ? results : [];
  if (!list.length) {
    const error = new Error(`No airport found for "${query}"`);
    error.status = 404;
    throw error;
  }

  const normalized = query.trim().toLowerCase();
  const scored = list.map((item) => {
    const id = String(item.id || '');
    const name = String(item.name || item.cityName || '').toLowerCase();
    const code = String(item.code || item.iata || '').toLowerCase();
    let score = 0;
    if (id.toUpperCase().endsWith('.AIRPORT')) score += 50;
    if (String(item.type || '').toUpperCase() === 'AIRPORT') score += 40;
    if (code && (code === normalized || normalized.includes(code))) score += 30;
    if (name === normalized) score += 25;
    if (name.includes(normalized) || normalized.includes(name)) score += 10;
    return { item, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].item;
}

export async function searchFlightLocation(query) {
  const data = await rapidGet('/flights/searchDestination', {
    query,
    languagecode: 'en-us',
  });
  const location = pickLocation(data?.data || data?.result || [], query);
  return {
    id: location.id,
    name: location.name || location.cityName || query,
    type: location.type || null,
    code: location.code || location.iata || null,
    raw: location,
  };
}

function formatPrice(priceBreakdown) {
  if (!priceBreakdown?.total) return null;
  const units = Number(priceBreakdown.total.units) || 0;
  const nanos = Number(priceBreakdown.total.nanos) || 0;
  const amount = units + nanos / 1_000_000_000;
  const currency =
    priceBreakdown.total.currencyCode ||
    priceBreakdown.total.currency ||
    'USD';
  return { amount, currency };
}

function mapSegment(segment) {
  if (!segment) return null;
  const legs = Array.isArray(segment.legs) ? segment.legs : [];
  const firstLeg = legs[0] || {};
  const carrier =
    firstLeg.carriersData?.[0]?.name ||
    firstLeg.flightInfo?.carrierInfo?.marketingCarrier ||
    'Airline';
  const flightNumber = firstLeg.flightInfo?.flightNumber
    ? `${firstLeg.flightInfo?.carrierInfo?.marketingCarrier || ''}${firstLeg.flightInfo.flightNumber}`
    : null;

  return {
    airline: carrier,
    flight_number: flightNumber,
    departure_airport: segment.departureAirport?.code || firstLeg.departureAirport?.code,
    departure_city: segment.departureAirport?.cityName || firstLeg.departureAirport?.cityName,
    departure_time: segment.departureTime || firstLeg.departureTime,
    arrival_airport: segment.arrivalAirport?.code || firstLeg.arrivalAirport?.code,
    arrival_city: segment.arrivalAirport?.cityName || firstLeg.arrivalAirport?.cityName,
    arrival_time: segment.arrivalTime || firstLeg.arrivalTime,
    duration: minutesToDuration(segment.totalTime),
    stops: Math.max(0, legs.length - 1),
    legs: legs.map((leg) => ({
      airline: leg.carriersData?.[0]?.name || null,
      departure_airport: leg.departureAirport?.code,
      departure_city: leg.departureAirport?.cityName,
      departure_time: leg.departureTime,
      arrival_airport: leg.arrivalAirport?.code,
      arrival_city: leg.arrivalAirport?.cityName,
      arrival_time: leg.arrivalTime,
      duration: minutesToDuration(leg.totalTime),
    })),
  };
}

function mapOffer(offer, index) {
  const segments = Array.isArray(offer.segments) ? offer.segments : [];
  const outbound = mapSegment(segments[0]);
  const inbound = segments.length > 1 ? mapSegment(segments[1]) : null;
  const price = formatPrice(offer.priceBreakdown);

  return {
    id: offer.token || offer.offerId || `offer-${index}`,
    price: price?.amount ?? null,
    currency: price?.currency ?? 'USD',
    outbound,
    inbound,
    cabin_class: offer.travelerPrices?.[0]?.travelerPriceBreakdown ? null : null,
  };
}

export async function searchFlightQuotes({
  origin,
  destination,
  travel_date,
  return_date,
  adults_count = 1,
  children_count = 0,
  children_ages = [],
  currency_code = 'USD',
  sort = 'BEST',
  cabinClass = 'ECONOMY',
  limit = 8,
}) {
  if (!origin || !destination || !travel_date) {
    const error = new Error('origin, destination, and travel_date are required');
    error.status = 400;
    throw error;
  }

  // Resolve airports sequentially to stay under RapidAPI free-tier rate limits
  const from = await searchFlightLocation(origin);
  const to = await searchFlightLocation(destination);

  const ages = Array.isArray(children_ages)
    ? children_ages.filter((age) => age !== '' && age != null)
    : String(children_ages || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

  const params = {
    fromId: from.id,
    toId: to.id,
    departDate: String(travel_date).slice(0, 10),
    pageNo: 1,
    adults: Math.max(1, Number(adults_count) || 1),
    sort,
    cabinClass,
    currency_code,
    stops: 'none',
  };

  if (return_date) {
    params.returnDate = String(return_date).slice(0, 10);
  }

  if (Number(children_count) > 0 && ages.length) {
    params.children = ages.join(',');
  } else if (Number(children_count) > 0) {
    // API expects ages; default school-age if ages missing
    params.children = Array.from({ length: Number(children_count) }, () => '8').join(',');
  }

  const data = await rapidGet('/flights/searchFlights', params);
  const offers = data?.data?.flightOffers || data?.data?.flights || [];
  const quotes = offers.slice(0, limit).map(mapOffer);

  return {
    from,
    to,
    search: {
      origin,
      destination,
      travel_date: params.departDate,
      return_date: params.returnDate || null,
      adults: params.adults,
      children: Number(children_count) || 0,
      currency_code,
      sort,
      cabinClass,
    },
    count: quotes.length,
    quotes,
  };
}
