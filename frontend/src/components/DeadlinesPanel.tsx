import { useEffect, useState } from 'react'
import { AlarmClock, Plus, Trash2 } from 'lucide-react'
import Button from './ui/Button'
import { locale, t as translate, useI18n } from '../lib/i18n'
import { localInputToIso } from '../lib/tasks'
import {
  DEADLINE_KIND_LABEL,
  addDeadline,
  deleteDeadline,
  fetchDeadlines,
  updateDeadline,
  type Deadline,
  type DeadlineKind,
} from '../lib/deadlines'

const FIELD = 'h-10 rounded-lg border border-line-strong bg-white px-2.5 text-sm'

/** Dates on this booking that cost money if missed. The team is warned 48 hours before. */
export default function DeadlinesPanel({ leadId }: { leadId: string }) {
  useI18n()
  const [items, setItems] = useState<Deadline[]>([])
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<DeadlineKind>('free_cancellation')
  const [label, setLabel] = useState('')
  const [due, setDue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [now] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    fetchDeadlines(leadId).then((list) => { if (!cancelled) setItems(list) }).catch(() => {})
    return () => { cancelled = true }
  }, [leadId])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const iso = localInputToIso(due)
    if (!iso || !label.trim()) return
    setError(null)
    try {
      const created = await addDeadline(leadId, { kind, label, due_at: iso })
      setItems((list) => [...list, created].sort((a, b) => a.due_at.localeCompare(b.due_at)))
      setAdding(false)
      setLabel('')
      setDue('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    }
  }

  const toggle = async (d: Deadline) => {
    const next = await updateDeadline(leadId, d.id, { status: d.status === 'open' ? 'done' : 'open' }).catch(() => null)
    if (next) setItems((list) => list.map((x) => (x.id === d.id ? next : x)))
  }

  const remove = async (d: Deadline) => {
    await deleteDeadline(leadId, d.id).catch(() => null)
    setItems((list) => list.filter((x) => x.id !== d.id))
  }

  return (
    <section aria-labelledby="dl-h" className="rounded-[10px] border border-shop-border bg-white p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 id="dl-h" className="flex items-center gap-2 text-[15px] font-bold">
          <AlarmClock className="size-4" aria-hidden="true" />
          {translate('Deadlines')}
        </h3>
        {!adding && <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setAdding(true)}>{translate('Add deadline')}</Button>}
      </div>
      <p className="mb-3 text-xs text-shop-muted">{translate('Free cancellation, flight options, supplier payments. The team is warned 48 hours before.')}</p>
      {adding && (
        <form onSubmit={save} className="mb-3 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-[auto_1fr_auto]">
          <select aria-label={translate('Type')} className={FIELD} value={kind} onChange={(e) => setKind(e.target.value as DeadlineKind)}>
            {(Object.keys(DEADLINE_KIND_LABEL) as DeadlineKind[]).map((k) => <option key={k} value={k}>{translate(DEADLINE_KIND_LABEL[k])}</option>)}
          </select>
          <input aria-label={translate('What is it for?')} placeholder={translate('What is it for? e.g. Hilton Istanbul')} className={FIELD} value={label} onChange={(e) => setLabel(e.target.value)} dir="auto" />
          <input aria-label={translate('Due')} type="datetime-local" className={FIELD} value={due} onChange={(e) => setDue(e.target.value)} />
          {error && <p role="alert" className="text-xs text-danger-fg sm:col-span-3">{translate(error)}</p>}
          <div className="flex gap-2 sm:col-span-3">
            <Button type="submit" size="sm" variant="primary" disabled={!label.trim() || !due}>{translate('Save')}</Button>
            <Button type="button" size="sm" onClick={() => setAdding(false)}>{translate('Cancel')}</Button>
          </div>
        </form>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-shop-muted">{translate('No deadlines on this booking.')}</p>
      ) : (
        <ul className="divide-y divide-shop-border">
          {items.map((d) => {
            const late = d.status === 'open' && new Date(d.due_at).getTime() < now
            const soon = d.status === 'open' && !late && new Date(d.due_at).getTime() - now < 48 * 3600_000
            return (
              <li key={d.id} className="flex items-center gap-3 py-2">
                <input type="checkbox" className="size-4" checked={d.status !== 'open'} aria-label={translate('Mark as done')} onChange={() => void toggle(d)} />
                <div className="min-w-0 flex-1">
                  <p dir="auto" className={`text-sm font-semibold ${d.status !== 'open' ? 'text-shop-muted line-through' : ''}`}>{d.label}</p>
                  <p className={`text-xs tabular-nums ${late ? 'font-semibold text-danger-fg' : soon ? 'font-semibold text-amber-700' : 'text-shop-muted'}`}>
                    {translate(DEADLINE_KIND_LABEL[d.kind])} · {new Date(d.due_at).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {late ? ` · ${translate('Passed')}` : soon ? ` · ${translate('Soon')}` : ''}
                  </p>
                </div>
                <button type="button" aria-label={translate('Delete {value0}', { value0: d.label })} className="inline-flex size-8 items-center justify-center rounded-md text-danger-fg hover:bg-danger-bg" onClick={() => void remove(d)}>
                  <Trash2 className="size-4" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
