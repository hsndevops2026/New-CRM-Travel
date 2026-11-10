import { t as translate, useI18n } from '../../lib/i18n'
type Pill = {
  id: string
  label: string
  /** Shown after the label, e.g. how many conversations match. */
  count?: number
}

type Props = {
  items: Pill[]
  value: string
  onChange: (id: string) => void
  ariaLabel?: string
}

/** Filter pills (design system): one is on at a time; the on pill is solid ink. */
export default function FilterPills({ items, value, onChange, ariaLabel }: Props) {
  useI18n()
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={ariaLabel}>
      {items.map((item) => {
        const on = item.id === value
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(item.id)}
            className={`inline-flex h-[30px] items-center gap-1.5 rounded-full border px-2.5 text-[13px] font-semibold max-sm:h-10 ${
              on
                ? 'border-shop-ink bg-shop-ink text-white'
                : 'border-shop-border bg-white text-neutral-fg hover:bg-neutral-bg'
            }`}
          >
            {translate(item.label)}
            {item.count != null && (
              <span className={`tabular-nums ${on ? 'opacity-70' : 'text-shop-muted'}`}>{item.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
