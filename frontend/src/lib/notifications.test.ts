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
