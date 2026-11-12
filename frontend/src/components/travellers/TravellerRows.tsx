import { Trash2 } from 'lucide-react'
import { t as translate, useI18n } from '../../lib/i18n'
import { ISSUE_TEXT, type Traveller } from '../../lib/travellers'

const FIELD = 'h-10 w-full rounded-lg border border-line-strong bg-white px-2.5 text-sm'

/** The editable traveller rows, shared by the lead page and the customer's form. */
export default function TravellerRows({ rows, onChange, showIssues = false }: {
  rows: Traveller[]
  onChange: (rows: Traveller[]) => void
  showIssues?: boolean
}) {
  useI18n()
  const set = (i: number, patch: Partial<Traveller>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <ol className="grid gap-3">
      {rows.map((row, i) => (
        <li key={i} className="rounded-lg border border-shop-border bg-white p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <strong className="text-sm">
              {translate(row.is_child ? 'Child {value0}' : 'Traveller {value0}', { value0: i + 1 })}
            </strong>
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-1.5 text-xs text-shop-muted">
                <input type="checkbox" checked={row.is_child} onChange={(e) => set(i, { is_child: e.target.checked })} />
                {translate('Child')}
              </label>
              {rows.length > 1 && (
                <button
                  type="button"
                  className="inline-flex size-8 items-center justify-center rounded-md text-danger-fg hover:bg-danger-bg"
                  aria-label={translate('Remove traveller {value0}', { value0: i + 1 })}
                  onClick={() => onChange(rows.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-shop-muted sm:col-span-2">
              {translate('Full name as in the passport')}
              <input className={FIELD} dir="ltr" autoComplete="off" value={row.full_name} onChange={(e) => set(i, { full_name: e.target.value })} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-shop-muted">
              {translate('Date of birth')}
              <input type="date" className={FIELD} value={row.date_of_birth || ''} onChange={(e) => set(i, { date_of_birth: e.target.value || null })} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-shop-muted">
              {translate('Nationality')}
              <input className={FIELD} value={row.nationality || ''} onChange={(e) => set(i, { nationality: e.target.value || null })} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-shop-muted">
              {translate('Passport number')}
              <input className={`${FIELD} uppercase`} dir="ltr" autoComplete="off" value={row.passport_number || ''} onChange={(e) => set(i, { passport_number: e.target.value || null })} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-shop-muted">
              {translate('Passport expiry date')}
              <input type="date" className={FIELD} value={row.passport_expiry || ''} onChange={(e) => set(i, { passport_expiry: e.target.value || null })} />
            </label>
          </div>
          {showIssues && row.issues && row.issues.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {row.issues.map((issue) => (
                <li
                  key={issue}
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    issue.startsWith('missing') ? 'bg-neutral-bg text-neutral-fg' : 'bg-danger-bg text-danger-fg'
                  }`}
                >
                  {translate(ISSUE_TEXT[issue])}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  )
}
