import { t } from './i18n'
type Meta = Record<string, unknown> | null | undefined

export type ItemKind = 'flight' | 'hotel' | 'other'

/** What kind of thing a quote line is, from the customer-safe fields the API exposes. */
export function itemKind(meta: Meta): ItemKind {
  if (!meta) return 'other'
  if (meta.airline) return 'flight'
  if (meta.hotel_name || meta.room_type || meta.board_name || meta.check_in) return 'hotel'
  return 'other'
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)

/** "Free cancellation until 5 Dec" lines to show under Terms, one per quote item that has them. */
export function cancellationTerms(
  items: Array<{ label: string; meta?: Meta }>,
): Array<{ label: string; text: string }> {
  const out: Array<{ label: string; text: string }> = []
  for (const item of items) {
    const terms = text(item.meta?.cancellation_policy) ?? text(item.meta?.cancellation_terms)
    if (terms) out.push({ label: item.label, text: terms })
  }
  return out
}

/** "2 adults, 1 child" — the quote's travellers for a customer. */
export function travellersText(adults?: number | null, children?: number | null): string | null {
  const a = Number(adults) || 0
  const c = Number(children) || 0
  if (!a && !c) return null
  const parts: string[] = []
  if (a) parts.push(a === 1 ? t('1 adult') : t('{value0} adults', { value0: a }))
  if (c) parts.push(c === 1 ? t('1 child') : t('{value0} children', { value0: c }))
  return parts.join(t(', '))
}

/** A wa.me link for the agency's number, or null if there is no usable number. */
export function whatsappLink(phone?: string | null, message?: string): string | null {
  const digits = String(phone ?? '').replace(/\D/g, '')
  if (digits.length < 6) return null
  return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ''}`
}

/** "Sarah Ahmed" → "Sarah". */
export function firstName(name?: string | null): string {
  return String(name ?? '').trim().split(/\s+/)[0] ?? ''
}

/**
 * Why a link did not open. The API answers "invalid, expired, or revoked" for all three, so the
 * message names the likely causes and the one next step that helps, rather than guessing which.
 */
export function linkProblem(): { title: string; body: string } {
  return {
    title: 'This quote link isn’t available',
    body: 'It may have expired, been mistyped, or been replaced by a newer quote. Ask your agent to send the latest link.',
  }
}
