import { apiFetch } from './api'
import type { BookingDocument } from './bookingDocuments'
import type { Thread } from './inbox'
import type { Lead } from './leads'
import type { ContactReminder } from './reminders'

export type Contact = {
  id: string
  phone: string
  name: string
  email?: string | null
  /** Staff override for the customer's message language; null = follow WhatsApp. */
  preferred_language?: 'ar' | 'en' | null
  created_at: string
  updated_at?: string
}

export type ContactBooking = Lead & {
  documents: BookingDocument[]
}

export type ContactProfile = {
  contact: Contact
  bookings: ContactBooking[]
  threads: Thread[]
  reminders: ContactReminder[]
}

export type ContactInput = {
  phone: string
  name: string
  email?: string | null
}

export async function fetchContacts(query = ''): Promise<Contact[]> {
  const params = new URLSearchParams()
  if (query.trim()) params.set('query', query.trim())
  const suffix = params.toString() ? `?${params.toString()}` : ''
  const response = await apiFetch(`/api/contacts${suffix}`)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to load contacts')
  return (data.contacts || []) as Contact[]
}

export async function createContact(input: ContactInput): Promise<Contact> {
  const response = await apiFetch('/api/contacts', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to save contact')
  return data.contact as Contact
}

export async function updateContact(id: string, input: ContactInput): Promise<Contact> {
  const response = await apiFetch(`/api/contacts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to update contact')
  return data.contact as Contact
}

export async function deleteContact(id: string): Promise<void> {
  const response = await apiFetch(`/api/contacts/${id}`, { method: 'DELETE' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Failed to delete contact')
}

export async function fetchContactProfile(id: string): Promise<ContactProfile> {
  const response = await apiFetch(`/api/contacts/${id}/profile`)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to load contact profile')
  return {
    contact: data.contact as Contact,
    bookings: (data.bookings || []) as ContactBooking[],
    threads: (data.threads || []) as Thread[],
    reminders: (data.reminders || []) as ContactReminder[],
  }
}

export async function setContactLanguage(id: string, language: 'ar' | 'en' | null): Promise<Contact> {
  const response = await apiFetch(`/api/contacts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ preferred_language: language }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to update contact')
  return data.contact as Contact
}
