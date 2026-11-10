import { describe, expect, it } from 'vitest'
import type { Thread } from './inbox'
import type { Lead } from './leads'
import { contactThread, digitsOnly, matchesContact, relatedLead } from './contactView'

const sarah = { name: 'Sarah Ahmed', phone: '971501234567' }
const lead = (over: Partial<Lead>): Lead => ({ id: 'l', phone: '+971501234567', booking_type: 'hotel', origin: null, destination: 'Istanbul', travel_date: '', return_date: '', nights: 0, adults_count: 2, children_count: 0, children_ages: [], budget: null, hotel_name: null, notes: null, summary: null, created_at: '2026-10-01T00:00:00Z', ...over })
const thread = (over: Partial<Thread>): Thread => ({ id: 't', kind: 'customer', title: 'x', subtitle: '', last_message: '', last_at: null, phone: '971501234567', ...over })

describe('matchesContact', () => {
  it('matches names ignoring case and spaces', () => {
    expect(matchesContact(sarah, 'sarah')).toBe(true)
    expect(matchesContact(sarah, 'SARAH AH')).toBe(true)
    expect(matchesContact(sarah, 'sarahahmed')).toBe(true)
    expect(matchesContact(sarah, 'rahul')).toBe(false)
  })
  it('matches phone numbers on digits, with or without a leading zero or punctuation', () => {
    expect(matchesContact(sarah, '050 123')).toBe(true)
    expect(matchesContact(sarah, '+971 50 123')).toBe(true)
    expect(matchesContact(sarah, '50-123-4567')).toBe(true)
    expect(matchesContact(sarah, '055')).toBe(false)
  })
  it('matches everything when empty, and never matches on punctuation alone', () => {
    expect(matchesContact(sarah, '   ')).toBe(true)
    expect(matchesContact(sarah, '+-')).toBe(false)
  })
})

describe('relatedLead', () => {
  it('picks the newest lead on the same number, however it is formatted', () => {
    const older = lead({ id: 'old', phone: '971501234567', created_at: '2026-09-01T00:00:00Z' })
    const newer = lead({ id: 'new', phone: '+971 50 123 4567', created_at: '2026-10-05T00:00:00Z' })
    const other = lead({ id: 'other', phone: '+971559082231', created_at: '2026-10-09T00:00:00Z' })
    expect(relatedLead(sarah, [older, other, newer])?.id).toBe('new')
  })
  it('is null with no lead, or no number', () => {
    expect(relatedLead(sarah, [lead({ phone: '+1555' })])).toBeNull()
    expect(relatedLead({ phone: '' }, [lead({ phone: '' })])).toBeNull()
  })
})

describe('contactThread', () => {
  it('finds the customer conversation, not a dealer one on a similar number', () => {
    const dealer = thread({ id: 'd', kind: 'dealer' })
    const customer = thread({ id: 'c' })
    expect(contactThread(sarah, [dealer, customer])?.id).toBe('c')
    expect(contactThread(sarah, [dealer])).toBeNull()
  })
})

describe('digitsOnly', () => {
  it('strips everything but digits and tolerates null', () => {
    expect(digitsOnly('+971 (50) 123-4567')).toBe('971501234567')
    expect(digitsOnly(null)).toBe('')
  })
})
