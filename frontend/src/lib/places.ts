import { apiJson } from './api'

export type AirportSuggestion = {
  id: string | null
  name: string | null
  type: string | null
  description: string | null
  position: number | null
  airports: Array<{
    id: string | null
    name: string | null
    city: string | null
    city_id: string | null
    /** Display string as returned by Google, e.g. "6 mi". */
    distance: string | null
    /** Parsed numeric distance for sorting. */
    distance_value: number | null
  }>
}

export type HotelSuggestion = {
  position: number | null
  value: string | null
  suggestion: string | null
  type: string | null
  location: string | null
  thumbnail: string | null
  property_token: string | null
  kgmid: string | null
  data_cid: string | null
  is_property: boolean
  highlighted_words: string[]
}

export type ImageResult = {
  position: number | null
  title: string | null
  thumbnail: string | null
  original: string | null
  /** Best displayable URL: original, falling back to thumbnail. */
  url: string | null
  width: number | null
  height: number | null
  source: string | null
  source_logo: string | null
  link: string | null
  is_product: boolean
}

/** Airport / city typeahead — SerpApi google_flights_autocomplete. */
export function searchAirports(query: string, signal?: AbortSignal) {
  return apiJson<{ query: string; count: number; suggestions: AirportSuggestion[] }>(
    `/api/flights/airports?query=${encodeURIComponent(query)}`,
    { signal },
  )
}

/** Hotel destination / property typeahead — SerpApi google_hotels_autocomplete. */
export function searchHotelPlaces(query: string, signal?: AbortSignal) {
  return apiJson<{
    query: string
    count: number
    suggestions: HotelSuggestion[]
    places: HotelSuggestion[]
    properties: HotelSuggestion[]
  }>(`/api/hotels/destinations/suggest?query=${encodeURIComponent(query)}`, { signal })
}

/** Image search — SerpApi google_images. */
export function searchImages(query: string, limit = 20, signal?: AbortSignal) {
  return apiJson<{ query: string; count: number; page: number; images: ImageResult[] }>(
    `/api/images/search?query=${encodeURIComponent(query)}&limit=${limit}`,
    { signal },
  )
}

/** Single best image for a subject, usage-rights filtered. */
export function pickImage(query: string, signal?: AbortSignal) {
  return apiJson<{ query: string; image: ImageResult }>(
    `/api/images/pick?query=${encodeURIComponent(query)}`,
    { signal },
  )
}

export type FlightSegment = {
  airline: string | null
  airline_logo: string | null
  flight_number: string | null
  departure_airport: string | null
  departure_city: string | null
  departure_time: string | null
  arrival_airport: string | null
  arrival_city: string | null
  arrival_time: string | null
  duration: string | null
  stops: number
  layovers: Array<{ airport: string | null; duration: string | null }>
}

export type FlightQuote = {
  id: string
  price: number | null
  currency: string
  outbound: FlightSegment | null
  inbound: FlightSegment | null
  outbound_only: boolean
  cabin_class: string | null
  provider: string
}

export type ResolvedLocation = {
  id: string
  name: string
  code: string | null
  metro: boolean
  airport_spread_mi: number | null
  nearby_airports: Array<{ id: string | null; name: string | null; distance: string | null }>
}

export type FlightQuoteResult = {
  provider: string
  from: ResolvedLocation
  to: ResolvedLocation
  search: { trip_type: string; metro_search: boolean; travel_date: string; return_date: string | null }
  count: number
  quotes: FlightQuote[]
}

/** Live flight search. `provider: 'google'` routes to SerpApi Google Flights. */
export function searchFlightQuotes(
  body: {
    origin: string
    destination: string
    travel_date: string
    return_date?: string
    provider?: 'google' | 'booking'
    limit?: number
  },
  signal?: AbortSignal,
) {
  return apiJson<FlightQuoteResult>('/api/flights/quotes', {
    method: 'POST',
    body: JSON.stringify(body),
    signal,
  })
}

/** Flattens an airport suggestion into the option rows shown in the dropdown. */
export function airportOptions(suggestions: AirportSuggestion[]) {
  const options: Array<{ value: string; label: string; hint: string | null }> = []

  for (const suggestion of suggestions) {
    const airports = suggestion.airports || []
    if (!airports.length) {
      if (suggestion.name) {
        options.push({
          value: suggestion.name,
          label: suggestion.name,
          hint: suggestion.description,
        })
      }
      continue
    }
    for (const airport of airports) {
      if (!airport.id) continue
      options.push({
        value: airport.id,
        label: `${airport.id} — ${airport.name || suggestion.name || ''}`.trim(),
        hint: airport.city || suggestion.description,
      })
    }
  }

  return options
}

/** Flattens hotel suggestions into dropdown option rows. */
export function hotelOptions(suggestions: HotelSuggestion[]) {
  return suggestions
    .filter((item) => item.value)
    .map((item) => ({
      value: item.value as string,
      label: item.value as string,
      hint: item.location || item.type,
    }))
}
