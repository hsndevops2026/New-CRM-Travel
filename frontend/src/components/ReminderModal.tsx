import { t as translate, useI18n } from '../lib/i18n'
import { useId, useState, type FormEvent } from 'react'
import Button from './ui/Button'
import Field from './ui/Field'
import ModalDrawer from './ui/ModalDrawer'
import type { Contact } from '../lib/contacts'
import {
  combineRemindAt,
  createReminder,
  splitRemindAt,
  todayYmd,
  updateReminder,
  type ContactReminder,
} from '../lib/reminders'

type Props = {
  open: boolean
  contact: Contact | null
  reminder?: ContactReminder | null
  onClose: () => void
  onSaved: (reminder: ContactReminder) => void
}

export default function ReminderModal({ open, contact, reminder, onClose, onSaved }: Props) {
  useI18n()
  const textId = useId()
  const dateId = useId()
  const timeId = useId()
  const notifyId = useId()
  const sessionKey = open ? `${contact?.id || ''}:${reminder?.id || 'new'}` : null
  const initial = reminder ? splitRemindAt(reminder.remind_at) : { date: todayYmd(), time: '09:00' }
  const [formKey, setFormKey] = useState(sessionKey)
  const [text, setText] = useState(reminder?.text || '')
  const [date, setDate] = useState(initial.date)
  const [time, setTime] = useState(initial.time)
  const [notifyCustomer, setNotifyCustomer] = useState(reminder?.notify_customer === true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (sessionKey !== formKey) {
    setFormKey(sessionKey)
    setError(null)
    setText(reminder?.text || '')
    const next = reminder ? splitRemindAt(reminder.remind_at) : { date: todayYmd(), time: '09:00' }
    setDate(next.date)
    setTime(next.time)
    setNotifyCustomer(reminder?.notify_customer === true)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!contact) return
    if (!text.trim()) {
      setError('Enter a reminder')
      return
    }
    if (!date || !time) {
      setError('Pick a date and time')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        text: text.trim(),
        remind_at: combineRemindAt(date, time),
        notify_customer: notifyCustomer,
      }
      const saved = reminder
        ? await updateReminder(reminder.id, payload)
        : await createReminder(contact.id, payload)
      onSaved(saved)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save reminder')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalDrawer
      open={open}
      title={reminder ? translate("Edit reminder") : translate("Add reminder")}
      subtitle={contact ? translate("For {value0}", { value0: translate(String(contact.name)) }) : undefined}
      onClose={onClose}
      maxWidthClassName="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {translate("Cancel")}</Button>
          <Button variant="primary" type="submit" form="reminder-form" disabled={saving || !contact}>
            {saving ? translate("Saving…") : reminder ? translate("Save changes") : translate("Add reminder")}
          </Button>
        </div>
      }
    >
      <form id="reminder-form" onSubmit={(e) => void submit(e)} className="grid gap-4">
        <Field label={translate("Reminder")} htmlFor={textId} error={error && !text.trim() ? error : null}>
          <textarea
            id={textId}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-shop-border px-3 py-2 text-sm outline-none focus:border-primary-500"
            placeholder={translate("Follow up about hotel confirmation…")}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={translate("Date")} htmlFor={dateId}>
            <input
              id={dateId}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-md border border-shop-border px-3 py-2 text-sm outline-none focus:border-primary-500"
            />
          </Field>
          <Field label={translate("Time")} htmlFor={timeId}>
            <input
              id={timeId}
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-full rounded-md border border-shop-border px-3 py-2 text-sm outline-none focus:border-primary-500"
            />
          </Field>
        </div>
        <label htmlFor={notifyId} className="flex items-start gap-2 text-sm text-shop-ink">
          <input
            id={notifyId}
            type="checkbox"
            checked={notifyCustomer}
            onChange={(e) => setNotifyCustomer(e.target.checked)}
            disabled={reminder?.sent_at != null}
            className="mt-0.5"
          />
          <span>
            {translate('Also send this to {value0} on WhatsApp at the reminder time', {
              value0: contact?.name || translate('the customer'),
            })}
            <span className="block text-xs text-shop-muted">
              {reminder?.sent_at
                ? translate('Already sent to the customer.')
                : translate('Leave unticked for an internal note that only staff see.')}
            </span>
          </span>
        </label>
        {error && text.trim() ? <p className="text-sm text-red-600">{translate(error)}</p> : null}
      </form>
    </ModalDrawer>
  )
}
