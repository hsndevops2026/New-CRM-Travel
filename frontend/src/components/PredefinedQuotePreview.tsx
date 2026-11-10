import { t as translate, useI18n } from '../lib/i18n'
import { useState } from 'react'
import { formatDate } from '../lib/leads'
import {
  availabilityLabel,
  displayTotal,
  downloadPredefinedQuotePdf,
  formatQuoteMoney,
  hotelLocationLabel,
  quoteTypeLabel,
  type PredefinedQuote,
} from '../lib/predefinedQuotes'
import Button from './ui/Button'
import ModalDrawer from './ui/ModalDrawer'

type Props = {
  open: boolean
  quote: PredefinedQuote | null
  onClose: () => void
  onEdit: () => void
}

export default function PredefinedQuotePreview({ open, quote, onClose, onEdit }: Props) {
  useI18n()
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hotels = quote?.items.filter((item) => item.item_type === 'hotel') || []
  const flights = quote?.items.filter((item) => item.item_type === 'flight') || []
  const total = quote ? displayTotal(quote) : 0

  const download = async () => {
    if (!quote) return
    setDownloading(true)
    setError(null)
    try {
      await downloadPredefinedQuotePdf(quote)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download quote')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <ModalDrawer
      open={open && Boolean(quote)}
      title={quote?.title || 'Quote'}
      subtitle={quote ? translate("{value0} quote", { value0: translate(String(quoteTypeLabel(quote.quote_type))) }) : undefined}
      onClose={onClose}
      maxWidthClassName="max-w-3xl"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" onClick={onEdit}>
            {translate("Edit")}</Button>
          <Button type="button" variant="primary" onClick={() => void download()} disabled={downloading}>
            {downloading ? translate('Downloading…') : translate("Download quote")}
          </Button>
        </div>
      }
    >
      {quote ? (
        <div className="space-y-5">
          {quote.cover_image_url && (
            <img
              src={quote.cover_image_url}
              alt=""
              className="h-44 w-full rounded-xl object-cover ring-1 ring-shop-border"
            />
          )}
          <div className="grid gap-2 text-sm text-shop-muted sm:grid-cols-2">
            <div>
              <div className="text-xs uppercase tracking-wide">{translate("Trip")}</div>
              <div className="font-medium text-shop-ink">
                {quote.origin && quote.destination
                  ? `${quote.origin} → ${quote.destination}`
                  : quote.destination || '—'}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide">{translate("Dates")}</div>
              <div className="font-medium text-shop-ink">
                {availabilityLabel(quote) || '—'}
                {quote.nights ? ` · ${quote.nights}n` : ''}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide">{translate("Guests")}</div>
              <div className="font-medium text-shop-ink">
                {quote.adults_count}A · {quote.children_count}C
              </div>
            </div>
          </div>
          {quote.description && <p className="text-sm">{quote.description}</p>}

          {hotels.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">{translate("Hotels")}</h3>
              {hotels.map((item) => (
                <article key={item.id || item.hotel_name} className="rounded-xl border border-shop-border p-4">
                  <div className="flex gap-3">
                    {item.image_url && (
                      <img src={item.image_url} alt="" className="size-16 rounded-lg object-cover" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-semibold">{item.hotel_name || item.title}</div>
                        <div className="shrink-0 font-bold">
                          {formatQuoteMoney(item.price, item.currency || quote.currency)}
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-shop-muted">
                        {[hotelLocationLabel(item), item.category, item.room_name, item.board_name]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      {(item.check_in || item.check_out) && (
                        <p className="text-xs text-shop-muted">
                          {item.check_in ? formatDate(item.check_in) : '—'}
                          {item.check_out ? ` → ${formatDate(item.check_out)}` : ''}
                          {item.nights ? ` · ${item.nights}n` : ''}
                        </p>
                      )}
                      {item.description && <p className="mt-2 text-sm">{item.description}</p>}
                      {Array.isArray(item.extra?.gallery_urls) && item.extra.gallery_urls.length > 1 && (
                        <div className="mt-2 flex gap-1.5 overflow-x-auto">
                          {item.extra.gallery_urls.slice(0, 8).map((url) => (
                            <img
                              key={url}
                              src={url}
                              alt=""
                              className="size-12 shrink-0 rounded-md object-cover ring-1 ring-shop-border"
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </section>
          )}

          {flights.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">{translate("Flights")}</h3>
              {flights.map((item) => (
                <article key={item.id || `${item.airline}-${item.flight_number}`} className="rounded-xl border border-shop-border p-4">
                  <div className="flex gap-3">
                    {item.image_url && (
                      <img src={item.image_url} alt="" className="size-16 rounded-lg object-cover" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-semibold">
                          {[item.airline, item.flight_number].filter(Boolean).join(' ') || item.title}
                        </div>
                        <div className="shrink-0 font-bold">
                          {formatQuoteMoney(item.price, item.currency || quote.currency)}
                        </div>
                      </div>
                      <p className="mt-1 text-sm">
                        {[item.departure_airport || item.departure_city, item.arrival_airport || item.arrival_city]
                          .filter(Boolean)
                          .join(' → ')}
                      </p>
                      <p className="text-xs capitalize text-shop-muted">
                        {[
                          item.direction === 'return' ? translate("Return") : item.direction === 'outbound' ? translate("Outbound") : item.direction,
                          item.departure_time,
                          item.arrival_time,
                          item.duration,
                          item.stops == null
                            ? null
                            : item.stops === 0
                              ? translate('Non-stop')
                              : translate("{value0} stop{value1}", { value0: translate(String(item.stops)), value1: translate(String(item.stops === 1 ? '' : 's')) }),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      {item.description && <p className="mt-2 text-sm">{item.description}</p>}
                    </div>
                  </div>
                </article>
              ))}
            </section>
          )}

          <div className="flex items-center justify-between border-t border-shop-border pt-4">
            <span className="text-sm text-shop-muted">{translate("Total")}</span>
            <span className="text-xl font-bold">{formatQuoteMoney(total, quote.currency)}</span>
          </div>
          {quote.notes && (
            <p className="text-sm text-shop-muted">
              <span className="font-medium text-shop-ink">{translate("Notes:")}{' '}</span>
              {quote.notes}
            </p>
          )}
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{translate(error)}</div>}
        </div>
      ) : null}
    </ModalDrawer>
  )
}
