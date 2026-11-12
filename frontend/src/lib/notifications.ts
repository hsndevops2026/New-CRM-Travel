import { apiFetch } from './api'
import { t } from './i18n'

export type NotificationKind = 'new_lead' | 'customer_waiting' | 'human_requested' | 'quote_accepted' | 'reminder_due' | 'task_assigned' | 'task_due' | 'quote_approval_needed' | 'quote_reviewed' | 'travellers_submitted' | 'traveller_message' | 'quote_viewed' | 'lead_waiting' | 'low_rating' | 'deadline_soon' | 'deadline_passed'

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
    case 'task_assigned':
      return {
        title: d.by ? t('New task from {value0}', { value0: String(d.by) }) : t('New task'),
        detail: String(d.text || ''),
      }
    case 'task_due':
      return { title: t('Task deadline passed'), detail: String(d.text || '') }
    case 'quote_approval_needed':
      return {
        title: t('Quote v{value0} needs your approval', { value0: String(d.version_number ?? '') }),
        detail: [d.customer, d.by, d.margin_pct != null ? t('margin {value0}%', { value0: Number(d.margin_pct).toFixed(1) }) : '']
          .filter(Boolean).join(' · '),
      }
    case 'quote_reviewed':
      return d.decision === 'approved'
        ? { title: t('Quote v{value0} approved, you can send it', { value0: String(d.version_number ?? '') }), detail: String(d.by || '') }
        : { title: t('Changes requested on quote v{value0}', { value0: String(d.version_number ?? '') }), detail: String(d.note || '') }
    case 'travellers_submitted':
      return {
        title: t('The customer sent the travellers\' details ({value0})', { value0: String(d.count ?? '') }),
        detail: Number(d.problems) ? t('{value0} passport problem(s)', { value0: String(d.problems) }) : '',
      }
    case 'traveller_message':
      return { title: t('Message from a customer travelling now ({value0})', { value0: String(d.destination || '') }), detail: String(d.preview || '') }
    case 'quote_viewed':
      return { title: t('{value0} opened the quote', { value0: who || t('The customer') }), detail: d.version_number ? t('Version {value0}', { value0: String(d.version_number) }) : '' }
    case 'lead_waiting':
      return {
        title: t('{value0} has been waiting {value1} min with no reply', { value0: who || t('A new customer'), value1: String(d.minutes ?? '') }),
        detail: String(d.destination || ''),
      }
    case 'low_rating':
      return {
        title: t('{value0} rated the trip {value1}/5', { value0: who || t('A customer'), value1: String(d.rating ?? '') }),
        detail: String(d.destination || ''),
      }
    case 'deadline_soon':
      return { title: t('Deadline in less than 48 hours'), detail: String(d.text || '') }
    case 'deadline_passed':
      return { title: t('A deadline has passed'), detail: String(d.text || '') }
    case 'reminder_due':
      return { title: t('Reminder: {value0}', { value0: who }), detail: String(d.text || '') }
    default:
      return { title: t('Notification'), detail: '' }
  }
}

export function notificationLink(n: StaffNotification): string | null {
  if (n.kind === 'task_assigned' || n.kind === 'task_due') return '/tasks'
  if (n.lead_id) return `/leads/${n.lead_id}`
  if (n.contact_id) return `/contacts/${n.contact_id}`
  return null
}
