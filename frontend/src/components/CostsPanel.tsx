import { useEffect, useState } from 'react'
import { Receipt, Trash2 } from 'lucide-react'
import Button from './ui/Button'
import { t as translate, useI18n } from '../lib/i18n'
import { addCost, fetchCosts, money, removeCost, setCostPaid, type CostList } from '../lib/business'

const FIELD = 'h-10 rounded-lg border border-line-strong bg-white px-2.5 text-sm'

/** What suppliers were really paid for this booking, and the profit that leaves. Internal. */
export default function CostsPanel({ leadId }: { leadId: string }) {
  useI18n()
  const [data, setData] = useState<CostList | null>(null)
  const [description, setDescription] = useState('')
  const [supplier, setSupplier] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchCosts(leadId).then((d) => { if (!cancelled) setData(d) }).catch(() => {})
    return () => { cancelled = true }
  }, [leadId])

  if (!data) return null
  const s = data.summary
  const cur = currency || s.currency || 'USD'

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      setData(await addCost(leadId, { description, supplier: supplier || undefined, amount: Number(amount), currency: cur }))
      setDescription('')
      setSupplier('')
      setAmount('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    }
  }

  return (
    <section aria-labelledby="cost-h" className="rounded-[10px] border border-shop-border bg-white p-4">
      <h3 id="cost-h" className="mb-1 flex items-center gap-2 text-[15px] font-bold">
        <Receipt className="size-4" aria-hidden="true" />
        {translate('Actual costs and profit')}
      </h3>
      <p className="mb-3 text-xs text-shop-muted">{translate('What the suppliers were really paid. Only staff see this.')}</p>
      {s.price != null && (
        <dl className="mb-3 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-center text-sm">
          <div><dt className="text-xs text-shop-muted">{translate('Sold for')}</dt><dd className="font-bold tabular-nums">{money(s.price, s.currency)}</dd></div>
          <div><dt className="text-xs text-shop-muted">{translate('Costs')}</dt><dd className="font-bold tabular-nums">{money(s.costs, s.currency)}</dd></div>
          <div>
            <dt className="text-xs text-shop-muted">{translate('Profit')}</dt>
            <dd className={`font-bold tabular-nums ${s.profit != null && s.profit < 0 ? 'text-danger-fg' : 'text-primary-800'}`}>
              {money(s.profit, s.currency)}{s.margin_pct != null ? ` (${s.margin_pct}%)` : ''}
            </dd>
          </div>
        </dl>
      )}
      {s.other_currency && <p className="mb-2 text-xs font-semibold text-amber-800">{translate('Some costs are in another currency and are not in the profit.')}</p>}
      {data.costs.length > 0 && (
        <ul className="mb-3 divide-y divide-shop-border">
          {data.costs.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p dir="auto" className="font-semibold">{c.description}</p>
                {c.supplier && <p dir="auto" className="text-xs text-shop-muted">{c.supplier}</p>}
              </div>
              <span className="tabular-nums">{money(c.amount, c.currency)}</span>
              <label className="inline-flex items-center gap-1 text-xs text-shop-muted">
                <input type="checkbox" checked={c.paid} onChange={(e) => void setCostPaid(leadId, c.id, e.target.checked).then(setData).catch(() => {})} />
                {translate('Paid')}
              </label>
              <button type="button" aria-label={translate('Delete {value0}', { value0: c.description })} className="inline-flex size-8 items-center justify-center rounded-md text-danger-fg hover:bg-danger-bg" onClick={() => void removeCost(leadId, c.id).then(setData).catch(() => {})}>
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto_auto]">
        <input aria-label={translate('What for')} placeholder={translate('What for, e.g. Hotel 4 nights')} className={FIELD} dir="auto" value={description} onChange={(e) => setDescription(e.target.value)} />
        <input aria-label={translate('Supplier')} placeholder={translate('Supplier')} className={FIELD} dir="auto" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        <input aria-label={translate('Amount')} type="number" min={0} step="any" placeholder={translate('Amount')} className={`${FIELD} w-28`} value={amount} onChange={(e) => setAmount(e.target.value)} />
        <input aria-label={translate('Currency')} className={`${FIELD} w-20 uppercase`} maxLength={3} value={cur} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        <Button type="submit" size="sm" variant="primary" disabled={!description.trim() || amount === ''}>{translate('Add')}</Button>
      </form>
      {error && <p role="alert" className="mt-2 text-xs text-danger-fg">{translate(error)}</p>}
    </section>
  )
}
