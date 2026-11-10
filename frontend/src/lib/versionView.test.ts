import { describe, expect, it } from 'vitest'
import type { QuoteDelivery, QuoteVersion } from './quoteVersions'
import { currentVersion, deliveryEvent, deliveryTimeline, eventTime, versionStatusLabel, versionSummary } from './versionView'

const NOW = new Date(2026, 9, 23, 15, 0)
const version = (n: number, status: QuoteVersion['status'] = 'sent', labels: string[] = []): QuoteVersion => ({
  id: `v${n}`, quote_draft_id: 'd', lead_id: 'l', version_number: n, selling_price: 100, currency: 'USD', status,
  accepted_at: null, accepted_by: null, notes: null, created_by: null, created_at: new Date(2026, 9, 21, 13, 58).toISOString(),
  snapshot: { items: labels.map((label) => ({ label })) } as QuoteVersion['snapshot'],
})
const delivery = (over: Partial<QuoteDelivery>): QuoteDelivery => ({
  id: 'd1', quote_version_id: 'v2', channel: 'whatsapp', recipient: '+971501234567', status: 'sent', provider_id: null,
  error_message: null, attempt_count: 1, sent_at: new Date(2026, 9, 23, 14, 5).toISOString(), created_at: new Date(2026, 9, 23, 14, 5).toISOString(),
  updated_at: '', ...over,
})

describe('eventTime', () => {
  it('shows the clock for today and the date for earlier days', () => {
    expect(eventTime(new Date(2026, 9, 23, 14, 5).toISOString(), NOW)).toBe('14:05')
    expect(eventTime(new Date(2026, 9, 21, 13, 58).toISOString(), NOW)).toBe('21 Oct, 13:58')
    expect(eventTime(null, NOW)).toBe('—')
    expect(eventTime('junk', NOW)).toBe('—')
  })
})

describe('currentVersion', () => {
  it('is the newest version that is not revoked', () => {
    expect(currentVersion([version(1, 'revoked'), version(2), version(3, 'revoked')])?.version_number).toBe(2)
    expect(currentVersion([version(1), version(2)])?.version_number).toBe(2)
  })
  it('is null when everything is revoked or nothing exists', () => {
    expect(currentVersion([version(1, 'revoked')])).toBeNull()
    expect(currentVersion([])).toBeNull()
  })
})

describe('versionSummary', () => {
  it('lists what is in the version and counts the rest', () => {
    expect(versionSummary(version(1, 'sent', ['A', 'B']))).toBe('A · B')
    expect(versionSummary(version(1, 'sent', ['A', 'B', 'C', 'D', 'E']))).toBe('A · B · C · +2 more')
    expect(versionSummary(version(1))).toBe('')
  })
})

describe('deliveryEvent', () => {
  it('describes a failure with its reason and flags it for retry', () => {
    const e = deliveryEvent(delivery({ channel: 'email', recipient: 'a@gmial.com', status: 'failed', error_message: 'mailbox not found' }), NOW)
    expect(e).toMatchObject({ title: 'Email failed', tone: 'danger', failed: true })
    expect(e.detail).toBe('14:05 · a@gmial.com · mailbox not found')
  })
  it('maps delivered, pending and sent', () => {
    expect(deliveryEvent(delivery({ status: 'delivered' }), NOW)).toMatchObject({ title: 'WhatsApp delivered', tone: 'success' })
    expect(deliveryEvent(delivery({ status: 'pending' }), NOW)).toMatchObject({ title: 'WhatsApp sending…', tone: 'warning' })
    expect(deliveryEvent(delivery({ status: 'sent' }), NOW)).toMatchObject({ title: 'WhatsApp sent', tone: 'neutral', failed: false })
  })
})

describe('deliveryTimeline', () => {
  it('puts the newest delivery first and the version creation last', () => {
    const late = delivery({ id: 'late', status: 'delivered', sent_at: new Date(2026, 9, 23, 14, 6).toISOString() })
    const early = delivery({ id: 'early', sent_at: new Date(2026, 9, 23, 14, 5).toISOString() })
    const line = deliveryTimeline(version(2), [early, late], NOW)
    expect(line.map((e) => e.id)).toEqual(['late', 'early', 'created-v2'])
    expect(line[2].title).toBe('v2 created')
  })
})

describe('versionStatusLabel', () => {
  it('calls a locked-but-unsent version locked, and leaves the rest alone', () => {
    expect(versionStatusLabel('sent')).toBe('locked')
    expect(versionStatusLabel('accepted')).toBe('accepted')
    expect(versionStatusLabel('revoked')).toBe('revoked')
  })
})
