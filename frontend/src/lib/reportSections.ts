import type { ComponentType } from 'react'
import {
  AlertTriangle,
  BarChart3,
  Store,
  UsersRound,
  Wallet,
} from 'lucide-react'

export type ReportSectionId = 'pipeline' | 'team' | 'attention' | 'profit' | 'suppliers'

export type ReportSection = {
  id: ReportSectionId
  to: string
  label: string
  description: string
  icon: ComponentType<{ className?: string; strokeWidth?: number }>
  /** Whether the shared date-range toolbar applies to this section. */
  usesRange: boolean
}

/** Sidebar + in-page submenu for /reports/*. */
export const REPORT_SECTIONS: ReportSection[] = [
  {
    id: 'pipeline',
    to: '/reports/pipeline',
    label: 'Pipeline',
    description: 'New leads, quotes sent and accepted, funnel and sources.',
    icon: BarChart3,
    usesRange: true,
  },
  {
    id: 'team',
    to: '/reports/team',
    label: 'Team',
    description: 'How each employee performed in the selected period.',
    icon: UsersRound,
    usesRange: true,
  },
  {
    id: 'attention',
    to: '/reports/attention',
    label: 'Needs attention',
    description: 'Waiting customers, quiet quotes, overdue reminders and stalled leads.',
    icon: AlertTriangle,
    usesRange: false,
  },
  {
    id: 'profit',
    to: '/reports/profit',
    label: 'Profit',
    description: 'Real profit and margin on accepted bookings.',
    icon: Wallet,
    usesRange: true,
  },
  {
    id: 'suppliers',
    to: '/reports/suppliers',
    label: 'Suppliers',
    description: 'Dealer response speed and how often their prices become bookings.',
    icon: Store,
    usesRange: true,
  },
]

export function reportSectionFromPath(pathname: string): ReportSection {
  const match = REPORT_SECTIONS.find((s) => pathname === s.to || pathname.startsWith(`${s.to}/`))
  return match || REPORT_SECTIONS[0]
}
