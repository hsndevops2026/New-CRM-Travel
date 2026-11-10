import { describe, expect, it } from 'vitest'
import { formatDateRange, leadRef, leadTypeLabel, nightsLabel, travelersLabel } from './leadSummary'

describe('formatDateRange', () => {
  it('collapses a range inside one month', () => {
    expect(formatDateRange('2026-12-12', '2026-12-18')).toBe('12–18 Dec 2026')
  })
  it('spells both months when it crosses one', () => {
    expect(formatDateRange('2026-11-28', '2026-12-03')).toBe('28 Nov – 3 Dec 2026')
  })
  it('spells both years when it crosses New Year', () => {
    expect(formatDateRange('2026-12-28T00:00:00.000Z', '2027-01-03')).toBe('28 Dec 2026 – 3 Jan 2027')
  })
  it('handles one-way and missing dates', () => {
    expect(formatDateRange('2026-12-12', '')).toBe('12 Dec 2026')
    expect(formatDateRange('2026-12-12', '2026-12-12')).toBe('12 Dec 2026')
    expect(formatDateRange('', '2026-12-12')).toBe('—')
  })
})

describe('travelersLabel', () => {
  it('writes adults and children with ages', () => {
    expect(travelersLabel(2, 1, [8])).toBe('2 adults, 1 child (8)')
    expect(travelersLabel(2, 2, [8, 5])).toBe('2 adults, 2 children (8, 5)')
  })
  it('uses singular and omits what is zero', () => {
    expect(travelersLabel(1, 0)).toBe('1 adult')
    expect(travelersLabel(0, 0)).toBe('0 adults')
    expect(travelersLabel(2, 1, [])).toBe('2 adults, 1 child')
  })
})

describe('nightsLabel / leadTypeLabel / leadRef', () => {
  it('labels nights', () => {
    expect(nightsLabel(6)).toBe('6 nights')
    expect(nightsLabel(1)).toBe('1 night')
    expect(nightsLabel(0)).toBeNull()
    expect(nightsLabel(undefined)).toBeNull()
  })
  it('names the lead type', () => {
    expect(leadTypeLabel('package')).toBe('Flight + Hotel package')
    expect(leadTypeLabel('hotel')).toBe('Hotel')
    expect(leadTypeLabel('cruise')).toBe('Cruise')
  })
  it('makes a short reference', () => {
    expect(leadRef('aff20913-1ea8-4e49-b3ab-f12bd983c413')).toBe('L-AFF209')
  })
})
