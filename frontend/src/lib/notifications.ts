import { apiFetch } from './api'
import { t } from './i18n'

export type NotificationKind = 'new_lead' | 'customer_waiting' | 'human_requested' | 'quote_accepted' | 'reminder_due'

export type StaffNotification = {
  id: string
  kind: NotificationKind
  lead_id: string | null
  contact_id: string | null
  data: Record<string, string | number | null | undefined>
  count: number
  read_at: string | null
  created_at: string
}

type ListResponse = { notifications: StaffNotification[]; unread: number }

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to load notifications')
  return data as T
}

export async function fetchNotifications() {
  return json<ListResponse>(await apiFetch('/api/notifications'))
}

export async function markNotificationsRead(input: { ids?: string[]; all?: boolean }) {
  return json<ListResponse>(await apiFetch('/api/notifications/read', { method: 'POST', body: JSON.stringify(input) }))
}

const SOURCE: Record<string, string> = { web: 'website', whatsapp: 'WhatsApp' }

/** The line shown for a notification, in the current language. */
export function notificationText(n: StaffNotification): { title: string; detail: string } {
  const d = n.data || {}
  const who = String(d.customer || '')
  switch (n.kind) {
    case 'new_lead':
      return {
        title: t('New request from {value0}', { value0: who }),
        detail: [d.destination, d.source ? t('via {value0}', { value0: t(SOURCE[String(d.source)] || String(d.source)) }) : '']
          .filter(Boolean).join(' · '),
      }
    case 'customer_waiting':
      return {
        title: n.count > 1
          ? t('{value0} sent {value1} messages while the AI is paused', { value0: who, value1: n.count })
          : t('{value0} wrote while the AI is paused', { value0: who }),
        detail: String(d.preview || ''),
      }
    case 'human_requested':
      return { title: t('{value0} asked to talk to a person', { value0: who }), detail: String(d.preview || '') }
    case 'quote_accepted':
      return { title: t('{value0} accepted the quote', { value0: who }), detail: String(d.destination || '') }
    case 'reminder_due':
      return { title: t('Reminder: {value0}', { value0: who }), detail: String(d.text || '') }
    default:
      return { title: t('Notification'), detail: '' }
  }
}

export function notificationLink(n: StaffNotification): string | null {
  if (n.lead_id) return `/leads/${n.lead_id}`
  if (n.contact_id) return `/contacts/${n.contact_id}`
  return null
}
