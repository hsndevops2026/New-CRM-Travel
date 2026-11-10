import { useEffect, useState, type ReactNode } from 'react'
import { Check, ChevronDown, LoaderCircle, RefreshCw } from 'lucide-react'
import Button from './ui/Button'
import StatusBadge from './ui/StatusBadge'
import {
  fetchFlightQuotes,
  fetchHotelSources,
  type Lead,
} from '../lib/leads'
import { fetchDealerResponses } from '../lib/dealers'

/**
 * Every channel a lead's quotes can come from, with live status.
 *
 * Sourcing fans out across several providers and any of them can fail on its
 * own (rate limit, no availability, missing key). The lead only surfaced a
 * single "quote status", which hid which provider actually returned something
 * — this shows the whole matrix so an agent knows what they are comparing.
 */

type SourceState = {
  count: number | null
  error: string | null
  detail: string | null
}

type Row = {
  id: string
  label: string
  via: string
  provides: string
  applies: boolean
  state: SourceState
}

const idle: SourceState = { count: null, error: null, detail: null }

function FLIGHT_PROVIDER_LABEL(provider?: string) {
  if (provider === 'google_flights') return 'Google Flights · SerpApi'
  if (provider === 'booking.com') return 'Booking.com · RapidAPI'
  return 'Booking.com · RapidAPI (Google Flights fallback)'
}

function SourceRow({ row }: { row: Row }) {
  const { state } = row

  const badge = !row.applies ? (
    <StatusBadge label="not used" tone="neutral" />
  ) : state.error ? (
    <StatusBadge label="failed" tone="danger" />
  ) : state.count == null ? (
    <StatusBadge label="…" tone="neutral" />
  ) : state.count > 0 ? (
    <StatusBadge label={`${state.count}`} tone="success" />
  ) : (
    <StatusBadge label="0" tone="warning" />
  )

  return (
    <li
      className={`flex items-start gap-3 border-b border-shop-border px-3 py-2.5 last:border-b-0 ${
        row.applies ? '' : 'opacity-55'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-shop-ink">{row.label}</span>
          <span className="shrink-0 rounded bg-shop-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-shop-muted">
            {row.provides}
          </span>
        </div>
        <div className="truncate text-xs text-shop-muted">{row.via}</div>
        {state.error && (
          <div className="mt-1 text-xs text-red-700">{state.error}</div>
        )}
        {!state.error && state.detail && (
          <div className="mt-1 text-xs text-shop-muted">{state.detail}</div>
        )}
      </div>
      <div className="shrink-0 pt-0.5">{badge}</div>
    </li>
  )
}

type Props = {
  lead: Lead
  /** Reusable packages that matched, from the comparison (null while it loads). */
  packageMatches?: number | null
  /** Hotels the comparison holds — the only hotel count a package lead has (null while it loads). */
  hotelOptions?: number | null
  onRetry?: () => void
  retrying?: boolean
}

export default function QuoteSourcesPanel({ lead, packageMatches = null, hotelOptions = null, onRetry, retrying }: Props) {
  const wantsFlights = lead.booking_type === 'flight' || lead.booking_type === 'package'
  const wantsHotels = lead.booking_type === 'hotel' || lead.booking_type === 'package'
  // The per-provider hotel breakdown endpoint only answers for hotel leads; a package
  // lead's hotels are summarised from the comparison instead.
  const hasHotelBreakdown = lead.booking_type === 'hotel'
  const processing = lead.quote_status === 'processing'

  const [flights, setFlights] = useState<SourceState>(idle)
  const [hotelbeds, setHotelbeds] = useState<SourceState>(idle)
  const [booking, setBooking] = useState<SourceState>(idle)
  const [airbnb, setAirbnb] = useState<SourceState>(idle)
  const [dealers, setDealers] = useState<SourceState>(idle)

  useEffect(() => {
    if (processing) return
    let cancelled = false

    if (wantsFlights) {
      void fetchFlightQuotes(lead)
        .then((data) => {
          if (cancelled) return
          const route =
            data.from && data.to ? `${data.from.code || data.from.id} → ${data.to.code || data.to.id}` : null
          setFlights({ count: data.count, error: data.quote_error || null, detail: route })
        })
        .catch((err) => {
          if (!cancelled) setFlights({ count: null, error: String(err.message || err), detail: null })
        })
    }

    if (hasHotelBreakdown) {
      void fetchHotelSources(lead)
        .then((data) => {
          if (cancelled) return
          const toState = (s: { count: number; error: string | null }): SourceState => ({
            count: s.count,
            error: s.error,
            detail: null,
          })
          setHotelbeds(toState(data.sources.hotelbeds))
          setBooking(toState(data.sources.booking))
          setAirbnb(toState(data.sources.airbnb))
        })
        .catch((err) => {
          if (cancelled) return
          const failed = { count: null, error: String(err.message || err), detail: null }
          setHotelbeds(failed)
          setBooking(failed)
          setAirbnb(failed)
        })
    }

    void fetchDealerResponses({ leadId: lead.id })
      .then((rows) => {
        if (!cancelled) {
          setDealers({
            count: rows.length,
            error: null,
            detail: rows.length ? `${rows.filter((r) => r.review_status === 'pending').length} pending review` : null,
          })
        }
      })
      .catch(() => {
        if (!cancelled) setDealers({ count: 0, error: null, detail: null })
      })

    return () => {
      cancelled = true
    }
  }, [lead, wantsFlights, hasHotelBreakdown, processing])

  const rows: Row[] = [
    {
      id: 'flights',
      label: 'Flights',
      via: FLIGHT_PROVIDER_LABEL(lead.quote_search?.flight_provider),
      provides: 'flights',
      applies: wantsFlights,
      state: processing ? idle : flights,
    },
    {
      id: 'hotelbeds',
      label: 'Hotelbeds',
      via: 'Hotelbeds API · direct contract rates',
      provides: 'hotels',
      applies: hasHotelBreakdown,
      state: processing ? idle : hotelbeds,
    },
    {
      id: 'booking',
      label: 'Booking.com',
      via: 'RapidAPI · booking-com15',
      provides: 'hotels',
      applies: hasHotelBreakdown,
      state: processing ? idle : booking,
    },
    {
      id: 'airbnb',
      label: 'Airbnb',
      via: 'RapidAPI · airbnb19',
      provides: 'hotels',
      applies: hasHotelBreakdown,
      state: processing ? idle : airbnb,
    },
    {
      id: 'hotel-quotes',
      label: 'Hotels',
      via: 'Hotel quote search · Booking.com · Hotelbeds',
      provides: 'hotels',
      applies: lead.booking_type === 'package',
      state: processing || hotelOptions == null ? idle : { count: hotelOptions, error: null, detail: null },
    },
    {
      id: 'predefined',
      label: 'Predefined package',
      via: lead.predefined_quote_title || 'Curated packages matched on destination',
      provides: 'packages',
      applies: true,
      state: {
        count: lead.predefined_quote_id ? 1 : 0,
        error: null,
        detail: lead.predefined_quote_id ? 'attached to this lead' : null,
      },
    },
    {
      id: 'dealers',
      label: 'Dealers',
      via: 'WhatsApp RFQ · AI-extracted offers',
      provides: 'manual',
      applies: true,
      state: dealers,
    },
  ]

  const hotelParts = [hotelbeds, booking, airbnb]
  const hotelCount = hotelParts.reduce((sum, p) => sum + (p.count || 0), 0)
  const hotelFailures = hotelParts.filter((p) => p.error).length
  const hotelLoaded = hotelParts.every((p) => p.count != null || p.error)

  const flightCard: CardState = processing
    ? { badge: <StatusBadge label="Searching" tone="info" icon={<LoaderCircle className="motion-safe:animate-spin" />} />, detail: 'Fetching options…' }
    : flights.error
      ? { badge: <StatusBadge label="Failed" tone="danger" />, detail: flights.error, problem: true }
      : flights.count == null
        ? { badge: <StatusBadge label="…" tone="neutral" />, detail: 'Checking…' }
        : flights.count > 0
          ? { badge: <StatusBadge label="Done" tone="success" icon={<Check />} />, detail: [`${flights.count} results`, flights.detail].filter(Boolean).join(' · ') }
          : { badge: <StatusBadge label="No results" tone="warning" />, detail: flights.detail || 'Nothing for these dates', problem: true }

  const hotelCard: CardState = processing
    ? { badge: <StatusBadge label="Searching" tone="info" icon={<LoaderCircle className="motion-safe:animate-spin" />} />, detail: 'Fetching options…' }
    : !hasHotelBreakdown
      ? hotelOptions == null
        ? { badge: <StatusBadge label="…" tone="neutral" />, detail: 'Checking…' }
        : hotelOptions > 0
          ? { badge: <StatusBadge label="Done" tone="success" icon={<Check />} />, detail: `${hotelOptions} results` }
          : { badge: <StatusBadge label="No results" tone="warning" />, detail: 'Nothing for these dates', problem: true }
    : !hotelLoaded
      ? { badge: <StatusBadge label="…" tone="neutral" />, detail: 'Checking…' }
      : hotelFailures === 0
        ? hotelCount > 0
          ? { badge: <StatusBadge label="Done" tone="success" icon={<Check />} />, detail: `${hotelCount} results` }
          : { badge: <StatusBadge label="No results" tone="warning" />, detail: 'Nothing for these dates', problem: true }
        : hotelCount > 0
          ? { badge: <StatusBadge label="Partial" tone="warning" />, detail: `${hotelCount} results · ${hotelFailures} provider${hotelFailures === 1 ? '' : 's'} failed`, problem: true }
          : { badge: <StatusBadge label="Failed" tone="danger" />, detail: 'Every hotel provider failed', problem: true }

  const packageCard: CardState =
    packageMatches == null
      ? { badge: <StatusBadge label="…" tone="neutral" />, detail: 'From Quotes library' }
      : { badge: <StatusBadge label={`${packageMatches} match${packageMatches === 1 ? '' : 'es'}`} tone={packageMatches ? 'success' : 'neutral'} />, detail: 'From Quotes library' }

  return (
    <section aria-label="Source status" className="space-y-3">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-3">
        {wantsFlights && <StatusCard title="Flight API" state={flightCard} />}
        {wantsHotels && <StatusCard title="Hotel API" state={hotelCard} />}
        <StatusCard title="Reusable packages" state={packageCard} />
        {onRetry && (
          <div className="flex items-center justify-end">
            <Button icon={<RefreshCw />} loading={retrying} onClick={onRetry}>
              Retry sourcing
            </Button>
          </div>
        )}
      </div>

      <details className="group rounded-[10px] border border-shop-border bg-white">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-2.5 text-[13px] font-semibold text-slate-700 [&::-webkit-details-marker]:hidden">
          <span>
            All sources checked <span className="font-normal text-shop-muted">· {rows.filter((r) => r.applies).length}</span>
          </span>
          <ChevronDown className="size-4 text-shop-muted transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="border-t border-shop-border">
          <p className="px-3.5 py-2 text-xs text-shop-muted">
            {processing
              ? 'Sourcing in progress…'
              : 'Every channel checked for this lead. A failed source does not block the others.'}
          </p>
          <ul>
            {rows.map((row) => (
              <SourceRow key={row.id} row={row} />
            ))}
          </ul>
        </div>
      </details>
    </section>
  )
}

type CardState = { badge: ReactNode; detail: string; problem?: boolean }

function StatusCard({ title, state }: { title: string; state: CardState }) {
  return (
    <div className={`flex flex-col gap-1 rounded-[10px] border bg-white px-3.5 py-3 ${state.problem ? 'border-[#FCD34D]' : 'border-shop-border'}`}>
      <div className="flex items-center justify-between gap-2">
        <strong className="text-sm">{title}</strong>
        {state.badge}
      </div>
      <span className={`text-[13px] tabular-nums ${state.problem ? 'text-warn-fg' : 'text-shop-muted'}`}>{state.detail}</span>
    </div>
  )
}
