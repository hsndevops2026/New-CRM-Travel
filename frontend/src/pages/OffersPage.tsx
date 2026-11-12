import { useEffect, useState } from 'react'
import { CheckCircle2, MapPin, Moon } from 'lucide-react'
import { currentLanguage, t as translate, useI18n } from '../lib/i18n'
import { fetchPublicOffers, requestPublicOffer, type PublicOffer } from '../lib/growth'
import type { AgencySettings } from '../lib/agencySettings'

function price(amount: number | null, currency: string) {
  if (amount == null) return null
  try {
    return new Intl.NumberFormat(currentLanguage() === 'ar' ? 'ar-u-nu-latn' : 'en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${currency} ${Math.round(amount)}`
  }
}

function monthNames(months: number[]) {
  const locale = currentLanguage() === 'ar' ? 'ar' : 'en-GB'
  return months.map((m) => new Date(2026, m - 1, 15).toLocaleDateString(locale, { month: 'long' })).join('، ')
}

function RequestForm({ offer, brand, onDone }: { offer: PublicOffer; brand: string; onDone: () => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [date, setDate] = useState(offer.travel_date || '')
  const [adults, setAdults] = useState(2)
  const [children, setChildren] = useState(0)
  const [notes, setNotes] = useState('')
  const [website, setWebsite] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const field = 'h-11 w-full rounded-lg border border-line-strong bg-white px-3 text-sm'

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSending(true)
    setError(null)
    try {
      await requestPublicOffer(offer.id, { name, phone, travel_date: date, adults, children, notes, website })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 grid gap-2.5 border-t border-shop-border pt-3">
      <input className={field} placeholder={translate('Your name')} aria-label={translate('Your name')} value={name} onChange={(e) => setName(e.target.value)} required />
      <input className={field} dir="ltr" inputMode="tel" placeholder="+972 5x xxx xxxx" aria-label={translate('WhatsApp number')} value={phone} onChange={(e) => setPhone(e.target.value)} required />
      <div className="grid grid-cols-3 gap-2">
        <label className="col-span-3 grid gap-1 text-xs font-semibold text-shop-muted sm:col-span-1">
          {translate('Travel date')}
          <input type="date" className={field} value={date} onChange={(e) => setDate(e.target.value)} required={!offer.travel_date} />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-shop-muted">
          {translate('Adults')}
          <input type="number" min={1} max={20} className={field} value={adults} onChange={(e) => setAdults(Number(e.target.value))} />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-shop-muted">
          {translate('Children')}
          <input type="number" min={0} max={20} className={field} value={children} onChange={(e) => setChildren(Number(e.target.value))} />
        </label>
      </div>
      <textarea rows={2} className="rounded-lg border border-line-strong px-3 py-2 text-sm" placeholder={translate('Anything we should know? (optional)')} aria-label={translate('Anything we should know? (optional)')} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <input tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" value={website} onChange={(e) => setWebsite(e.target.value)} name="website" />
      {error && <p role="alert" className="text-sm text-danger-fg">{translate(error)}</p>}
      <button type="submit" disabled={sending} className="h-11 rounded-lg text-sm font-bold text-white disabled:opacity-60" style={{ background: brand }}>
        {sending ? translate('Sending…') : translate('Send my request')}
      </button>
    </form>
  )
}

/** Public offers page: the packages the agency marked as public. No sign-in. */
export default function OffersPage() {
  useI18n()
  const [offers, setOffers] = useState<PublicOffer[]>([])
  const [agency, setAgency] = useState<AgencySettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)

  useEffect(() => {
    fetchPublicOffers()
      .then((data) => { setOffers(data.offers); setAgency(data.agency) })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load offers'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (id && offers.some((o) => o.id === id)) document.getElementById(id)?.scrollIntoView({ block: 'start' })
  }, [offers])

  const brand = agency?.primary_color || '#0f766e'

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="text-white" style={{ background: brand }}>
        <div className="mx-auto flex max-w-[1100px] items-center gap-3 px-4 py-5">
          {agency?.logo_url && <img src={agency.logo_url} alt="" className="size-11 rounded-lg bg-white object-contain p-1" />}
          <div>
            <p className="text-lg font-bold">{agency?.agency_name}</p>
            <h1 className="text-sm opacity-90">{translate('Our travel offers')}</h1>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1100px] p-4 pb-16">
        {loading && <p className="text-sm text-shop-muted">{translate('Loading…')}</p>}
        {error && <p role="alert" className="text-sm text-danger-fg">{translate(error)}</p>}
        {!loading && !error && offers.length === 0 && <p className="text-shop-muted">{translate('No offers right now. Check back soon!')}</p>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {offers.map((offer) => (
            <article id={offer.id} key={offer.id} className="overflow-hidden rounded-2xl border border-shop-border bg-white">
              {offer.cover_image_url && <img src={offer.cover_image_url} alt="" loading="lazy" className="h-44 w-full object-cover" />}
              <div className="p-4">
                <h2 dir="auto" className="text-base font-bold">{offer.title}</h2>
                <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-shop-muted">
                  {offer.destination && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden="true" />{offer.destination}</span>}
                  {offer.nights ? <span className="inline-flex items-center gap-1"><Moon className="size-3.5" aria-hidden="true" />{translate('{value0} nights', { value0: offer.nights })}</span> : null}
                </p>
                {offer.availability_mode === 'period' && offer.available_months.length > 0 && (
                  <p className="mt-1 text-xs text-shop-muted">{translate('Available in: {value0}', { value0: monthNames(offer.available_months) })}</p>
                )}
                {offer.description && <p dir="auto" className="mt-2 line-clamp-3 text-sm text-slate-700">{offer.description}</p>}
                {offer.price != null && (
                  <p className="mt-3 text-xl font-extrabold tabular-nums" style={{ color: brand }}>
                    {translate('From {value0}', { value0: price(offer.price, offer.currency) || '' })}
                  </p>
                )}
                {sent === offer.id ? (
                  <p role="status" className="mt-3 flex items-center gap-2 rounded-lg bg-shop-green-bg p-3 text-sm font-semibold text-primary-800">
                    <CheckCircle2 className="size-5" aria-hidden="true" />
                    {translate('Thanks! We will contact you on WhatsApp soon.')}
                  </p>
                ) : open === offer.id ? (
                  <RequestForm offer={offer} brand={brand} onDone={() => { setSent(offer.id); setOpen(null) }} />
                ) : (
                  <button type="button" onClick={() => setOpen(offer.id)} className="mt-3 h-11 w-full rounded-lg text-sm font-bold text-white" style={{ background: brand }}>
                    {translate('I want this offer')}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </main>
    </div>
  )
}
