import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, Plus, Send, Sparkles, Trash2, X } from 'lucide-react'
import Button from '../ui/Button'
import EmptyState from '../ui/EmptyState'
import { useConfirm } from '../../hooks/useConfirm'
import { useToast } from '../../hooks/useToast'
import { t as translate, useI18n } from '../../lib/i18n'
import {
  addTripPlanItems,
  deleteTripPlanItem,
  fetchTripPlan,
  previewTripPlan,
  sendTripPlan,
  updateTripPlanItem,
  type TripPlanItem,
} from '../../lib/tripPlan'

type Props = { leadId: string }

type Draft = { title: string; details: string; day: string }

const emptyDraft: Draft = { title: '', details: '', day: '' }

function toDay(value: string): number | null {
  const n = Number(value)
  return value.trim() && Number.isInteger(n) && n >= 1 && n <= 60 ? n : null
}

function ItemEditor({
  initial,
  saveLabel,
  onSave,
  onCancel,
}: {
  initial: Draft
  saveLabel: string
  onSave: (draft: Draft) => Promise<void>
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<Draft>(initial)
  const [busy, setBusy] = useState(false)
  const inputClass = 'w-full rounded-lg border border-shop-border bg-white px-2.5 py-1.5 text-sm text-shop-ink'
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-shop-border bg-white p-3">
      <div className="flex gap-2">
        <label className="flex w-24 shrink-0 flex-col gap-1 text-xs text-shop-muted">
          {translate('Day')}
          <input
            type="number"
            min={1}
            max={60}
            value={draft.day}
            onChange={(e) => setDraft({ ...draft, day: e.target.value })}
            className={inputClass}
            dir="ltr"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs text-shop-muted">
          {translate('Title')}
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            className={inputClass}
            dir="auto"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs text-shop-muted">
        {translate('Details')}
        <textarea
          rows={3}
          value={draft.details}
          onChange={(e) => setDraft({ ...draft, details: e.target.value })}
          className={`${inputClass} resize-y`}
          dir="auto"
        />
      </label>
      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={busy || !draft.title.trim()}
          onClick={async () => {
            setBusy(true)
            try {
              await onSave(draft)
            } finally {
              setBusy(false)
            }
          }}
        >
          {saveLabel}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {translate('Cancel')}
        </Button>
      </div>
    </div>
  )
}

export default function TripPlanPanel({ leadId }: Props) {
  useI18n()
  const toast = useToast()
  const { confirm, dialog } = useConfirm()
  const [items, setItems] = useState<TripPlanItem[]>([])
  const [customerName, setCustomerName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [lang, setLang] = useState<'ar' | 'en'>('ar')
  const [message, setMessage] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchTripPlan(leadId)
      .then((data) => {
        if (cancelled) return
        setItems(data.items)
        setCustomerName(data.lead.customer_name)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load the trip program')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leadId])

  const groups = useMemo(() => {
    const map = new Map<number, TripPlanItem[]>()
    for (const item of items) {
      const key = item.day_number ?? 0
      map.set(key, [...(map.get(key) || []), item])
    }
    return [...map.entries()].sort(([a], [b]) => (a || 999) - (b || 999))
  }, [items])

  const run = async (action: () => Promise<TripPlanItem[]>, done?: () => void) => {
    try {
      setItems(await action())
      done?.()
    } catch (err) {
      toast.show({ message: translate(err instanceof Error ? err.message : 'Something went wrong'), tone: 'error' })
    }
  }

  const openMessage = async () => {
    try {
      setMessage(await previewTripPlan(leadId, lang))
    } catch (err) {
      toast.show({ message: translate(err instanceof Error ? err.message : 'Failed to prepare the message'), tone: 'error' })
    }
  }

  const send = async () => {
    if (!message?.trim()) return
    const ok = await confirm({
      title: translate('Send the trip program?'),
      description: translate('It will be sent to {value0} on WhatsApp as it appears in the box.', {
        value0: customerName || translate('the customer'),
      }),
      confirmLabel: translate('Send'),
      tone: 'primary',
    })
    if (!ok) return
    setSending(true)
    try {
      await sendTripPlan(leadId, message)
      toast.show({ message: translate('Trip program sent'), tone: 'success' })
      setMessage(null)
    } catch (err) {
      toast.show({ message: translate(err instanceof Error ? err.message : 'Failed to send the trip program'), tone: 'error' })
    } finally {
      setSending(false)
    }
  }

  if (loading) return <p role="status" className="text-sm text-shop-muted">{translate('Loading…')}</p>
  if (error) return <p className="text-sm text-red-600">{translate(error)}</p>

  return (
    <section aria-labelledby="trip-plan-h" className="space-y-4">
      {dialog}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="trip-plan-h" className="text-lg font-bold text-shop-ink">{translate('Trip program')}</h2>
        <div className="flex flex-wrap gap-2">
          <Link to="/assistant">
            <Button variant="ghost" icon={<Sparkles />}>{translate('Get ideas from the assistant')}</Button>
          </Link>
          <Button icon={<Plus />} onClick={() => { setAdding(true); setEditing(null) }}>{translate('Add item')}</Button>
        </div>
      </div>

      {adding && (
        <ItemEditor
          initial={emptyDraft}
          saveLabel={translate('Add')}
          onCancel={() => setAdding(false)}
          onSave={(d) =>
            run(
              () => addTripPlanItems(leadId, [{ title: d.title, details: d.details, day_number: toDay(d.day), kind: 'note' }]),
              () => setAdding(false),
            )
          }
        />
      )}

      {!items.length && !adding ? (
        <EmptyState
          title={translate('No trip program yet')}
          description={translate('Add activities and day trips here, or pick ideas in the assistant’s Trip planner and add them to this customer.')}
        />
      ) : null}

      {groups.map(([day, list]) => (
        <div key={day} className="space-y-2">
          <h3 className="text-sm font-bold text-shop-muted">
            {day ? translate('Day {value0}', { value0: day }) : translate('Not scheduled yet')}
          </h3>
          {list.map((item) =>
            editing === item.id ? (
              <ItemEditor
                key={item.id}
                initial={{ title: item.title, details: item.details, day: item.day_number ? String(item.day_number) : '' }}
                saveLabel={translate('Save')}
                onCancel={() => setEditing(null)}
                onSave={(d) =>
                  run(
                    () => updateTripPlanItem(leadId, item.id, { title: d.title, details: d.details, day_number: toDay(d.day) }),
                    () => setEditing(null),
                  )
                }
              />
            ) : (
              <div key={item.id} dir="auto" className="flex items-start gap-3 rounded-xl border border-shop-border bg-white px-3 py-2.5 text-sm">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-shop-ink">{item.title}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        item.source === 'system' ? 'bg-dealer-bg text-dealer-fg' : 'bg-warn-bg text-[#78350F]'
                      }`}
                    >
                      {item.source === 'system' ? translate('From the system') : translate('General suggestion, not from the system')}
                    </span>
                    {item.price != null && item.currency ? (
                      <span dir="ltr" className="text-xs font-bold tabular-nums text-shop-ink">
                        {item.price.toLocaleString('en-US')} {item.currency}
                      </span>
                    ) : null}
                  </div>
                  {item.details ? <p className="mt-1 whitespace-pre-wrap text-shop-muted">{item.details}</p> : null}
                </div>
                <Button variant="ghost" iconOnly aria-label={translate('Edit')} icon={<Pencil />} onClick={() => { setEditing(item.id); setAdding(false) }} />
                <Button
                  variant="ghost"
                  iconOnly
                  aria-label={translate('Delete')}
                  icon={<Trash2 />}
                  onClick={() => void run(() => deleteTripPlanItem(leadId, item.id))}
                />
              </div>
            ),
          )}
        </div>
      ))}

      {items.length > 0 && (
        <div className="space-y-2 rounded-xl border border-shop-border bg-white p-3">
          {message === null ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-shop-muted">
                {translate('Message language')}
                <select
                  value={lang}
                  onChange={(e) => setLang(e.target.value === 'en' ? 'en' : 'ar')}
                  className="rounded-lg border border-shop-border bg-white px-2 py-1 text-sm text-shop-ink"
                >
                  <option value="ar">العربية</option>
                  <option value="en">English</option>
                </select>
              </label>
              <Button variant="primary" icon={<Send />} onClick={() => void openMessage()}>
                {translate('Prepare message for the customer')}
              </Button>
            </div>
          ) : (
            <>
              <p className="text-xs text-shop-muted">
                {translate('Edit the message if needed. It is sent only when you click Send.')}
              </p>
              <textarea
                rows={10}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full resize-y rounded-lg border border-shop-border bg-white px-3 py-2 text-sm text-shop-ink"
                dir="auto"
                aria-label={translate('Message to the customer')}
              />
              <div className="flex gap-2">
                <Button variant="primary" icon={<Send />} disabled={sending || !message.trim()} onClick={() => void send()}>
                  {translate('Send to {value0} on WhatsApp', { value0: customerName || translate('the customer') })}
                </Button>
                <Button variant="ghost" icon={<X />} onClick={() => setMessage(null)}>
                  {translate('Cancel')}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
