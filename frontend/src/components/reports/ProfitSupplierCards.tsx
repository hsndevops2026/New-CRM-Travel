import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { t as translate, useI18n } from '../../lib/i18n'
import { downloadCsv, toCsv, type Range } from '../../lib/reports'
import { fetchProfitReport, fetchSupplierReport, money, type ProfitReport, type SupplierRow } from '../../lib/business'

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-shop-border bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-shop-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

const th = 'px-2 py-1.5 text-start text-xs font-semibold text-shop-muted'
const td = 'px-2 py-1.5 tabular-nums'

/** Real profit per booking and the supplier scorecard, for the selected period. */
export default function ProfitSupplierCards({ range }: { range: Range }) {
  useI18n()
  const [profit, setProfit] = useState<ProfitReport | null>(null)
  const [suppliers, setSuppliers] = useState<SupplierRow[] | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchProfitReport(range), fetchSupplierReport(range)])
      .then(([p, s]) => { if (!cancelled) { setProfit(p); setSuppliers(s) } })
      .catch(() => {})
    return () => { cancelled = true }
  }, [range])

  const exportProfit = () => {
    if (!profit) return
    downloadCsv('profit.csv', toCsv(
      ['Customer', 'Destination', 'Travel date', 'Employee', 'Price', 'Cost', 'Cost from', 'Profit', 'Margin %', 'Currency'],
      profit.bookings.map((b) => [b.customer, b.destination, b.travel_date, b.employee, b.price, b.cost, b.cost_source, b.profit, b.margin_pct, b.currency]),
    ))
  }

  return (
    <>
      <Section
        title={translate('Profit per booking')}
        action={profit?.bookings.length ? <button type="button" className="text-sm font-semibold text-shop-accent" onClick={exportProfit}>{translate('Export CSV')}</button> : null}
      >
        {!profit ? <p className="text-sm text-shop-muted">{translate('Loading…')}</p> : (
          <>
            <div className="mb-3 flex flex-wrap gap-4 text-sm">
              {profit.totals.map((t) => (
                <p key={t.currency}>
                  <strong className="tabular-nums">{money(t.profit, t.currency)}</strong>{' '}
                  <span className="text-shop-muted">{translate('profit on {value0} sales ({value1} bookings)', { value0: money(t.sales, t.currency), value1: t.bookings })}</span>
                </p>
              ))}
            </div>
            {profit.bookings.length === 0 ? <p className="text-sm text-shop-muted">{translate('No accepted bookings in this period.')}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead><tr>{['Customer', 'Employee', 'Price', 'Cost', 'Profit'].map((h) => <th key={h} className={th}>{translate(h)}</th>)}</tr></thead>
                  <tbody className="divide-y divide-neutral-bg">
                    {profit.bookings.map((b) => (
                      <tr key={b.id}>
                        <td className="px-2 py-1.5">
                          <Link to={`/leads/${b.id}`} className="font-semibold hover:underline">{b.customer || b.destination || translate('Booking')}</Link>
                          <span className="block text-xs text-shop-muted">{b.destination}</span>
                        </td>
                        <td className="px-2 py-1.5 text-xs" dir="ltr">{b.employee || '—'}</td>
                        <td className={td}>{money(b.price, b.currency)}</td>
                        <td className={td}>
                          {money(b.cost, b.currency)}
                          {b.cost_source === 'quoted' && <span className="block text-[11px] text-shop-muted">{translate('from the quote')}</span>}
                        </td>
                        <td className={`${td} font-semibold ${b.profit < 0 ? 'text-danger-fg' : ''}`}>
                          {money(b.profit, b.currency)}{b.margin_pct != null ? ` · ${b.margin_pct}%` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Section>
      <Section title={translate('Suppliers')}>
        {!suppliers ? <p className="text-sm text-shop-muted">{translate('Loading…')}</p> : suppliers.length === 0 ? (
          <p className="text-sm text-shop-muted">{translate('No price requests to suppliers in this period.')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead>
                <tr>{['Supplier', 'Requests', 'Answered', 'Typical answer time', 'Price used', 'Became bookings'].map((h) => <th key={h} className={th}>{translate(h)}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-neutral-bg">
                {suppliers.map((s) => (
                  <tr key={s.id}>
                    <td className="px-2 py-1.5 font-semibold" dir="auto">
                      {s.name}
                      {s.company ? <span className="block text-xs font-normal text-shop-muted">{s.company}</span> : null}
                    </td>
                    <td className={td}>{s.requests}</td>
                    <td className={td}>{s.answered}{s.answer_rate != null ? ` (${s.answer_rate}%)` : ''}</td>
                    <td className={td}>{s.median_minutes != null ? translate('{value0} min', { value0: s.median_minutes }) : '—'}</td>
                    <td className={td}>{s.picked}</td>
                    <td className={td}>{s.picked_and_booked}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  )
}
