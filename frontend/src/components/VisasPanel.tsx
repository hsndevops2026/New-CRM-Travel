import { useEffect, useState } from 'react'
import { Stamp } from 'lucide-react'
import Button from './ui/Button'
import { useAuth } from '../context/AuthContext'
import { t as translate, useI18n } from '../lib/i18n'
import { VISA_STATUS_LABEL, fetchVisas, saveVisaRule, updateVisa, type LeadVisas, type VisaStatus, type VisaTraveller } from '../lib/groupsVisas'

const FIELD = 'h-9 rounded-lg border border-line-strong bg-white px-2 text-sm'
const TONE: Partial<Record<VisaStatus, string>> = {
  approved: 'text-primary-800', not_needed: 'text-shop-muted', rejected: 'text-danger-fg font-semibold', applied: 'text-amber-800',
}

/** Visa progress per traveller, and what this destination asks for. */
export default function VisasPanel({ leadId }: { leadId: string }) {
  useI18n()
  const { admin } = useAuth()
  const [data, setData] = useState<LeadVisas | null>(null)
  const [editingRule, setEditingRule] = useState(false)
  const [docs, setDocs] = useState('')
  const [days, setDays] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchVisas(leadId).then((d) => { if (!cancelled) setData(d) }).catch(() => {})
    return () => { cancelled = true }
  }, [leadId])

  if (!data) return null

  const patch = async (t: VisaTraveller, input: Partial<VisaTraveller>) => {
    setError(null)
    try {
      const next = await updateVisa(leadId, t.id, input)
      setData((d) => (d ? { ...d, travellers: d.travellers.map((x) => (x.id === t.id ? { ...x, ...next } : x)) } : d))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    }
  }

  const saveRule = async () => {
    if (!data.destination) return
    try {
      const rule = await saveVisaRule({ destination: data.destination, requires_visa: true, documents: docs || null, processing_days: days ? Number(days) : null })
      setData((d) => (d ? { ...d, rule } : d))
      setEditingRule(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    }
  }

  return (
    <section aria-labelledby="visa-h" className="rounded-[10px] border border-shop-border bg-white p-4">
      <h3 id="visa-h" className="mb-2 flex items-center gap-2 text-[15px] font-bold">
        <Stamp className="size-4" aria-hidden="true" />
        {translate('Visas')}
      </h3>
      <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm">
        {editingRule ? (
          <div className="grid gap-2">
            <textarea rows={3} dir="auto" aria-label={translate('Documents needed')} placeholder={translate('Documents needed, e.g. passport, photo, bank statement')} className="rounded-lg border border-line-strong px-2.5 py-2 text-sm" value={docs} onChange={(e) => setDocs(e.target.value)} />
            <label className="flex items-center gap-2 text-xs text-shop-muted">
              {translate('Processing takes about')}
              <input type="number" min={0} max={365} className={`${FIELD} w-20`} value={days} onChange={(e) => setDays(e.target.value)} />
              {translate('days')}
            </label>
            <div className="flex gap-2">
              <Button size="sm" variant="primary" onClick={() => void saveRule()}>{translate('Save')}</Button>
              <Button size="sm" onClick={() => setEditingRule(false)}>{translate('Cancel')}</Button>
            </div>
          </div>
        ) : data.rule ? (
          <>
            <p className="font-semibold">{translate('{value0} asks for:', { value0: data.rule.destination })}</p>
            <p dir="auto" className="whitespace-pre-line text-shop-muted">{data.rule.documents || '—'}</p>
            {data.rule.processing_days != null && <p className="text-xs text-shop-muted">{translate('Processing takes about {value0} days', { value0: data.rule.processing_days })}</p>}
          </>
        ) : (
          <p className="text-shop-muted">{translate('No visa notes for {value0} yet.', { value0: data.destination || translate('this destination') })}</p>
        )}
        {!editingRule && admin?.role === 'admin' && data.destination && (
          <button type="button" className="mt-1 text-xs font-semibold text-shop-accent" onClick={() => { setDocs(data.rule?.documents || ''); setDays(data.rule?.processing_days?.toString() || ''); setEditingRule(true) }}>
            {translate(data.rule ? 'Edit' : 'Add what this destination needs')}
          </button>
        )}
      </div>
      {data.travellers.length === 0 ? (
        <p className="text-sm text-shop-muted">{translate('Add the travellers above first.')}</p>
      ) : (
        <ul className="divide-y divide-shop-border">
          {data.travellers.map((t) => (
            <li key={t.id} className="grid gap-2 py-2.5 sm:grid-cols-[1fr_auto_auto] sm:items-center">
              <span className={`text-sm font-semibold ${TONE[t.visa_status] || ''}`} dir="ltr">{t.full_name}</span>
              <select aria-label={translate('Visa status for {value0}', { value0: t.full_name })} className={FIELD} value={t.visa_status} onChange={(e) => void patch(t, { visa_status: e.target.value as VisaStatus })}>
                {(Object.keys(VISA_STATUS_LABEL) as VisaStatus[]).map((s) => <option key={s} value={s}>{translate(VISA_STATUS_LABEL[s])}</option>)}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-shop-muted">
                {translate('Answer expected')}
                <input type="date" className={FIELD} value={t.visa_expected_at || ''} onChange={(e) => void patch(t, { visa_expected_at: e.target.value || null })} />
              </label>
              <input dir="auto" aria-label={translate('Visa notes for {value0}', { value0: t.full_name })} placeholder={translate('Notes')} className={`${FIELD} sm:col-span-3`} defaultValue={t.visa_notes || ''} onBlur={(e) => { if ((e.target.value || null) !== t.visa_notes) void patch(t, { visa_notes: e.target.value }) }} />
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-danger-fg">{translate(error)}</p>}
    </section>
  )
}
