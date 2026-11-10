import { useState } from 'react'
import Button from './ui/Button'
import StatusBadge from './ui/StatusBadge'
import {
  searchAirports,
  searchFlightQuotes,
  searchHotelPlaces,
  searchImages,
  type AirportSuggestion,
  type FlightQuoteResult,
  type HotelSuggestion,
  type ImageResult,
} from '../lib/places'

/**
 * Live check for the four SerpApi integrations.
 *
 * Doubles as a diagnostic: each card shows the endpoint it called and how long
 * it took, so a missing SERPAPI_KEY or an exhausted search quota shows up here
 * as a readable error instead of an empty dropdown somewhere in the CRM.
 */

type Card = 'airports' | 'hotels' | 'flights' | 'images'

const CARDS: Array<{ id: Card; label: string; endpoint: string; engine: string }> = [
  {
    id: 'airports',
    label: 'Flight autocomplete',
    endpoint: 'GET /api/flights/airports',
    engine: 'google_flights_autocomplete',
  },
  {
    id: 'hotels',
    label: 'Hotel autocomplete',
    endpoint: 'GET /api/hotels/destinations/suggest',
    engine: 'google_hotels_autocomplete',
  },
  {
    id: 'flights',
    label: 'Flight search',
    endpoint: 'POST /api/flights/quotes',
    engine: 'google_flights',
  },
  {
    id: 'images',
    label: 'Image search',
    endpoint: 'GET /api/images/search',
    engine: 'google_images',
  },
]

const inputClass = 'min-h-10 w-full rounded-lg border border-shop-border px-3 py-2 text-sm'

function defaultDate(offsetDays: number) {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}

export default function GoogleApisPanel() {
  const [card, setCard] = useState<Card>('airports')

  const [placeQuery, setPlaceQuery] = useState('dubai')
  const [imageQuery, setImageQuery] = useState('Maldives overwater villa')
  const [origin, setOrigin] = useState('DXB')
  const [destination, setDestination] = useState('LHR')
  const [travelDate, setTravelDate] = useState(defaultDate(30))
  const [returnDate, setReturnDate] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState<number | null>(null)
  const [airports, setAirports] = useState<AirportSuggestion[] | null>(null)
  const [hotels, setHotels] = useState<HotelSuggestion[] | null>(null)
  const [flights, setFlights] = useState<FlightQuoteResult | null>(null)
  const [images, setImages] = useState<ImageResult[] | null>(null)

  const active = CARDS.find((item) => item.id === card)

  const run = async () => {
    setBusy(true)
    setError(null)
    setElapsed(null)
    const startedAt = Date.now()
    try {
      if (card === 'airports') {
        setAirports((await searchAirports(placeQuery)).suggestions)
      } else if (card === 'hotels') {
        setHotels((await searchHotelPlaces(placeQuery)).suggestions)
      } else if (card === 'flights') {
        setFlights(
          await searchFlightQuotes({
            provider: 'google',
            origin,
            destination,
            travel_date: travelDate,
            return_date: returnDate || undefined,
            limit: 5,
          }),
        )
      } else {
        setImages((await searchImages(imageQuery, 12)).images)
      }
      setElapsed(Date.now() - startedAt)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
      setElapsed(Date.now() - startedAt)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="integrations" aria-labelledby="s-google" className="scroll-mt-4 rounded-[10px] border border-shop-border bg-white p-5">
      <h2 id="s-google" className="text-base font-bold">Google APIs (SerpApi)</h2>
      <p className="mt-1 text-sm text-shop-muted">
        Run each integration live. Every call spends one SerpApi search credit.
      </p>

      <div className="mt-3 flex flex-wrap gap-1">
        {CARDS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setCard(item.id)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium max-sm:min-h-11 ${
              card === item.id
                ? 'bg-shop-accent text-white'
                : 'bg-shop-bg text-shop-muted ring-1 ring-shop-border'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {active && (
        <p className="mt-3 font-mono text-[11px] text-shop-muted">
          {active.endpoint} · engine={active.engine}
        </p>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {(card === 'airports' || card === 'hotels') && (
          <input
            className={`${inputClass} sm:col-span-2`}
            value={placeQuery}
            placeholder="dubai"
            onChange={(event) => setPlaceQuery(event.target.value)}
          />
        )}

        {card === 'images' && (
          <input
            className={`${inputClass} sm:col-span-2`}
            value={imageQuery}
            placeholder="Maldives overwater villa"
            onChange={(event) => setImageQuery(event.target.value)}
          />
        )}

        {card === 'flights' && (
          <>
            <input
              className={inputClass}
              value={origin}
              placeholder="Origin (DXB or dubai)"
              onChange={(event) => setOrigin(event.target.value)}
            />
            <input
              className={inputClass}
              value={destination}
              placeholder="Destination (LHR or london)"
              onChange={(event) => setDestination(event.target.value)}
            />
            <label className="grid gap-1 text-xs text-shop-muted">
              Depart
              <input
                type="date"
                className={inputClass}
                value={travelDate}
                onChange={(event) => setTravelDate(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-xs text-shop-muted">
              Return (blank = one way)
              <input
                type="date"
                className={inputClass}
                value={returnDate}
                onChange={(event) => setReturnDate(event.target.value)}
              />
            </label>
          </>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button variant="primary" onClick={() => void run()} disabled={busy}>
          {busy ? 'Running…' : 'Run'}
        </Button>
        {elapsed != null && !busy && (
          <span className="text-xs text-shop-muted">{(elapsed / 1000).toFixed(1)}s</span>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {/* ── Results ─────────────────────────────────────────────────────── */}

      {card === 'airports' && airports && !error && (
        <ul className="mt-3 space-y-2">
          {airports.map((suggestion) => (
            <li key={suggestion.id} className="rounded-lg bg-shop-bg px-3 py-2 text-sm">
              <div className="font-medium">{suggestion.name}</div>
              <div className="text-xs text-shop-muted">{suggestion.description}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {suggestion.airports.map((airport) => (
                  <span
                    key={`${suggestion.id}-${airport.id}`}
                    className="rounded bg-white px-1.5 py-0.5 text-[11px] ring-1 ring-shop-border"
                  >
                    {airport.id} · {airport.distance}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      {card === 'hotels' && hotels && !error && (
        <ul className="mt-3 space-y-2">
          {hotels.map((suggestion, index) => (
            <li
              key={`${suggestion.value}-${index}`}
              className="flex items-center gap-2 rounded-lg bg-shop-bg px-3 py-2 text-sm"
            >
              {suggestion.thumbnail && (
                <img
                  src={suggestion.thumbnail}
                  alt=""
                  className="h-8 w-8 rounded object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{suggestion.value}</div>
                {suggestion.location && (
                  <div className="truncate text-xs text-shop-muted">{suggestion.location}</div>
                )}
              </div>
              {suggestion.is_property && <StatusBadge label="property" tone="info" />}
            </li>
          ))}
        </ul>
      )}

      {card === 'flights' && flights && !error && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-shop-muted">
            <StatusBadge
              label={`${flights.from.id} → ${flights.to.id}`}
              tone="info"
            />
            <StatusBadge
              label={flights.search.metro_search ? 'metro search' : 'single airport'}
              tone={flights.search.metro_search ? 'warning' : 'neutral'}
            />
            <span>{flights.search.trip_type.replace('_', ' ')}</span>
            <span>· {flights.count} results</span>
          </div>

          {flights.quotes.map((quote) => (
            <div key={quote.id} className="rounded-lg bg-shop-bg px-3 py-2 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">
                  {quote.currency} {quote.price ?? '—'}
                </span>
                <span className="text-xs text-shop-muted">
                  {quote.outbound?.airline} · {quote.cabin_class}
                </span>
              </div>
              {quote.outbound && (
                <div className="mt-1 text-xs text-shop-muted">
                  {quote.outbound.departure_airport} {quote.outbound.departure_time} →{' '}
                  {quote.outbound.arrival_airport} {quote.outbound.arrival_time} ·{' '}
                  {quote.outbound.duration} ·{' '}
                  {quote.outbound.stops === 0 ? 'nonstop' : `${quote.outbound.stops} stop`}
                </div>
              )}
              {quote.inbound ? (
                <div className="text-xs text-shop-muted">
                  ↩ {quote.inbound.departure_airport} {quote.inbound.departure_time} →{' '}
                  {quote.inbound.arrival_airport} · {quote.inbound.duration}
                </div>
              ) : quote.outbound_only ? (
                <div className="text-xs text-amber-700">
                  outbound only — return not resolved
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {card === 'images' && images && !error && (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {images.map((image, index) => (
            <a
              key={`${image.url}-${index}`}
              href={image.link || image.url || '#'}
              target="_blank"
              rel="noreferrer noopener"
              className="group block overflow-hidden rounded-lg ring-1 ring-shop-border"
              title={image.title || ''}
            >
              <img
                src={image.thumbnail || image.url || ''}
                alt={image.title || ''}
                loading="lazy"
                className="h-20 w-full object-cover transition-transform group-hover:scale-105"
              />
              <span className="block truncate px-1.5 py-1 text-[10px] text-shop-muted">
                {image.width && image.height ? `${image.width}×${image.height}` : image.source}
              </span>
            </a>
          ))}
        </div>
      )}
    </section>
  )
}
