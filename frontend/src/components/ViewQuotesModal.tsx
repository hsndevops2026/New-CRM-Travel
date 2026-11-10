import { t as translate, useI18n } from '../lib/i18n'
import { useEffect, useMemo, useState } from 'react'
import {
  fetchFlightQuotes,
  fetchHotelQuotes,
  formatDate,
  formatMoney,
  formatTime,
  hotelProviderLabel,
  HOTEL_SOURCE_ORDER,
  leadTitle,
  retryFlightQuotes,
  retryHotelQuotes,
  type FlightQuote,
  type HotelQuote,
  type Lead,
} from '../lib/leads'
import { EMPTY_QUOTE_FILTERS, filterHotelQuotes } from '../lib/quoteFilters'
import QuoteFiltersBar from './QuoteFiltersBar'

type Props = {
  open: boolean
  lead: Lead | null
  onClose: () => void
  onRetried?: (leadId: string) => void
}

function FlightQuoteCard({ quote }: { quote: FlightQuote }) {
  useI18n()
  const outbound = quote.outbound
  const inbound = quote.inbound

  return (
    <article className="rounded-xl border border-shop-border bg-shop-bg/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{outbound?.airline || 'Flight'}</div>
          {outbound?.flight_number && (
            <div className="text-xs text-shop-muted"><bdi dir="ltr">{outbound.flight_number}</bdi></div>
          )}
        </div>
        <div className="text-end">
          <div className="text-lg font-bold tracking-tight">
            <bdi dir="ltr">{formatMoney(quote.price, quote.currency)}</bdi>
          </div>
          <div className="text-xs text-shop-muted">{translate("total")}</div>
        </div>
      </div>

      {outbound && (
        <div className="mt-4 grid gap-1 text-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-shop-muted">
            {translate("Outbound")}</div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">
              {outbound.departure_airport} <bdi dir="ltr">{formatTime(outbound.departure_time)}</bdi>
            </span>
            <span className="text-shop-muted">→</span>
            <span className="font-semibold">
              {outbound.arrival_airport} <bdi dir="ltr">{formatTime(outbound.arrival_time)}</bdi>
            </span>
          </div>
          <div className="text-xs text-shop-muted">
            {outbound.departure_city} → {outbound.arrival_city} · {outbound.duration}
            {outbound.stops != null
              ? ` · ${outbound.stops === 0 ? translate('Non-stop') : translate("{value0} stop{value1}", { value0: translate(String(outbound.stops)), value1: translate(String(outbound.stops === 1 ? '' : 's')) })}`
              : ''}
          </div>
        </div>
      )}

      {inbound && (
        <div className="mt-3 grid gap-1 border-t border-shop-border pt-3 text-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-shop-muted">
            {translate("Return")}</div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">
              {inbound.departure_airport} <bdi dir="ltr">{formatTime(inbound.departure_time)}</bdi>
            </span>
            <span className="text-shop-muted">→</span>
            <span className="font-semibold">
              {inbound.arrival_airport} <bdi dir="ltr">{formatTime(inbound.arrival_time)}</bdi>
            </span>
          </div>
          <div className="text-xs text-shop-muted">
            {inbound.departure_city} → {inbound.arrival_city} · {inbound.duration}
            {inbound.stops != null
              ? ` · ${inbound.stops === 0 ? translate('Non-stop') : translate("{value0} stop{value1}", { value0: translate(String(inbound.stops)), value1: translate(String(inbound.stops === 1 ? '' : 's')) })}`
              : ''}
          </div>
        </div>
      )}
    </article>
  )
}

function HotelQuoteCard({ quote }: { quote: HotelQuote }) {
  useI18n()
  const freeCancel = Boolean(quote.free_cancellation)
  const cancelLabel =
    quote.cancellation_summary ||
    (quote.rate_class && String(quote.rate_class).toUpperCase() === 'NRF'
      ? 'Non-refundable'
      : null)

  return (
    <article className="overflow-hidden rounded-xl border border-shop-border bg-shop-bg/40">
      <div className="flex gap-3 p-4">
        {quote.photo_url && (
          <img
            src={quote.photo_url}
            alt={quote.hotel_name || 'Hotel'}
            className="size-16 shrink-0 rounded-lg object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="truncate font-semibold">{quote.hotel_name || 'Hotel'}</div>
                {quote.provider && (
                  <span className="rounded-md bg-white px-1.5 py-0.5 text-[11px] font-semibold text-shop-muted">
                    {hotelProviderLabel(quote.provider)}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-shop-muted">
                {quote.category && <span>{quote.category}</span>}
                {quote.destination_name && <span>{quote.destination_name}</span>}
                {quote.zone_name && <span>{quote.zone_name}</span>}
              </div>
              {(quote.room_name || quote.room_code) && (
                <div className="mt-1 text-xs text-shop-muted">
                  {quote.room_name || 'Room'}
                  {quote.room_code ? ` · ${quote.room_code}` : ''}
                </div>
              )}
            </div>
            <div className="shrink-0 text-end">
              <div className="text-lg font-bold tracking-tight">
                <bdi dir="ltr">{formatMoney(quote.price, quote.currency)}</bdi>
              </div>
              <div className="text-xs text-shop-muted">{translate("total stay")}</div>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {quote.review_score != null && (
              <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 font-semibold text-blue-800">
                ★ {Number(quote.review_score).toFixed(1)}
                {quote.review_word && (
                  <span className="font-normal text-blue-600">· {quote.review_word}</span>
                )}
                {quote.review_count != null && (
                  <span className="font-normal text-blue-500">
                    ({Number(quote.review_count).toLocaleString()})
                  </span>
                )}
              </span>
            )}
            {quote.board_name && (
              <span className="rounded-md bg-shop-bg px-2 py-0.5 text-shop-muted">
                {quote.board_name}
              </span>
            )}
            {quote.rate_type && (
              <span className="rounded-md bg-green-50 px-2 py-0.5 font-medium text-green-700">
                {quote.rate_type}
              </span>
            )}
            {freeCancel ? (
              <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                {translate("Free cancellation")}</span>
            ) : cancelLabel ? (
              <span className="rounded-md bg-amber-50 px-2 py-0.5 font-medium text-amber-800">
                {cancelLabel}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  )
}

export default function ViewQuotesModal({ open, lead, onClose, onRetried }: Props) {
  useI18n()
  const [loading, setLoading] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flightQuotes, setFlightQuotes] = useState<FlightQuote[]>([])
  const [hotelQuotes, setHotelQuotes] = useState<HotelQuote[]>([])
  const [meta, setMeta] = useState<{ fromName?: string; toName?: string; destName?: string }>({})
  const [status, setStatus] = useState<string | null>(null)
  const filterSession = open ? lead?.id ?? null : null
  const [filtersSession, setFiltersSession] = useState(filterSession)
  const [filters, setFilters] = useState(EMPTY_QUOTE_FILTERS)
  if (filterSession !== filtersSession) {
    setFiltersSession(filterSession)
    setFilters(EMPTY_QUOTE_FILTERS)
  }

  const isHotel = String(lead?.booking_type || '').toLowerCase() === 'hotel'
  const leadId = lead?.id
  const filteredHotelQuotes = useMemo(
    () => filterHotelQuotes(hotelQuotes, filters),
    [hotelQuotes, filters],
  )
  const groupedHotelQuotes = useMemo(
    () =>
      HOTEL_SOURCE_ORDER.map((source) => ({
        ...source,
        quotes: filteredHotelQuotes.filter(
          (quote) => (quote.provider || 'hotelbeds') === source.id,
        ),
      })).filter((source) => source.quotes.length > 0),
    [filteredHotelQuotes],
  )

  useEffect(() => {
    if (!open || !lead || !leadId) return

    let cancelled = false
    let timer: number | undefined

    const load = async (silent = false) => {
      if (!silent) {
        setLoading(true)
        setError(null)
      }

      try {
        if (isHotel) {
          const data = await fetchHotelQuotes(lead)
          if (cancelled) return

          setStatus(data.quote_status || null)
          setMeta({ destName: data.destination?.name || lead.destination })
          const quotes = Array.isArray(data.quotes) ? data.quotes : []
          setHotelQuotes(quotes)
          setFlightQuotes([])

          if (data.quote_status === 'processing') {
            setError('Fetching Hotelbeds, Booking.com and Airbnb…')
            timer = window.setTimeout(() => void load(true), 2000)
            return
          }
          if (data.quote_status === 'error') {
            setError(data.quote_error || 'Quote fetch failed')
            return
          }
          if (!quotes.length) {
            setError('No hotel quotes were found for this itinerary.')
            return
          }
          setError(null)
        } else {
          const data = await fetchFlightQuotes(lead)
          if (cancelled) return

          setStatus(data.quote_status || null)
          setMeta({ fromName: data.from?.name, toName: data.to?.name })
          const quotes = Array.isArray(data.quotes) ? data.quotes : []
          setFlightQuotes(quotes)
          setHotelQuotes([])

          if (data.quote_status === 'processing') {
            setError('Fetching flight quotes…')
            timer = window.setTimeout(() => void load(true), 2000)
            return
          }
          if (data.quote_status === 'error') {
            setError(data.quote_error || 'Quote fetch failed')
            return
          }
          if (!quotes.length) {
            setError('No flight quotes were saved for this itinerary.')
            return
          }
          setError(null)
        }
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load quotes')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load(false)
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [open, leadId, isHotel, lead])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  const handleRetry = async () => {
    if (!lead) return
    setRetrying(true)
    setError(null)
    try {
      if (isHotel) {
        await retryHotelQuotes(lead.id)
      } else {
        await retryFlightQuotes(lead.id)
      }
      onRetried?.(lead.id)
      setStatus('processing')
      setHotelQuotes([])
      setFlightQuotes([])
      setError(isHotel ? 'Fetching Hotelbeds, Booking.com and Airbnb…' : 'Fetching quotes…')
      // Reload after a short delay so the queue can start
      window.setTimeout(async () => {
        try {
          if (isHotel) {
            const data = await fetchHotelQuotes(lead)
            setStatus(data.quote_status || null)
            setHotelQuotes(data.quotes || [])
            if (data.quote_status === 'processing') {
              setError('Fetching Hotelbeds, Booking.com and Airbnb…')
            } else if (data.quote_status === 'error') {
              setError(data.quote_error || 'Quote fetch failed')
            } else if (!(data.quotes || []).length) {
              setError('No hotel quotes were found for this itinerary.')
            } else {
              setError(null)
            }
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to load quotes')
        }
      }, 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry quotes')
    } finally {
      setRetrying(false)
    }
  }

  if (!open || !lead) return null

  const title = isHotel ? 'Hotel quotes' : 'Flight quotes'
  const quotes = isHotel ? hotelQuotes : flightQuotes
  const showRetry = !loading && (status === 'error' || (status === 'completed' && !quotes.length) || !status)

  const subtitle = (() => {
    const parts: string[] = []
    if (isHotel) {
      parts.push(meta.destName || lead.destination)
    } else {
      parts.push(
        meta.fromName && meta.toName
          ? `${meta.fromName} → ${meta.toName}`
          : leadTitle(lead),
      )
    }
    parts.push(`${formatDate(lead.travel_date)} → ${formatDate(lead.return_date)}`)
    parts.push(`${lead.adults_count}A · ${lead.children_count}C`)
    return parts.join(' · ')
  })()

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="flex max-h-[92dvh] w-full max-w-2xl flex-col rounded-t-2xl bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-shop-border px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{translate(title)}</h2>
            <p className="mt-0.5 truncate text-sm text-shop-muted">{translate(subtitle)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-shop-muted hover:bg-shop-bg"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-5">
          {loading && (
            <div className="py-16 text-center text-sm text-shop-muted">
              {translate("Loading saved quotes…")}</div>
          )}

          {!loading && error && (
            <div
              className={`rounded-lg px-3 py-3 text-sm ${
                status === 'processing'
                  ? 'bg-amber-50 text-amber-800'
                  : 'bg-red-50 text-red-700'
              }`}
            >
              {translate(error)}
            </div>
          )}

          {!loading && isHotel && hotelQuotes.length > 0 && (
            <QuoteFiltersBar
              filters={filters}
              onChange={setFilters}
              resultCount={filteredHotelQuotes.length}
              totalCount={hotelQuotes.length}
            />
          )}

          {!loading && isHotel && hotelQuotes.length > 0 && filteredHotelQuotes.length === 0 && (
            <div className="py-8 text-center text-sm text-shop-muted">
              {translate("No hotels match these filters.")}</div>
          )}

          {!loading && isHotel && groupedHotelQuotes.map((source) => (
            <section key={source.id} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-shop-muted">
                {translate(source.label)}
              </h3>
              {source.quotes.map((quote) => (
                <HotelQuoteCard key={quote.id} quote={quote} />
              ))}
            </section>
          ))}

          {!loading && !isHotel && flightQuotes.map((quote) => (
            <FlightQuoteCard key={quote.id} quote={quote} />
          ))}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-shop-border px-4 py-3 sm:px-5">
          {showRetry && (
            <button
              type="button"
              disabled={retrying}
              onClick={() => void handleRetry()}
              className="min-h-11 rounded-lg bg-shop-ink px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-60"
            >
              {retrying ? translate('Retrying…') : translate("Retry fetch")}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-lg border border-shop-border px-4 py-2 text-sm font-medium hover:bg-shop-bg"
          >
            {translate("Close")}</button>
        </div>
      </div>
    </div>
  )
}
