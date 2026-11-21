import { locale } from '../lib/i18n'
import { t as translate, useI18n } from '../lib/i18n'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlarmClock, Bell, ChevronLeft, ChevronRight, CircleAlert, Clock, MessageCircle, Pencil, Trash2 } from 'lucide-react'
import ReminderModal from '../components/ReminderModal'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import PageHeader from '../components/ui/PageHeader'
import { useConfirm } from '../hooks/useConfirm'
import type { Contact } from '../lib/contacts'
import { threadInitials } from '../lib/inboxView'
import {
  deleteReminder,
  fetchRemindersBetween,
  formatReminderTime,
  isReminderOverdue,
  reminderYmd,
  shiftYmd,
  todayYmd,
  updateReminder,
  weekStartYmd,
  type ContactReminder,
} from '../lib/reminders'

/** How far back "still open from earlier days" looks. */
const EARLIER_DAYS = 180

function dayLabel(ymd: string, options: Intl.DateTimeFormatOptions) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(locale(), options)
}

function ReminderRow({ reminder, showDate, onToggle, onEdit, onDelete }: {
  reminder: ContactReminder
  showDate?: boolean
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  useI18n()
  const overdue = isReminderOverdue(reminder)
  const done = Boolean(reminder.done_at)
  return (
    <li className={`group flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-[#f7fafb] ${done ? 'opacity-70' : ''}`}>
      <input
        type="checkbox"
        checked={done}
        aria-label={done ? translate("Mark reminder not done") : translate("Mark reminder done")}
        className="mt-1 size-[18px] shrink-0"
        onChange={onToggle}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-semibold tabular-nums ${
            overdue ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-shop-border bg-[#f8fafb] text-slate-700'
          }`}>
            <Clock className="size-3" aria-hidden="true" />
            {showDate && <>{dayLabel(reminderYmd(reminder.remind_at), { day: 'numeric', month: 'short' })} · </>}
            {formatReminderTime(reminder.remind_at)}
          </span>
          {reminder.contact_name && (
            <Link
              to={`/contacts/${reminder.contact_id}`}
              className="inline-flex h-6 items-center gap-1.5 rounded-full border border-shop-border bg-white ps-0.5 pe-2 text-xs font-semibold hover:border-line-strong"
            >
              <span aria-hidden="true" className="grid size-5 place-items-center rounded-full bg-teal-100 text-[9px] font-bold text-teal-800">
                {threadInitials(reminder.contact_name)}
              </span>
              <span dir="auto">{reminder.contact_name}</span>
            </Link>
          )}
          {overdue && (
            <span className="text-[11px] font-bold tracking-wide text-rose-700 uppercase">{translate("Overdue")}</span>
          )}
          {reminder.notify_customer && (
            <span className="inline-flex h-6 items-center gap-1 rounded-full bg-tint px-2 text-xs font-semibold text-primary-800">
              <MessageCircle className="size-3" aria-hidden="true" />
              {translate(reminder.sent_at ? "Sent to customer" : "Messages the customer")}
            </span>
          )}
        </div>
        <p dir="auto" className={`mt-1.5 text-start text-sm ${done ? 'line-through text-shop-muted' : 'text-shop-ink'}`}>{reminder.text}</p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
        <Button size="sm" variant="ghost" iconOnly aria-label={translate("Edit reminder")} icon={<Pencil />} onClick={onEdit} />
        <Button size="sm" variant="ghost" iconOnly aria-label={translate("Delete reminder")} icon={<Trash2 />} onClick={onDelete} />
      </div>
    </li>
  )
}

export default function RemindersPage() {
  useI18n()
  const navigate = useNavigate()
  const { confirm, dialog } = useConfirm()
  const [day, setDay] = useState(() => todayYmd())
  const [week, setWeek] = useState<ContactReminder[]>([])
  const [earlier, setEarlier] = useState<ContactReminder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ContactReminder | null>(null)

  const today = todayYmd()
  const weekStart = weekStartYmd(day)
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => shiftYmd(weekStart, i)), [weekStart])

  const [loadedKey, setLoadedKey] = useState(weekStart)
  if (weekStart !== loadedKey) {
    setLoadedKey(weekStart)
    setLoading(true)
  }

  // The whole week of the chosen day (for the strip and the day list), and the reminders
  // still open from before today, which would otherwise be on no page at all.
  const fetchAll = (start: string) => Promise.all([
    fetchRemindersBetween(start, shiftYmd(start, 7)),
    fetchRemindersBetween(shiftYmd(todayYmd(), -EARLIER_DAYS), todayYmd()),
  ])
  const apply = ([nextWeek, past]: [ContactReminder[], ContactReminder[]]) => {
    setWeek(nextWeek)
    setEarlier(past.filter((r) => !r.done_at))
    setError(null)
  }
  const fail = (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load reminders')

  const load = useCallback((start: string) => {
    fetchAll(start).then(apply).catch(fail).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchAll(weekStart)
      .then((data) => { if (!cancelled) apply(data) })
      .catch((err) => { if (!cancelled) fail(err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [weekStart])

  useEffect(() => {
    const refresh = () => load(weekStart)
    window.addEventListener('reminders:changed', refresh)
    return () => window.removeEventListener('reminders:changed', refresh)
  }, [weekStart, load])

  const reminders = useMemo(
    () => week.filter((r) => reminderYmd(r.remind_at) === day).sort((a, b) => a.remind_at.localeCompare(b.remind_at)),
    [week, day],
  )
  const perDay = useMemo(() => {
    const map = new Map<string, { open: number; total: number }>()
    for (const r of week) {
      const key = reminderYmd(r.remind_at)
      const entry = map.get(key) || { open: 0, total: 0 }
      entry.total += 1
      if (!r.done_at) entry.open += 1
      map.set(key, entry)
    }
    return map
  }, [week])

  const editContact: Contact | null = editing
    ? { id: editing.contact_id, name: editing.contact_name || 'Contact', phone: editing.contact_phone || '', created_at: '' }
    : null

  const notifyChanged = () => window.dispatchEvent(new Event('reminders:changed'))
  const replace = (saved: ContactReminder) => {
    setWeek((rows) => rows.map((r) => (r.id === saved.id ? saved : r)))
    setEarlier((rows) => rows.map((r) => (r.id === saved.id ? saved : r)))
  }
  const toggle = (reminder: ContactReminder) => {
    void updateReminder(reminder.id, { done: !reminder.done_at }).then((saved) => {
      replace(saved)
      notifyChanged()
    })
  }
  const remove = (reminder: ContactReminder) => {
    void confirm({
      title: translate("Delete reminder?"),
      description: reminder.text,
      confirmLabel: translate("Delete"),
    }).then((ok) => {
      if (!ok) return
      void deleteReminder(reminder.id).then(() => {
        setWeek((rows) => rows.filter((r) => r.id !== reminder.id))
        setEarlier((rows) => rows.filter((r) => r.id !== reminder.id))
        notifyChanged()
      })
    })
  }
  const row = (reminder: ContactReminder, showDate = false) => (
    <ReminderRow
      key={reminder.id}
      reminder={reminder}
      showDate={showDate}
      onToggle={() => toggle(reminder)}
      onEdit={() => setEditing(reminder)}
      onDelete={() => remove(reminder)}
    />
  )

  return (
    <div className="mx-auto w-full max-w-[900px] p-4 pb-24 sm:p-6">
      <PageHeader
        title={translate("Reminders")}
        subtitle={dayLabel(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        actions={
          <div className="flex items-center gap-1.5">
            {day !== today && (
              <Button size="sm" onClick={() => setDay(today)}>{translate("Today")}</Button>
            )}
            <input
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value || todayYmd())}
              className="h-9 rounded-[9px] border border-line-strong bg-white px-2.5 text-sm max-sm:h-11"
              aria-label={translate("Reminder day")}
            />
          </div>
        }
      />

      {/* The week: pick a day; a dot or count shows where reminders are. */}
      <div className="mb-4 flex items-stretch gap-1.5 rounded-xl border border-shop-border bg-white p-1.5 shadow-[var(--shadow-card)]">
        <Button size="sm" variant="ghost" iconOnly aria-label={translate("Previous week")} icon={<ChevronLeft />} onClick={() => setDay((d) => shiftYmd(d, -7))} className="self-center" />
        <ol className="m-0 grid min-w-0 flex-1 list-none grid-cols-7 gap-1 p-0">
          {weekDays.map((ymd) => {
            const on = ymd === day
            const isToday = ymd === today
            const counts = perDay.get(ymd)
            return (
              <li key={ymd}>
                <button
                  type="button"
                  onClick={() => setDay(ymd)}
                  aria-current={on ? 'date' : undefined}
                  aria-label={`${dayLabel(ymd, { weekday: 'long', day: 'numeric', month: 'long' })}${counts ? ` · ${translate('{value0} reminders', { value0: counts.total })}` : ''}`}
                  className={`flex w-full flex-col items-center gap-0.5 rounded-lg py-2 transition-colors ${
                    on ? 'bg-shop-accent text-white shadow-[0_1px_2px_rgb(15_118_110/0.3)]' : 'hover:bg-shop-bg'
                  }`}
                >
                  <span className={`max-w-full truncate px-0.5 text-[11px] font-semibold uppercase ${on ? 'text-white/80' : 'text-shop-muted'}`}>
                    {/* Short names do not fit seven across on a phone (Arabic ones are long). */}
                    <span className="sm:hidden">{dayLabel(ymd, { weekday: 'narrow' })}</span>
                    <span className="max-sm:hidden">{dayLabel(ymd, { weekday: 'short' })}</span>
                  </span>
                  <span className={`text-base font-bold tabular-nums ${!on && isToday ? 'text-shop-accent' : ''}`}>
                    {dayLabel(ymd, { day: 'numeric' })}
                  </span>
                  <span className="flex h-4 items-center">
                    {counts ? (
                      <span className={`rounded-full px-1.5 text-[10px] font-bold tabular-nums ${
                        on ? 'bg-white/20 text-white' : counts.open ? 'bg-tint text-primary-800' : 'bg-neutral-bg text-shop-muted'
                      }`}>{counts.total}</span>
                    ) : isToday && !on ? (
                      <span aria-hidden="true" className="size-1.5 rounded-full bg-shop-accent" />
                    ) : null}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
        <Button size="sm" variant="ghost" iconOnly aria-label={translate("Next week")} icon={<ChevronRight />} onClick={() => setDay((d) => shiftYmd(d, 7))} className="self-center" />
      </div>

      {day === today && earlier.length > 0 && (
        <section aria-labelledby="rem-earlier" className="mb-4 overflow-hidden rounded-xl border border-rose-200 bg-white">
          <h2 id="rem-earlier" className="flex items-center gap-2 border-b border-rose-100 bg-rose-50 px-4 py-2.5 text-[13px] font-bold text-rose-700">
            <AlarmClock className="size-4" aria-hidden="true" />
            {translate("Still open from earlier days")}
            <span className="rounded-full bg-white px-2 text-xs tabular-nums">{earlier.length}</span>
          </h2>
          <ul className="divide-y divide-[#eef1f5]">{earlier.map((r) => row(r, true))}</ul>
        </section>
      )}

      <section className="overflow-hidden rounded-xl border border-shop-border bg-white">
        {loading && <p className="px-4 py-6 text-sm text-shop-muted">{translate("Loading reminders…")}</p>}
        {!loading && error && (
          <EmptyState
            tone="danger"
            icon={<CircleAlert />}
            title={translate("Reminders could not be loaded")}
            description={translate(error)}
            action={<Button variant="primary" onClick={() => load(weekStart)}>{translate("Retry")}</Button>}
          />
        )}
        {!loading && !error && reminders.length === 0 && (
          <EmptyState
            icon={<Bell />}
            title={translate("No reminders for this day")}
            description={translate("Add one from a contact’s menu or profile.")}
            action={
              <Button onClick={() => navigate('/contacts')}>
                {translate("Go to contacts")}
              </Button>
            }
          />
        )}
        {!loading && !error && reminders.length > 0 && (
          <ul className="divide-y divide-[#eef1f5]">{reminders.map((r) => row(r))}</ul>
        )}
      </section>

      <ReminderModal
        open={editing !== null}
        contact={editContact}
        reminder={editing}
        onClose={() => setEditing(null)}
        onSaved={(saved) => {
          setEditing(null)
          load(weekStart)
          replace(saved)
          notifyChanged()
        }}
      />
      {dialog}
    </div>
  )
}
