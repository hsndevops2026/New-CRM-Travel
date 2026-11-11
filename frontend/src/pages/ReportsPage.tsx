import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Download } from 'lucide-react'
import Button from '../components/ui/Button'
import LifecycleBadge from '../components/ui/LifecycleBadge'
import PageHeader from '../components/ui/PageHeader'
import SegmentedControl from '../components/ui/SegmentedControl'
import { useAuth } from '../context/AuthContext'
import { lifecycleLabel } from '../lib/lifecycle'
import { formatPhone } from '../lib/leads'
import { locale, t as translate, useI18n } from '../lib/i18n'
import {
  customRange,
  downloadCsv,
  fetchEmployeeReport,
  fetchOverdueReport,
  fetchPipelineReport,
  presetRange,
  toCsv,
  type EmployeeRow,
  type OverdueReport,
  type PipelineReport,
  type Preset,
  type Range,
} from '../lib/reports'

const STAGE_LABEL: Record<string, string> = {
  new: 'New leads',
  sent: 'Quote sent',
  accepted: 'Accepted',
  booked: 'Booked',
}

const SOURCE_LABEL: Record<string, string> = { whatsapp: 'WhatsApp', web: 'Website', manual: 'Manual', import: 'Import' }

function fmtDate(value: string | null | undefined) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function fmtMinutes(min: number | null) {
  if (min == null) return '—'
  if (min < 60) return translate('{value0} min', { value0: Math.round(min) })
  const h = min / 60
  if (h < 48) return translate('{value0} h', { value0: Math.round(h * 10) / 10 })
  return translate('{value0} days', { value0: Math.round((h / 24) * 10) / 10 })
}

function money(total: number | null, currency: string) {
  if (total == null) return '—'
  return `${total.toLocaleString('en-US', { maximumFractionDigits: 0 })} ${currency}`
}

function Card({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-shop-border bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-shop-ink">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  )
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-shop-border bg-white p-3">
      <div className="text-xs text-shop-muted">{label}</div>
      <div className="mt-1 text-2xl font-extrabold tabular-nums text-shop-ink" dir="ltr">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-shop-muted">{hint}</div> : null}
    </div>
  )
}

function Bar({ label, count, max, note }: { label: string; count: number; max: number; note?: string }) {
  const width = max > 0 ? Math.max(2, Math.round((count / max) * 100)) : 0
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-28 shrink-0 text-shop-muted">{label}</span>
      <div className="h-6 flex-1 overflow-hidden rounded-md bg-neutral-bg">
        <div className="h-full rounded-md bg-shop-ink" style={{ width: `${width}%` }} />
      </div>
      <span className="w-20 shrink-0 text-end font-bold tabular-nums" dir="ltr">
        {count}
        {note ? <span className="ms-1 text-xs font-normal text-shop-muted">{note}</span> : null}
      </span>
    </div>
  )
}

function CsvButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" icon={<Download />} onClick={onClick}>
      {translate('Export CSV')}
    </Button>
  )
}

function LeadLink({ id, name, phone }: { id: string; name: string; phone: string }) {
  return (
    <Link to={`/leads/${id}`} className="font-bold text-shop-ink underline-offset-2 hover:underline">
      {name || <span dir="ltr">{formatPhone(phone)}</span>}
    </Link>
  )
}

function Table({ headers, rows, empty }: { headers: string[]; rows: ReactNode[][]; empty: string }) {
  if (!rows.length) return <p className="text-sm text-shop-muted">{empty}</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-shop-border text-start text-xs text-shop-muted">
            {headers.map((h) => (
              <th key={h} className="px-2 py-2 text-start font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-shop-border/60 last:border-0">
              {r.map((c, j) => (
                <td key={j} className="px-2 py-2 align-top">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function ReportsPage() {
  useI18n()
  const { admin } = useAuth()
  const [preset, setPreset] = useState<Preset>('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [pipeline, setPipeline] = useState<PipelineReport | null>(null)
  const [employees, setEmployees] = useState<EmployeeRow[] | null>(null)
  const [overdue, setOverdue] = useState<OverdueReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const range: Range | null = useMemo(
    () => (preset === 'custom' ? customRange(customFrom, customTo) : presetRange(preset)),
    [preset, customFrom, customTo],
  )

  useEffect(() => {
    if (!range || admin?.role !== 'admin') return
    let cancelled = false
    Promise.all([fetchPipelineReport(range), fetchEmployeeReport(range)])
      .then(([p, e]) => {
        if (cancelled) return
        setPipeline(p)
        setEmployees(e.employees)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to build the report')
      })
    return () => {
      cancelled = true
    }
  }, [range, admin?.role])

  useEffect(() => {
    if (admin?.role !== 'admin') return
    let cancelled = false
    fetchOverdueReport()
      .then((o) => { if (!cancelled) setOverdue(o) })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to build the report') })
    return () => {
      cancelled = true
    }
  }, [admin?.role])

  if (admin?.role !== 'admin') return <Navigate to="/leads/hotel" replace />

  const funnelMax = pipeline?.funnel[0]?.count || 0
  const sourceMax = Math.max(0, ...(pipeline?.by_source.map((s) => s.count) || [0]))
  const stamp = new Date().toISOString().slice(0, 10)

  const exportPipeline = () => {
    if (!pipeline) return
    const rows: unknown[][] = [
      ...pipeline.funnel.map((f) => [translate(STAGE_LABEL[f.stage]), f.count, f.rate == null ? '' : `${f.rate}%`]),
      [translate('Lost'), pipeline.lost, ''],
      ...pipeline.by_source.map((s) => [`${translate('Source')}: ${translate(SOURCE_LABEL[s.source] || s.source)}`, s.count, '']),
      [translate('Quotes sent'), pipeline.quotes_sent, ''],
      [translate('Quotes accepted'), pipeline.quotes_accepted, ''],
      ...pipeline.accepted_value.map((v) => [`${translate('Accepted value')} (${v.currency})`, v.total, v.count]),
    ]
    downloadCsv(`pipeline-${stamp}.csv`, toCsv([translate('Metric'), translate('Count'), translate('Rate')], rows))
  }

  const exportEmployees = () => {
    if (!employees) return
    downloadCsv(
      `employees-${stamp}.csv`,
      toCsv(
        [translate('Employee'), translate('Role'), translate('Leads assigned'), translate('Open leads'), translate('Quotes sent'),
          translate('Quotes accepted'), translate('Accepted value'), translate('Replies to customers'), translate('Avg. first reply (min)')],
        employees.map((e) => [e.email, e.role, e.leads_assigned, e.open_leads, e.quotes_sent, e.quotes_accepted,
          e.accepted_value ?? '', e.customer_replies, e.avg_first_reply_minutes ?? '']),
      ),
    )
  }

  const exportOverdue = () => {
    if (!overdue) return
    const rows: unknown[][] = [
      ...overdue.overdue_reminders.map((r) => [translate('Overdue reminder'), r.customer_name, r.phone, r.text, r.remind_at, '']),
      ...overdue.unanswered_customers.map((r) => [translate('Waiting for a reply'), r.customer_name, r.phone, r.last_message, r.waiting_since, r.assigned_to || '']),
      ...overdue.quotes_without_reply.map((r) => [translate('Quote with no reply'), r.customer_name, r.phone, r.destination, r.sent_at, r.assigned_to || '']),
      ...overdue.stalled_requests.map((r) => [translate('Stalled request'), r.customer_name, r.phone, lifecycleLabel(r.lifecycle_status), r.last_activity, r.assigned_to || '']),
    ]
    downloadCsv(
      `overdue-${stamp}.csv`,
      toCsv([translate('Type'), translate('Customer'), translate('Phone'), translate('Details'), translate('Since'), translate('Assigned to')], rows),
    )
  }

  const presets = [
    { id: 'today', label: translate('Today') },
    { id: '7d', label: translate('7 days') },
    { id: '30d', label: translate('30 days') },
    { id: 'month', label: translate('This month') },
    { id: 'custom', label: translate('Custom') },
  ]

  return (
    <div className="space-y-4 pb-8">
      <PageHeader title={translate('Reports')} subtitle={translate('Sales, team performance and what needs attention.')} />

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl items={presets} value={preset} onChange={(id) => setPreset(id as Preset)} ariaLabel={translate('Date range')} />
        {preset === 'custom' && (
          <div className="flex items-center gap-2 text-sm">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} aria-label={translate('From')}
              className="rounded-lg border border-shop-border bg-white px-2 py-1.5" />
            <span className="text-shop-muted">{translate('to')}</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} aria-label={translate('To')}
              className="rounded-lg border border-shop-border bg-white px-2 py-1.5" />
          </div>
        )}
      </div>

      {error ? <p role="alert" className="text-sm text-red-600">{translate(error)}</p> : null}
      {preset === 'custom' && !range ? <p className="text-sm text-shop-muted">{translate('Choose a start and end date.')}</p> : null}

      {pipeline && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={translate('New leads')} value={pipeline.new_leads} />
            <Stat label={translate('Quotes sent')} value={pipeline.quotes_sent} />
            <Stat label={translate('Quotes accepted')} value={pipeline.quotes_accepted} />
            <Stat
              label={translate('Accepted value')}
              value={pipeline.accepted_value.length ? pipeline.accepted_value.map((v) => money(v.total, v.currency)).join(' + ') : '—'}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={translate('Sales pipeline')} actions={<CsvButton onClick={exportPipeline} />}>
              <p className="mb-3 text-xs text-shop-muted">
                {translate('Leads created in this period, by where they are now.')}
              </p>
              <div className="space-y-2">
                {pipeline.funnel.map((f) => (
                  <Bar key={f.stage} label={translate(STAGE_LABEL[f.stage])} count={f.count} max={funnelMax}
                    note={f.rate == null || f.stage === 'new' ? undefined : `${f.rate}%`} />
                ))}
              </div>
              <p className="mt-3 text-xs text-shop-muted">{translate('Lost: {value0}', { value0: pipeline.lost })}</p>
            </Card>

            <Card title={translate('Where leads come from')}>
              {pipeline.by_source.length ? (
                <div className="space-y-2">
                  {pipeline.by_source.map((s) => (
                    <Bar key={s.source} label={translate(SOURCE_LABEL[s.source] || s.source)} count={s.count} max={sourceMax} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-shop-muted">{translate('No new leads in this period.')}</p>
              )}
              <h3 className="mt-4 mb-2 text-sm font-bold text-shop-ink">{translate('All open requests now')}</h3>
              <div className="flex flex-wrap gap-2">
                {pipeline.current_pipeline.map((p) => (
                  <span key={p.status} className="inline-flex items-center gap-1.5">
                    <LifecycleBadge status={p.status} />
                    <strong className="tabular-nums" dir="ltr">{p.count}</strong>
                  </span>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}

      {employees && (
        <Card title={translate('Team performance')} actions={<CsvButton onClick={exportEmployees} />}>
          <Table
            empty={translate('No employees yet.')}
            headers={[translate('Employee'), translate('Leads assigned'), translate('Open leads'), translate('Quotes sent'),
              translate('Quotes accepted'), translate('Accepted value'), translate('Replies to customers'), translate('Avg. first reply')]}
            rows={employees.map((e) => [
              <span key="e" className="font-bold" dir="ltr">{e.email}</span>,
              <span key="a" dir="ltr">{e.leads_assigned}</span>,
              <span key="o" dir="ltr">{e.open_leads}</span>,
              <span key="s" dir="ltr">{e.quotes_sent}</span>,
              <span key="c" dir="ltr">{e.quotes_accepted}</span>,
              <span key="v" dir="ltr">{e.accepted_value == null ? '—' : e.accepted_value.toLocaleString('en-US')}</span>,
              <span key="r" dir="ltr">{e.customer_replies}</span>,
              <span key="f">{fmtMinutes(e.avg_first_reply_minutes)}</span>,
            ])}
          />
          <p className="mt-2 text-xs text-shop-muted">
            {translate('First reply: time from the customer’s first message to the employee’s first reply, for leads assigned in this period.')}
          </p>
        </Card>
      )}

      {overdue && (
        <Card title={translate('Needs attention now')} actions={<CsvButton onClick={exportOverdue} />}>
          <div className="space-y-5">
            <div>
              <h3 className="mb-2 text-sm font-bold text-shop-ink">
                {translate('Customers waiting for a reply (over {value0} h)', { value0: overdue.thresholds.reply_hours })} · {overdue.unanswered_customers.length}
              </h3>
              <Table
                empty={translate('Nobody is waiting.')}
                headers={[translate('Customer'), translate('Last message'), translate('Since'), translate('Assigned to')]}
                rows={overdue.unanswered_customers.map((r) => [
                  <LeadLink key="l" id={r.lead_id} name={r.customer_name} phone={r.phone} />,
                  <span key="m" dir="auto">{r.last_message}</span>,
                  fmtDate(r.waiting_since),
                  <span key="a" dir="ltr">{r.assigned_to || translate('Not assigned')}</span>,
                ])}
              />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-bold text-shop-ink">
                {translate('Quotes with no customer reply (over {value0} days)', { value0: overdue.thresholds.quote_days })} · {overdue.quotes_without_reply.length}
              </h3>
              <Table
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
              <h3 className="mb-2 text-sm font-bold text-shop-ink">
                {translate('Overdue reminders')} · {overdue.overdue_reminders.length}
              </h3>
              <Table
                empty={translate('None.')}
                headers={[translate('Customer'), translate('Reminder'), translate('Was due')]}
                rows={overdue.overdue_reminders.map((r) => [
                  <Link key="c" to={`/contacts/${r.contact_id}`} className="font-bold text-shop-ink hover:underline">{r.customer_name}</Link>,
                  <span key="t" dir="auto">{r.text}</span>,
                  fmtDate(r.remind_at),
                ])}
              />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-bold text-shop-ink">
                {translate('Stalled requests (no activity for {value0} days)', { value0: overdue.thresholds.stale_days })} · {overdue.stalled_requests.length}
              </h3>
              <Table
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
        </Card>
      )}
    </div>
  )
}
