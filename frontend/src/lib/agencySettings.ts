import { apiJson } from './api'

export type AgencySettings = {
  agency_name: string
  logo_url: string | null
  primary_color: string
  quotation_template: 'classic' | 'modern'
  phone: string | null
  email: string | null
  website: string | null
  address: string | null
  quotation_footer: string | null
  /** Staff only. off · agents (every agent quote) · below_margin (agent quotes under the minimum margin). */
  quote_approval_mode?: 'off' | 'agents' | 'below_margin'
  quote_approval_min_margin?: number
  quote_approval_min_margin_type?: 'percent' | 'fixed'
  auto_quote_followup?: boolean
  quote_followup_hours?: number
  lead_wait_alert_minutes?: number
  auto_trip_messages?: boolean
  google_review_url?: string | null
  emergency_phone?: string | null
}

export async function fetchAgencySettings(): Promise<AgencySettings> {
  const data = await apiJson<{ agency: AgencySettings }>('/api/agency-settings')
  return data.agency
}

export async function saveAgencySettings(input: Partial<AgencySettings>): Promise<AgencySettings> {
  const data = await apiJson<{ agency: AgencySettings }>('/api/agency-settings', {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
  return data.agency
}
