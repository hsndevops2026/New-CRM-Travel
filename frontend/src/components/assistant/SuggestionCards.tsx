import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import Button from '../ui/Button'
import { suggestionsToText, type AssistantSuggestion } from '../../lib/assistant'
import { t as translate, useI18n } from '../../lib/i18n'

export default function SuggestionCards({ cards }: { cards: AssistantSuggestion[] }) {
  useI18n()
  const [picked, setPicked] = useState<boolean[]>(() => cards.map(() => false))
  const [copied, setCopied] = useState(false)
  const chosen = cards.filter((_, i) => picked[i])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(suggestionsToText(chosen))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      {cards.map((card, i) => (
        <label
          key={i}
          dir="auto"
          className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 text-sm ${
            picked[i] ? 'border-shop-ink bg-white' : 'border-shop-border bg-white'
          }`}
        >
          <input
            type="checkbox"
            className="mt-1"
            checked={picked[i]}
            onChange={(e) => setPicked((prev) => prev.map((v, j) => (j === i ? e.target.checked : v)))}
          />
          <span className="flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-shop-ink">{card.title}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  card.source === 'system' ? 'bg-dealer-bg text-dealer-fg' : 'bg-warn-bg text-[#78350F]'
                }`}
              >
                {card.source === 'system' ? translate('From the system') : translate('General suggestion, not from the system')}
              </span>
              {card.price != null && card.currency ? (
                <span dir="ltr" className="text-xs font-bold text-shop-ink tabular-nums">
                  {card.price.toLocaleString('en-US')} {card.currency}
                </span>
              ) : null}
            </span>
            <span className="mt-1 block whitespace-pre-wrap text-shop-muted">{card.details}</span>
          </span>
        </label>
      ))}
      <div className="flex items-center gap-2">
        <Button variant="primary" icon={copied ? <Check /> : <Copy />} disabled={!chosen.length} onClick={() => void copy()}>
          {copied ? translate('Copied') : translate('Copy selected for the customer')}
        </Button>
        <span className="text-xs text-shop-muted">
          {translate('Check dates, opening hours and availability before sending.')}
        </span>
      </div>
    </div>
  )
}
