import { describe, expect, it } from 'vitest'
import type { DealerRequest, DealerResponse } from './dealers'
import { offerPrice, requestState, waitingFor } from './dealerStatus'

const NOW = Date.parse('2026-10-23T12:00:00Z')
const req = (over: Partial<DealerRequest> = {}): DealerRequest => ({
  id: 'r1', lead_id: 'l', request_code: 'REQ-1', status: 'sent', message_body: '', created_at: '2026-10-23T09:00:00Z', ...over,
})
const reply = (extracted: Record<string, unknown> | null = null): DealerResponse => ({
  id: 'a', dealer_request_id: 'r1', raw_text: '', review_status: 'pending', created_at: '2026-10-23T10:00:00Z', extracted,
})

describe('waitingFor', () => {
  it('speaks in minutes, hours, then days', () => {
    expect(waitingFor('2026-10-23T11:34:00Z', NOW)).toBe('26 min')
    expect(waitingFor('2026-10-23T09:00:00Z', NOW)).toBe('3 h')
    expect(waitingFor('2026-10-20T12:00:00Z', NOW)).toBe('3 d')
  })
  it('never says 0 min and tolerates junk', () => {
    expect(waitingFor('2026-10-23T12:00:00Z', NOW)).toBe('1 min')
    expect(waitingFor(null, NOW)).toBeNull()
    expect(waitingFor('nonsense', NOW)).toBeNull()
  })
})

describe('requestState', () => {
  it('is replied when the status says so or a reply exists', () => {
    expect(requestState(req({ status: 'replied' }), [], NOW)).toEqual({ label: 'Replied', tone: 'success' })
    expect(requestState(req(), [reply()], NOW).tone).toBe('success')
  })
  it('waits in amber, with how long', () => {
    expect(requestState(req({ sent_at: '2026-10-23T09:00:00Z' }), [], NOW)).toEqual({ label: 'Waiting · 3 h', tone: 'warning' })
  })
  it('goes red once the deadline has passed with no reply', () => {
    const state = requestState(req({ deadline_at: '2026-10-23T10:00:00Z' }), [], NOW)
    expect(state.tone).toBe('danger')
    expect(state.label).toContain('past deadline')
  })
  it('a reply beats a passed deadline', () => {
    expect(requestState(req({ deadline_at: '2026-10-23T10:00:00Z' }), [reply()], NOW).tone).toBe('success')
  })
  it('shows an unknown status as itself', () => {
    expect(requestState(req({ status: 'send_failed' }), [], NOW)).toEqual({ label: 'Send failed', tone: 'neutral' })
  })
})

describe('offerPrice', () => {
  it('formats a total with its currency', () => {
    expect(offerPrice(reply({ total_price: 1860, currency: 'USD' }))).toBe('USD 1,860')
  })
  it('falls back to per-night, then to nothing', () => {
    expect(offerPrice(reply({ price_per_night: 120, currency: 'EUR' }))).toBe('EUR 120')
    expect(offerPrice(reply({}))).toBeNull()
    expect(offerPrice(undefined)).toBeNull()
  })
})
