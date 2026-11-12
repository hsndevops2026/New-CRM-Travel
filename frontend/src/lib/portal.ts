import { apiJson } from './api'
import type { Lead } from './leads'

export type PortalCustomer = {
  id: string
  email: string
  contact_id: string
  name: string
  phone: string
}

export type PortalDocument = {
  id: string
  lead_id: string
  title: string
  file_url: string
  file_name?: string | null
  mime_type?: string | null
  created_at: string
  destination?: string | null
  travel_date?: string | null
  booking_type?: string | null
}

export type PortalChatMessage = {
  id: string
  direction: string
  channel?: string | null
  body?: string | null
  status?: string | null
  created_at: string
}

export type PortalChat = {
  lead_id: string
  destination: string
  travel_date: string
  booking_type: string
  message_count: number
  last_message_at: string | null
  messages: PortalChatMessage[]
}

export type PortalProgramItem = { day_number: number | null; title: string; details: string; kind: string }

export type PortalHome = {
  customer: PortalCustomer
  agency?: { agency_name?: string; logo_url?: string | null; primary_color?: string }
  bookings: (Lead & { program?: PortalProgramItem[] })[]
  documents: PortalDocument[]
  chats: PortalChat[]
}

export async function fetchPortalHome(): Promise<PortalHome> {
  return apiJson<PortalHome>('/api/portal/home')
}
