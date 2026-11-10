import { describe, expect, it } from 'vitest'
import { creditSummary, defaultStaffTab, parseCreditAmount, staffCounts, visibleStaff, type StaffUser } from './permissionsView'

const user = (over: Partial<StaffUser>): StaffUser => ({
  id: 'u', email: 'a@x.com', approval_status: 'approved', lead_credits: 10, leads_used: 0, created_at: '2026-10-01T00:00:00Z', ...over,
})

describe('staffCounts / defaultStaffTab', () => {
  const users = [user({ id: '1', approval_status: 'pending' }), user({ id: '2' }), user({ id: '3', approval_status: 'revoked' }), user({ id: '4' })]
  it('counts each tab', () => {
    expect(staffCounts(users)).toEqual({ pending: 1, approved: 2, revoked: 1 })
  })
  it('opens on pending requests, then approved staff', () => {
    expect(defaultStaffTab(users)).toBe('pending')
    expect(defaultStaffTab(users.filter((u) => u.approval_status !== 'pending'))).toBe('approved')
    expect(defaultStaffTab([])).toBe('pending')
  })
})

describe('visibleStaff', () => {
  const users = [
    user({ id: 'old', email: 'karim@horizon.ae', created_at: '2026-06-01T00:00:00Z' }),
    user({ id: 'new', email: 'aisha@horizon.ae', created_at: '2026-10-01T00:00:00Z' }),
    user({ id: 'p', email: 'omar@horizon.ae', approval_status: 'pending' }),
  ]
  it('keeps only the tab, newest first', () => {
    expect(visibleStaff(users, 'approved', '').map((u) => u.id)).toEqual(['new', 'old'])
    expect(visibleStaff(users, 'pending', '').map((u) => u.id)).toEqual(['p'])
  })
  it('searches the email within the tab, ignoring case and spaces around', () => {
    expect(visibleStaff(users, 'approved', '  KARIM ').map((u) => u.id)).toEqual(['old'])
    expect(visibleStaff(users, 'approved', 'omar')).toEqual([])
  })
})

describe('creditSummary', () => {
  it('reports what is left and how much is spent', () => {
    expect(creditSummary({ lead_credits: 300, leads_used: 116 })).toEqual({ remaining: 184, used: 116, total: 300, pct: 39 })
  })
  it('never goes negative and caps the meter', () => {
    expect(creditSummary({ lead_credits: 10, leads_used: 25 })).toEqual({ remaining: 0, used: 25, total: 10, pct: 100 })
  })
  it('handles an empty allowance and bad numbers', () => {
    expect(creditSummary({ lead_credits: 0, leads_used: 0 }).pct).toBe(0)
    expect(creditSummary({ lead_credits: 0, leads_used: 3 }).pct).toBe(100)
    expect(creditSummary({ lead_credits: NaN, leads_used: NaN })).toEqual({ remaining: 0, used: 0, total: 0, pct: 0 })
  })
})

describe('parseCreditAmount', () => {
  it('accepts whole numbers of at least one', () => {
    expect(parseCreditAmount('50')).toBe(50)
    expect(parseCreditAmount('1')).toBe(1)
  })
  it('rejects zero, negatives, fractions, blanks and text', () => {
    for (const bad of ['0', '-5', '2.5', '', undefined, 'abc']) expect(parseCreditAmount(bad)).toBeNull()
  })
})
