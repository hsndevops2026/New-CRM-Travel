import type { Contact } from './contacts'
import type { Thread } from './inbox'
import type { Lead } from './leads'

export const digitsOnly = (value: string | null | undefined) => String(value ?? '').replace(/\D/g, '')

/**
 * Does the search text match this contact? Names match as typed (spaces ignored); phone numbers
 * match on digits alone, and a leading 0 is dropped so "050 123" finds "+971 50 123 4567".
 */
export function matchesContact(contact: Pick<Contact, 'name' | 'phone'>, term: string): boolean {
  const text = term.trim().toLowerCase()
  if (!text) return true
  if (contact.name.toLowerCase().replace(/\s/g, '').includes(text.replace(/\s/g, ''))) return true
  const wanted = digitsOnly(text).replace(/^0+/, '')
  return wanted.length > 0 && digitsOnly(contact.phone).includes(wanted)
}

/** The newest lead raised from this contact's number, if any. */
export function relatedLead(contact: Pick<Contact, 'phone'>, leads: Lead[]): Lead | null {
  const phone = digitsOnly(contact.phone)
  if (!phone) return null
  return (
    leads
      .filter((lead) => digitsOnly(lead.phone) === phone)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null
  )
}

/** The customer conversation on this contact's number, if there is one. */
export function contactThread(contact: Pick<Contact, 'phone'>, threads: Thread[]): Thread | null {
  const phone = digitsOnly(contact.phone)
  if (!phone) return null
  return threads.find((t) => t.kind === 'customer' && digitsOnly(t.phone) === phone) ?? null
}
