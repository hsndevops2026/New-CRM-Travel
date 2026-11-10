import { t as translate, useI18n } from '../lib/i18n'
import { useEffect, useMemo, useState } from 'react'
import {
  fetchHotelQuotes,
  formatDate,
  formatMoney,
  leadTitle,
  type HotelQuote,
  type HotelQuoteDetail,
  type Lead,
} from '../lib/leads'
import { EMPTY_QUOTE_FILTERS, filterHotelQuotes } from '../lib/quoteFilters'
import QuoteFiltersBar from './QuoteFiltersBar'

type Props = {
  open: boolean
  lead: Lead | null
  onClose: () => void
}

function groupDetailsByRoom(details: HotelQuoteDetail[]) {
  const groups = new Map<string, { room_code: string | null; room_name: string | null; rates: HotelQuoteDetail[] }>()
  for (const detail of details) {
    const key = `${detail.room_code || ''}::${detail.room_name || 'Room'}`
    const existing = groups.get(key)
    if (existing) {
      existing.rates.push(detail)
    } else {
      groups.set(key, {
        room_code: detail.room_code,
        room_name: detail.room_name,
        rates: [detail],
      })
    }
  }
  return [...groups.values()]
}

function RateRow({ rate }: { rate: HotelQuoteDetail }) {
  useI18n()
  return (
    <div className="rounded-lg border border-shop-border bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {rate.board_name && (
              <span className="rounded-md bg-shop-bg px-2 py-0.5 text-shop-muted">
                {rate.board_name}
                {rate.board_code ? ` (${rate.board_code})` : ''}
              </span>
            )}
            {rate.rate_class && (
              <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                {rate.rate_class}
              </span>
            )}
            {rate.rate_type && (
              <span className="rounded-md bg-green-50 px-2 py-0.5 font-medium text-green-700">
                {rate.rate_type}
              </span>
            )}
            {rate.free_cancellation ? (
              <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                {translate("Free cancellation")}</span>
            ) : rate.cancellation_summary ? (
              <span className="rounded-md bg-amber-50 px-2 py-0.5 font-medium text-amber-800">
                {rate.cancellation_summary}
              </span>
            ) : null}
          </div>
          <div className="text-xs text-shop-muted">
            {[
              rate.payment_type ? translate("Pay: {value0}", { value0: translate(String(rate.payment_type)) }) : null,
              rate.allotment != null ? translate("Allotment: {value0}", { value0: translate(String(rate.allotment)) }) : null,
              rate.packaging ? translate('Packaging') : null,
              rate.adults != null || rate.children != null
                ? `${rate.adults ?? '—'}A · ${rate.children ?? '—'}C`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
          {rate.promotions && rate.promotions.length > 0 && (
            <div className="text-xs text-violet-700">
              {rate.promotions
                .map((p) => [p.name || p.code, p.amount != null ? formatMoney(p.amount, rate.currency) : null]
                  .filter(Boolean)
                  .join(' '))
                .join(' · ')}
            </div>
          )}
          {Array.isArray(rate.cancellation_policies) && rate.cancellation_policies.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-shop-muted">
              {rate.cancellation_policies.map((policy, index) => (
                <li key={`${policy.from || 'p'}-${index}`}>
                  {translate("From")}{' '}{policy.from ? String(policy.from).slice(0, 16).replace('T', ' ') : '—'}
                  {policy.amount != null ? translate(" · fee {value0}", { value0: translate(String(policy.amount)) }) : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="shrink-0 text-end">
          <div className="text-base font-bold tracking-tight">
            <bdi dir="ltr">{formatMoney(rate.price, rate.currency)}</bdi>
          </div>
          {rate.selling_rate != null && rate.net != null && rate.selling_rate !== rate.net && (
            <div className="text-xs text-shop-muted">
              {translate("sell")}{' '}<bdi dir="ltr">{formatMoney(rate.selling_rate, rate.currency)}</bdi>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function HotelCustomCard({ quote }: { quote: HotelQuote }) {
  useI18n()
  const [open, setOpen] = useState(true)
  const rooms = useMemo(() => groupDetailsByRoom(quote.details ?? []), [quote.details])
  const detailCount = quote.details?.length ?? 0

  return (
    <article className="rounded-xl border border-shop-border bg-shop-bg/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-3 p-4 text-start"
      >
        <div className="min-w-0">
          <div className="font-semibold">{quote.hotel_name || 'Hotel'}</div>
          <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-shop-muted">
            {quote.category && <span>{quote.category}</span>}
            {quote.destination_name && <span>{quote.destination_name}</span>}
            {quote.zone_name && <span>{quote.zone_name}</span>}
            <span>
              {translate("{count} rate{suffix}", { count: detailCount, suffix: detailCount === 1 ? '' : 's' })} · {translate("{count} room{suffix}", { count: rooms.length, suffix: rooms.length === 1 ? '' : 's' })}
            </span>
          </div>
        </div>
        <div className="shrink-0 text-end">
          <div className="text-sm font-bold"><bdi dir="ltr">{formatMoney(quote.price, quote.currency)}</bdi></div>
          <div className="text-xs text-shop-muted">{open ? translate('Hide') : translate('Show')}</div>
        </div>
      </button>

      {open && (
        <div className="space-y-3 border-t border-shop-border px-4 py-3">
          {rooms.length === 0 && (
            <p className="text-sm text-shop-muted">
              {translate("No room/rate details stored for this hotel. Retry quote fetch to refresh raw data.")}</p>
          )}
          {rooms.map((room) => (
            <div key={`${room.room_code}-${room.room_name}`} className="space-y-2">
              <div className="text-sm font-semibold">
                {room.room_name || 'Room'}
                {room.room_code ? (
                  <span className="ms-2 text-xs font-normal text-shop-muted">{room.room_code}</span>
                ) : null}
              </div>
              {room.rates.map((rate, index) => (
                <RateRow key={`${rate.rate_key || index}`} rate={rate} />
              ))}
            </div>
          ))}
        </div>
      )}
    </article>
  )
}

export default function CustomQuotesModal({ open, lead, onClose }: Props) {
  useI18n()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quotes, setQuotes] = useState<HotelQuote[]>([])
  const [meta, setMeta] = useState<{ destName?: string; search?: Record<string, unknown> | null }>(
    {},
  )
  const filterSession = open ? lead?.id ?? null : null
  const [filtersSession, setFiltersSession] = useState(filterSession)
  const [filters, setFilters] = useState(EMPTY_QUOTE_FILTERS)
  if (filterSession !== filtersSession) {
    setFiltersSession(filterSession)
    setFilters(EMPTY_QUOTE_FILTERS)
  }

  const leadId = lead?.id
  const hotelbedsQuotes = useMemo(
    () => quotes.filter((quote) => (quote.provider || 'hotelbeds') === 'hotelbeds'),
    [quotes],
  )
  const filteredQuotes = useMemo(
    () => filterHotelQuotes(hotelbedsQuotes, filters),
    [hotelbedsQuotes, filters],
  )

  useEffect(() => {
    if (!open || !lead || !leadId) return
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await fetchHotelQuotes(lead)
        if (cancelled) return
        setQuotes(data.quotes || [])
        setMeta({
          destName: data.destination?.name || lead.destination || undefined,
          search: data.search,
        })
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load custom quotes')
          setQuotes([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [open, lead, leadId])

  if (!open || !lead) return null

  const search = meta.search || {}
  const subtitle = [
    meta.destName || lead.destination,
    lead.travel_date ? formatDate(lead.travel_date) : null,
    lead.return_date ? `→ ${formatDate(lead.return_date)}` : null,
    typeof search.adults === 'number' ? `${search.adults}A` : null,
    typeof search.children === 'number' && search.children > 0 ? `${search.children}C` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92dvh] w-full max-w-3xl flex-col rounded-t-2xl border border-shop-border bg-white shadow-xl sm:rounded-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-shop-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{translate("Custom quotes")}</h2>
            <p className="truncate text-sm text-shop-muted">{leadTitle(lead)}</p>
            {subtitle && <p className="mt-0.5 text-xs text-shop-muted">{translate(subtitle)}</p>}
            <p className="mt-1 text-xs text-shop-muted">
              {translate("All Hotelbeds rooms &amp; rates (views appear in room name; cancel rules from policies).")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-shop-border px-2.5 py-1.5 text-xs font-semibold hover:bg-shop-bg"
          >
            {translate("Close")}</button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-5">
          {loading && <div className="py-12 text-center text-sm text-shop-muted">{translate("Loading…")}</div>}
          {!loading && error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {translate(error)}
            </div>
          )}
          {!loading && !error && hotelbedsQuotes.length === 0 && (
            <div className="py-12 text-center text-sm text-shop-muted">
              {translate("No hotel quotes yet. Fetch quotes first.")}</div>
          )}
          {!loading && hotelbedsQuotes.length > 0 && (
            <QuoteFiltersBar
              filters={filters}
              onChange={setFilters}
              resultCount={filteredQuotes.length}
              totalCount={hotelbedsQuotes.length}
            />
          )}
          {!loading && hotelbedsQuotes.length > 0 && filteredQuotes.length === 0 && (
            <div className="py-8 text-center text-sm text-shop-muted">
              {translate("No hotels match these filters.")}</div>
          )}
          {!loading &&
            filteredQuotes.map((quote) => <HotelCustomCard key={quote.id} quote={quote} />)}
        </div>
      </div>
    </div>
  )
}
