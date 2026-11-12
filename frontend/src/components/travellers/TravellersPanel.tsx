import { useEffect, useState } from 'react'
import { Copy, Plus, Send, Users } from 'lucide-react'
import Button from '../ui/Button'
import TravellerRows from './TravellerRows'
import { t as translate, useI18n } from '../../lib/i18n'
import {
  emptyTraveller,
  fetchTravellers,
  makeTravellerLink,
  padTravellers,
  saveTravellers,
  type Traveller,
  type TravellerList,
} from '../../lib/travellers'

/** Travellers on a lead, with passport checks and a link the customer can fill in. */
export default function TravellersPanel({ leadId }: { leadId: string }) {
  useI18n()
  const [data, setData] = useState<TravellerList | null>(null)
  const [rows, setRows] = useState<Traveller[]>([])
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const apply = (next: TravellerList) => {
    setData(next)
    setRows(padTravellers(next.travellers, next.expected))
  }

  useEffect(() => {
    let cancelled = false
    fetchTravellers(leadId)
      .then((next) => { if (!cancelled) apply(next) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load travellers') })
    return () => { cancelled = true }
  }, [leadId])

  const save = async () => {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      apply(await saveTravellers(leadId, rows))
      setNotice(translate('Saved'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const link = async (send: boolean) => {
    setSending(true)
    setError(null)
    setNotice(null)
    try {
      const { url } = await makeTravellerLink(leadId, send)
      if (!send) {
        await navigator.clipboard?.writeText(url).catch(() => {})
        setNotice(translate('Link copied: {value0}', { value0: url }))
      } else {
        setNotice(translate('Form sent to the customer on WhatsApp'))
      }
      setData((d) => (d ? { ...d, link: { url, expires_at: '', submitted_at: null } } : d))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the link')
    } finally {
      setSending(false)
    }
  }

  const problems = (data?.travellers || []).filter((t) => t.issues?.some((i) => !i.startsWith('missing'))).length

  return (
    <section aria-labelledby="trav-h" className="rounded-[10px] border border-shop-border bg-white p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="trav-h" className="flex items-center gap-2 text-[15px] font-bold">
            <Users className="size-4" aria-hidden="true" />
            {translate('Travellers')}
          </h3>
          <p className="text-xs text-shop-muted">
            {translate('Names exactly as in the passports. Passports are checked against the trip dates.')}
            {data?.link?.submitted_at ? ` ${translate('The customer filled in the form.')}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<Send />} loading={sending} onClick={() => void link(true)}>{translate('Send form to customer')}</Button>
          <Button size="sm" variant="ghost" icon={<Copy />} disabled={sending} onClick={() => void link(false)}>{translate('Copy link')}</Button>
        </div>
      </div>
      {problems > 0 && (
        <p role="alert" className="mb-3 rounded-lg bg-danger-bg px-3 py-2 text-[13px] font-semibold text-danger-fg">
          {translate('{value0} passport problem(s) to sort out before the trip', { value0: problems })}
        </p>
      )}
      <TravellerRows rows={rows} onChange={setRows} showIssues />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" loading={saving} onClick={() => void save()}>{translate('Save travellers')}</Button>
        <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setRows((r) => [...r, emptyTraveller(false)])}>{translate('Add traveller')}</Button>
        {notice && <span role="status" className="break-all text-xs text-shop-muted">{notice}</span>}
        {error && <span role="alert" className="text-xs text-danger-fg">{translate(error)}</span>}
      </div>
    </section>
  )
}
