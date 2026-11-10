import { describe, expect, it } from 'vitest'
import type { PredefinedQuoteImport, PredefinedQuoteInput } from './predefinedQuotes'
import { approvalProblems, carouselOrder, indexAfterRemoval, offerRows, pageLabel, stayDates, summaryCounts } from './importCarousel'

const rec = (id: string, over: Partial<PredefinedQuoteImport> = {}): PredefinedQuoteImport => ({
  id, file_name: 'rates.pdf', file_hash: id, file_size: 1, status: 'needs_review', warnings: [], created_at: '2026-10-01T10:00:00Z', ...over,
})

describe('carouselOrder', () => {
  it('keeps a brochure together and in printed order, brochures oldest first', () => {
    const list = [
      rec('b2', { batch_id: 'B', batch_index: 1, created_at: '2026-10-02T10:00:00Z' }),
      rec('a3', { batch_id: 'A', batch_index: 2 }),
      rec('b1', { batch_id: 'B', batch_index: 0, created_at: '2026-10-02T10:00:00Z' }),
      rec('a1', { batch_id: 'A', batch_index: 0 }),
      rec('a2', { batch_id: 'A', batch_index: 1 }),
    ]
    expect(carouselOrder(list).map((r) => r.id)).toEqual(['a1', 'a2', 'a3', 'b1', 'b2'])
  })
  it('treats an import with no batch as its own brochure', () => {
    const list = [rec('new', { created_at: '2026-10-05T00:00:00Z' }), rec('old', { created_at: '2026-10-01T00:00:00Z' })]
    expect(carouselOrder(list).map((r) => r.id)).toEqual(['old', 'new'])
  })
  it('does not change the list it was given', () => {
    const list = [rec('b', { batch_id: 'B', batch_index: 1 }), rec('a', { batch_id: 'B', batch_index: 0 })]
    carouselOrder(list)
    expect(list.map((r) => r.id)).toEqual(['b', 'a'])
  })
})

describe('pageLabel', () => {
  it('names a page or a range, and says nothing when unknown', () => {
    expect(pageLabel('7')).toBe('Page 7')
    expect(pageLabel('3-4')).toBe('Pages 3–4')
    expect(pageLabel('2,5')).toBe('Pages 2,5')
    expect(pageLabel('')).toBeNull()
    expect(pageLabel(null)).toBeNull()
  })
})

describe('indexAfterRemoval', () => {
  it('stays put (showing the next slide), steps back from the end, and resets when empty', () => {
    expect(indexAfterRemoval(2, 5)).toBe(2)
    expect(indexAfterRemoval(4, 4)).toBe(3)
    expect(indexAfterRemoval(0, 0)).toBe(0)
  })
})

describe('offerRows', () => {
  const payload: PredefinedQuoteInput = {
    title: 'Mövenpick Taba', currency: 'USD',
    items: [
      { item_type: 'hotel', hotel_name: 'Mövenpick Taba', room_name: 'Standard', board_name: 'HB', check_in: '2026-07-01', check_out: '2026-09-15', nights: 76, price: 120 },
      { item_type: 'hotel', hotel_name: 'Mövenpick Taba', room_name: 'Sea view', board_name: 'FB', check_in: '2026-09-16', nights: 1, price: 150, currency: 'EUR' },
      { item_type: 'flight', airline: 'Turkish Airlines', flight_number: 'TK123', departure_airport: 'DXB', arrival_airport: 'IST', departure_time: '2026-12-12T08:35:00', direction: 'outbound', price: 400 },
    ],
  }

  it('makes one row per offer, so a hotel with several offers shows each', () => {
    const rows = offerRows(payload)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ kind: 'hotel', title: 'Mövenpick Taba', detail: 'Standard · HB', when: '1 Jul → 15 Sep · 76 nights', price: 120, currency: 'USD' })
    expect(rows[1]).toMatchObject({ detail: 'Sea view · FB', when: '16 Sep · 1 night', currency: 'EUR' })
  })

  it('describes a flight by airline, route and time', () => {
    expect(offerRows(payload)[2]).toMatchObject({ kind: 'flight', title: 'Turkish Airlines TK123', detail: 'outbound · DXB → IST', when: '12 Dec 08:35', price: 400 })
  })

  it('copes with missing details and with nothing at all', () => {
    expect(offerRows({ items: [{ item_type: 'hotel' }] })[0]).toMatchObject({ title: 'Hotel', detail: '', when: '', price: null, currency: 'USD' })
    expect(offerRows(null)).toEqual([])
  })
})

describe('stayDates', () => {
  it('shows what exists', () => {
    expect(stayDates({ check_in: '2026-07-01', check_out: '2026-07-05' })).toBe('1 Jul → 5 Jul')
    expect(stayDates({ check_in: '2026-07-01', check_out: '2026-07-01' })).toBe('1 Jul')
    expect(stayDates({ check_in: '2026-07-01' })).toBe('1 Jul')
    expect(stayDates({ check_out: '2026-07-05' })).toBe('5 Jul')
    expect(stayDates({})).toBe('')
  })
})

describe('approvalProblems', () => {
  it('passes a complete package', () => {
    expect(approvalProblems({ title: 'X', items: [{ item_type: 'hotel' }] })).toEqual([])
  })
  it('lists everything wrong, in plain words', () => {
    expect(approvalProblems({ title: '  ', items: [] })).toEqual(['Title is missing', 'No hotel or flight offers were found'])
    expect(approvalProblems({ title: 'X', items: [{ item_type: 'hotel' }], travel_date: '2026-12-18', return_date: '2026-12-12' })).toEqual(['Return date is before the travel date'])
    expect(approvalProblems(null)).toEqual(['Nothing was extracted from this page'])
  })
})

describe('summaryCounts', () => {
  it('counts distinct hotels separately from offers', () => {
    const counts = summaryCounts({
      items: [
        { item_type: 'hotel', hotel_name: 'A' },
        { item_type: 'hotel', hotel_name: ' a ' },
        { item_type: 'hotel', hotel_name: 'B' },
        { item_type: 'flight' },
      ],
    })
    expect(counts).toEqual({ offers: 4, hotels: 2, flights: 1 })
  })
})
