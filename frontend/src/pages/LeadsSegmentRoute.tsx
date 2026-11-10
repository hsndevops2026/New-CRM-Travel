import { Navigate, useParams } from 'react-router-dom'
import LeadsPage from './LeadsPage'
import LeadDetailPage from './LeadDetailPage'

export default function LeadsSegmentRoute() {
  const { segment = '' } = useParams<{ segment: string }>()
  if (segment === 'hotel' || segment === 'flight' || segment === 'package') {
    return <LeadsPage />
  }
  if (/^[0-9a-f-]{36}$/i.test(segment)) {
    return <LeadDetailPage />
  }
  return <Navigate to="/leads/hotel" replace />
}
