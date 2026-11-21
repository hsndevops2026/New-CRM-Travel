import { useEffect, useState } from 'react'
import { CircleAlert } from 'lucide-react'
import EmptyState from '../../components/ui/EmptyState'
import { TableSkeleton } from '../../components/ui/Skeleton'
import { fetchSupplierReport, type SupplierRow } from '../../lib/business'
import { t as translate, useI18n } from '../../lib/i18n'
import { useReportRange } from './ReportRangeContext'
import { ReportCard } from './reportUi'

const th = 'whitespace-nowrap px-3 py-2.5 text-start text-[11px] font-semibold tracking-[0.06em] text-slate-500 uppercase'
const td = 'px-3 py-3 tabular-nums'

export default function SuppliersReportPage() {
  useI18n()
  const { range } = useReportRange()
  const [suppliers, setSuppliers] = useState<SupplierRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!range) {
      setSuppliers(null)
      return
    }
    let cancelled = false
    setLoading(true)
    fetchSupplierReport(range)
      .then((s) => {
        if (cancelled) return
        setSuppliers(s)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load supplier report')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [range])

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

  if (loading && !suppliers) {
    return (
      <div className="overflow-hidden rounded-xl border border-shop-border bg-white">
        <TableSkeleton rows={5} label={translate('Loading…')} />
      </div>
    )
  }

  if (!suppliers) return null

  return (
    <ReportCard title={translate('Suppliers')}>
      {suppliers.length === 0 ? (
        <p className="py-6 text-center text-sm text-shop-muted">{translate('No price requests to suppliers in this period.')}</p>
      ) : (
        <div className="-mx-4 overflow-x-auto sm:mx-0 sm:rounded-lg sm:border sm:border-shop-border">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-shop-border bg-[#f8fafc]">
                {['Supplier', 'Requests', 'Answered', 'Typical answer time', 'Price used', 'Became bookings'].map((h) => (
                  <th key={h} className={th}>{translate(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id} className="border-b border-[#eef1f5] transition-colors last:border-0 hover:bg-[#f7fafb]">
                  <td className="px-3 py-3 font-semibold" dir="auto">
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
    </ReportCard>
  )
}
