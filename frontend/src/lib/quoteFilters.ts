export type QuoteFilters = {
  stars: number[]
  freeCancellation: 'any' | 'yes' | 'no'
  refundable: 'any' | 'yes' | 'no'
  roomType: 'any' | 'single' | 'double'
}

export const EMPTY_QUOTE_FILTERS: QuoteFilters = {
  stars: [],
  freeCancellation: 'any',
  refundable: 'any',
  roomType: 'any',
}

export function quoteFiltersActive(filters: QuoteFilters) {
  return (
    filters.stars.length > 0 ||
    filters.freeCancellation !== 'any' ||
    filters.refundable !== 'any' ||
    filters.roomType !== 'any'
  )
}

export function parseStars(category?: string | null): number | null {
  if (!category) return null
  const text = String(category)
  const match =
    text.match(/([1-5])\s*(?:\*|stars?|estrellas?|est)/i) ||
    text.match(/\b([1-5])\b/)
  const n = match ? Number(match[1]) : NaN
  return n >= 1 && n <= 5 ? n : null
}

export function classifyRoomType(roomName?: string | null): 'single' | 'double' | 'other' {
  const name = String(roomName || '').toLowerCase()
  if (!name.trim()) return 'other'
  if (/\b(single|sgl|individual|1\s*pax|one\s*person)\b/.test(name)) return 'single'
  if (/\b(double|dbl|twin|queen|king|matrimonial|2\s*pax|two\s*person)\b/.test(name)) return 'double'
  return 'other'
}

function isRefundable(item: {
  refundable?: boolean | null
  free_cancellation?: boolean | null
  rate_class?: string | null
  cancellation_summary?: string | null
}): boolean | null {
  if (item.refundable != null) return Boolean(item.refundable)
  if (String(item.rate_class || '').toUpperCase() === 'NRF') return false
  if (/\bnon[-\s]?refundable\b/i.test(String(item.cancellation_summary || ''))) return false
  if (item.free_cancellation) return true
  return null
}

type FilterableRate = {
  category?: string | null
  room_name?: string | null
  free_cancellation?: boolean | null
  refundable?: boolean | null
  rate_class?: string | null
  cancellation_summary?: string | null
}

export function matchesQuoteFilters(item: FilterableRate, filters: QuoteFilters): boolean {
  if (filters.stars.length && !filters.stars.includes(parseStars(item.category) ?? -1)) {
    return false
  }

  if (filters.freeCancellation === 'yes' && !item.free_cancellation) return false
  if (filters.freeCancellation === 'no' && item.free_cancellation) return false

  const refundable = isRefundable(item)
  if (filters.refundable === 'yes' && refundable !== true) return false
  if (filters.refundable === 'no' && refundable !== false) return false

  if (filters.roomType !== 'any' && classifyRoomType(item.room_name) !== filters.roomType) {
    return false
  }

  return true
}

type HotelLike = FilterableRate & {
  details?: FilterableRate[] | null
  [key: string]: unknown
}

export function filterHotelQuotes<T extends HotelLike>(quotes: T[], filters: QuoteFilters): T[] {
  if (!quoteFiltersActive(filters)) return quotes

  return quotes.flatMap((quote) => {
    if (filters.stars.length && !filters.stars.includes(parseStars(quote.category) ?? -1)) {
      return []
    }

    const details = Array.isArray(quote.details) ? quote.details : []
    if (details.length) {
      const nextDetails = details.filter((detail) =>
        matchesQuoteFilters({ ...detail, category: detail.category || quote.category }, filters),
      )
      if (!nextDetails.length) return []
      return [{ ...quote, details: nextDetails }]
    }

    return matchesQuoteFilters(quote, filters) ? [quote] : []
  })
}
