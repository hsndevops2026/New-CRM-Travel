import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Copy, ListPlus, Pencil } from 'lucide-react'
import Button from '../ui/Button'
import { suggestionsToText, type AssistantLead, type AssistantSuggestion } from '../../lib/assistant'
import { fetchLeads, type Lead } from '../../lib/leads'
import { addTripPlanItems } from '../../lib/tripPlan'
import { t as translate, useI18n } from '../../lib/i18n'

type Props = {
  cards: AssistantSuggestion[]
  /** The customer the assistant linked these ideas to, if it could tell. */
  lead?: AssistantLead | null
}

function leadLabel(lead: Lead) {
  return [lead.contact_name || lead.phone, lead.destination].filter(Boolean).join(' · ')
}

export default function SuggestionCards({ cards: initialCards, lead }: Props) {
  useI18n()
  const [cards, setCards] = useState<AssistantSuggestion[]>(initialCards)
  const [picked, setPicked] = useState<boolean[]>(() => initialCards.map(() => false))
  const [editing, setEditing] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const [target, setTarget] = useState<AssistantLead | null>(lead ?? null)
  const [choosing, setChoosing] = useState(false)
  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const chosen = cards.filter((_, i) => picked[i])

  useEffect(() => {
    if (!choosing || leads) return
    fetchLeads()
      .then(setLeads)
      .catch(() => setError('Failed to load customers'))
  }, [choosing, leads])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(suggestionsToText(chosen))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const addToProgram = async () => {
    if (!target) {
      setChoosing(true)
      return
    }
    setAdding(true)
    setError(null)
    try {
      await addTripPlanItems(
        target.id,
        chosen.map((c) => ({ title: c.title, details: c.details, kind: c.kind, source: c.source, package_id: c.package_id })),
      )
      setAdded(target.id)
      setPicked(cards.map(() => false))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add to the trip program')
    } finally {
      setAdding(false)
    }
  }

  const updateCard = (i: number, patch: Partial<AssistantSuggestion>) =>
    setCards((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  return (
    <div className="mt-2 flex flex-col gap-2">
      {cards.map((card, i) => (
        <div
          key={i}
          dir="auto"
          className={`flex items-start gap-3 rounded-xl border bg-white px-3 py-2.5 text-sm ${
            picked[i] ? 'border-shop-ink' : 'border-shop-border'
          }`}
        >
          <input
            type="checkbox"
            className="mt-1"
            aria-label={card.title}
            checked={picked[i]}
            onChange={(e) => setPicked((prev) => prev.map((v, j) => (j === i ? e.target.checked : v)))}
          />
          <div className="flex-1">
            {editing === i ? (
              <div className="flex flex-col gap-2">
                <input
                  value={card.title}
                  onChange={(e) => updateCard(i, { title: e.target.value })}
                  aria-label={translate('Title')}
                  className="rounded-lg border border-shop-border px-2.5 py-1.5 text-sm text-shop-ink"
                  dir="auto"
                />
                <textarea
                  rows={3}
                  value={card.details}
                  onChange={(e) => updateCard(i, { details: e.target.value })}
                  aria-label={translate('Details')}
                  className="resize-y rounded-lg border border-shop-border px-2.5 py-1.5 text-sm text-shop-ink"
                  dir="auto"
                />
                <div>
                  <Button variant="primary" icon={<Check />} onClick={() => setEditing(null)}>{translate('Done')}</Button>
                </div>
              </div>
            ) : (
              <>
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
              </>
            )}
          </div>
          {editing !== i && (
            <Button variant="ghost" iconOnly aria-label={translate('Edit')} icon={<Pencil />} onClick={() => setEditing(i)} />
          )}
        </div>
      ))}

      {choosing && !target && (
        <label className="flex flex-col gap-1 text-xs text-shop-muted">
          {translate('Which customer is this for?')}
          <select
            defaultValue=""
            onChange={(e) => {
              const found = leads?.find((l) => l.id === e.target.value)
              if (found) {
                setTarget({ id: found.id, customer_name: found.contact_name || found.phone, destination: found.destination })
                setChoosing(false)
              }
            }}
            className="rounded-lg border border-shop-border bg-white px-2 py-1.5 text-sm text-shop-ink"
          >
            <option value="" disabled>{leads ? translate('Choose a customer') : translate('Loading…')}</option>
            {(leads || []).map((l) => (
              <option key={l.id} value={l.id}>{leadLabel(l)}</option>
            ))}
          </select>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon={<ListPlus />} disabled={!chosen.length || adding} onClick={() => void addToProgram()}>
          {target
            ? translate("Add to {value0}'s trip program", { value0: target.customer_name || target.destination || translate('the customer') })
            : translate('Add to a customer’s trip program')}
        </Button>
        <Button variant="ghost" icon={copied ? <Check /> : <Copy />} disabled={!chosen.length} onClick={() => void copy()}>
          {copied ? translate('Copied') : translate('Copy')}
        </Button>
        {target && lead == null ? (
          <Button variant="ghost" onClick={() => { setTarget(null); setChoosing(true) }}>{translate('Change customer')}</Button>
        ) : null}
      </div>
      {added ? (
        <p className="text-xs text-shop-muted">
          {translate('Added.')}{' '}
          <Link className="font-bold text-shop-ink underline" to={`/leads/${added}?step=trip`}>
            {translate('Open the trip program')}
          </Link>
        </p>
      ) : null}
      {error ? <p className="text-xs text-red-600">{translate(error)}</p> : null}
      <p className="text-xs text-shop-muted">{translate('Check dates, opening hours and availability before sending.')}</p>
    </div>
  )
}
