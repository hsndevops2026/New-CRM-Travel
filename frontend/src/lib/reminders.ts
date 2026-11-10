import { locale } from './i18n'
import { apiFetch } from './api'

export type ContactReminder = {
  id: string
  contact_id: string
  text: string
  remind_at: string
  done_at: string | null
  notify_customer?: boolean
  sent_at?: string | null
  created_by?: string | null
  created_at: string
  contact_name?: string
  contact_phone?: string
}

export type ReminderInput = {
  text: string
  remind_at: string
  notify_customer?: boolean
}

/** Local calendar day bounds as ISO strings for the reminders range API. */
export function dayBounds(dateYmd: string): { from: string; to: string } {
  const [y, m, d] = dateYmd.split('-').map(Number)
  const start = new Date(y, m - 1, d, 0, 0, 0, 0)
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0)
  return { from: start.toISOString(), to: end.toISOString() }
}

export function todayYmd(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function shiftYmd(dateYmd: string, days: number) {
  const [y, m, d] = dateYmd.split('-').map(Number)
  const next = new Date(y, m - 1, d + days)
  return todayYmd(next)
}

export function splitRemindAt(iso: string): { date: string; time: string } {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return { date: todayYmd(), time: '09:00' }
  }
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return { date: `${y}-${m}-${d}`, time: `${hh}:${mm}` }
}

export function combineRemindAt(dateYmd: string, timeHm: string): string {
  const [y, m, d] = dateYmd.split('-').map(Number)
  const [hh, mm] = timeHm.split(':').map(Number)
  return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0).toISOString()
}

export function formatReminderTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
}

export function isReminderOverdue(reminder: ContactReminder, now = new Date()) {
  if (reminder.done_at) return false
  return new Date(reminder.remind_at).getTime() < now.getTime()
}

export async function fetchRemindersForDay(dateYmd: string): Promise<ContactReminder[]> {
  const { from, to } = dayBounds(dateYmd)
  const params = new URLSearchParams({ from, to })
  const response = await apiFetch(`/api/reminders?${params.toString()}`)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to load reminders')
  return (data.reminders || []) as ContactReminder[]
}

export async function fetchContactReminders(contactId: string): Promise<ContactReminder[]> {
  const response = await apiFetch(`/api/contacts/${contactId}/reminders`)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to load reminders')
  return (data.reminders || []) as ContactReminder[]
}

export async function createReminder(contactId: string, input: ReminderInput): Promise<ContactReminder> {
  const response = await apiFetch(`/api/contacts/${contactId}/reminders`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to create reminder')
  return data.reminder as ContactReminder
}

export async function updateReminder(
  id: string,
  patch: Partial<ReminderInput> & { done?: boolean },
): Promise<ContactReminder> {
  const response = await apiFetch(`/api/reminders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to update reminder')
  return data.reminder as ContactReminder
}

export async function deleteReminder(id: string): Promise<void> {
  const response = await apiFetch(`/api/reminders/${id}`, { method: 'DELETE' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Failed to delete reminder')
}
