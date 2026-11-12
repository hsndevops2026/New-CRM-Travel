import { t as translate, useI18n } from '../lib/i18n'
import { useRef, useState } from 'react'
import { Check, Eye, Lock } from 'lucide-react'
import Button from './ui/Button'
import { formatDate } from '../lib/leads'
import { upsertQuoteDraft, type DraftConfig, type QuoteDraft } from '../lib/quoteDrafts'

type Props = {
  leadId: string
  draft: QuoteDraft | null
  onDraftChange: (draft: QuoteDraft) => void
}

function fmt(value: number, currency = 'USD') {
  return value.toLocaleString(undefined, { style: 'currency', currency, maximumFractionDigits: 2 })
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  useI18n()
  return (
    <div className={`flex items-center justify-between gap-3 py-0.5 text-sm tabular-nums ${strong ? 'font-bold' : ''}`}>
      <span className={strong ? '' : 'text-shop-muted'}>{translate(label)}</span>
      <span>{value}</span>
    </div>
  )
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'SAR', 'EGP', 'INR', 'TRY', 'THB']
const FIELD =
  'h-9 w-full rounded-lg border border-line-strong bg-white px-2.5 text-sm tabular-nums max-sm:h-11'
const LABEL = 'text-xs font-semibold text-slate-600'

export default function PricingPanel({ leadId, draft, onDraftChange }: Props) {
  useI18n()
  const [config, setConfig] = useState<DraftConfig>({
    currency: draft?.currency ?? 'USD',
    markup_type: draft?.markup_type ?? 'percent',
    markup_value: draft?.markup_value ?? 0,
    extras_amount: draft?.extras_amount ?? 0,
    extras_label: draft?.extras_label ?? '',
    rounding_mode: draft?.rounding_mode ?? 'none',
    notes: draft?.notes ?? '',
    valid_until: draft?.valid_until ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [syncedDraftId, setSyncedDraftId] = useState(draft?.id)
  if (draft && draft.id !== syncedDraftId) {
    setSyncedDraftId(draft.id)
    setConfig({
      currency: draft.currency,
      markup_type: draft.markup_type,
      markup_value: draft.markup_value,
      extras_amount: draft.extras_amount,
      extras_label: draft.extras_label ?? '',
      rounding_mode: draft.rounding_mode,
      notes: draft.notes ?? '',
      valid_until: draft.valid_until ?? '',
    })
  }

  const save = async (cfg: DraftConfig) => {
    setSaving(true)
    setError(null)
    try {
      const updated = await upsertQuoteDraft(leadId, cfg)
      onDraftChange(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const patch = (partial: Partial<DraftConfig>) => {
    const next = { ...config, ...partial }
    setConfig(next)
    // debounce auto-save for numeric fields
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void save(next), 600)
  }

  const pricing = draft?.pricing
  const currency = config.currency || 'USD'
  const items = draft?.items ?? []
  const hasItems = items.length > 0
  const rounding = pricing ? Math.max(0, pricing.selling_price - pricing.subtotal) : 0
  const underCost = Boolean(pricing && pricing.gross_margin < 0)
  const customerLine = hasItems
    ? [...items.map((item) => item.label), ...(pricing && pricing.extras_amount > 0 ? [config.extras_label || 'extras'] : [])].join(' + ')
    : 'Select at least one option'

  return (
    <div className="flex flex-col gap-3">
      <section aria-labelledby="pricing-h" className="flex flex-col gap-3.5 rounded-[10px] border border-shop-border bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 id="pricing-h" className="text-base font-bold">{translate("Pricing")}</h2>
          <span role="status" className={`flex items-center gap-1 text-xs ${error ? 'text-danger-fg' : 'text-shop-accent'}`}>
            {error ? (
              error
            ) : saving ? (
              <span className="text-shop-muted">{translate("Saving…")}</span>
            ) : saved ? (
              <>
                <Check className="size-3.5" aria-hidden="true" />
                {translate("Saved")}</>
            ) : null}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1">
            <span className={LABEL}>{translate("Currency")}</span>
            <select value={config.currency} onChange={(e) => patch({ currency: e.target.value })} className={FIELD}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>

          <div className="grid gap-1">
            <span id="markup-type" className={LABEL}>{translate("Markup type")}</span>
            <div role="radiogroup" aria-labelledby="markup-type" className="flex h-9 rounded-lg border border-line-strong bg-white p-0.5 max-sm:h-11">
              {(['percent', 'fixed'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={config.markup_type === kind}
                  onClick={() => patch({ markup_type: kind })}
                  className={`flex-1 rounded-md text-[13px] font-semibold ${
                    config.markup_type === kind ? 'bg-shop-ink text-white' : 'text-neutral-fg hover:bg-neutral-bg'
                  }`}
                >
                  {kind === 'percent' ? '%' : translate('Fixed')}
                </button>
              ))}
            </div>
          </div>

          <label className="col-span-2 grid gap-1">
            <span className={LABEL}>{translate("Markup")}{' '}{config.markup_type === 'percent' ? '(%)' : `(${currency})`}</span>
            <input
              type="number"
              min={0}
              step={config.markup_type === 'percent' ? 0.5 : 1}
              value={config.markup_value ?? 0}
              onChange={(e) => patch({ markup_value: Number(e.target.value) })}
              className={FIELD}
            />
          </label>

          <label className="grid gap-1">
            <span className={LABEL}>{translate("Extras label")}</span>
            <input
              type="text"
              placeholder={translate("e.g. Visa support fee")}
              value={config.extras_label ?? ''}
              onChange={(e) => patch({ extras_label: e.target.value })}
              className={FIELD}
            />
          </label>
          <label className="grid gap-1">
            <span className={LABEL}>{translate("Extras amount")}</span>
            <input
              type="number"
              min={0}
              step={1}
              value={config.extras_amount ?? 0}
              onChange={(e) => patch({ extras_amount: Number(e.target.value) })}
              className={FIELD}
            />
          </label>

          <label className="grid gap-1">
            <span className={LABEL}>{translate("Rounding")}</span>
            <select
              value={config.rounding_mode}
              onChange={(e) => patch({ rounding_mode: e.target.value as DraftConfig['rounding_mode'] })}
              className={FIELD}
            >
              <option value="none">{translate("None (2dp)")}</option>
              <option value="round">{translate("Round to whole")}</option>
              <option value="ceil">{translate("Ceiling (always up)")}</option>
              <option value="floor">{translate("Floor (always down)")}</option>
            </select>
          </label>
          <label className="grid gap-1">
            <span className={LABEL}>{translate("Valid until")}</span>
            <input
              type="date"
              value={config.valid_until ?? ''}
              onChange={(e) => patch({ valid_until: e.target.value || null })}
              className={FIELD}
            />
          </label>

          <label className="col-span-2 grid gap-1">
            <span className={LABEL}>{translate("Internal notes")}</span>
            <textarea
              rows={2}
              className="resize-y rounded-lg border border-line-strong px-2.5 py-2 text-sm"
              placeholder={translate("Optional notes for staff")}
              value={config.notes ?? ''}
              onChange={(e) => patch({ notes: e.target.value })}
            />
          </label>
        </div>

        <div className="flex justify-end">
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => void save(config)} className="text-shop-accent">
            {translate("Save now")}</Button>
        </div>
      </section>

      <section aria-labelledby="internal-h" className="flex flex-col rounded-[10px] border border-dashed border-[#94A3B8] bg-slate-50 px-4 py-3.5">
        <div className="mb-1.5 flex items-center justify-between">
          <span id="internal-h" className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.06em] text-slate-700 uppercase">
            <Lock className="size-3.5" aria-hidden="true" />
            {translate("Internal only · never sent")}</span>
          <span className="text-xs text-shop-muted tabular-nums">
            {translate("{count} item{suffix}", { count: items.length, suffix: items.length === 1 ? '' : 's' })}
          </span>
        </div>
        {hasItems && draft?.issues && (draft.issues.missing_cost.length > 0 || draft.issues.other_currency.length > 0) && (
          <div role="alert" className="mb-3 rounded-lg bg-danger-bg px-3 py-2 text-[13px] text-danger-fg">
            <p className="font-semibold">{translate('Fix these before locking the quote:')}</p>
            <ul className="mt-1 list-disc ps-5">
              {draft.issues.missing_cost.map((i) => (
                <li key={`m-${i.id}`}><bdi>{i.label}</bdi>: {translate('no price')}</li>
              ))}
              {draft.issues.other_currency.map((i) => (
                <li key={`c-${i.id}`}>
                  <bdi>{i.label}</bdi>: {translate('priced in {value0}, the quote is in {value1}. Totals are not converted.', { value0: i.currency, value1: currency })}
                </li>
              ))}
            </ul>
          </div>
        )}
        {!hasItems || !pricing ? (
          <p className="py-3 text-center text-sm text-shop-muted">{translate("Select options to see pricing.")}</p>
        ) : (
          <>
            <Row label={translate("Net total")} value={fmt(pricing.net_total, currency)} />
            <Row
              label={translate("Markup ({value0})", { value0: translate(String(config.markup_type === 'percent' ? `${Number(config.markup_value)}%` : 'fixed')) })}
              value={`+ ${fmt(pricing.markup_amount, currency)}`}
            />
            {pricing.extras_amount > 0 && (
              <Row label={config.extras_label || 'Extras'} value={`+ ${fmt(pricing.extras_amount, currency)}`} />
            )}
            {rounding > 0.004 && <Row label={translate("Rounding")} value={`+ ${fmt(rounding, currency)}`} />}
            <div className="my-1.5 h-px bg-line-strong" />
            <div className="flex items-center justify-between gap-3 text-sm font-bold tabular-nums">
              <span>{translate("Gross margin")}</span>
              <span className={underCost ? 'text-danger' : 'text-shop-accent'}>
                {fmt(pricing.gross_margin, currency)}
                {pricing.gross_margin_pct != null ? ` · ${pricing.gross_margin_pct}%` : ''}
              </span>
            </div>
            {underCost && <span className="text-xs font-semibold text-danger">{translate("Selling below cost")}</span>}
          </>
        )}
      </section>

      <section aria-labelledby="customer-h" className="flex flex-col gap-1.5 rounded-[10px] border-2 border-shop-accent bg-white px-4 py-3.5">
        <span id="customer-h" className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.06em] text-shop-accent uppercase">
          <Eye className="size-3.5" aria-hidden="true" />
          {translate("Customer sees")}</span>
        <div className="flex items-baseline justify-between gap-3">
          <span>{translate("Selling price")}</span>
          <span className="text-[28px] font-extrabold tracking-[-0.01em] tabular-nums">
            {hasItems && pricing ? fmt(pricing.selling_price, currency) : '—'}
          </span>
        </div>
        <span className="text-[13px] text-shop-muted">
          {customerLine}
          {config.valid_until ? translate(" · valid until {value0}", { value0: translate(String(formatDate(config.valid_until))) }) : ''}
        </span>
      </section>
    </div>
  )
}
