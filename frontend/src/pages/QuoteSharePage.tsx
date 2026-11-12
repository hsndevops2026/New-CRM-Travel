/**
 * Public customer-facing quote view.
 * Accessible at /quote/:token — no authentication required.
 *
 * Mobile-first: customers open this from a WhatsApp link on their phone. The agency's brand
 * colour drives the header, ticks and buttons; everything else is the shared design system.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { Bed, Check, CircleAlert, Download, FileText, MessageCircle, Phone, Plane } from 'lucide-react'
import {
  fetchPublicQuote,
  acceptPublicQuote,
  publicPdfUrl,
  type ShareTokenView,
} from '../lib/quoteVersions'
import { formatDateRange, nightsLabel } from '../lib/leadSummary'
import { cancellationTerms, firstName, itemKind, linkProblem, travellersText, whatsappLink } from '../lib/publicQuoteView'
import { currentLanguage, t as translate, useI18n } from '../lib/i18n'

function money(v: number | string | null | undefined, currency = 'USD') {
  const amount = v == null || v === '' ? NaN : Number(v)
  if (!Number.isFinite(amount)) return ''
  try {
    return amount.toLocaleString(currentLanguage() === 'ar' ? 'ar-u-nu-latn' : 'en-GB', { style: 'currency', currency, maximumFractionDigits: 0 })
  } catch {
    return `${currency} ${Math.round(amount)}`
  }
}

function longDate(d?: string | null) {
  if (!d) return null
  const date = new Date(d)
  if (Number.isNaN(date.getTime())) return d.slice(0, 10)
  return date.toLocaleDateString(currentLanguage() === 'ar' ? 'ar-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const FALLBACK_AGENCY: ShareTokenView['agency'] = {
  agency_name: 'Horizon', logo_url: null, primary_color: '#0f766e',
  quotation_template: 'classic', phone: null, email: null, website: null,
  address: null, quotation_footer: 'Prices are indicative and subject to availability.',
}

type Agency = ShareTokenView['agency']

function Header({ agency }: { agency: Agency }) {
  return (
    <header className="text-white" style={{ background: agency.primary_color }}>
      <div className="mx-auto flex max-w-xl items-center gap-2.5 px-5 py-4">
        {agency.logo_url ? (
          <img src={agency.logo_url} alt="" className="size-[34px] rounded-[9px] bg-white/20 object-contain" />
        ) : (
          <span aria-hidden="true" className="grid size-[34px] place-items-center rounded-[9px] bg-white/20 font-extrabold">
            {(agency.agency_name || 'A').charAt(0).toUpperCase()}
          </span>
        )}
        <strong className="flex-1 text-[17px]">{agency.agency_name}</strong>
        {agency.phone && (
          <a href={`tel:${agency.phone.replace(/\s+/g, '')}`} className="flex h-11 items-center gap-1.5 text-sm font-semibold text-white">
            <Phone className="size-4" aria-hidden="true" />
            {translate('Call us')}
          </a>
        )}
      </div>
    </header>
  )
}

function Footer({ agency }: { agency: Agency }) {
  const contact = [agency.phone, agency.email, agency.website].filter(Boolean).join(' · ')
  return (
    <footer className="mt-auto border-t border-shop-border bg-white px-5 pt-6 pb-8 text-sm text-slate-600">
      <div className="mx-auto flex max-w-xl flex-col gap-1.5">
        <strong className="text-shop-ink">{agency.agency_name}</strong>
        {contact && <span className="tabular-nums">{contact}</span>}
        {agency.address && <span>{agency.address}</span>}
        {agency.quotation_footer && <span className="text-xs text-shop-muted">{agency.quotation_footer}</span>}
      </div>
    </footer>
  )
}

function Shell({ agency, children }: { agency: Agency; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-shop-bg text-shop-ink">
      <Header agency={agency} />
      {children}
      <Footer agency={agency} />
    </div>
  )
}

export default function QuoteSharePage() {
  useI18n()
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<ShareTokenView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Accept form
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [accepting, setAccepting] = useState(false)
  const [accepted, setAccepted] = useState<{ by: string | null; at: string | null } | null>(null)
  const [acceptError, setAcceptError] = useState<string | null>(null)
  const [triedWithoutName, setTriedWithoutName] = useState(false)

  useEffect(() => {
    if (!token) return
    fetchPublicQuote(token)
      .then((d) => {
        setData(d)
        if (d.version_status === 'accepted') setAccepted({ by: null, at: d.accepted_at })
      })
      .catch((err) => setError(err instanceof Error ? err.message : translate('Failed to load quote')))
      .finally(() => setLoading(false))
  }, [token])

  const handleAccept = async () => {
    if (!token) return
    if (!name.trim()) {
      setTriedWithoutName(true)
      return
    }
    setAccepting(true)
    setAcceptError(null)
    try {
      await acceptPublicQuote(token, { customer_name: name.trim(), customer_email: email.trim() })
      setAccepted({ by: name.trim(), at: new Date().toISOString() })
    } catch (err) {
      setAcceptError(err instanceof Error ? err.message : translate('Failed to accept'))
    } finally {
      setAccepting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-shop-bg">
        <p role="status" className="text-shop-muted">{translate('Loading your quote…')}</p>
      </div>
    )
  }

  if (error || !data) {
    const problem = linkProblem()
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-shop-bg px-6 text-center">
        <div aria-hidden="true" className="grid size-14 place-items-center rounded-[14px] bg-warn-bg text-warn-fg">
          <CircleAlert className="size-[26px]" />
        </div>
        <h1 className="text-xl font-bold">{translate(problem.title)}</h1>
        <p className="max-w-sm text-slate-600">{translate(problem.body)}</p>
      </div>
    )
  }

  const snap = data.snapshot
  const lead = snap.lead || {}
  const items = snap.items || []
  const agency = data.agency || FALLBACK_AGENCY
  const brand = agency.primary_color
  const price = money(data.selling_price ?? snap.pricing?.selling_price, data.currency)
  const travellers = travellersText(lead.adults_count, lead.children_count)
  const dates = formatDateRange(lead.travel_date, lead.return_date)
  const nights = nightsLabel(lead.nights)
  const terms = cancellationTerms(items)
  const waLink = whatsappLink(
    agency.phone,
    translate('Hi, a question about my quote “{value0}”', { value0: snap.title || translate('my quote') }),
  )

  /* ── Accepted ─────────────────────────────────────────────────────────── */
  if (accepted) {
    const who = firstName(accepted.by || lead.customer_name)
    return (
      <Shell agency={agency}>
        <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pt-7 pb-8">
          <section role="status" className="flex flex-col items-center gap-3 rounded-2xl border border-shop-border bg-white px-5 py-6 text-center">
            <span aria-hidden="true" className="grid size-16 place-items-center rounded-full bg-shop-green-bg" style={{ color: brand }}>
              <Check className="size-8" strokeWidth={2.2} />
            </span>
            <h1 className="text-[26px] leading-tight font-extrabold">
              {who ? translate('Thanks, {value0} — we’ve got it', { value0: who }) : translate('Thanks — we’ve got it')}
            </h1>
            <p className="text-slate-700">
              {translate('You’ve accepted quote v{value0}. {value1} will contact you to confirm traveller details and finalise your booking.', {
                value0: snap.version_number,
                value1: agency.agency_name,
              })}
            </p>
            <p className="rounded-[10px] bg-neutral-bg px-3 py-2.5 text-sm text-slate-600">
              {translate('Nothing has been charged or reserved yet. Prices are confirmed when we book.')}
            </p>
          </section>

          <section aria-labelledby="sum-h" className="flex flex-col gap-2.5 rounded-2xl border border-shop-border bg-white p-[18px]">
            <h2 id="sum-h" className="text-base font-bold">{translate('Your accepted quote')}</h2>
            <Row label={translate('Trip')} value={snap.title || translate('Your travel quote')} />
            {dates !== '—' && <Row label={translate('Dates')} value={dates} />}
            {price && <Row label={translate('Total')} value={price} strong />}
            {accepted.by && <Row label={translate('Accepted by')} value={accepted.by} />}
            {accepted.at && (
              <Row
                label={translate('When')}
                value={new Date(accepted.at).toLocaleString(currentLanguage() === 'ar' ? 'ar-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              />
            )}
          </section>

          <section aria-labelledby="nx-h" className="flex flex-col gap-3 rounded-2xl border border-shop-border bg-white p-[18px]">
            <h2 id="nx-h" className="text-base font-bold">{translate('What happens next')}</h2>
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {['We confirm availability with the airline and hotel.', 'We ask for passport names for all travellers.', 'We share payment options and send your confirmation.'].map((step, i) => (
                <li key={step} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className={`grid size-[26px] shrink-0 place-items-center rounded-full text-[13px] font-bold tabular-nums ${i === 0 ? 'text-white' : 'bg-line-strong/60 text-neutral-fg'}`}
                    style={i === 0 ? { background: brand } : undefined}
                  >
                    {i + 1}
                  </span>
                  <span>{translate(step)}</span>
                </li>
              ))}
            </ol>
          </section>

          {waLink && (
            <a
              href={waLink}
              target="_blank"
              rel="noreferrer"
              className="flex h-[52px] items-center justify-center gap-2 rounded-xl font-bold text-white"
              style={{ background: brand }}
            >
              <MessageCircle className="size-4" aria-hidden="true" />
              {translate('Message us on WhatsApp')}
            </a>
          )}
          {token && (
            <a
              href={`${publicPdfUrl(token)}?lang=${currentLanguage() === 'ar' ? 'ar' : 'en'}`}
              target="_blank"
              rel="noreferrer"
              className="flex h-12 items-center justify-center gap-2 rounded-xl border border-line-strong bg-white font-bold"
            >
              <Download className="size-4" aria-hidden="true" />
              {translate('Download PDF')}
            </a>
          )}
        </main>
      </Shell>
    )
  }

  /* ── Quote ────────────────────────────────────────────────────────────── */
  const showNameError = triedWithoutName && !name.trim()

  return (
    <Shell agency={agency}>
      <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pt-6 pb-8">
        <section className="flex flex-col gap-3.5 rounded-2xl border border-shop-border bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold tracking-[0.06em] text-shop-muted uppercase">
              {lead.customer_name ? translate('Quote for {value0}', { value0: lead.customer_name }) : translate('Your travel quote')} · v{snap.version_number}
            </span>
            <h1 className="text-[26px] leading-tight font-extrabold tracking-[-0.01em]">{snap.title || translate('Your travel quote')}</h1>
          </div>
          <dl className="m-0 grid grid-cols-2 gap-3.5">
            {lead.destination && (
              <Fact label={lead.origin ? translate('From → To') : translate('Destination')} value={lead.origin ? `${lead.origin} → ${lead.destination}` : lead.destination} />
            )}
            {dates !== '—' && <Fact label={translate('Dates')} value={dates} />}
            {nights && <Fact label={translate('Nights')} value={nights} />}
            {travellers && <Fact label={translate('Travellers')} value={travellers} />}
          </dl>
        </section>

        {items.length > 0 && (
          <section aria-labelledby="inc-h" className="flex flex-col gap-2.5">
            <h2 id="inc-h" className="mx-1 mt-2 text-lg font-bold">{translate('What’s included')}</h2>
            {items.map((item, i) => {
              const kind = itemKind(item.meta)
              const meta = item.meta || {}
              const details = [meta.room_type, meta.board_name].filter(Boolean).map(String)
              return (
                <article key={i} className="flex flex-col gap-2.5 rounded-2xl border border-shop-border bg-white p-4">
                  <div className="flex items-center gap-2.5">
                    <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-neutral-bg" style={{ color: brand }}>
                      {kind === 'flight' ? <Plane className="size-4" /> : kind === 'hotel' ? <Bed className="size-4" /> : <FileText className="size-4" />}
                    </span>
                    <div className="flex min-w-0 flex-col leading-tight">
                      <strong>{item.label}</strong>
                      {item.description && <span className="text-sm text-shop-muted">{item.description}</span>}
                    </div>
                  </div>
                  {details.length > 0 && (
                    <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[15px]">
                      {details.map((d) => (
                        <li key={d} className="flex gap-2">
                          <Check className="mt-0.5 size-[18px] shrink-0" style={{ color: brand }} aria-hidden="true" />
                          {d}
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              )
            })}
          </section>
        )}

        {terms.length > 0 && (
          <section aria-labelledby="terms-h" className="flex flex-col gap-2 rounded-2xl border border-shop-border bg-white p-4">
            <h2 id="terms-h" className="text-base font-bold">{translate('Terms & cancellation')}</h2>
            <ul className="m-0 flex list-disc flex-col gap-1.5 ps-[18px] text-[15px] text-slate-700">
              {terms.map((t) => (
                <li key={t.label}>
                  {t.label}: {t.text}
                </li>
              ))}
              <li>{translate('Prices are held until the quote expires and are confirmed when we book.')}</li>
            </ul>
          </section>
        )}

        <section aria-labelledby="price-h" className="flex flex-col gap-1.5 rounded-2xl bg-shop-ink p-5 text-white">
          <span id="price-h" className="text-[13px] font-bold tracking-[0.06em] text-slate-300 uppercase">{translate('Total price')}</span>
          <span className="text-[40px] leading-[1.1] font-extrabold tracking-[-0.02em] tabular-nums">{price || '—'}</span>
          <span className="text-sm text-slate-300 tabular-nums">
            {[
              travellers && translate('For {value0}', { value0: travellers }),
              snap.valid_until && translate('valid until {value0}', { value0: longDate(snap.valid_until) || '' }),
            ].filter(Boolean).join(' · ')}
          </span>
        </section>

        {snap.notes && (
          <section aria-labelledby="note-h" className="flex flex-col gap-1.5 rounded-2xl border border-shop-border bg-white p-4">
            <h2 id="note-h" className="text-base font-bold">{translate('A note from {value0}', { value0: agency.agency_name })}</h2>
            <p className="whitespace-pre-wrap text-slate-700">{snap.notes}</p>
          </section>
        )}

        {token && (
          <a
            href={`${publicPdfUrl(token)}?lang=${currentLanguage() === 'ar' ? 'ar' : 'en'}`}
            target="_blank"
            rel="noreferrer"
            className="flex h-[52px] items-center justify-center gap-2 rounded-xl border border-line-strong bg-white font-bold"
          >
            <Download className="size-4" aria-hidden="true" />
            {translate('Download PDF')}
          </a>
        )}

        {data.superseded || data.expired ? (
          <section role="status" className="flex flex-col gap-2 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5">
            <h2 className="text-base font-bold">
              {data.superseded ? translate('This quote has been updated') : translate('This quote has expired')}
            </h2>
            <p className="text-slate-700">
              {data.superseded
                ? translate('We sent you a newer version of this quote. Please open the latest link we sent, or contact us.')
                : translate('Prices may have changed since this quote was made. Contact us and we’ll send you an updated one.')}
            </p>
            {waLink && (
              <a href={waLink} target="_blank" rel="noreferrer" className="font-semibold" style={{ color: brand }}>
                {translate('Reply on WhatsApp')}
              </a>
            )}
          </section>
        ) : (
        <form
          aria-labelledby="acc-h"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void handleAccept()
          }}
          className="flex flex-col gap-3.5 rounded-2xl border-2 bg-white p-5"
          style={{ borderColor: brand }}
        >
          <div className="flex flex-col gap-1">
            <h2 id="acc-h" className="text-xl font-extrabold">{translate('Happy with this quote?')}</h2>
            <p className="text-[15px] text-slate-700">
              {translate('Accepting tells our team you’d like to go ahead. We’ll contact you to confirm details and finalise the booking.')}{' '}
              <strong>{translate('Nothing is charged or reserved yet.')}</strong>
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-neutral-fg" htmlFor="acc-n">
              {translate('Your full name')} <span className="text-danger">*</span>
            </label>
            <input
              id="acc-n"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={showNameError || undefined}
              aria-describedby={showNameError ? 'acc-ne' : undefined}
              className={`h-11 w-full rounded-lg border bg-white px-3 text-base ${showNameError ? 'border-danger' : 'border-line-strong'}`}
            />
            {showNameError && (
              <span id="acc-ne" role="alert" className="text-sm text-danger">
                {translate('Please enter your name so we know who accepted.')}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-neutral-fg" htmlFor="acc-e">
              {translate('Email')} <span className="font-normal text-shop-muted">{translate('(optional)')}</span>
            </label>
            <input
              id="acc-e"
              type="email"
              autoComplete="email"
              placeholder={translate('For a copy of your confirmation')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 w-full rounded-lg border border-line-strong bg-white px-3 text-base"
            />
          </div>

          {acceptError && (
            <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
              {translate(acceptError)}
            </p>
          )}

          <button
            type="submit"
            disabled={accepting}
            aria-busy={accepting || undefined}
            className="h-[52px] rounded-xl text-[17px] font-bold text-white hover:brightness-90 disabled:opacity-60"
            style={{ background: brand }}
          >
            {accepting ? translate('Accepting…') : translate('Accept this quote')}
          </button>
          {waLink && (
            <span className="text-center text-[13px] text-shop-muted">
              {translate('Questions first?')}{' '}
              <a href={waLink} target="_blank" rel="noreferrer" className="font-semibold" style={{ color: brand }}>
                {translate('Reply on WhatsApp')}
              </a>
            </span>
          )}
        </form>
        )}
      </main>
    </Shell>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-bold tracking-[0.06em] text-shop-muted uppercase">{label}</dt>
      <dd className="m-0 mt-0.5 font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-shop-muted">{label}</span>
      <span className={`text-end tabular-nums ${strong ? 'font-extrabold' : 'font-semibold'}`}>{value}</span>
    </div>
  )
}
