import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './AuthContext'
import ProtectedRoute from '../components/ProtectedRoute'
import { getAccessToken, resetApiAuthState } from '../lib/api'

function Probe() {
  const { admin, loading } = useAuth()
  if (loading) return <div>bootstrapping</div>
  return <div>signed-in:{admin?.email || 'none'}</div>
}

function LoginProbe() {
  return <div>login-page</div>
}

describe('AuthContext', () => {
  beforeEach(() => {
    resetApiAuthState()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetApiAuthState()
  })

  it('bootstraps from refresh cookie and exposes admin', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          admin: { id: '1', email: 'admin@example.com', created_at: '2026-01-01' },
          access_token: 'boot-token',
          token_type: 'Bearer',
          expires_in: '15m',
        }),
        { status: 200 },
      ),
    )

    render(
      <MemoryRouter>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </MemoryRouter>,
    )

    expect(screen.getByText('bootstrapping')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByText('signed-in:admin@example.com')).toBeTruthy()
    })
    expect(getAccessToken()).toBe('boot-token')
  })

  it('redirects protected routes to login when unauthenticated', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'no session' }), { status: 401 }),
    )

    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginProbe />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <div>crm</div>
                </ProtectedRoute>
              }
            />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('login-page')).toBeTruthy()
    })
    expect(screen.queryByText('crm')).toBeNull()
  })
})
