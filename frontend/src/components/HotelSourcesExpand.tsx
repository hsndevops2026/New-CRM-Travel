import { t as translate, useI18n } from '../lib/i18n'
import { useEffect, useState } from 'react'
import {
  fetchHotelSources,
  formatMoney,
  type HotelQuote,
  type HotelSourceResult,
  type Lead,
} from '../lib/leads'

function HotelMiniCard({ quote }: { quote: HotelQuote }) {
  useI18n()
  const freeCancel = Boolean(quote.free_cancellation)

  return (
    <article className="w-[15.5rem] shrink-0 overflow-hidden rounded-xl border border-shop-border bg-white shadow-sm">
      {quote.photo_url ? (
        <img
          src={quote.photo_url}
          alt={quote.hotel_name || 'Hotel'}
          className="h-24 w-full object-cover"
        />
      ) : (
        <div className="flex h-24 items-center justify-center bg-shop-bg text-xs font-semibold uppercase tracking-wide text-shop-muted">
          {(quote.hotel_name || 'HO').slice(0, 2)}
        </div>
      )}
      <div className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-shop-ink">
              {quote.hotel_name || 'Hotel'}
            </div>
            <div className="truncate text-xs text-shop-muted">
              {[quote.category, quote.zone_name || quote.destination_name].filter(Boolean).join(' · ') ||
                '—'}
            </div>
          </div>
          <div className="shrink-0 text-end">
            <div className="text-sm font-bold tracking-tight text-shop-ink">
              <bdi dir="ltr">{formatMoney(quote.price, quote.currency)}</bdi>
            </div>
            <div className="text-[11px] text-shop-muted">{translate("total stay")}</div>
          </div>
        </div>
        {(quote.room_name || quote.board_name) && (
          <div className="truncate text-xs text-shop-muted">
            {[quote.room_name, quote.board_name].filter(Boolean).join(' · ')}
          </div>
        )}
        <div className="flex flex-wrap gap-1">
          {quote.review_score != null && (
            <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-800">
              ★ {Number(quote.review_score).toFixed(1)}
              {quote.review_word ? ` ${quote.review_word}` : ''}
            </span>
          )}
          {freeCancel && (
            <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
              {translate("Free cancel")}</span>
          )}
        </div>
      </div>
    </article>
  )
}

function SourceRow({
  label,
  source,
  loading,
}: {
  label: string
  source: HotelSourceResult | undefined
  loading: boolean
}) {
  useI18n()
  return (
    <div className="flex min-h-[11rem] border-b border-shop-border last:border-b-0">
      <div className="flex w-28 shrink-0 flex-col justify-center gap-1 border-e border-shop-border bg-white px-3 py-4 sm:w-36">
        <div className="text-sm font-semibold text-shop-ink">{translate(label)}</div>
        <div className="text-xs text-shop-muted">
          {loading
            ? translate('Searching…')
            : source && !source.ok
              ? translate('Unavailable')
              : translate("{value0} hotel{value1}", { value0: translate(String(source?.count ?? 0)), value1: translate(String(source?.count === 1 ? '' : 's')) })}
        </div>
      </div>
      <div className="min-w-0 flex-1 overflow-x-auto bg-shop-bg p-3">
        {loading && (
          <div className="flex h-full items-center text-sm text-shop-muted">{translate("Loading hotels…")}</div>
        )}
        {!loading && source && !source.ok && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {source.error || 'Failed to load hotels'}
          </div>
        )}
        {!loading && source?.ok && !source.quotes.length && (
          <div className="flex h-full items-center text-sm text-shop-muted">
            {translate("No hotels found for these dates.")}</div>
        )}
        {!loading && Boolean(source?.quotes.length) && (
          <div className="flex gap-3">
            {source!.quotes.map((quote) => (
              <HotelMiniCard key={`${quote.provider}-${quote.id}`} quote={quote} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function HotelSourcesExpand({ lead }: { lead: Lead }) {
  useI18n()
  const processing = lead.quote_status === 'processing'
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hotelbeds, setHotelbeds] = useState<HotelSourceResult | undefined>()
  const [booking, setBooking] = useState<HotelSourceResult | undefined>()
  const [airbnb, setAirbnb] = useState<HotelSourceResult | undefined>()

  useEffect(() => {
    if (processing) return

    let cancelled = false

    void fetchHotelSources(lead)
      .then((data) => {
        if (cancelled) return
        setBooking(data.sources.booking)
        setAirbnb(data.sources.airbnb)
        setHotelbeds(data.sources.hotelbeds)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load hotels')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remounts per lead.id + quote_status
  }, [lead.id, processing])

  const showLoading = processing || loading

  return (
    <div className="border-t border-shop-border bg-shop-bg">
      {error && (
        <div className="border-b border-shop-border bg-red-50 px-4 py-2 text-sm text-red-700">
          {translate(error)}
        </div>
      )}
      <SourceRow label="Booking.com" source={booking} loading={showLoading} />
      <SourceRow label="Airbnb" source={airbnb} loading={showLoading} />
      <SourceRow label="Hotelbeds" source={hotelbeds} loading={showLoading} />
    </div>
  )
}
