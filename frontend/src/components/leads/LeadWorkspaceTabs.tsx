import { t as translate, useI18n } from '../../lib/i18n'
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
  useI18n()
  return (
    <nav aria-label={translate("Lead workspace steps")} className="-mx-1 flex gap-1 overflow-x-auto pb-2.5 max-md:mx-0 max-md:gap-1.5 max-md:px-2 max-md:pb-2">
      {QUOTE_STEPS.map((item, index) => {
        const on = step === item.id
        const badge = badges[item.id]
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-current={on ? 'page' : undefined}
            className={`relative flex shrink-0 items-center gap-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors md:h-10 md:px-3 max-md:h-9 max-md:gap-1.5 max-md:rounded-full max-md:border max-md:px-3 ${
              on
                ? 'bg-tint text-primary-800 md:after:absolute md:after:inset-x-3 md:after:-bottom-2.5 md:after:h-[3px] md:after:rounded-t-full md:after:bg-shop-accent max-md:border-shop-accent max-md:bg-shop-accent max-md:text-white'
                : 'text-slate-600 hover:bg-shop-bg hover:text-shop-ink max-md:border-shop-border max-md:bg-white'
            }`}
          >
            <span
              aria-hidden="true"
              className={`grid size-5 place-items-center rounded-full text-[11px] font-bold max-md:hidden ${
                on ? 'bg-shop-accent text-white shadow-[0_1px_2px_rgb(15_118_110/0.35)]' : 'bg-neutral-bg text-slate-600'
              }`}
            >
              {index + 1}
            </span>
            <span className="hidden max-md:inline tabular-nums">{index + 1}</span>
            {translate(item.label)}
            {badge ? (
              <StatusBadge
                label={translate(badge.label)}
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
