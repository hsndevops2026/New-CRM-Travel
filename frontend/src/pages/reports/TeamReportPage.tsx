import { useEffect, useState } from 'react'
import { CircleAlert } from 'lucide-react'
import EmptyState from '../../components/ui/EmptyState'
import { TableSkeleton } from '../../components/ui/Skeleton'
import { t as translate, useI18n } from '../../lib/i18n'
import {
  downloadCsv,
  fetchEmployeeReport,
  toCsv,
  type EmployeeRow,
} from '../../lib/reports'
import { useReportRange } from './ReportRangeContext'
import { CsvButton, fmtMinutes, ReportCard, ReportTable, stampDay } from './reportUi'

export default function TeamReportPage() {
  useI18n()
  const { range } = useReportRange()
  const [employees, setEmployees] = useState<EmployeeRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!range) {
      setEmployees(null)
      return
    }
    let cancelled = false
    setLoading(true)
    fetchEmployeeReport(range)
      .then((e) => {
        if (cancelled) return
        setEmployees(e.employees)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to build the report')
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

  if (loading && !employees) {
    return (
      <div className="overflow-hidden rounded-xl border border-shop-border bg-white">
        <TableSkeleton rows={6} label={translate('Loading reports')} />
      </div>
    )
  }

  if (!employees) return null

  const exportEmployees = () => {
    downloadCsv(
      `employees-${stampDay()}.csv`,
      toCsv(
        [translate('Employee'), translate('Role'), translate('Leads assigned'), translate('Open leads'), translate('Quotes sent'),
          translate('Quotes accepted'), translate('Accepted value'), translate('Replies to customers'), translate('Avg. first reply (min)')],
        employees.map((e) => [e.email, e.role, e.leads_assigned, e.open_leads, e.quotes_sent, e.quotes_accepted,
          e.accepted_value ?? '', e.customer_replies, e.avg_first_reply_minutes ?? '']),
      ),
    )
  }

  return (
    <ReportCard title={translate('Team performance')} actions={<CsvButton onClick={exportEmployees} />}>
      <ReportTable
        empty={translate('No employees yet.')}
        headers={[translate('Employee'), translate('Leads assigned'), translate('Open leads'), translate('Quotes sent'),
          translate('Quotes accepted'), translate('Accepted value'), translate('Replies to customers'), translate('Avg. first reply')]}
        rows={employees.map((e) => [
          <span key="e" className="font-semibold" dir="ltr">{e.email}</span>,
          <span key="a" dir="ltr">{e.leads_assigned}</span>,
          <span key="o" dir="ltr">{e.open_leads}</span>,
          <span key="s" dir="ltr">{e.quotes_sent}</span>,
          <span key="c" dir="ltr">{e.quotes_accepted}</span>,
          <span key="v" dir="ltr">{e.accepted_value == null ? '—' : e.accepted_value.toLocaleString('en-US')}</span>,
          <span key="r" dir="ltr">{e.customer_replies}</span>,
          <span key="f">{fmtMinutes(e.avg_first_reply_minutes)}</span>,
        ])}
      />
      <p className="mt-3 text-xs text-shop-muted">
        {translate('First reply: time from the customer’s first message to the employee’s first reply, for leads assigned in this period.')}
      </p>
    </ReportCard>
  )
}
