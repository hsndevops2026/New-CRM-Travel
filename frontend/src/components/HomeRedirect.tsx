import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { homePathFor } from '../lib/auth'

/** Sends signed-in users to the CRM or customer portal home. */
export default function HomeRedirect() {
  const { admin, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-shop-bg text-sm text-shop-muted">
        Checking session…
      </div>
    )
  }
  return <Navigate to={homePathFor(admin)} replace />
}
