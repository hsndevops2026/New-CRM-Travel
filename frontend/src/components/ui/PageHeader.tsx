import { t as translate, useI18n } from '../../lib/i18n'
import type { ReactNode } from 'react'

type Props = {
  title: ReactNode
  /** Text, or rich content such as "<strong>38</strong> hotel leads". */
  subtitle?: ReactNode
  actions?: ReactNode
}

export default function PageHeader({ title, subtitle, actions }: Props) {
  useI18n()
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-extrabold tracking-[-0.01em] text-shop-ink">{typeof title === 'string' ? translate(title) : title}</h1>
        {subtitle ? (
          <p className="mt-1 text-sm tabular-nums text-shop-muted [&_strong]:font-bold [&_strong]:text-shop-ink">
            {typeof subtitle === 'string' ? translate(subtitle) : subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div> : null}
    </div>
  )
}
