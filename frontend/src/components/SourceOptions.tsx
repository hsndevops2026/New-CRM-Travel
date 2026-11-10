import { t as translate, useI18n } from '../lib/i18n'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchComparison, setDraftItems, type ComparisonItem, type QuoteDraft } from '../lib/quoteDrafts'
import { draftItemsAfterToggle, groupOptions, lowestPricedId, optionKey, selectionSummary } from '../lib/sourceOptions'
import type { Lead } from '../lib/leads'
import Button from './ui/Button'
import StatusBadge from './ui/StatusBadge'
import { HighlightBadge, SourceBadge } from './ui/SourceBadge'
import QuoteSourcesPanel from './QuoteSourcesPanel'

type Props = {
  lead: Lead
  draft: QuoteDraft | null
  onDraftChange: (draft: QuoteDraft) => void
  onCompare: () => void
  onRetry: () => void
  retrying: boolean
}

const money = (value: number | null, currency: string) =>
  value == null ? null : `${currency} ${Math.round(value).toLocaleString()}`

function Price({ item }: { item: ComparisonItem }) {
  useI18n()
  const price = money(item.net_cost, item.currency)
  return (
    <div className="shrink-0 text-end">
      <span className="block text-[11px] font-bold uppercase tracking-[0.06em] text-shop-muted">{translate("Net")}</span>
      <div className="font-extrabold tabular-nums">{price ?? <span className="text-xs font-medium text-shop-muted italic">{translate("No price")}</span>}</div>
    </div>
  )
}

function Highlights({ item, lowest }: { item: ComparisonItem; lowest: boolean }) {
  useI18n()
  return (
    <>
      {lowest && <HighlightBadge kind="lowest" />}
      {Boolean(item.meta?.is_best) && <HighlightBadge kind="best_value" />}
      {!item.meta?.is_best && Boolean(item.meta?.is_recommended) && <HighlightBadge kind="ai_pick" />}
    </>
  )
}

function Option({
  item,
  selected,
  lowest,
  disabled,
  onToggle,
}: {
  item: ComparisonItem
  selected: boolean
  lowest: boolean
  disabled: boolean
  onToggle: (item: ComparisonItem, on: boolean) => void
}) {
  useI18n()
  const provider = item.meta?.source ? String(item.meta.source) : null
  const board = item.meta?.board_name ? String(item.meta.board_name) : null
  const cancel = item.meta?.cancellation_policy ? String(item.meta.cancellation_policy) : null
  return (
    <li>
      <label
        className={`flex cursor-pointer items-start gap-3 border-b border-neutral-bg px-3.5 py-3 last:border-b-0 ${
          selected ? 'bg-tint' : 'hover:bg-slate-50'
        } ${disabled ? 'cursor-wait opacity-70' : ''}`}
      >
        <input
          type="checkbox"
          checked={selected}
          disabled={disabled}
          onChange={(event) => onToggle(item, event.target.checked)}
          aria-label={translate("Compare {value0}", { value0: translate(String(item.label)) })}
          className="mt-0.5 size-[18px] shrink-0 accent-shop-accent"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <strong className="text-sm">{translate(item.label)}</strong>
            <Highlights item={item} lowest={lowest} />
          </div>
          {item.description && <span className="text-[13px] text-shop-muted">{translate(item.description)}</span>}
          {(board || cancel || provider) && (
            <div className="flex flex-wrap gap-1.5">
              {board && <StatusBadge label={board} tone="neutral" />}
              {cancel && <StatusBadge label={cancel} tone="success" />}
              {provider && <StatusBadge label={provider === 'google_flights' ? translate("Google · SerpApi") : provider} tone="info" />}
            </div>
          )}
        </div>
        <Price item={item} />
      </label>
    </li>
  )
}

function OptionList({
  title,
  items,
  selected,
  busy,
  onToggle,
  limit = 3,
}: {
  title: string
  items: ComparisonItem[]
  selected: Set<string>
  busy: boolean
  onToggle: (item: ComparisonItem, on: boolean) => void
  limit?: number
}) {
  useI18n()
  const [all, setAll] = useState(false)
  const lowestId = useMemo(() => lowestPricedId(items), [items])
  // Anything already ticked stays visible even when the list is collapsed.
  const shown = all ? items : items.filter((item, index) => index < limit || selected.has(item.id))
  const hidden = items.length - shown.length
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="text-base font-bold">
        {translate(title)} <span className="font-medium text-shop-muted tabular-nums">· {items.length}</span>
      </h2>
      {items.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-line-strong bg-white px-4 py-6 text-center text-sm text-shop-muted">
          {translate("Nothing returned yet.")}</p>
      ) : (
        <ul className="overflow-hidden rounded-[10px] border border-shop-border bg-white">
          {shown.map((item) => (
            <Option
              key={item.id}
              item={item}
              selected={selected.has(item.id)}
              lowest={item.id === lowestId}
              disabled={busy}
              onToggle={onToggle}
            />
          ))}
          {(hidden > 0 || all) && items.length > limit && (
            <li className="border-t border-neutral-bg px-3.5 py-2">
              <button
                type="button"
                onClick={() => setAll((v) => !v)}
                className="h-[30px] text-[13px] font-semibold text-shop-accent hover:underline max-sm:h-11"
              >
                {all ? translate("Show fewer") : translate("Show {value0} more", { value0: translate(String(hidden)) })}
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

export default function SourceOptions({ lead, draft, onDraftChange, onCompare, onRetry, retrying }: Props) {
  useI18n()
  const [items, setItems] = useState<ComparisonItem[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchComparison(lead.id)
      .then(({ items: next }) => {
        if (cancelled) return
        setItems(next)
        setLoadError(null)
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load options')
      })
    return () => {
      cancelled = true
    }
  }, [lead.id, lead.quote_status, lead.quotes_fetched_at])

  const groups = useMemo(() => groupOptions(items ?? []), [items])
  const selected = useMemo(() => new Set((draft?.items ?? []).map((i) => optionKey(i))), [draft])

  const toggle = async (item: ComparisonItem, on: boolean) => {
    if (!draft) return
    setBusy(true)
    setSaveError(null)
    try {
      onDraftChange(await setDraftItems(lead.id, draftItemsAfterToggle(draft.items, item, on)))
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not update the quote')
    } finally {
      setBusy(false)
    }
  }

  const wantsFlights = lead.booking_type === 'flight' || lead.booking_type === 'package'
  const wantsHotels = lead.booking_type === 'hotel' || lead.booking_type === 'package'
  const count = draft?.items.length ?? 0

  return (
    <div className="flex flex-col gap-5">
      <QuoteSourcesPanel lead={lead} packageMatches={items ? groups.packages.length : null} hotelOptions={items ? groups.hotels.length : null} onRetry={onRetry} retrying={retrying} />

      {lead.quote_status === 'error' && lead.quote_error && (
        <p role="alert" className="rounded-lg border border-[#FCD34D] bg-warn-bg px-3.5 py-2.5 text-[13px] text-warn-fg">
          {lead.quote_error}
        </p>
      )}
      {loadError && (
        <p role="alert" className="rounded-lg border border-red-200 bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger-fg">
          {loadError}
        </p>
      )}
      {saveError && (
        <p role="alert" className="rounded-lg border border-red-200 bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger-fg">
          {saveError}
        </p>
      )}

      {items === null && !loadError ? (
        <p role="status" className="py-8 text-center text-sm text-shop-muted">
          {translate("Loading options…")}</p>
      ) : (
        items && (
          <>
            {groups.packages.length > 0 && (
              <section className="flex flex-col gap-2.5">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-base font-bold">{translate("Reusable package matches")}</h2>
                  <Link to="/quotes" className="text-[13px] font-semibold text-shop-accent hover:underline">
                    {translate("Open library")}</Link>
                </div>
                <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-3">
                  {groups.packages.map((item) => {
                    const on = selected.has(item.id)
                    return (
                      <li key={item.id}>
                        <label
                          className={`flex h-full cursor-pointer items-start gap-3 rounded-[10px] border bg-white p-3 ${
                            on ? 'border-shop-accent bg-tint' : 'border-shop-border'
                          }`}
                        >
                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <div className="flex flex-wrap gap-1.5">
                              <SourceBadge source="package" />
                              <Highlights item={item} lowest={false} />
                            </div>
                            <strong className="text-sm">{translate(item.label)}</strong>
                            {item.description && <span className="text-[13px] text-shop-muted">{translate(item.description)}</span>}
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-2">
                            <span className="font-extrabold tabular-nums">{money(item.net_cost, item.currency) ?? '—'}</span>
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={busy || !draft}
                              onChange={(event) => void toggle(item, event.target.checked)}
                              aria-label={translate("Compare {value0}", { value0: translate(String(item.label)) })}
                              className="size-[18px] accent-shop-accent"
                            />
                          </div>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}

            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(440px,100%),1fr))] items-start gap-5">
              {wantsFlights && (
                <OptionList title={translate("Flights")} items={groups.flights} selected={selected} busy={busy || !draft} onToggle={(i, on) => void toggle(i, on)} />
              )}
              {wantsHotels && (
                <OptionList title={translate("Hotels")} items={groups.hotels} selected={selected} busy={busy || !draft} onToggle={(i, on) => void toggle(i, on)} />
              )}
            </div>

            {groups.dealers.length > 0 && (
              <OptionList title={translate("Dealer offers")} items={groups.dealers} selected={selected} busy={busy || !draft} onToggle={(i, on) => void toggle(i, on)} />
            )}
          </>
        )
      )}

      {count > 0 && (
        <div
          role="status"
          className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-xl bg-shop-ink py-2.5 pe-2.5 ps-4 text-white shadow-[0_8px_24px_rgba(15,23,42,0.2)]"
        >
          <strong className="tabular-nums">
            {translate('{count} option{suffix} added to compare', { count, suffix: count === 1 ? '' : 's' })}
          </strong>
          <span className="text-slate-300 tabular-nums">{selectionSummary(draft?.items ?? [])}</span>
          <div className="flex-1" />
          <Button variant="primary" size="sm" onClick={onCompare} className="border-[#14B8A6] bg-[#14B8A6] text-[#042F2E] hover:bg-[#2DD4BF] hover:border-[#2DD4BF]">
            {translate("Compare &amp; price")}</Button>
        </div>
      )}
    </div>
  )
}
