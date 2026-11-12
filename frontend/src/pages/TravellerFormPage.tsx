import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, Plus } from 'lucide-react'
import TravellerRows from '../components/travellers/TravellerRows'
import { t as translate, useI18n } from '../lib/i18n'
import {
  emptyTraveller,
  fetchTravellerForm,
  padTravellers,
  submitTravellerForm,
  type Traveller,
  type TravellerForm,
} from '../lib/travellers'

/** The customer's page for traveller details. No sign-in: the link is the key. */
export default function TravellerFormPage() {
  useI18n()
  const { token = '' } = useParams()
  const [form, setForm] = useState<TravellerForm | null>(null)
  const [rows, setRows] = useState<Traveller[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchTravellerForm(token)
      .then((data) => {
        if (cancelled) return
        setForm(data)
        setRows(padTravellers(data.travellers, data.expected))
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'This link has expired. Please ask us for a new one.') })
    return () => { cancelled = true }
  }, [token])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await submitTravellerForm(token, rows)
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <main className="mx-auto flex min-h-screen max-w-[560px] flex-col items-center justify-center gap-3 p-6 text-center">
        <CheckCircle2 className="size-12 text-primary-700" aria-hidden="true" />
        <h1 className="text-xl font-bold">{translate('Thank you! We received the details.')}</h1>
        <p className="text-shop-muted">{translate('We will contact you if anything needs checking.')}</p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-[640px] p-4 pb-16 sm:p-6">
      <h1 className="text-xl font-bold">{translate('Traveller details')}</h1>
      {form && (
        <p className="mt-1 text-sm text-shop-muted">
          {[form.destination, form.trip.travel_date].filter(Boolean).join(' · ')}
        </p>
      )}
      <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
        {translate('Write each name exactly as it appears in the passport, in English letters. Many countries require a passport valid at least 6 months after you return.')}
      </p>
      {error && <p role="alert" className="mt-3 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">{translate(error)}</p>}
      {form && (
        <form onSubmit={submit} className="mt-4 grid gap-3">
          <TravellerRows rows={rows} onChange={setRows} />
          <button type="button" className="inline-flex items-center gap-1.5 justify-self-start text-sm font-semibold text-shop-accent" onClick={() => setRows((r) => [...r, emptyTraveller(false)])}>
            <Plus className="size-4" aria-hidden="true" />
            {translate('Add traveller')}
          </button>
          <button
            type="submit"
            disabled={saving || !rows.some((r) => r.full_name.trim())}
            className="h-12 rounded-xl bg-shop-accent text-base font-bold text-white disabled:opacity-50"
          >
            {saving ? translate('Sending…') : translate('Send details')}
          </button>
        </form>
      )}
    </main>
  )
}
