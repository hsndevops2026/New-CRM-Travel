import { describe, expect, it } from 'vitest'
import type { Thread } from './inbox'
import { bubbleDelivery, filterThreads, hasLead, QUICK_REPLIES, threadCounts, threadInitials, threadPreview } from './inboxView'

const t = (over: Partial<Thread>): Thread => ({ id: 'x', kind: 'customer', title: 'T', subtitle: '', last_message: '', last_at: null, ...over })

describe('filterThreads / threadCounts', () => {
  const threads = [t({ id: '1' }), t({ id: '2', kind: 'dealer' }), t({ id: '3', kind: 'group' }), t({ id: '4' })]
  it('filters by kind and keeps everything for All', () => {
    expect(filterThreads(threads, 'all')).toHaveLength(4)
    expect(filterThreads(threads, 'customer').map((x) => x.id)).toEqual(['1', '4'])
    expect(filterThreads(threads, 'group').map((x) => x.id)).toEqual(['3'])
  })
  it('counts every pill from the same list', () => {
    expect(threadCounts(threads)).toEqual({ all: 4, customer: 2, dealer: 1, group: 1 })
    expect(threadCounts([])).toEqual({ all: 0, customer: 0, dealer: 0, group: 0 })
  })
})

describe('threadInitials', () => {
  it('abbreviates names, up to two letters', () => {
    expect(threadInitials('Sarah Ahmed')).toBe('SA')
    expect(threadInitials('Istanbul DMC partners')).toBe('ID')
    expect(threadInitials('atlas')).toBe('A')
  })
  it('uses # for a bare number and handles non-Latin names', () => {
    expect(threadInitials('+971 55 908 2231')).toBe('#')
    expect(threadInitials('')).toBe('#')
    expect(threadInitials('موفنبيك ريزورت')).toBe('مر')
  })
})

describe('threadPreview', () => {
  it('prefixes what the agency wrote and flattens whitespace', () => {
    expect(threadPreview({ last_message: 'Quote v1\nattached', last_direction: 'outbound' })).toBe('You: Quote v1 attached')
    expect(threadPreview({ last_message: 'Hello', last_direction: 'inbound' })).toBe('Hello')
    expect(threadPreview({ last_message: '', last_direction: null })).toBe('No messages yet')
  })
})

describe('hasLead', () => {
  it('is about the lead id, not the thread kind', () => {
    expect(hasLead({ kind: 'customer', lead_id: 'abc' })).toBe(true)
    expect(hasLead({ kind: 'customer' })).toBe(false)
  })
})

describe('bubbleDelivery', () => {
  const m = (direction: 'inbound' | 'outbound', status: string) => ({ direction, status })
  it('only tracks delivery for messages we sent', () => {
    expect(bubbleDelivery(m('inbound', 'received'))).toBe('none')
    expect(bubbleDelivery(m('outbound', 'sent'))).toBe('sent')
    expect(bubbleDelivery(m('outbound', 'delivered'))).toBe('delivered')
    expect(bubbleDelivery(m('outbound', 'read'))).toBe('delivered')
    expect(bubbleDelivery(m('outbound', 'failed'))).toBe('failed')
  })
})

describe('QUICK_REPLIES', () => {
  it('has unique ids and non-empty text', () => {
    expect(new Set(QUICK_REPLIES.map((q) => q.id)).size).toBe(QUICK_REPLIES.length)
    expect(QUICK_REPLIES.every((q) => q.text.length > 10)).toBe(true)
  })
})
