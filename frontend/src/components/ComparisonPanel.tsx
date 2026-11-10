import { useCallback, useEffect, useMemo, useState } from 'react'
import { CircleAlert, Clock } from 'lucide-react'
import { fetchComparison, setDraftItems, type ComparisonItem, type QuoteDraft } from '../lib/quoteDrafts'
import { hasPackageConflict, plainOptionLabel } from '../lib/sourceOptions'
import Button from './ui/Button'
import FilterPills from './ui/FilterPills'
import StatusBadge from './ui/StatusBadge'
import { HighlightBadge, SourceBadge, type OptionSource } from './ui/SourceBadge'

type Props = {
  leadId: string
  draft: QuoteDraft | null
  onDraftChange: (draft: QuoteDraft) => void
}

const SOURCE_LABELS: Record<string, string> = {
  predefined: 'Package',
  flight_api: 'Flight API',
  hotel_api: 'Hotel API',
  dealer: 'Dealer',
}

const BADGE_SOURCE: Record<string, OptionSource> = {
  predefined: 'package',
  flight_api: 'flight_api',
  hotel_api: 'hotel_api',
  dealer: 'dealer',
}

const money = (value: number, currency: string) => `${currency} ${Math.round(value).toLocaleString()}`

function MetaDetail({ item }: { item: ComparisonItem }) {
  const m = item.meta
  const rows: [string, string][] = []

  if (item.source_type === 'predefined') {
    if (m.destination) rows.push(['Destination', String(m.destination)])
    const dates = [m.travel_date, m.return_date]
      .map((value) => (value ? String(value).slice(0, 10) : ''))
      .filter(Boolean)
    if (dates.length) rows.push(['Dates', dates.join(' → ')])
    if (m.nights) rows.push(['Nights', String(m.nights)])
    if (m.hotel_name) rows.push(['Hotel', String(m.hotel_name)])
  } else if (item.source_type === 'flight_api') {
    const ob = m.outbound as Record<string, unknown> | null
    if (ob?.departureTime) rows.push(['Departs', String(ob.departureTime)])
    if (ob?.arrivalTime) rows.push(['Arrives', String(ob.arrivalTime)])
    if (m.airline) rows.push(['Airline', String(m.airline)])
  } else if (item.source_type === 'hotel_api') {
    if (m.source) rows.push(['Source', String(m.source)])
    if (m.room_type) rows.push(['Room', String(m.room_type)])
    if (m.board_name) rows.push(['Board', String(m.board_name)])
    if (m.check_in) rows.push(['Check-in', String(m.check_in)])
    if (m.check_out) rows.push(['Check-out', String(m.check_out)])
    if (m.cancellation_policy) rows.push(['Cancel', String(m.cancellation_policy)])
  } else if (item.source_type === 'dealer') {
    if (m.dealer_name) rows.push(['Dealer', String(m.dealer_name)])
    if (m.request_code) rows.push(['Code', String(m.request_code)])
    if (m.confidence) rows.push(['AI confidence', String(m.confidence)])
    const ext = m.extracted as Record<string, unknown> | null
    if (ext?.cancellation_terms) rows.push(['Cancel', String(ext.cancellation_terms)])
    if (ext?.validity) rows.push(['Valid', String(ext.validity)])
  }

  if (!rows.length) return null
  const shown = rows.slice(0, 4)
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[13px] tabular-nums">
      {shown.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-shop-muted">{k}</dt>
          <dd className="truncate font-medium text-slate-700">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function ItemCard({
  item,
  selected,
  rank,
  onToggle,
}: {
  item: ComparisonItem
  selected: boolean
  rank: number | null
  onToggle: (id: string) => void
}) {
  const terms = item.source_type === 'dealer' && item.meta?.extracted
    ? (item.meta.extracted as Record<string, unknown>).cancellation_terms
    : item.meta?.cancellation_policy
  const why = item.meta?.is_recommended && !item.meta?.is_best ? item.meta?.ai_rank_reason : null
  const provider = (item.source_type === 'hotel_api' || item.source_type === 'flight_api') && item.meta?.source
    ? String(item.meta.source)
    : null
  const dealerName = item.source_type === 'dealer' && item.meta?.dealer_name ? String(item.meta.dealer_name) : null
  return (
    <label
      className={`flex cursor-pointer gap-3 rounded-[10px] p-3.5 transition-colors ${
        selected ? 'border-2 border-shop-accent bg-tint p-[13px]' : 'border border-shop-border bg-white hover:bg-slate-50'
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(item.id)}
        aria-label={`Include ${plainOptionLabel(item.label)}`}
        className="mt-0.5 size-[18px] shrink-0 accent-shop-accent"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap gap-1.5">
          <SourceBadge source={BADGE_SOURCE[item.source_type] ?? 'market'} />
          {dealerName && <StatusBadge label={dealerName} tone="dealer" />}
          {provider && <StatusBadge label={provider === 'google_flights' ? 'Google · SerpApi' : provider} tone="info" />}
          {rank === 1 && <HighlightBadge kind="lowest" rank={1} />}
          {Boolean(item.meta?.is_best) && <HighlightBadge kind="best_value" />}
          {!item.meta?.is_best && Boolean(item.meta?.is_recommended) && <HighlightBadge kind="ai_pick" />}
        </div>
        <strong className="text-[15px]">{plainOptionLabel(item.label)}</strong>
        {item.description && <span className="text-[13px] text-slate-700">{item.description}</span>}
        <MetaDetail item={item} />
        {terms ? (
          <span className="flex items-center gap-1.5 text-[13px] text-slate-700">
            <Clock className="size-3.5 shrink-0" aria-hidden="true" />
            {String(terms)}
          </span>
        ) : null}
        {why ? (
          <span className="rounded-lg bg-[#F5F3FF] px-2.5 py-2 text-[13px] text-dealer-fg">{String(why)}</span>
        ) : null}
      </div>
      <div className="shrink-0 text-right">
        <span className="block text-[11px] font-bold tracking-[0.06em] text-shop-muted uppercase">Net</span>
        {item.net_cost != null ? (
          <div className="text-base font-extrabold tabular-nums">{money(item.net_cost, item.currency)}</div>
        ) : (
          <span className="text-xs text-shop-muted italic">No price</span>
        )}
      </div>
    </label>
  )
}

function ItemList({
  items,
  selectedIds,
  priceRankedIds,
  onToggle,
}: {
  items: ComparisonItem[]
  selectedIds: Set<string>
  priceRankedIds: Map<string, number>
  onToggle: (id: string) => void
}) {
  if (!items.length) {
    return (
      <p className="rounded-[10px] border border-dashed border-line-strong py-6 text-center text-sm text-shop-muted">
        Nothing in this section yet.
      </p>
    )
  }
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <ItemCard
          key={item.id}
          item={item}
          selected={selectedIds.has(item.id)}
          rank={priceRankedIds.get(item.id) ?? null}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}

function ComparisonSections({
  items,
  showAllSections,
  selectedIds,
  priceRankedIds,
  onToggle,
}: {
  items: ComparisonItem[]
  showAllSections: boolean
  selectedIds: Set<string>
  priceRankedIds: Map<string, number>
  onToggle: (id: string) => void
}) {
  const [referenceOpen, setReferenceOpen] = useState(false)
  const dealers = items.filter((item) => item.source_type === 'dealer')
  const reference = items.filter((item) => item.source_type === 'hotel_api')
  const other = items.filter((item) => item.source_type !== 'dealer' && item.source_type !== 'hotel_api')

  if (!items.length) {
    return (
      <p className="rounded-[10px] border border-dashed border-line-strong py-10 text-center text-sm text-shop-muted">
        No options available yet. Send a dealer RFQ, or use API hotels as market reference.
      </p>
    )
  }

  if (!showAllSections) {
    return (
      <ItemList items={items} selectedIds={selectedIds} priceRankedIds={priceRankedIds} onToggle={onToggle} />
    )
  }

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 text-[11px] font-bold tracking-[0.06em] text-shop-muted uppercase">Dealer offers</h3>
        <ItemList items={dealers} selectedIds={selectedIds} priceRankedIds={priceRankedIds} onToggle={onToggle} />
      </section>
      {other.length > 0 && (
        <section>
          <h3 className="mb-2 text-[11px] font-bold tracking-[0.06em] text-shop-muted uppercase">Packages &amp; flights</h3>
          <ItemList items={other} selectedIds={selectedIds} priceRankedIds={priceRankedIds} onToggle={onToggle} />
        </section>
      )}
      {reference.length > 0 && (
        <section>
          <button
            type="button"
            aria-expanded={referenceOpen}
            onClick={() => setReferenceOpen((open) => !open)}
            className="mb-2 flex min-h-9 w-full items-center justify-between text-left max-sm:min-h-11"
          >
            <h3 className="text-[11px] font-bold tracking-[0.06em] text-shop-muted uppercase">
              Market reference (API hotels)
            </h3>
            <span className="text-[13px] font-semibold text-shop-accent">{referenceOpen ? 'Hide' : `Show ${reference.length}`}</span>
          </button>
          {referenceOpen && (
            <ItemList
              items={reference}
              selectedIds={selectedIds}
              priceRankedIds={priceRankedIds}
              onToggle={onToggle}
            />
          )}
        </section>
      )}
    </div>
  )
}

export default function ComparisonPanel({ leadId, draft, onDraftChange }: Props) {
  const [items, setItems] = useState<ComparisonItem[]>([])
  const [sourceErrors, setSourceErrors] = useState<{ source: string; error: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [loadedLeadId, setLoadedLeadId] = useState(leadId)
  if (leadId !== loadedLeadId) {
    setLoadedLeadId(leadId)
    setLoading(true)
    setError(null)
  }

  useEffect(() => {
    let cancelled = false
    fetchComparison(leadId)
      .then(({ items, source_errors }) => {
        if (cancelled) return
        setItems(items)
        setSourceErrors(source_errors)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leadId])

  const draftSelectedIds = useMemo(() => {
    const ids = new Set<string>()
    for (const item of draft?.items ?? []) {
      ids.add(`${item.source_type}:${item.source_id}`)
    }
    return ids
  }, [draft])

  const validItemIds = useMemo(() => new Set(items.map((item) => item.id)), [items])

  const [selectionOverrides, setSelectionOverrides] = useState<Record<string, boolean>>({})
  const [selectionDraftId, setSelectionDraftId] = useState(draft?.id)
  if (draft?.id !== selectionDraftId) {
    setSelectionDraftId(draft?.id)
    setSelectionOverrides({})
  }

  const selectedIds = useMemo(() => {
    const next = new Set<string>()
    for (const id of draftSelectedIds) {
      if (items.length === 0 || validItemIds.has(id)) next.add(id)
    }
    for (const [id, selected] of Object.entries(selectionOverrides)) {
      if (items.length > 0 && !validItemIds.has(id)) continue
      if (selected) next.add(id)
      else next.delete(id)
    }
    return next
  }, [draftSelectedIds, validItemIds, items.length, selectionOverrides])

  const filteredItems = useMemo(() => {
    if (filter === 'all') return items
    return items.filter((i) => i.source_type === filter)
  }, [items, filter])

  const toggleItem = useCallback((id: string) => {
    setSelectionOverrides((prev) => {
      const currentlySelected = selectedIds.has(id)
      return { ...prev, [id]: !currentlySelected }
    })
  }, [selectedIds])

  const applySelection = async () => {
    setSaving(true)
    setError(null)
    try {
      const selectedItems = items.filter((item) => selectedIds.has(item.id))
      if (selectedIds.size > 0 && selectedItems.length === 0) {
        setError('Previous selections expired after re-sourcing. Please select options again.')
        return
      }
      const updated = await setDraftItems(
        leadId,
        selectedItems.map(({ source_type, source_id, label, description, net_cost, currency, meta }) => ({
          source_type,
          source_id,
          label,
          description,
          net_cost,
          currency,
          meta,
          quantity: 1,
        })),
      )
      onDraftChange(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply selection')
    } finally {
      setSaving(false)
    }
  }

  const priceRankedIds = useMemo(() => {
    const withPrice = items.filter((i) => i.sort_price != null)
    return new Map(withPrice.map((item, idx) => [item.id, idx + 1]))
  }, [items])

  const sourceTypes = useMemo(() => {
    const types = [...new Set(items.map((i) => i.source_type))]
    return types
  }, [items])

  const selectedCount = selectedIds.size
  const dirty = useMemo(() => {
    const draftIds = new Set((draft?.items ?? []).map((i) => `${i.source_type}:${i.source_id}`))
    if (draftIds.size !== selectedIds.size) return true
    for (const id of selectedIds) if (!draftIds.has(id)) return true
    return false
  }, [selectedIds, draft])

  const selectedItems = items.filter((item) => selectedIds.has(item.id))
  const conflict = hasPackageConflict(selectedItems)
  const filterPills = [
    { id: 'all', label: 'All' },
    ...sourceTypes.map((t) => ({ id: t, label: SOURCE_LABELS[t] || t })),
  ]

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="cmp-h" className="text-base font-bold">
            Compare options <span className="font-medium text-shop-muted tabular-nums">· {items.length} eligible</span>
          </h2>
          <p className="text-xs text-shop-muted">
            Dealer offers first. API hotels are market reference — add one to the quote only if needed.
          </p>
        </div>
        <Button variant="primary" loading={saving} disabled={!dirty} onClick={() => void applySelection()}>
          {`Apply (${selectedCount} selected)`}
        </Button>
      </div>

      {sourceTypes.length > 1 && (
        <FilterPills ariaLabel="Filter by source" items={filterPills} value={filter} onChange={setFilter} />
      )}

      {conflict && (
        <div role="alert" className="flex gap-2.5 rounded-[10px] bg-warn-bg px-3.5 py-3 text-[#78350F]">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            A package already includes flights and hotel. Remove the separate items or the package to avoid double counting.
          </span>
        </div>
      )}

      {sourceErrors.length > 0 && (
        <div className="rounded-lg border border-[#FCD34D] bg-warn-bg px-3 py-2 text-xs text-warn-fg">
          Some sources had errors: {sourceErrors.map((e) => e.source).join(', ')}
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-danger-bg px-3 py-2 text-sm text-danger-fg">{error}</div>
      )}

      {loading && <p role="status" className="py-8 text-center text-sm text-shop-muted">Loading options…</p>}

      {!loading && (
        <ComparisonSections
          items={filteredItems}
          showAllSections={filter === 'all'}
          selectedIds={selectedIds}
          priceRankedIds={priceRankedIds}
          onToggle={toggleItem}
        />
      )}
    </div>
  )
}
