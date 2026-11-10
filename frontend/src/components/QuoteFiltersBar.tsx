import { t as translate, useI18n } from '../lib/i18n'
import {
  EMPTY_QUOTE_FILTERS,
  quoteFiltersActive,
  type QuoteFilters,
} from '../lib/quoteFilters'

type Props = {
  filters: QuoteFilters
  onChange: (next: QuoteFilters) => void
  resultCount: number
  totalCount: number
}

const STAR_OPTIONS = [1, 2, 3, 4, 5]

export default function QuoteFiltersBar({ filters, onChange, resultCount, totalCount }: Props) {
  useI18n()
  const toggleStar = (star: number) => {
    const stars = filters.stars.includes(star)
      ? filters.stars.filter((value) => value !== star)
      : [...filters.stars, star].sort()
    onChange({ ...filters, stars })
  }

  return (
    <div className="space-y-2 rounded-xl border border-shop-border bg-shop-bg/50 p-3">
      <div className="flex flex-wrap gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <span className="pe-1 text-xs font-semibold text-shop-muted">{translate("Stars")}</span>
          {STAR_OPTIONS.map((star) => {
            const active = filters.stars.includes(star)
            return (
              <button
                key={star}
                type="button"
                onClick={() => toggleStar(star)}
                className={`rounded-md px-2 py-1 text-xs font-semibold ${
                  active ? 'bg-shop-ink text-white' : 'border border-shop-border bg-white text-shop-ink'
                }`}
              >
                {star}★
              </button>
            )
          })}
        </div>

        <label className="flex items-center gap-1 text-xs">
          <span className="font-semibold text-shop-muted">{translate("Cancel")}</span>
          <select
            className="rounded-md border border-shop-border bg-white px-2 py-1"
            value={filters.freeCancellation}
            onChange={(e) =>
              onChange({ ...filters, freeCancellation: e.target.value as QuoteFilters['freeCancellation'] })
            }
          >
            <option value="any">{translate("Any")}</option>
            <option value="yes">{translate("Free cancellation")}</option>
            <option value="no">{translate("Paid / none")}</option>
          </select>
        </label>

        <label className="flex items-center gap-1 text-xs">
          <span className="font-semibold text-shop-muted">{translate("Refund")}</span>
          <select
            className="rounded-md border border-shop-border bg-white px-2 py-1"
            value={filters.refundable}
            onChange={(e) =>
              onChange({ ...filters, refundable: e.target.value as QuoteFilters['refundable'] })
            }
          >
            <option value="any">{translate("Any")}</option>
            <option value="yes">{translate("Refundable")}</option>
            <option value="no">{translate("Non-refundable")}</option>
          </select>
        </label>

        <label className="flex items-center gap-1 text-xs">
          <span className="font-semibold text-shop-muted">{translate("Room")}</span>
          <select
            className="rounded-md border border-shop-border bg-white px-2 py-1"
            value={filters.roomType}
            onChange={(e) =>
              onChange({ ...filters, roomType: e.target.value as QuoteFilters['roomType'] })
            }
          >
            <option value="any">{translate("Any")}</option>
            <option value="single">{translate("Single")}</option>
            <option value="double">{translate("Double")}</option>
          </select>
        </label>
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-shop-muted">
        <span>
          {translate("Showing")}{' '}{resultCount}{' '}{translate("of")}{' '}{totalCount}
        </span>
        {quoteFiltersActive(filters) && (
          <button
            type="button"
            onClick={() => onChange(EMPTY_QUOTE_FILTERS)}
            className="font-semibold text-shop-ink underline-offset-2 hover:underline"
          >
            {translate("Clear filters")}</button>
        )}
      </div>
    </div>
  )
}
