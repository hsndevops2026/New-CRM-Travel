import type { PredefinedQuoteImport, PredefinedQuoteInput, PredefinedQuoteItem } from './predefinedQuotes'

/**
 * Packages waiting for review, in the order they were printed: brochures oldest first, and
 * within a brochure by position (a 12-page rate sheet reads page 1 → page 12, not shuffled).
 */
export function carouselOrder(imports: PredefinedQuoteImport[]): PredefinedQuoteImport[] {
  const firstSeen = new Map<string, number>()
  const key = (r: PredefinedQuoteImport) => r.batch_id || r.id
  for (const record of imports) {
    const at = Date.parse(record.created_at)
    const known = firstSeen.get(key(record))
    if (known === undefined || at < known) firstSeen.set(key(record), Number.isFinite(at) ? at : 0)
  }
  return [...imports].sort((a, b) => {
    const byBrochure = (firstSeen.get(key(a)) ?? 0) - (firstSeen.get(key(b)) ?? 0)
    if (byBrochure !== 0) return byBrochure
    if (key(a) !== key(b)) return key(a).localeCompare(key(b))
    return (a.batch_index ?? 0) - (b.batch_index ?? 0)
  })
}

/** "3-4" → "Pages 3–4", "7" → "Page 7", nothing → null (older imports have no page info). */
export function pageLabel(sourcePages: string | null | undefined): string | null {
  const text = String(sourcePages ?? '').trim()
  if (!text) return null
  return /[-,–]/.test(text) ? `Pages ${text.replace(/-/g, '–')}` : `Page ${text}`
}

/** After removing the slide at `index`, which slide to show: the next one, else the last. */
export function indexAfterRemoval(index: number, remaining: number): number {
  if (remaining <= 0) return 0
  return Math.min(index, remaining - 1)
}

export type OfferRow = {
  key: string
  kind: 'hotel' | 'flight'
  /** What it is: hotel name, or "Turkish Airlines TK123". */
  title: string
  /** Room / board, or the flight's route. */
  detail: string
  /** Stay dates or departure time. */
  when: string
  price: number | null
  currency: string
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function shortDate(value: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''))
  if (!match) return null
  return `${Number(match[3])} ${SHORT_MONTHS[Number(match[2]) - 1]}`
}

/** "12 Dec → 18 Dec" for a stay; just the date that exists when only one does. */
export function stayDates(item: Pick<PredefinedQuoteItem, 'check_in' | 'check_out'>): string {
  const from = shortDate(item.check_in)
  const to = shortDate(item.check_out)
  if (from && to) return from === to ? from : `${from} → ${to}`
  return from || to || ''
}

/**
 * One row per offer. A hotel with several offers (different room types, boards or date
 * ranges) is several rows, which is exactly how the carousel shows them.
 */
export function offerRows(payload: Pick<PredefinedQuoteInput, 'items' | 'currency'> | null | undefined): OfferRow[] {
  return (payload?.items ?? []).map((item, index) => {
    const currency = item.currency || payload?.currency || 'USD'
    if (item.item_type === 'flight') {
      const route = [item.departure_airport || item.departure_city, item.arrival_airport || item.arrival_city]
        .filter(Boolean)
        .join(' → ')
      return {
        key: `${index}-flight`,
        kind: 'flight' as const,
        title: [item.airline, item.flight_number].filter(Boolean).join(' ') || item.title || 'Flight',
        detail: [item.direction, route].filter(Boolean).join(' · '),
        when: [shortDate(item.departure_time), item.departure_time?.slice(11, 16)].filter(Boolean).join(' '),
        price: item.price ?? null,
        currency,
      }
    }
    const nights = item.nights ? `${item.nights} night${item.nights === 1 ? '' : 's'}` : ''
    return {
      key: `${index}-hotel`,
      kind: 'hotel' as const,
      title: item.hotel_name || item.title || 'Hotel',
      detail: [item.room_name, item.board_name].filter(Boolean).join(' · '),
      when: [stayDates(item), nights].filter(Boolean).join(' · '),
      price: item.price ?? null,
      currency,
    }
  })
}

/** Why a package can't be approved as extracted — the server's rules, caught before the request. */
export function approvalProblems(payload: PredefinedQuoteInput | null | undefined): string[] {
  if (!payload) return ['Nothing was extracted from this page']
  const problems: string[] = []
  if (!String(payload.title ?? '').trim()) problems.push('Title is missing')
  if (!(payload.items ?? []).length) problems.push('No hotel or flight offers were found')
  if (payload.travel_date && payload.return_date && payload.return_date < payload.travel_date) {
    problems.push('Return date is before the travel date')
  }
  return problems
}

/** The distinct hotels in a package, so "2 hotels · 5 offers" can be said. */
export function summaryCounts(payload: Pick<PredefinedQuoteInput, 'items'> | null | undefined) {
  const items = payload?.items ?? []
  const hotels = new Set(items.filter((i) => i.item_type === 'hotel').map((i) => (i.hotel_name || i.title || '').trim().toLowerCase()))
  hotels.delete('')
  return {
    offers: items.length,
    hotels: hotels.size,
    flights: items.filter((i) => i.item_type === 'flight').length,
  }
}
