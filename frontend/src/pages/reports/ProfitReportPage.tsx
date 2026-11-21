import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CircleAlert } from 'lucide-react'
import EmptyState from '../../components/ui/EmptyState'
import { TableSkeleton } from '../../components/ui/Skeleton'
import { fetchProfitReport, money, type ProfitReport } from '../../lib/business'
import { downloadCsv, toCsv } from '../../lib/reports'
import { t as translate, useI18n } from '../../lib/i18n'
import { useReportRange } from './ReportRangeContext'
import { CsvButton, ReportCard } from './reportUi'
import { stampDay } from './reportFormat'

const th = 'whitespace-nowrap px-3 py-2.5 text-start text-[11px] font-semibold tracking-[0.06em] text-slate-500 uppercase'
const td = 'px-3 py-3 tabular-nums'

export default function ProfitReportPage() {
  useI18n()
  const { range } = useReportRange()
  const [profit, setProfit] = useState<ProfitReport | null>(null)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rangeKey = range ? `${range.from}:${range.to}` : null
  const ready = Boolean(rangeKey && loadedKey === rangeKey && profit)

  useEffect(() => {
    if (!range || !rangeKey) return
    let cancelled = false
    fetchProfitReport(range)
      .then((p) => {
        if (cancelled) return
        setProfit(p)
        setLoadedKey(rangeKey)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load profit report')
      })
    return () => { cancelled = true }
  }, [range, rangeKey])

  if (!range) return null

  if (error) {
    return (
      <EmptyState
        tone="danger"
        icon={<CircleAlert />}
        title={translate('Reports could not be loaded')}
        description={translate(error)}
      />
    )
  }

  if (!ready || !profit) {
    return (
      <div className="overflow-hidden rounded-xl border border-shop-border bg-white">
        <TableSkeleton rows={5} label={translate('Loading…')} />
      </div>
    )
  }

  if (!profit) return null

  const exportProfit = () => {
    downloadCsv(`profit-${stampDay()}.csv`, toCsv(
      ['Customer', 'Destination', 'Travel date', 'Employee', 'Price', 'Cost', 'Cost from', 'Profit', 'Margin %', 'Currency'],
      profit.bookings.map((b) => [b.customer, b.destination, b.travel_date, b.employee, b.price, b.cost, b.cost_source, b.profit, b.margin_pct, b.currency]),
    ))
  }

  return (
    <ReportCard
      title={translate('Profit per booking')}
      actions={profit.bookings.length ? <CsvButton onClick={exportProfit} /> : null}
    >
      {profit.totals.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {profit.totals.map((t) => (
            <div key={t.currency} className="rounded-[10px] border border-shop-border bg-[#f8fafb] px-3 py-2.5">
              <strong className="text-base font-extrabold tabular-nums text-shop-ink" dir="ltr">
                {money(t.profit, t.currency)}
              </strong>
              <span className="mt-0.5 block text-xs text-shop-muted">
                {translate('profit on {value0} sales ({value1} bookings)', {
                  value0: money(t.sales, t.currency),
                  value1: t.bookings,
                })}
              </span>
            </div>
          ))}
        </div>
      )}
      {profit.bookings.length === 0 ? (
        <p className="py-6 text-center text-sm text-shop-muted">{translate('No accepted bookings in this period.')}</p>
      ) : (
        <div className="-mx-4 overflow-x-auto sm:mx-0 sm:rounded-lg sm:border sm:border-shop-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-shop-border bg-[#f8fafc]">
                {['Customer', 'Employee', 'Price', 'Cost', 'Profit'].map((h) => (
                  <th key={h} className={th}>{translate(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {profit.bookings.map((b) => (
                <tr key={b.id} className="border-b border-[#eef1f5] transition-colors last:border-0 hover:bg-[#f7fafb]">
                  <td className="px-3 py-3">
                    <Link to={`/leads/${b.id}`} className="font-semibold text-shop-ink hover:text-shop-accent hover:underline">
                      {b.customer || b.destination || translate('Booking')}
                    </Link>
                    <span className="block text-xs text-shop-muted">{b.destination}</span>
                  </td>
                  <td className="px-3 py-3 text-xs" dir="ltr">{b.employee || '—'}</td>
                  <td className={td}>{money(b.price, b.currency)}</td>
                  <td className={td}>
                    {money(b.cost, b.currency)}
                    {b.cost_source === 'quoted' && (
                      <span className="block text-[11px] text-shop-muted">{translate('from the quote')}</span>
                    )}
                  </td>
                  <td className={`${td} font-semibold ${b.profit < 0 ? 'text-danger-fg' : 'text-primary-800'}`}>
                    {money(b.profit, b.currency)}{b.margin_pct != null ? ` · ${b.margin_pct}%` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ReportCard>
  )
}
