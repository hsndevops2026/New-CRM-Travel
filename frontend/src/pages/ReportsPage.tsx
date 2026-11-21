import { Navigate } from 'react-router-dom'

/** Legacy entry: reports live under /reports/pipeline and sibling sections. */
export default function ReportsPage() {
  return <Navigate to="/reports/pipeline" replace />
}
