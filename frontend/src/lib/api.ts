/**
 * API URL helper.
 *
 * Always use same-origin paths in the browser so the refresh cookie is
 * first-party (Vite proxies /api locally; Vercel rewrites /api → backend).
 * Cross-origin VITE_API_URL breaks auth cookies (Secure/SameSite / 3P blocking).
 *
 * Set VITE_FORCE_ABSOLUTE_API=true only if you intentionally call a remote API
 * host directly (requires HTTPS + COOKIE_SAME_SITE=none on the API).
 */
export function apiUrl(path: string) {
  const normalized = path.startsWith('/') ? path : `/${path}`
  const forceAbsolute = String(import.meta.env.VITE_FORCE_ABSOLUTE_API || '') === 'true'
  const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

  if (forceAbsolute && base) {
    return `${base}${normalized}`
  }

  return normalized
}

let accessToken: string | null = null
let refreshPromise: Promise<RefreshResult | null> | null = null
let onAuthFailure: (() => void) | null = null

export type RefreshResult = {
  admin: { id: string; email: string; created_at: string }
  access_token: string
  token_type?: string
  expires_in?: string
}

export function getAccessToken() {
  return accessToken
}

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function setAuthFailureHandler(handler: (() => void) | null) {
  onAuthFailure = handler
}

/** Test helper — reset in-memory auth state between cases. */
export function resetApiAuthState() {
  accessToken = null
  refreshPromise = null
  onAuthFailure = null
}

type ApiFetchOptions = RequestInit & {
  skipAuth?: boolean
  retry?: boolean
}

/**
 * Single-flight refresh used by bootstrap and 401 retries.
 * Prevents React Strict Mode double-mount from rotating the same cookie twice
 * (which previously looked like token reuse and logged everyone out).
 */
export async function refreshSessionRequest(): Promise<RefreshResult | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const response = await fetch(apiUrl('/api/auth/refresh'), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
        if (!response.ok) {
          setAccessToken(null)
          return null
        }
        const data = (await response.json()) as RefreshResult
        if (!data?.access_token) {
          setAccessToken(null)
          return null
        }
        setAccessToken(data.access_token)
        return data
      } catch {
        setAccessToken(null)
        return null
      } finally {
        refreshPromise = null
      }
    })()
  }
  return refreshPromise
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshed = await refreshSessionRequest()
  return refreshed?.access_token || null
}

/**
 * Authenticated fetch with credentials + single-flight refresh on 401.
 */
export async function apiFetch(path: string, options: ApiFetchOptions = {}) {
  const { skipAuth = false, retry = true, headers, ...rest } = options
  const finalHeaders = new Headers(headers || {})

  if (!skipAuth) {
    const token = getAccessToken()
    if (token) finalHeaders.set('Authorization', `Bearer ${token}`)
  }

  if (rest.body && !finalHeaders.has('Content-Type')) {
    finalHeaders.set('Content-Type', 'application/json')
  }

  const response = await fetch(apiUrl(path), {
    ...rest,
    headers: finalHeaders,
    credentials: 'include',
  })

  if (response.status !== 401 || skipAuth || !retry) {
    return response
  }

  const nextToken = await refreshAccessToken()
  if (!nextToken) {
    onAuthFailure?.()
    return response
  }

  const retryHeaders = new Headers(headers || {})
  retryHeaders.set('Authorization', `Bearer ${nextToken}`)
  if (rest.body && !retryHeaders.has('Content-Type')) {
    retryHeaders.set('Content-Type', 'application/json')
  }

  return fetch(apiUrl(path), {
    ...rest,
    headers: retryHeaders,
    credentials: 'include',
  })
}

export async function apiJson<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const response = await apiFetch(path, options)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(
      (data as { error?: string }).error || `Request failed (${response.status})`,
    )
  }
  return data as T
}
