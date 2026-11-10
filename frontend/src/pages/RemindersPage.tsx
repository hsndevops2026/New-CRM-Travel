import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, ChevronLeft, ChevronRight, CircleAlert, Pencil, Trash2 } from 'lucide-react'
import ReminderModal from '../components/ReminderModal'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import PageHeader from '../components/ui/PageHeader'
import { useConfirm } from '../hooks/useConfirm'
import type { Contact } from '../lib/contacts'
import {
  deleteReminder,
  fetchRemindersForDay,
  formatReminderTime,
  isReminderOverdue,
  shiftYmd,
  todayYmd,
  updateReminder,
  type ContactReminder,
} from '../lib/reminders'

export default function RemindersPage() {
  const { confirm, dialog } = useConfirm()
  const [day, setDay] = useState(() => todayYmd())
  const [reminders, setReminders] = useState<ContactReminder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ContactReminder | null>(null)

  const [loadedDay, setLoadedDay] = useState(day)
  if (day !== loadedDay) {
    setLoadedDay(day)
    setLoading(true)
  }

  const applyDay = useCallback(async (dateYmd: string) => {
    try {
      const next = await fetchRemindersForDay(dateYmd)
      setReminders(next)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reminders')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchRemindersForDay(day)
      .then((next) => {
        if (cancelled) return
        setReminders(next)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load reminders')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [day])

  useEffect(() => {
    const refresh = () => {
      void applyDay(day)
    }
    window.addEventListener('reminders:changed', refresh)
    return () => window.removeEventListener('reminders:changed', refresh)
  }, [day, applyDay])

  const label = (() => {
    const [y, m, d] = day.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  })()

  const editContact: Contact | null = editing
    ? {
        id: editing.contact_id,
        name: editing.contact_name || 'Contact',
        phone: editing.contact_phone || '',
        created_at: '',
      }
    : null

  const notifyChanged = () => window.dispatchEvent(new Event('reminders:changed'))

  return (
    <div className="mx-auto w-full max-w-[900px] p-4 pb-24 sm:p-6">
      <PageHeader
        title="Reminders"
        subtitle={label}
        actions={
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              aria-label="Previous day"
              icon={<ChevronLeft />}
              onClick={() => setDay((d) => shiftYmd(d, -1))}
            />
            <input
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value || todayYmd())}
              className="rounded-md border border-shop-border px-2 py-1.5 text-sm outline-none focus:border-primary-500"
              aria-label="Reminder day"
            />
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              aria-label="Next day"
              icon={<ChevronRight />}
              onClick={() => setDay((d) => shiftYmd(d, 1))}
            />
            {day !== todayYmd() && (
              <Button size="sm" variant="secondary" onClick={() => setDay(todayYmd())}>
                Today
              </Button>
            )}
          </div>
        }
      />

      <section className="overflow-hidden rounded-[10px] border border-shop-border bg-white">
        {loading && <p className="px-3.5 py-6 text-sm text-shop-muted">Loading reminders…</p>}
        {!loading && error && (
          <EmptyState
            tone="danger"
            icon={<CircleAlert />}
            title="Reminders could not be loaded"
            description={error}
            action={<Button variant="primary" onClick={() => void applyDay(day)}>Retry</Button>}
          />
        )}
        {!loading && !error && reminders.length === 0 && (
          <EmptyState
            icon={<Bell />}
            title="No reminders for this day"
            description="Add one from a contact’s menu or profile."
            action={
              <Button variant="secondary" onClick={() => window.location.assign('/contacts')}>
                Go to contacts
              </Button>
            }
          />
        )}
        {!loading && !error && reminders.length > 0 && (
          <ul className="divide-y divide-neutral-bg">
            {reminders.map((reminder) => {
              const overdue = isReminderOverdue(reminder)
              const done = Boolean(reminder.done_at)
              return (
                <li
                  key={reminder.id}
                  className={`flex items-start gap-3 px-3.5 py-3.5 ${
                    overdue ? 'bg-amber-50/70' : done ? 'opacity-70' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={done}
                    aria-label={done ? 'Mark reminder not done' : 'Mark reminder done'}
                    className="mt-1"
                    onChange={() => {
                      void updateReminder(reminder.id, { done: !done }).then((saved) => {
                        setReminders((rows) => rows.map((r) => (r.id === saved.id ? saved : r)))
                        notifyChanged()
                      })
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-xs font-semibold tabular-nums text-shop-muted">
                        {formatReminderTime(reminder.remind_at)}
                      </span>
                      {reminder.contact_name && (
                        <Link
                          to={`/contacts/${reminder.contact_id}`}
                          className="text-sm font-semibold hover:underline"
                        >
                          {reminder.contact_name}
                        </Link>
                      )}
                      {overdue && (
                        <span className="text-[11px] font-bold tracking-wide text-amber-800 uppercase">
                          Overdue
                        </span>
                      )}
                    </div>
                    <p className={`text-sm ${done ? 'line-through text-shop-muted' : ''}`}>{reminder.text}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      iconOnly
                      aria-label="Edit reminder"
                      icon={<Pencil />}
                      onClick={() => setEditing(reminder)}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      iconOnly
                      aria-label="Delete reminder"
                      icon={<Trash2 />}
                      onClick={() => {
                        void confirm({
                          title: 'Delete reminder?',
                          description: reminder.text,
                          confirmLabel: 'Delete',
                        }).then((ok) => {
                          if (!ok) return
                          void deleteReminder(reminder.id).then(() => {
                            setReminders((rows) => rows.filter((r) => r.id !== reminder.id))
                            notifyChanged()
                          })
                        })
                      }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <ReminderModal
        open={editing !== null}
        contact={editContact}
        reminder={editing}
        onClose={() => setEditing(null)}
        onSaved={(saved) => {
          setEditing(null)
          setReminders((rows) => rows.map((r) => (r.id === saved.id ? saved : r)))
          notifyChanged()
        }}
      />
      {dialog}
    </div>
  )
}
