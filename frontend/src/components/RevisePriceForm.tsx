import { useState } from 'react'
import Button from './ui/Button'
import { t as translate, useI18n } from '../lib/i18n'
import { revisePrice, type QuoteVersion } from '../lib/quoteVersions'

function fmt(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

/**
 * The customer asked for a better price: type the agreed total and lock it as a new
 * version. Items stay the same; only the profit changes. Shows the profit as you type.
 */
export default function RevisePriceForm({ leadId, version, onDone, onCancel }: {
  leadId: string
  version: QuoteVersion
  onDone: (next: QuoteVersion) => void
  onCancel: () => void
}) {
  useI18n()
  const currency = version.currency || 'USD'
  const pricing = version.snapshot?.pricing
  const cost = Number(pricing?.net_total ?? 0) + Number(pricing?.extras_amount ?? 0)
  const [price, setPrice] = useState(String(version.selling_price ?? ''))
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const value = Number(price)
  const valid = Number.isFinite(value) && value > 0
  const profit = valid ? Math.round((value - cost) * 100) / 100 : null
  const pct = profit != null && value > 0 ? (profit / value) * 100 : null
  const belowCost = profit != null && profit < 0

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid || belowCost) return
    setSaving(true)
    setError(null)
    try {
      onDone(await revisePrice(leadId, value, note.trim() || undefined))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the new price')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="mx-4 mb-3 flex flex-col gap-2.5 rounded-lg border border-shop-border bg-slate-50 p-3">
      <p className="text-[13px] font-semibold">{translate('New price for the customer')}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-semibold text-shop-muted">
          {translate('Total price ({value0})', { value0: currency })}
          <input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            autoFocus
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="h-10 w-40 rounded-lg border border-line-strong bg-white px-2.5 text-sm tabular-nums"
          />
        </label>
        {profit != null && (
          <p className={`pb-2 text-[13px] tabular-nums ${belowCost ? 'font-semibold text-danger-fg' : 'text-shop-muted'}`}>
            {belowCost
              ? translate('Below cost by {value0}', { value0: fmt(-profit, currency) })
              : translate('Profit {value0} ({value1}%) · internal', { value0: fmt(profit, currency), value1: (pct ?? 0).toFixed(1) })}
          </p>
        )}
      </div>
      <input
        dir="auto"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={translate('Note (optional), e.g. discount agreed on the phone')}
        aria-label={translate('Note (optional), e.g. discount agreed on the phone')}
        className="h-10 rounded-lg border border-line-strong bg-white px-2.5 text-sm"
      />
      {error && <p role="alert" className="text-[13px] text-danger-fg">{translate(error)}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" loading={saving} disabled={!valid || belowCost}>
          {translate('Save as v{value0}', { value0: version.version_number + 1 })}
        </Button>
        <Button type="button" size="sm" onClick={onCancel}>{translate('Cancel')}</Button>
      </div>
    </form>
  )
}
