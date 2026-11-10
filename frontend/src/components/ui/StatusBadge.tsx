import type { ReactNode } from 'react'
import { t, useI18n } from '../../lib/i18n'

/**
 * Pill badge from the design system. Status is always text + colour (never colour alone),
 * so a state can carry an icon or a dot as well.
 */
export type BadgeTone =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'dealer'
  | 'solid'
  | 'ink'
  | 'outline'
  | 'outlineSuccess'
  | 'outlineDealer'

const toneStyles: Record<BadgeTone, string> = {
  neutral: 'bg-neutral-bg text-neutral-fg',
  success: 'bg-shop-green-bg text-primary-800',
  warning: 'bg-warn-bg text-warn-fg',
  danger: 'bg-danger-bg text-danger-fg',
  info: 'bg-info-bg text-info-fg',
  dealer: 'bg-dealer-bg text-dealer-fg',
  solid: 'bg-shop-accent text-white',
  ink: 'bg-shop-ink text-white',
  outline: 'border border-line-strong bg-white text-neutral-fg',
  outlineSuccess: 'border border-shop-accent bg-white text-shop-accent',
  outlineDealer: 'border border-dealer bg-white text-dealer-fg',
}

type Props = {
  label: string
  tone?: BadgeTone
  className?: string
  /** A 12px icon shown before the label. */
  icon?: ReactNode
  /** A small status dot before the label (used when there is no icon). */
  dot?: boolean
}

/**
 * "pending approval" → "Pending approval". Labels that are already cased are untouched, and so
 * are version tags like "v2 locked" — "V2" would read as a different thing.
 */
function sentenceCase(text: string) {
  if (!text || /^v\d/.test(text)) return text
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export default function StatusBadge({ label, tone = 'neutral', className = '', icon, dot }: Props) {
  useI18n()
  return (
    <span
      className={`inline-flex h-[22px] items-center gap-[5px] whitespace-nowrap rounded-full px-2 text-xs font-semibold ${toneStyles[tone]} ${className}`}
    >
      {icon ? (
        <span className="flex shrink-0 items-center [&_svg]:size-3" aria-hidden="true">
          {icon}
        </span>
      ) : dot ? (
        <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
      ) : null}
      {t(sentenceCase(label))}
    </span>
  )
}
