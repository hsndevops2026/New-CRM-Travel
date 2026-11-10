import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { setAccessToken, setAuthFailureHandler } from '../lib/api'
import {
  login as loginRequest,
  logout as logoutRequest,
  refreshSession,
  signup as signupRequest,
  type Admin,
} from '../lib/auth'

type AuthContextValue = {
  admin: Admin | null
  loading: boolean
  login: (email: string, password: string) => Promise<Admin>
  signup: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null)
  const [loading, setLoading] = useState(true)

  const clearSession = useCallback(() => {
    setAccessToken(null)
    setAdmin(null)
  }, [])

  useEffect(() => {
    setAuthFailureHandler(() => {
      clearSession()
    })
    return () => setAuthFailureHandler(null)
  }, [clearSession])

  useEffect(() => {
    let cancelled = false
    const bootstrap = async () => {
      setLoading(true)
      try {
        const refreshed = await refreshSession()
        if (cancelled) return
        if (refreshed?.admin) {
          setAdmin(refreshed.admin)
          return
        }
        // No refresh cookie — stay logged out
        setAdmin(null)
      } catch {
        if (!cancelled) clearSession()
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [clearSession])

  const login = useCallback(async (email: string, password: string) => {
    const data = await loginRequest(email, password)
    setAdmin(data.admin)
    return data.admin
  }, [])

  const signup = useCallback(async (email: string, password: string) => {
    await signupRequest(email, password)
  }, [])

  const logout = useCallback(async () => {
    try {
      await logoutRequest()
    } finally {
      clearSession()
    }
  }, [clearSession])

  const value = useMemo(
    () => ({ admin, loading, login, signup, logout }),
    [admin, loading, login, signup, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- hook paired with provider
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
