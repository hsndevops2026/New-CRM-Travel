import { Check, Clock, LoaderCircle, Pencil, Send, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { lifecycleLabel } from '../../lib/lifecycle'
import StatusBadge, { type BadgeTone } from './StatusBadge'

type Look = { tone: BadgeTone; icon?: ReactNode; dot?: boolean }

const ICON = { strokeWidth: 1.8 }

/** One look per lead stage — colour AND an icon or dot, so no stage relies on colour alone. */
const LOOK: Record<string, Look> = {
  intake: { tone: 'neutral', dot: true },
  sourcing: { tone: 'info', icon: <LoaderCircle {...ICON} className="motion-safe:animate-spin" /> },
  awaiting_dealers: { tone: 'warning', icon: <Clock {...ICON} /> },
  comparing: { tone: 'info', dot: true },
  drafting: { tone: 'neutral', icon: <Pencil {...ICON} /> },
  ready_to_send: { tone: 'success', dot: true },
  sent: { tone: 'info', icon: <Send {...ICON} /> },
  accepted: { tone: 'success', icon: <Check {...ICON} /> },
  booked: { tone: 'solid', icon: <Check {...ICON} /> },
  lost: { tone: 'danger', icon: <X {...ICON} /> },
  archived: { tone: 'outline' },
}

export default function LifecycleBadge({
  status,
  className,
}: {
  status?: string | null
  className?: string
}) {
  const look = LOOK[status || 'intake'] || LOOK.intake
  return (
    <StatusBadge
      label={lifecycleLabel(status)}
      tone={look.tone}
      icon={look.icon}
      dot={look.dot}
      className={className}
    />
  )
}
