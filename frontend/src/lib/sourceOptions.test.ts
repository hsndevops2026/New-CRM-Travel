import { describe, expect, it } from 'vitest'
import type { ComparisonItem, QuoteItem } from './quoteDrafts'
import { draftItemsAfterToggle, groupOptions, hasPackageConflict, lowestPricedId, plainOptionLabel, selectionSummary } from './sourceOptions'

const opt = (source_type: ComparisonItem['source_type'], n: number, net_cost: number | null = 100): ComparisonItem => ({
  id: `${source_type}:${n}`,
  source_type,
  source_id: String(n),
  label: `${source_type} ${n}`,
  description: null,
  net_cost,
  currency: 'USD',
  sort_price: net_cost,
  meta: {},
})
const inDraft = (source_type: string, n: number, quantity = 1): QuoteItem => ({
  id: `d${n}`,
  quote_draft_id: 'q',
  source_type,
  source_id: String(n),
  label: `${source_type} ${n}`,
  description: null,
  net_cost: 100,
  currency: 'USD',
  quantity,
  item_order: 0,
  meta: {},
})

describe('groupOptions', () => {
  it('splits comparison items by where they came from', () => {
    const g = groupOptions([opt('flight_api', 1), opt('hotel_api', 2), opt('predefined', 3), opt('dealer', 4), opt('flight_api', 5)])
    expect(g.flights.map((i) => i.source_id)).toEqual(['1', '5'])
    expect(g.hotels).toHaveLength(1)
    expect(g.packages).toHaveLength(1)
    expect(g.dealers).toHaveLength(1)
  })
})

describe('draftItemsAfterToggle', () => {
  it('adds an option while keeping what is already in the draft, quantities included', () => {
    const next = draftItemsAfterToggle([inDraft('flight_api', 1, 3)], opt('hotel_api', 2), true)
    expect(next.map((i) => `${i.source_type}:${i.source_id}`)).toEqual(['flight_api:1', 'hotel_api:2'])
    expect(next[0].quantity).toBe(3)
    expect(next[1].quantity).toBe(1)
  })
  it('removes only the unticked option', () => {
    const next = draftItemsAfterToggle([inDraft('flight_api', 1), inDraft('hotel_api', 2)], opt('flight_api', 1), false)
    expect(next.map((i) => i.source_id)).toEqual(['2'])
  })
  it('never lists the same option twice', () => {
    const next = draftItemsAfterToggle([inDraft('hotel_api', 2)], opt('hotel_api', 2), true)
    expect(next).toHaveLength(1)
  })
})

describe('selectionSummary', () => {
  it('counts each kind with plurals and a "+" before dealer offers', () => {
    expect(selectionSummary([{ source_type: 'flight_api' }, { source_type: 'flight_api' }, { source_type: 'hotel_api' }, { source_type: 'hotel_api' }, { source_type: 'dealer' }])).toBe(
      '2 flights · 2 hotels · + 1 dealer offer',
    )
  })
  it('does not start with a "+" when dealer offers are all there is', () => {
    expect(selectionSummary([{ source_type: 'dealer' }, { source_type: 'dealer' }])).toBe('2 dealer offers')
  })
  it('is empty for nothing', () => {
    expect(selectionSummary([])).toBe('')
  })
})

describe('lowestPricedId', () => {
  it('picks the cheapest priced option', () => {
    expect(lowestPricedId([opt('flight_api', 1, 1260), opt('flight_api', 2, 1540), opt('flight_api', 3, 1310)])).toBe('flight_api:1')
  })
  it('says nothing when there is nothing to compare against', () => {
    expect(lowestPricedId([opt('flight_api', 1, 1260)])).toBeNull()
    expect(lowestPricedId([opt('flight_api', 1, null), opt('flight_api', 2, 5)])).toBeNull()
  })
})

describe('hasPackageConflict', () => {
  it('flags a package ticked together with separate flights or hotels', () => {
    expect(hasPackageConflict([{ source_type: 'predefined' }, { source_type: 'hotel_api' }])).toBe(true)
    expect(hasPackageConflict([{ source_type: 'predefined' }, { source_type: 'flight_api' }])).toBe(true)
  })
  it('allows a package alone, parts alone, or a package with a dealer offer', () => {
    expect(hasPackageConflict([{ source_type: 'predefined' }])).toBe(false)
    expect(hasPackageConflict([{ source_type: 'flight_api' }, { source_type: 'hotel_api' }])).toBe(false)
    expect(hasPackageConflict([{ source_type: 'predefined' }, { source_type: 'dealer' }])).toBe(false)
  })
})

describe('plainOptionLabel', () => {
  it('drops the server-side badge prefix only', () => {
    expect(plainOptionLabel('Best · Atlas — Family room')).toBe('Atlas — Family room')
    expect(plainOptionLabel('AI pick · Atlas')).toBe('Atlas')
    expect(plainOptionLabel('Best Western')).toBe('Best Western')
  })
})
