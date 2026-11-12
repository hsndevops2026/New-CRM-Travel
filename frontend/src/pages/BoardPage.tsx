import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, PlaneLanding, PlaneTakeoff } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { locale, t as translate, useI18n } from '../lib/i18n'
import { DEADLINE_KIND_LABEL, addDays, boardDays, dayKey, fetchBoard, type Board } from '../lib/deadlines'

/** This week at a glance: who flies out, who comes back, who is away, and what is due. */
export default function BoardPage() {
  useI18n()
  const [start, setStart] = useState(() => dayKey(new Date()))
  const [board, setBoard] = useState<Board | null>(null)
  const [error, setError] = useState<string | null>(null)
  const end = addDays(start, 6)

  useEffect(() => {
    let cancelled = false
    fetchBoard(start, end)
      .then((b) => { if (!cancelled) { setBoard(b); setError(null) } })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load') })
    return () => { cancelled = true }
  }, [start, end])

  const days = useMemo(() => (board ? boardDays(board) : []), [board])
  const today = dayKey(new Date())
  const overdue = (board?.deadlines || []).filter((d) => dayKey(new Date(d.due_at)) < start)
  const who = (c: string | null, dest: string | null) => [c, dest].filter(Boolean).join(' · ') || translate('Booking')

  return (
    <div className="mx-auto w-full max-w-[1000px] p-4 pb-24 sm:p-6">
      <PageHeader
        title="This week"
        subtitle={translate('Departures, returns and deadlines for booked trips.')}
        actions={
          <div className="flex items-center gap-1">
            <button type="button" aria-label={translate('Previous week')} className="inline-flex size-10 items-center justify-center rounded-lg border border-shop-border" onClick={() => setStart(addDays(start, -7))}><ChevronRight className="size-4 rtl:rotate-0 ltr:rotate-180" /></button>
            <button type="button" className="h-10 rounded-lg border border-shop-border px-3 text-sm font-semibold" onClick={() => setStart(dayKey(new Date()))}>{translate('Today')}</button>
            <button type="button" aria-label={translate('Next week')} className="inline-flex size-10 items-center justify-center rounded-lg border border-shop-border" onClick={() => setStart(addDays(start, 7))}><ChevronLeft className="size-4 rtl:rotate-0 ltr:rotate-180" /></button>
          </div>
        }
      />
      {error && <p role="alert" className="mb-3 text-sm text-danger-fg">{translate(error)}</p>}
      {overdue.length > 0 && (
        <section className="mb-4 rounded-[10px] border border-danger-fg/30 bg-danger-bg p-3">
          <h2 className="mb-1 text-sm font-bold text-danger-fg">{translate('Overdue deadlines')}</h2>
          <ul className="grid gap-1 text-sm">
            {overdue.map((d) => (
              <li key={d.id}><Link to={`/leads/${d.lead_id}`} className="hover:underline"><bdi>{d.label}</bdi> · {who(d.customer || null, d.destination || null)}</Link></li>
            ))}
          </ul>
        </section>
      )}
      <ol className="grid gap-3">
        {days.map((d) => {
          const empty = !d.departures.length && !d.returns.length && !d.deadlines.length
          return (
            <li key={d.day} className={`rounded-[10px] border bg-white p-3 ${d.day === today ? 'border-shop-accent' : 'border-shop-border'}`}>
              <h2 className="mb-1.5 flex items-center justify-between text-sm font-bold">
                {new Date(`${d.day}T12:00:00`).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' })}
                {d.away.length > 0 && <span className="text-xs font-normal text-shop-muted">{translate('{value0} away', { value0: d.away.length })}</span>}
              </h2>
              {empty ? <p className="text-xs text-shop-muted">{translate('Nothing scheduled')}</p> : (
                <ul className="grid gap-1 text-sm">
                  {d.departures.map((t) => (
                    <li key={`d-${t.id}`} className="flex items-center gap-2"><PlaneTakeoff className="size-4 text-primary-700" aria-label={translate('Departure')} /><Link to={`/leads/${t.id}`} className="hover:underline">{who(t.customer, t.destination)}</Link></li>
                  ))}
                  {d.returns.map((t) => (
                    <li key={`r-${t.id}`} className="flex items-center gap-2"><PlaneLanding className="size-4 text-shop-muted" aria-label={translate('Return')} /><Link to={`/leads/${t.id}`} className="hover:underline">{who(t.customer, t.destination)}</Link></li>
                  ))}
                  {d.deadlines.map((x) => (
                    <li key={`x-${x.id}`} className="flex items-center gap-2 text-amber-800">
                      <span aria-hidden="true">⏰</span>
                      <Link to={`/leads/${x.lead_id}`} className="hover:underline">
                        {translate(DEADLINE_KIND_LABEL[x.kind])}: <bdi>{x.label}</bdi> · {new Date(x.due_at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
