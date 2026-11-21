import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, BarChart3, CheckCircle2, CircleAlert, Clock3, FileText } from 'lucide-react'
import EmptyState from '../../components/ui/EmptyState'
import LifecycleBadge from '../../components/ui/LifecycleBadge'
import { TableSkeleton } from '../../components/ui/Skeleton'
import { lifecycleLabel } from '../../lib/lifecycle'
import { t as translate, useI18n } from '../../lib/i18n'
import {
  downloadCsv,
  fetchOverdueReport,
  toCsv,
  type OverdueReport,
} from '../../lib/reports'
import { AttentionCount, CsvButton, LeadLink, ReportCard, ReportTable } from './reportUi'
import { fmtDate, stampDay } from './reportFormat'

export default function AttentionReportPage() {
  useI18n()
  const [overdue, setOverdue] = useState<OverdueReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetchOverdueReport()
      .then((o) => {
        if (cancelled) return
        setOverdue(o)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to build the report')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

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

  if (loading && !overdue) {
    return (
      <div className="overflow-hidden rounded-xl border border-shop-border bg-white">
        <TableSkeleton rows={6} label={translate('Loading reports')} />
      </div>
    )
  }

  if (!overdue) return null

  const attentionTotal =
    overdue.unanswered_customers.length
    + overdue.quotes_without_reply.length
    + overdue.overdue_reminders.length
    + overdue.stalled_requests.length

  const exportOverdue = () => {
    const rows: unknown[][] = [
      ...overdue.overdue_reminders.map((r) => [translate('Overdue reminder'), r.customer_name, r.phone, r.text, r.remind_at, '']),
      ...overdue.unanswered_customers.map((r) => [translate('Waiting for a reply'), r.customer_name, r.phone, r.last_message, r.waiting_since, r.assigned_to || '']),
      ...overdue.quotes_without_reply.map((r) => [translate('Quote with no reply'), r.customer_name, r.phone, r.destination, r.sent_at, r.assigned_to || '']),
      ...overdue.stalled_requests.map((r) => [translate('Stalled request'), r.customer_name, r.phone, lifecycleLabel(r.lifecycle_status), r.last_activity, r.assigned_to || '']),
    ]
    downloadCsv(
      `overdue-${stampDay()}.csv`,
      toCsv([translate('Type'), translate('Customer'), translate('Phone'), translate('Details'), translate('Since'), translate('Assigned to')], rows),
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <AttentionCount label={translate('Waiting')} count={overdue.unanswered_customers.length} tone="danger" />
        <AttentionCount label={translate('Quotes quiet')} count={overdue.quotes_without_reply.length} tone="warn" />
        <AttentionCount label={translate('Reminders')} count={overdue.overdue_reminders.length} tone="warn" />
        <AttentionCount label={translate('Stalled')} count={overdue.stalled_requests.length} tone="neutral" />
      </div>

      <ReportCard title={translate('Needs attention now')} actions={<CsvButton onClick={exportOverdue} />}>
        {attentionTotal === 0 ? (
          <EmptyState
            tone="default"
            icon={<CheckCircle2 />}
            title={translate('All clear')}
            description={translate('No overdue replies, quiet quotes, reminders, or stalled requests right now.')}
          />
        ) : (
          <div className="space-y-6">
            <div>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-shop-ink">
                <Clock3 className="size-4 text-danger" aria-hidden="true" />
                {translate('Customers waiting for a reply (over {value0} h)', { value0: overdue.thresholds.reply_hours })}
                <span className="rounded-full bg-danger-bg px-2 text-xs font-bold text-danger-fg tabular-nums">
                  {overdue.unanswered_customers.length}
                </span>
              </h3>
              <ReportTable
                empty={translate('Nobody is waiting.')}
                headers={[translate('Customer'), translate('Last message'), translate('Since'), translate('Assigned to')]}
                rows={overdue.unanswered_customers.map((r) => [
                  <LeadLink key="l" id={r.lead_id} name={r.customer_name} phone={r.phone} />,
                  <span key="m" dir="auto" className="line-clamp-2 text-slate-700">{r.last_message}</span>,
                  fmtDate(r.waiting_since),
                  <span key="a" dir="ltr">{r.assigned_to || translate('Not assigned')}</span>,
                ])}
              />
            </div>
            <div>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-shop-ink">
                <FileText className="size-4 text-warn-fg" aria-hidden="true" />
                {translate('Quotes with no customer reply (over {value0} days)', { value0: overdue.thresholds.quote_days })}
                <span className="rounded-full bg-warn-bg px-2 text-xs font-bold text-warn-fg tabular-nums">
                  {overdue.quotes_without_reply.length}
                </span>
              </h3>
              <ReportTable
                empty={translate('None.')}
                headers={[translate('Customer'), translate('Destination'), translate('Sent'), translate('Assigned to')]}
                rows={overdue.quotes_without_reply.map((r) => [
                  <LeadLink key="l" id={r.lead_id} name={r.customer_name} phone={r.phone} />,
                  r.destination,
                  fmtDate(r.sent_at),
                  <span key="a" dir="ltr">{r.assigned_to || translate('Not assigned')}</span>,
                ])}
              />
            </div>
            <div>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-shop-ink">
                <AlertTriangle className="size-4 text-warn-fg" aria-hidden="true" />
                {translate('Overdue reminders')}
                <span className="rounded-full bg-warn-bg px-2 text-xs font-bold text-warn-fg tabular-nums">
                  {overdue.overdue_reminders.length}
                </span>
              </h3>
              <ReportTable
                empty={translate('None.')}
                headers={[translate('Customer'), translate('Reminder'), translate('Was due')]}
                rows={overdue.overdue_reminders.map((r) => [
                  <Link key="c" to={`/contacts/${r.contact_id}`} className="font-semibold text-shop-ink hover:text-shop-accent hover:underline">{r.customer_name}</Link>,
                  <span key="t" dir="auto">{r.text}</span>,
                  fmtDate(r.remind_at),
                ])}
              />
            </div>
            <div>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-shop-ink">
                <BarChart3 className="size-4 text-slate-500" aria-hidden="true" />
                {translate('Stalled requests (no activity for {value0} days)', { value0: overdue.thresholds.stale_days })}
                <span className="rounded-full bg-neutral-bg px-2 text-xs font-bold text-neutral-fg tabular-nums">
                  {overdue.stalled_requests.length}
                </span>
              </h3>
              <ReportTable
                empty={translate('None.')}
                headers={[translate('Customer'), translate('Stage'), translate('Last activity'), translate('Assigned to')]}
                rows={overdue.stalled_requests.map((r) => [
                  <LeadLink key="l" id={r.lead_id} name={r.customer_name} phone={r.phone} />,
                  <LifecycleBadge key="s" status={r.lifecycle_status} />,
                  fmtDate(r.last_activity),
                  <span key="a" dir="ltr">{r.assigned_to || translate('Not assigned')}</span>,
                ])}
              />
            </div>
          </div>
        )}
      </ReportCard>
    </div>
  )
}
