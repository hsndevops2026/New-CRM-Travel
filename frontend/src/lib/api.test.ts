import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  apiFetch,
  getAccessToken,
  resetApiAuthState,
  setAccessToken,
  setAuthFailureHandler,
} from './api'

describe('apiFetch', () => {
  beforeEach(() => {
    resetApiAuthState()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetApiAuthState()
  })

  it('attaches Bearer access token and credentials', async () => {
    setAccessToken('access-1')
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 200 }))

    await apiFetch('/api/leads')

    expect(fetch).toHaveBeenCalledTimes(1)
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(init?.credentials).toBe('include')
    const headers = new Headers(init?.headers)
    expect(headers.get('Authorization')).toBe('Bearer access-1')
  })

  it('single-flights concurrent 401 refreshes and retries once', async () => {
    setAccessToken('expired')
    let refreshCalls = 0
    let resolveRefresh!: (value: Response) => void
    const refreshGate = new Promise<Response>((resolve) => {
      resolveRefresh = resolve
    })

    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/api/auth/refresh')) {
        refreshCalls += 1
        return refreshGate
      }
      if (init?.headers && new Headers(init.headers).get('Authorization') === 'Bearer expired') {
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })

    const p1 = apiFetch('/api/leads')
    const p2 = apiFetch('/api/flights/quotes?lead_id=1')

    // Both should hit 401 and share one refresh
    await Promise.resolve()
    await Promise.resolve()
    expect(refreshCalls).toBe(1)

    resolveRefresh(
      new Response(JSON.stringify({ access_token: 'fresh-token' }), { status: 200 }),
    )

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    expect(getAccessToken()).toBe('fresh-token')
    expect(refreshCalls).toBe(1)

    const authHeaders = vi
      .mocked(fetch)
      .mock.calls.filter(([, init]) => {
        const h = new Headers(init?.headers)
        return h.get('Authorization') === 'Bearer fresh-token'
      })
    expect(authHeaders.length).toBeGreaterThanOrEqual(2)
  })

  it('calls auth failure handler when refresh fails', async () => {
    setAccessToken('expired')
    const onFail = vi.fn()
    setAuthFailureHandler(onFail)

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/auth/refresh')) {
        return new Response(JSON.stringify({ error: 'nope' }), { status: 401 })
      }
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
    })

    const response = await apiFetch('/api/leads')
    expect(response.status).toBe(401)
    expect(onFail).toHaveBeenCalledTimes(1)
    expect(getAccessToken()).toBeNull()
  })
})
