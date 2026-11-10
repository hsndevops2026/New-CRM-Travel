import { t as translate, useI18n } from '../../lib/i18n'
import type { ReactNode } from 'react'
import { Sparkles } from 'lucide-react'

type Props = {
  title: string
  description?: string
  action?: ReactNode
  /** The 26px glyph in the tile. Defaults to a sparkle. */
  icon?: ReactNode
  /** `danger` is for a region that failed to load. */
  tone?: 'default' | 'neutral' | 'danger'
}

const TILE = {
  default: 'bg-tint text-shop-accent',
  neutral: 'bg-neutral-bg text-slate-600',
  danger: 'bg-danger-bg text-danger',
}

/** Empty / error region (design system): an icon tile, what happened, what to do next. */
export default function EmptyState({ title, description, action, icon, tone = 'default' }: Props) {
  useI18n()
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
      <div aria-hidden="true" className={`grid size-14 place-items-center rounded-[14px] [&_svg]:size-[26px] ${TILE[tone]}`}>
        {icon ?? <Sparkles />}
      </div>
      <h3 className="text-base font-bold text-shop-ink">{translate(title)}</h3>
      {description ? <p className="max-w-sm text-shop-muted">{translate(description)}</p> : null}
      {action ? <div>{action}</div> : null}
    </div>
  )
}
