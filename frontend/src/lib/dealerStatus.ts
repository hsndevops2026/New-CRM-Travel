import type { DealerRequest, DealerResponse } from './dealers'

export type RequestState = {
  label: string
  tone: 'success' | 'warning' | 'danger' | 'neutral'
}

/** "26 min", "3 h", "2 d" — how long something has been waiting. */
export function waitingFor(sinceIso: string | null | undefined, now: number): string | null {
  const since = sinceIso ? Date.parse(sinceIso) : NaN
  if (!Number.isFinite(since)) return null
  const minutes = Math.max(0, Math.round((now - since) / 60000))
  if (minutes < 60) return `${Math.max(1, minutes)} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} h`
  return `${Math.floor(hours / 24)} d`
}

/**
 * What a sent RFQ is doing, in words and colour: replied (teal), waiting (amber), or past its
 * deadline with no reply (red). Anything the API reports that we don't know is shown as-is.
 */
export function requestState(req: DealerRequest, replies: DealerResponse[], now: number): RequestState {
  if (req.status === 'replied' || replies.length > 0) return { label: 'Replied', tone: 'success' }
  if (req.status === 'sent') {
    const deadline = req.deadline_at ? Date.parse(req.deadline_at) : NaN
    if (Number.isFinite(deadline) && deadline < now) return { label: 'No reply · past deadline', tone: 'danger' }
    const waited = waitingFor(req.sent_at || req.created_at, now)
    return { label: waited ? `Waiting · ${waited}` : 'Waiting', tone: 'warning' }
  }
  const text = String(req.status || 'unknown').replace(/_/g, ' ')
  return { label: text.charAt(0).toUpperCase() + text.slice(1), tone: 'neutral' }
}

/** The price a dealer quoted, as "USD 1,860", or null when the reply had none. */
export function offerPrice(reply: Pick<DealerResponse, 'extracted'> | undefined): string | null {
  const ext = reply?.extracted
  const value = ext?.total_price ?? ext?.price_per_night
  if (value == null || value === '') return null
  const amount = Number(value)
  const currency = String(ext?.currency || 'USD')
  if (!Number.isFinite(amount)) return String(value)
  return `${currency} ${Math.round(amount).toLocaleString()}`
}
