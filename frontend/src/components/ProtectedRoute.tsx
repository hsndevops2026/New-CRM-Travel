import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { homePathFor, isCustomer } from '../lib/auth'

type Props = {
  children: ReactNode
  /** When true, only customer accounts may enter. Staff are sent to the CRM home. */
  customerOnly?: boolean
  /** When true, only staff (admin/agent) may enter. Customers are sent to the portal. */
  staffOnly?: boolean
}

export default function ProtectedRoute({ children, customerOnly = false, staffOnly = false }: Props) {
  const { admin, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-shop-bg text-sm text-shop-muted">
        Checking session…
      </div>
    )
  }

  if (!admin) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (customerOnly && !isCustomer(admin)) {
    return <Navigate to={homePathFor(admin)} replace />
  }

  if (staffOnly && isCustomer(admin)) {
    return <Navigate to="/portal" replace />
  }

  if (admin.role === 'agent' && ['/settings', '/permissions'].some((path) => location.pathname === path || location.pathname.startsWith(`${path}/`))) {
    return <Navigate to="/inbox" replace />
  }

  return children
}
