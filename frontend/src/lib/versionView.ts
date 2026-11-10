import type { QuoteDelivery, QuoteVersion } from './quoteVersions'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')

/** "14:05" for today, "21 Oct, 13:58" for any other day. */
export function eventTime(iso: string | null | undefined, now: Date): string {
  const d = iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return '—'
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  return sameDay ? clock : `${d.getDate()} ${MONTHS[d.getMonth()]}, ${clock}`
}

/** The version the customer should be looking at: the newest one that has not been revoked. */
export function currentVersion(versions: QuoteVersion[]): QuoteVersion | null {
  const live = versions.filter((v) => v.status !== 'revoked')
  if (!live.length) return null
  return live.reduce((best, v) => (v.version_number > best.version_number ? v : best))
}

/** "Turkish Airlines direct · Bosphorus Grand Hotel" — what the version contains. */
export function versionSummary(version: Pick<QuoteVersion, 'snapshot'>, max = 3): string {
  const labels = (version.snapshot?.items ?? []).map((i) => i.label).filter(Boolean)
  if (!labels.length) return ''
  const shown = labels.slice(0, max).join(' · ')
  return labels.length > max ? `${shown} · +${labels.length - max} more` : shown
}

export type DeliveryTone = 'success' | 'danger' | 'warning' | 'neutral'
export type DeliveryEvent = { id: string; title: string; detail: string; tone: DeliveryTone; failed: boolean; at: string }

const CHANNEL: Record<string, string> = { whatsapp: 'WhatsApp', email: 'Email' }

/** One delivery as a line of the history: what happened, to whom, and how it ended. */
export function deliveryEvent(delivery: QuoteDelivery, now: Date): DeliveryEvent {
  const channel = CHANNEL[delivery.channel] || delivery.channel
  const at = delivery.sent_at || delivery.created_at
  const when = eventTime(at, now)
  const base = `${when} · ${delivery.recipient}`
  switch (delivery.status) {
    case 'failed':
      return {
        id: delivery.id,
        title: `${channel} failed`,
        detail: delivery.error_message ? `${base} · ${delivery.error_message}` : base,
        tone: 'danger',
        failed: true,
        at,
      }
    case 'delivered':
      return { id: delivery.id, title: `${channel} delivered`, detail: base, tone: 'success', failed: false, at }
    case 'pending':
      return { id: delivery.id, title: `${channel} sending…`, detail: base, tone: 'warning', failed: false, at }
    default:
      return { id: delivery.id, title: `${channel} sent`, detail: base, tone: 'neutral', failed: false, at }
  }
}

/** Newest first, with the version's own creation as the last line. */
export function deliveryTimeline(version: QuoteVersion, deliveries: QuoteDelivery[], now: Date) {
  const events = deliveries.map((d) => deliveryEvent(d, now)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  const created = {
    id: `created-${version.id}`,
    title: `v${version.version_number} created`,
    detail: eventTime(version.created_at, now),
    tone: 'neutral' as DeliveryTone,
    failed: false,
    at: version.created_at,
  }
  return [...events, created]
}

/**
 * The API calls a freshly locked version 'sent' even before anything has gone out; whether it
 * was actually delivered is the delivery history's job. Say what the version is: locked.
 */
export function versionStatusLabel(status: string): string {
  return status === 'sent' ? 'locked' : status
}
