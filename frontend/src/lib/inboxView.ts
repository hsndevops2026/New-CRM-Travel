import type { ChatMessage, Thread, ThreadKind } from './inbox'

export type InboxFilter = 'all' | ThreadKind

export function filterThreads(threads: Thread[], filter: InboxFilter): Thread[] {
  return filter === 'all' ? threads : threads.filter((t) => t.kind === filter)
}

/** How many conversations each filter pill would show. */
export function threadCounts(threads: Thread[]): Record<InboxFilter, number> {
  const count = (kind: ThreadKind) => threads.filter((t) => t.kind === kind).length
  return { all: threads.length, customer: count('customer'), dealer: count('dealer'), group: count('group') }
}

/** "SA" for "Sarah Ahmed"; "#" for a bare phone number, which has no name to abbreviate. */
export function threadInitials(title: string): string {
  const words = String(title || '').trim().split(/\s+/).filter(Boolean)
  const letters = words.filter((w) => /\p{L}/u.test(w[0]))
  if (!letters.length) return '#'
  return letters
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

/** The last message as a list preview, marked "You:" when the agency wrote it. */
export function threadPreview(thread: Pick<Thread, 'last_message' | 'last_direction'>): string {
  const text = String(thread.last_message || '').replace(/\s+/g, ' ').trim()
  if (!text) return 'No messages yet'
  return thread.last_direction === 'outbound' ? `You: ${text}` : text
}

/** Customer threads can exist without a lead (a number that only said hello). */
export function hasLead(thread: Pick<Thread, 'kind' | 'lead_id'>): boolean {
  return Boolean(thread.lead_id)
}

export type BubbleState = {
  /** Text under the bubble: time, plus delivery for messages we sent. */
  delivery: 'none' | 'sent' | 'delivered' | 'failed'
}

/** Messages we sent show how far they got; ones we received show nothing. */
export function bubbleDelivery(msg: Pick<ChatMessage, 'direction' | 'status'>): BubbleState['delivery'] {
  if (msg.direction !== 'outbound') return 'none'
  if (msg.status === 'failed') return 'failed'
  if (msg.status === 'delivered' || msg.status === 'read') return 'delivered'
  return 'sent'
}

/** Canned replies the composer offers on a customer conversation. */
export const QUICK_REPLIES: Array<{ id: string; label: string; text: string }> = [
  { id: 'dates', label: 'Confirm dates', text: 'Could you please confirm your travel dates?' },
  { id: 'names', label: 'Ask for passport names', text: 'Could you share the full names of all travellers exactly as they appear on the passports?' },
  { id: 'link', label: 'Share quote link', text: 'Here is your quote — you can review it, download the PDF and accept it online:' },
]
