import { apiFetch, apiJson, refreshSessionRequest, setAccessToken } from './api'

export type Admin = {
  id: string
  email: string
  role: 'admin' | 'agent' | 'customer'
  created_at: string
  approval_status: 'pending' | 'approved' | 'revoked'
  lead_credits: number
  /** Credits already spent (agents only). */
  leads_used?: number
  /** Linked CRM contact for customer portal accounts. */
  contact_id?: string | null
}

export function isCustomer(admin: Admin | null | undefined): boolean {
  return admin?.role === 'customer'
}

export function homePathFor(admin: Admin | null | undefined): string {
  return isCustomer(admin) ? '/portal' : '/inbox'
}

export type AuthResponse = {
  admin: Admin
  access_token: string
  token_type: string
  expires_in: string
}

export async function signup(email: string, password: string): Promise<void> {
  await apiJson('/api/auth/signup', {
    method: 'POST',
    skipAuth: true,
    body: JSON.stringify({ email, password }),
  })
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const data = await apiJson<AuthResponse>('/api/auth/login', {
    method: 'POST',
    skipAuth: true,
    body: JSON.stringify({ email, password }),
  })
  setAccessToken(data.access_token)
  return data
}

export async function refreshSession(): Promise<AuthResponse | null> {
  const data = await refreshSessionRequest()
  if (!data?.admin || !data.access_token) return null
  return data as AuthResponse
}

export async function fetchMe(): Promise<Admin> {
  const data = await apiJson<{ admin: Admin }>('/api/auth/me')
  return data.admin
}

export async function logout(): Promise<void> {
  try {
    await apiFetch('/api/auth/logout', {
      method: 'POST',
      skipAuth: true,
      retry: false,
      body: '{}',
    })
  } finally {
    setAccessToken(null)
  }
}
