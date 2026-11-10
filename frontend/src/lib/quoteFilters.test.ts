import { describe, expect, it } from 'vitest'
import {
  classifyRoomType,
  EMPTY_QUOTE_FILTERS,
  filterHotelQuotes,
  parseStars,
} from './quoteFilters'

describe('parseStars', () => {
  it('reads Hotelbeds and Booking.com category labels', () => {
    expect(parseStars('4 STARS')).toBe(4)
    expect(parseStars('4 star')).toBe(4)
    expect(parseStars('5EST')).toBe(5)
  })
})

describe('classifyRoomType', () => {
  it('detects single and double room names', () => {
    expect(classifyRoomType('Standard Single Room')).toBe('single')
    expect(classifyRoomType('DBL Deluxe Sea View')).toBe('double')
    expect(classifyRoomType('Twin Garden')).toBe('double')
  })
})

describe('filterHotelQuotes', () => {
  const quotes = [
    {
      id: 'a',
      category: '4 STARS',
      room_name: 'Double Deluxe',
      free_cancellation: true,
      refundable: true,
      details: [
        {
          room_name: 'Double Deluxe',
          free_cancellation: true,
          refundable: true,
          rate_class: 'NOR',
        },
        {
          room_name: 'Single Standard',
          free_cancellation: false,
          refundable: false,
          rate_class: 'NRF',
        },
      ],
    },
    {
      id: 'b',
      category: '3 STARS',
      room_name: 'Single',
      free_cancellation: false,
      refundable: false,
      details: [],
    },
  ]

  it('filters custom quotes down to matching room rates', () => {
    const filtered = filterHotelQuotes(quotes, {
      ...EMPTY_QUOTE_FILTERS,
      stars: [4],
      roomType: 'double',
      freeCancellation: 'yes',
      refundable: 'yes',
    })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].id).toBe('a')
    expect(filtered[0].details).toHaveLength(1)
    expect(filtered[0].details?.[0].room_name).toBe('Double Deluxe')
  })

  it('keeps a 3-star non-refundable single in view quotes', () => {
    const filtered = filterHotelQuotes(quotes, {
      ...EMPTY_QUOTE_FILTERS,
      stars: [3],
      roomType: 'single',
      refundable: 'no',
    })
    expect(filtered.map((quote) => quote.id)).toEqual(['b'])
  })
})
