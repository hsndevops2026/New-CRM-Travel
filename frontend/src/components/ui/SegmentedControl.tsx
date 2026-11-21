import { t as translate, useI18n } from '../../lib/i18n'
import type { ReactNode } from 'react'

type Segment = {
  id: string
  label: string
  count?: number
  icon?: ReactNode
}

type Props = {
  items: Segment[]
  value: string
  onChange: (id: string) => void
  ariaLabel: string
}

/**
 * Segmented control (design system) — a small set of mutually exclusive views, such as
 * Hotel / Flight / Package. Arrow keys move between segments.
 */
export default function SegmentedControl({ items, value, onChange, ariaLabel }: Props) {
  const { language } = useI18n()
  const move = (from: number, step: number) => {
    const next = items[(from + step + items.length) % items.length]
    onChange(next.id)
    document.getElementById(`seg-${ariaLabel}-${next.id}`)?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label={translate(ariaLabel)}
      className="inline-flex gap-0.5 rounded-[10px] border border-shop-border bg-[#eef1f5] p-[3px]"
    >
      {items.map((item, index) => {
        const on = item.id === value
        return (
          <button
            key={item.id}
            id={`seg-${ariaLabel}-${item.id}`}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') {
                event.preventDefault()
                move(index, language === 'ar' || language === 'he' ? -1 : 1)
              } else if (event.key === 'ArrowLeft') {
                event.preventDefault()
                move(index, language === 'ar' || language === 'he' ? 1 : -1)
              }
            }}
            className={`inline-flex h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[7px] px-3 text-[13px] font-semibold max-sm:h-11 ${
              on ? 'bg-white text-shop-ink shadow-[0_1px_2px_rgb(16_24_40/0.08),0_1px_3px_rgb(16_24_40/0.06)]' : 'text-slate-600 hover:bg-white/60 hover:text-shop-ink'
            }`}
          >
            {item.icon && <span className="flex [&_svg]:size-4">{item.icon}</span>}
            {translate(item.label)}
            {item.count != null && <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${on ? 'bg-tint text-shop-accent' : 'text-shop-muted'}`}>{item.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
