import { Navigate } from 'react-router-dom'

/** Legacy entry — redirects to inbox. */
export default function App() {
  return <Navigate to="/inbox" replace />
}
