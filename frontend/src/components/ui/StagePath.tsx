import { Check } from 'lucide-react'
import type { LifecycleStatus } from '../../lib/leads'
import { HAPPY_PATH, LIFECYCLE_STEP_LABELS, lifecycleLabel } from '../../lib/lifecycle'
import LifecycleBadge from './LifecycleBadge'

type Props = {
  /** The lead's real lifecycle status (lost / archived included). */
  current: string
  /**
   * Stages the API will accept from `current` (lead.lifecycle_allowed).
   * Anything outside this list is not offered — the backend owns the rules, the UI just
   * stops offering moves that would come back as a 400.
   * Omitted = every other stage stays clickable (legacy callers).
   */
  allowed?: string[]
  onSelect?: (status: LifecycleStatus) => void
  disabled?: boolean
  /** One line about what happens next, shown after the path ("Next: pick a flight and hotel…"). */
  hint?: string
}

const STEP = 'inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold max-sm:h-9'

/**
 * The lead's journey, from the design system:
 *   done = tint + check · current = filled + aria-current · next = outline.
 * A lead that was lost or archived has left the path, so it shows a single badge instead
 * (with Reopen when the API allows it).
 */
export default function StagePath({ current, allowed, onSelect, disabled, hint }: Props) {
  if (current === 'lost' || current === 'archived') {
    const canReopen = Boolean(onSelect) && !disabled && (allowed ? allowed.includes('intake') : current === 'lost')
    return (
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <LifecycleBadge status={current} />
        {canReopen && (
          <button
            type="button"
            onClick={() => onSelect?.('intake')}
            className="text-xs font-semibold text-shop-accent hover:underline"
          >
            Reopen
          </button>
        )}
      </div>
    )
  }

  const currentIndex = Math.max(
    0,
    HAPPY_PATH.findIndex((stage) => stage === current),
  )

  return (
    <ol className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" aria-label="Lead stage">
      {HAPPY_PATH.map((stage, index) => {
        const active = index === currentIndex
        const done = index < currentIndex
        const label = LIFECYCLE_STEP_LABELS[stage] || lifecycleLabel(stage)

        // Selecting the stage the lead is already in is a no-op, and anything the API
        // would reject is not offered at all.
        const reachable = !allowed || allowed.includes(stage)
        const interactive = Boolean(onSelect) && !disabled && !active && reachable

        const look = active
          ? 'bg-shop-accent text-white font-bold'
          : done
            ? 'bg-shop-green-bg text-primary-800'
            : 'border border-shop-border text-shop-muted'

        const content = (
          <>
            {done && <Check className="size-3" strokeWidth={2.2} aria-hidden="true" />}
            {active && <span className="size-1.5 rounded-full bg-white" aria-hidden="true" />}
            {label}
          </>
        )

        return (
          <li key={stage} className="flex items-center gap-1.5">
            {index > 0 && (
              <span
                aria-hidden="true"
                className={`h-px w-3 ${index <= currentIndex ? 'bg-[#94A3B8]' : 'bg-line-strong'}`}
              />
            )}
            {interactive ? (
              <button
                type="button"
                onClick={() => onSelect?.(stage)}
                className={`${STEP} ${look} transition-shadow hover:ring-2 hover:ring-shop-accent/30`}
              >
                {content}
              </button>
            ) : (
              <span
                aria-current={active ? 'step' : undefined}
                title={active || reachable ? undefined : `Not available from “${lifecycleLabel(current)}”`}
                className={`${STEP} ${look}`}
              >
                {content}
              </span>
            )}
          </li>
        )
      })}
      {hint ? <li className="ml-2 text-[13px] text-slate-600">{hint}</li> : null}
    </ol>
  )
}
