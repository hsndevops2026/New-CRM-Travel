import { describe, expect, it } from 'vitest'
import type { Dealer, DealerRequest } from './dealers'
import { dealerInitials, dealerStats, destinationOptions, filterDealers, GROUPS_ONLY, serviceLabel } from './dealerView'

const dealer = (over: Partial<Dealer>): Dealer => ({ id: 'd', name: 'Atlas Holidays', phone: '+905324182290', created_at: '', ...over })
const req = (over: Partial<DealerRequest>): DealerRequest => ({
  id: 'r', lead_id: 'l', dealer_id: 'd', request_code: 'REQ', status: 'sent', message_body: '', created_at: '2026-10-01T00:00:00Z', ...over,
})

describe('dealerStats', () => {
  it('counts RFQs, replies, the reply rate and the latest send', () => {
    const stats = dealerStats('d', [
      req({ id: '1', status: 'replied', sent_at: '2026-10-05T00:00:00Z' }),
      req({ id: '2', status: 'sent', sent_at: '2026-10-09T00:00:00Z' }),
      req({ id: '3', status: 'replied', sent_at: '2026-10-02T00:00:00Z' }),
      req({ id: '4', dealer_id: 'someone-else', status: 'replied' }),
    ])
    expect(stats).toEqual({ rfqs: 3, replied: 2, replyRate: 67, lastAt: '2026-10-09T00:00:00Z' })
  })
  it('has no rate for a dealer nobody has asked yet', () => {
    expect(dealerStats('d', [])).toEqual({ rfqs: 0, replied: 0, replyRate: null, lastAt: null })
  })
})

describe('destinationOptions', () => {
  it('lists the most common destinations first, merging case, capped', () => {
    const dealers = [
      dealer({ destinations: ['Turkey', 'Egypt'] }),
      dealer({ destinations: ['turkey'] }),
      dealer({ destinations: ['Maldives', 'Sri Lanka', 'Georgia'] }),
    ]
    expect(destinationOptions(dealers, 3)).toEqual(['Turkey', 'Egypt', 'Georgia'])
  })
  it('ignores blanks and dealers without destinations', () => {
    expect(destinationOptions([dealer({}), dealer({ destinations: ['', '  '] })])).toEqual([])
  })
})

describe('filterDealers', () => {
  const list = [
    dealer({ id: '1', name: 'Atlas Holidays', destinations: ['Turkey'], whatsapp_group_id: '1203@g.us' }),
    dealer({ id: '2', name: 'Caspian Routes', destinations: ['Azerbaijan', 'Georgia'], phone: '+994503114820' }),
  ]
  it('keeps everyone for All with no search', () => {
    expect(filterDealers(list, { query: '', destination: 'all' })).toHaveLength(2)
  })
  it('filters by destination ignoring case, and by having a group', () => {
    expect(filterDealers(list, { query: '', destination: 'georgia' }).map((d) => d.id)).toEqual(['2'])
    expect(filterDealers(list, { query: '', destination: GROUPS_ONLY }).map((d) => d.id)).toEqual(['1'])
  })
  it('searches name, phone and destinations together with the pill', () => {
    expect(filterDealers(list, { query: '994', destination: 'all' }).map((d) => d.id)).toEqual(['2'])
    expect(filterDealers(list, { query: 'azer', destination: 'all' }).map((d) => d.id)).toEqual(['2'])
    expect(filterDealers(list, { query: 'atlas', destination: 'Georgia' })).toEqual([])
  })
})

describe('labels', () => {
  it('names services and passes unknown ones through', () => {
    expect(serviceLabel('transfers')).toBe('Transfers & tours')
    expect(serviceLabel('visa help')).toBe('visa help')
  })
  it('abbreviates names', () => {
    expect(dealerInitials('Atlas Holidays')).toBe('AH')
    expect(dealerInitials('Anatolia')).toBe('A')
    expect(dealerInitials('')).toBe('?')
  })
})
