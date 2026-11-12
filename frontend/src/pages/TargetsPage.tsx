import { useEffect, useState } from 'react'
import { Target } from 'lucide-react'
import Button from '../components/ui/Button'
import PageHeader from '../components/ui/PageHeader'
import { useAuth } from '../context/AuthContext'
import { locale, t as translate, useI18n } from '../lib/i18n'
import { fetchTargets, money, saveTarget, type TargetRow } from '../lib/business'

const FIELD = 'h-9 rounded-lg border border-line-strong bg-white px-2 text-sm tabular-nums'

function Row({ row, month, isAdmin, onSaved }: { row: TargetRow; month: string; isAdmin: boolean; onSaved: (rows: TargetRow[]) => void }) {
  useI18n()
  const [editing, setEditing] = useState(false)
  const [target, setTarget] = useState(String(row.target_amount ?? ''))
  const [pct, setPct] = useState(String(row.commission_pct ?? 0))
  const [cur, setCur] = useState(row.currency)
  const [error, setError] = useState<string | null>(null)
  const progress = Math.min(100, row.progress_pct ?? 0)

  const save = async () => {
    setError(null)
    try {
      const res = await saveTarget({ admin_id: row.id, month, target_amount: Number(target || 0), currency: cur, commission_pct: Number(pct || 0) })
      onSaved(res.people)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    }
  }

  return (
    <li className="rounded-[10px] border border-shop-border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-semibold" dir="ltr">{row.email}</p>
        {isAdmin && !editing && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>{translate(row.target_amount ? 'Edit target' : 'Set target')}</Button>}
      </div>
      {editing ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          {translate('Target')}
          <input type="number" min={0} aria-label={translate('Target')} className={`${FIELD} w-28`} value={target} onChange={(e) => setTarget(e.target.value)} />
          <input aria-label={translate('Currency')} maxLength={3} className={`${FIELD} w-16 uppercase`} value={cur} onChange={(e) => setCur(e.target.value.toUpperCase())} />
          {translate('Commission')}
          <input type="number" min={0} max={100} step={0.5} aria-label={translate('Commission')} className={`${FIELD} w-20`} value={pct} onChange={(e) => setPct(e.target.value)} />
          {translate('% of profit')}
          <Button size="sm" variant="primary" onClick={() => void save()}>{translate('Save')}</Button>
          <Button size="sm" onClick={() => setEditing(false)}>{translate('Cancel')}</Button>
          {error && <span role="alert" className="text-xs text-danger-fg">{translate(error)}</span>}
        </div>
      ) : (
        <>
          {row.target_amount ? (
            <div className="mt-2">
              <div className="h-2.5 overflow-hidden rounded-full bg-neutral-bg" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={translate('Progress to target')}>
                <div className={`h-full ${progress >= 100 ? 'bg-primary-700' : 'bg-primary-500'}`} style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-1 text-xs text-shop-muted tabular-nums">
                {translate('{value0} of {value1} ({value2}%)', { value0: money(row.sales, row.currency), value1: money(row.target_amount, row.currency), value2: row.progress_pct ?? 0 })}
              </p>
            </div>
          ) : <p className="mt-1 text-xs text-shop-muted">{translate('No target this month.')}</p>}
          <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
            <div><dt className="text-xs text-shop-muted">{translate('Bookings')}</dt><dd className="font-bold tabular-nums">{row.bookings}</dd></div>
            <div><dt className="text-xs text-shop-muted">{translate('Profit')}</dt><dd className="font-bold tabular-nums">{money(row.profit, row.currency)}</dd></div>
            <div><dt className="text-xs text-shop-muted">{translate('Commission ({value0}%)', { value0: row.commission_pct })}</dt><dd className="font-bold tabular-nums text-primary-800">{money(row.commission, row.currency)}</dd></div>
          </dl>
          {row.other_currency_bookings > 0 && <p className="mt-2 text-xs text-amber-800">{translate('{value0} booking(s) in another currency are not counted.', { value0: row.other_currency_bookings })}</p>}
        </>
      )}
    </li>
  )
}

/** Monthly targets and commission. Managers set them; each employee sees their own. */
export default function TargetsPage() {
  useI18n()
  const { admin } = useAuth()
  const isAdmin = admin?.role === 'admin'
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [rows, setRows] = useState<TargetRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchTargets(month)
      .then((r) => { if (!cancelled) { setRows(r.people); setError(null) } })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load') })
    return () => { cancelled = true }
  }, [month])

  const label = new Date(`${month}-15T12:00:00`).toLocaleDateString(locale(), { month: 'long', year: 'numeric' })

  return (
    <div className="mx-auto w-full max-w-[900px] p-4 pb-24 sm:p-6">
      <PageHeader
        title="Targets"
        subtitle={translate('Sales from quotes accepted in {value0}. Commission is a share of the profit.', { value0: label })}
        actions={<input type="month" aria-label={translate('Month')} className="h-10 rounded-lg border border-shop-border px-2 text-sm" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />}
      />
      {error && <p role="alert" className="mb-3 text-sm text-danger-fg">{translate(error)}</p>}
      {!rows ? <p className="text-sm text-shop-muted">{translate('Loading…')}</p> : rows.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-shop-muted"><Target className="size-4" aria-hidden="true" />{translate('No staff yet.')}</p>
      ) : (
        <ul className="grid gap-3">
          {rows.map((r) => <Row key={`${r.id}-${month}`} row={r} month={month} isAdmin={isAdmin} onSaved={setRows} />)}
        </ul>
      )}
    </div>
  )
}
