import { QUOTE_STEPS, type QuoteStep } from '../../lib/lifecycle'
import type { TabBadges } from '../../lib/leadTabs'
import StatusBadge from '../ui/StatusBadge'

type Props = {
  step: QuoteStep
  onSelect: (step: QuoteStep) => void
  badges?: TabBadges
}

/**
 * The five working steps of a lead, numbered, with a status chip where there is something
 * to say. Underline-style tabs (design: 44px, 2px teal rule on the current one).
 */
export default function LeadWorkspaceTabs({ step, onSelect, badges = {} }: Props) {
  return (
    <nav aria-label="Lead workspace steps" className="-mx-2 flex gap-0.5 overflow-x-auto max-md:mx-0 max-md:gap-1.5 max-md:px-2 max-md:pb-2">
      {QUOTE_STEPS.map((item, index) => {
        const on = step === item.id
        const badge = badges[item.id]
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-current={on ? 'page' : undefined}
            className={`flex shrink-0 items-center gap-2 text-sm font-semibold whitespace-nowrap md:h-11 md:border-b-2 md:px-3.5 max-md:h-9 max-md:gap-1.5 max-md:rounded-full max-md:border max-md:px-3 ${
              on
                ? 'border-shop-accent text-shop-ink max-md:bg-shop-accent max-md:text-white'
                : 'border-transparent text-slate-600 hover:text-shop-ink max-md:border-shop-border max-md:bg-white'
            }`}
          >
            <span
              aria-hidden="true"
              className={`grid size-5 place-items-center rounded-full text-[11px] font-bold max-md:hidden ${
                on ? 'bg-shop-accent text-white' : 'bg-neutral-bg text-slate-600'
              }`}
            >
              {index + 1}
            </span>
            <span className="hidden max-md:inline tabular-nums">{index + 1}</span>
            {item.label}
            {badge ? (
              <StatusBadge
                label={badge.label}
                tone={badge.tone === 'warning' ? 'warning' : badge.tone === 'success' ? 'success' : 'neutral'}
                className="tabular-nums"
              />
            ) : null}
          </button>
        )
      })}
    </nav>
  )
}
