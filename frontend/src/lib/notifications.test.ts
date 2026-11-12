import { describe, expect, it } from 'vitest'
import { notificationLink, notificationText, type StaffNotification } from './notifications'

const base: StaffNotification = {
  id: '1', kind: 'new_lead', lead_id: 'L1', contact_id: 'C1', data: {}, count: 1, read_at: null, created_at: new Date().toISOString(),
}

describe('notifications', () => {
  it('describes a new lead with destination and source', () => {
    const r = notificationText({ ...base, data: { customer: 'Sara', destination: 'Istanbul', source: 'web' } })
    expect(r.title).toContain('Sara')
    expect(r.detail).toContain('Istanbul')
  })

  it('shows the message count when a customer wrote several times', () => {
    const r = notificationText({ ...base, kind: 'customer_waiting', count: 3, data: { customer: 'Omar', preview: 'hello' } })
    expect(r.title).toContain('3')
    expect(r.detail).toBe('hello')
  })

  it('links to the lead first, then the contact', () => {
    expect(notificationLink(base)).toBe('/leads/L1')
    expect(notificationLink({ ...base, lead_id: null })).toBe('/contacts/C1')
    expect(notificationLink({ ...base, lead_id: null, contact_id: null })).toBeNull()
  })
})

describe('task notifications', () => {
  it('names who gave the task and opens the tasks page', () => {
    const n: StaffNotification = { ...base, kind: 'task_assigned', data: { by: 'boss@x.com', text: 'Send voucher' } }
    expect(notificationText(n).title).toContain('boss@x.com')
    expect(notificationText(n).detail).toBe('Send voucher')
    expect(notificationLink(n)).toBe('/tasks')
  })
})

describe('automation notifications', () => {
  it('says who opened the quote, who is waiting, and a low rating', () => {
    expect(notificationText({ ...base, kind: 'quote_viewed', data: { customer: 'Sara', version_number: 2 } }).title).toContain('Sara')
    expect(notificationText({ ...base, kind: 'lead_waiting', data: { customer: 'Omar', minutes: 15 } }).title).toContain('15')
    expect(notificationText({ ...base, kind: 'low_rating', data: { customer: 'Rana', rating: 2 } }).title).toContain('2/5')
    expect(notificationLink({ ...base, kind: 'low_rating' })).toBe('/leads/L1')
  })
})
