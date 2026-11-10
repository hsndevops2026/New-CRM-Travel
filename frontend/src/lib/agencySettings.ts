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
