import { t as translate, useI18n } from '../lib/i18n'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Globe, Link2, Mail, MessageCircle, Palette, Plug, Send, SlidersHorizontal, UserRound, Wrench, type LucideIcon } from 'lucide-react'
import GoogleApisPanel from '../components/GoogleApisPanel'
import ImageUpload from '../components/ImageUpload'
import OpsPanel from '../components/OpsPanel'
import TestWhatsAppModal from '../components/TestWhatsAppModal'
import Banner from '../components/ui/Banner'
import Button from '../components/ui/Button'
import PageHeader from '../components/ui/PageHeader'
import StatusBadge from '../components/ui/StatusBadge'
import { useAuth } from '../context/AuthContext'
import { useSearch } from '../hooks/useSearch'
import { useToast } from '../hooks/useToast'
import { changedFieldCount, contrastVerdict } from '../lib/branding'
import { initialsFromName, nameFromEmail } from '../lib/people'
import {
  fetchAgencySettings,
  saveAgencySettings,
  type AgencySettings,
} from '../lib/agencySettings'

const DEFAULT_AGENCY: AgencySettings = {
  agency_name: 'Horizon', logo_url: null, primary_color: '#0f766e',
  quotation_template: 'classic', phone: null, email: null, website: null,
  address: null, quotation_footer: 'Prices are indicative and subject to availability.',
}

const FIELD = 'h-9 w-full rounded-lg border border-line-strong bg-white px-2.5 text-sm max-sm:h-11'
const LABEL = 'text-xs font-semibold text-slate-600'
const CARD = 'scroll-mt-4 flex flex-col gap-4 rounded-[10px] border border-shop-border bg-white p-5'

const SECTION_ICONS: Record<string, LucideIcon> = {
  account: UserRound,
  branding: Palette,
  'quote-rules': SlidersHorizontal,
  delivery: Send,
  whatsapp: MessageCircle,
  integrations: Plug,
  ops: Wrench,
}

/** A section title with its icon and one line saying what it is for. */
function SectionHead({ id, icon: Icon, title, description }: { id: string; icon: LucideIcon; title: string; description?: string }) {
  useI18n()
  return (
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-tint text-shop-accent">
        <Icon className="size-[18px]" strokeWidth={1.8} />
      </span>
      <div className="min-w-0">
        <h2 id={id} className="m-0 text-base font-bold">{translate(title)}</h2>
        {description && <p className="m-0 mt-0.5 text-[13px] text-shop-muted">{translate(description)}</p>}
      </div>
    </div>
  )
}

export default function SettingsPage() {
  useI18n()
  const { admin } = useAuth()
  const { setPlaceholder } = useSearch()
  const toast = useToast()
  const [testWaOpen, setTestWaOpen] = useState(false)
  const [agency, setAgency] = useState<AgencySettings>(DEFAULT_AGENCY)
  const [saved, setSaved] = useState<AgencySettings>(DEFAULT_AGENCY)
  const [brandingLoading, setBrandingLoading] = useState(true)
  const [brandingSaving, setBrandingSaving] = useState(false)
  const [brandingError, setBrandingError] = useState<string | null>(null)
  const [section, setSection] = useState('account')

  const isAdmin = admin?.role === 'admin'

  // The menu highlights the section on screen while you scroll: the last section whose
  // top has passed the upper part of the screen.
  useEffect(() => {
    const ids = ['account', 'branding', 'quote-rules', 'delivery', 'whatsapp', 'integrations', 'ops']
    const scroller = document.getElementById('account')?.closest('main') || window
    const update = () => {
      // Just below the top of the scrolling area: the section you are reading has reached it.
      const top = scroller instanceof Element ? scroller.getBoundingClientRect().top : 0
      const line = top + 120
      let current = ids.find((id) => document.getElementById(id)) || 'account'
      for (const id of ids) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= line) current = id
      }
      setSection(current)
    }
    // Seven position reads per scroll event: cheap, and it works even where animation frames pause.
    scroller.addEventListener('scroll', update, { passive: true })
    return () => scroller.removeEventListener('scroll', update)
  }, [brandingLoading, isAdmin])

  useEffect(() => {
    document.title = 'Settings · Horizon'
    setPlaceholder('Search settings')
  }, [setPlaceholder])

  useEffect(() => {
    fetchAgencySettings()
      .then((next) => {
        setAgency(next)
        setSaved(next)
      })
      .catch((error) => setBrandingError(error instanceof Error ? error.message : 'Failed to load branding'))
      .finally(() => setBrandingLoading(false))
  }, [])

  const dirty = changedFieldCount(agency, saved)
  const verdict = contrastVerdict(agency.primary_color)

  const saveBranding = async () => {
    setBrandingSaving(true)
    setBrandingError(null)
    try {
      const next = await saveAgencySettings(agency)
      setAgency(next)
      setSaved(next)
      toast.show({ tone: 'success', message: 'Branding saved. New public quotes and PDFs use these details.' })
    } catch (error) {
      setBrandingError(error instanceof Error ? error.message : 'Failed to save branding')
    } finally {
      setBrandingSaving(false)
    }
  }

  const sections = [
    { id: 'account', label: 'Account' },
    ...(isAdmin ? [{ id: 'branding', label: 'Agency branding' }, { id: 'quote-rules', label: 'Quote rules' }] : []),
    { id: 'delivery', label: 'Quote delivery' },
    { id: 'whatsapp', label: 'WhatsApp' },
    { id: 'integrations', label: 'Integrations' },
    ...(isAdmin ? [{ id: 'ops', label: 'Operational tools' }] : []),
  ]

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col p-4 sm:p-6">
      <PageHeader title={translate("Settings")} subtitle="Branding and delivery settings apply to every customer quote." />

      <div className="flex flex-wrap items-start gap-6">
        <nav aria-label={translate("Settings sections")} className="flex flex-[0_1_220px] flex-col gap-0.5 max-xl:w-full max-xl:flex-none max-xl:flex-row max-xl:overflow-x-auto max-xl:pb-1 xl:sticky xl:top-4 xl:rounded-xl xl:border xl:border-shop-border xl:bg-white xl:p-2 xl:shadow-[var(--shadow-card)]">
          {sections.map((item) => {
            const Icon = SECTION_ICONS[item.id] || Globe
            const on = section === item.id
            return (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={() => setSection(item.id)}
                aria-current={on ? 'true' : undefined}
                className={`flex h-9 shrink-0 items-center gap-2.5 rounded-lg px-3 text-sm font-semibold whitespace-nowrap transition-colors max-sm:h-11 max-xl:border max-xl:bg-white ${
                  on ? 'bg-tint text-primary-800 max-xl:border-shop-accent max-xl:bg-tint' : 'text-neutral-fg hover:bg-shop-bg max-xl:border-shop-border'
                }`}
              >
                <Icon className={`size-4 shrink-0 ${on ? 'text-shop-accent' : 'text-shop-muted'}`} strokeWidth={1.8} aria-hidden="true" />
                {translate(item.label)}
              </a>
            )
          })}
        </nav>

        <div className="flex max-w-[980px] min-w-0 flex-[999_1_560px] flex-col gap-4">
          <section id="account" aria-labelledby="s-acc" className={CARD}>
            <SectionHead id="s-acc" icon={UserRound} title="Your account" description="The account you are signed in with." />
            <div className="flex flex-wrap items-center gap-4 rounded-xl bg-[#f8fafb] p-4">
              <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-teal-100 to-teal-200 text-lg font-extrabold text-teal-900">
                {initialsFromName(nameFromEmail(admin?.email || ''))}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <strong className="truncate text-base">{nameFromEmail(admin?.email || '')}</strong>
                <span className="flex min-w-0 items-center gap-1.5 text-sm text-shop-muted">
                  <Mail className="size-3.5 shrink-0" aria-hidden="true" />
                  <span dir="ltr" className="min-w-0 truncate">{admin?.email || '—'}</span>
                </span>
              </div>
              {admin?.role && (
                <StatusBadge label={admin.role === 'admin' ? translate('Administrator') : translate('Agent')} tone={admin.role === 'admin' ? 'info' : 'neutral'} />
              )}
            </div>
          </section>

          {isAdmin && (
            <section id="branding" aria-labelledby="s-br" className={CARD}>
              <SectionHead id="s-br" icon={Palette} title="Agency branding" description="Used on customer quote pages, PDFs, WhatsApp and email" />
              {brandingLoading ? (
                <p role="status" className="text-sm text-shop-muted">{translate("Loading branding…")}</p>
              ) : (
                <div className="flex flex-wrap items-start gap-6">
                  <div className="flex min-w-[min(100%,320px)] flex-[1_1_360px] flex-col gap-3.5">
                    <label className="grid gap-1">
                      <span className={LABEL}>{translate("Agency name")}</span>
                      <input className={FIELD} value={agency.agency_name} onChange={(e) => setAgency({ ...agency, agency_name: e.target.value })} />
                    </label>
                    <ImageUpload label={translate("Agency logo")} value={agency.logo_url} onChange={(logo_url) => setAgency({ ...agency, logo_url: logo_url || null })} />
                    <div className="grid gap-1">
                      <label className={LABEL} htmlFor="brand-hex">{translate("Primary brand color")}</label>
                      <div className="flex items-center gap-2">
                        <input
                          aria-label={translate("Choose primary color")}
                          type="color"
                          className="size-9 shrink-0 cursor-pointer rounded-lg border border-line-strong bg-white p-0.5 max-sm:size-11"
                          value={/^#[0-9a-f]{6}$/i.test(agency.primary_color) ? agency.primary_color : '#0f766e'}
                          onChange={(e) => setAgency({ ...agency, primary_color: e.target.value })}
                        />
                        <input
                          id="brand-hex"
                          dir="ltr"
                          className={`${FIELD} max-w-[140px] font-mono`}
                          value={agency.primary_color}
                          onChange={(e) => setAgency({ ...agency, primary_color: e.target.value })}
                        />
                        <StatusBadge label={translate(verdict.label)} tone={verdict.ok ? 'success' : 'warning'} icon={verdict.ok ? <Check /> : undefined} />
                      </div>
                    </div>
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-3.5">
                      <label className="grid gap-1">
                        <span className={LABEL}>{translate("Phone / WhatsApp")}</span>
                        <input className={`${FIELD} tabular-nums`} value={agency.phone || ''} onChange={(e) => setAgency({ ...agency, phone: e.target.value || null })} />
                      </label>
                      <label className="grid gap-1">
                        <span className={LABEL}>{translate("Email")}</span>
                        <input className={FIELD} value={agency.email || ''} onChange={(e) => setAgency({ ...agency, email: e.target.value || null })} />
                      </label>
                      <label className="grid gap-1">
                        <span className={LABEL}>{translate("Website")}</span>
                        <input className={FIELD} value={agency.website || ''} onChange={(e) => setAgency({ ...agency, website: e.target.value || null })} />
                      </label>
                      <label className="grid gap-1">
                        <span className={LABEL}>{translate("Quote template")}</span>
                        <select className={FIELD} value={agency.quotation_template} onChange={(e) => setAgency({ ...agency, quotation_template: e.target.value as AgencySettings['quotation_template'] })}>
                          <option value="classic">{translate("Classic")}</option>
                          <option value="modern">{translate("Modern")}</option>
                        </select>
                      </label>
                    </div>
                    <label className="grid gap-1">
                      <span className={LABEL}>{translate("Address")}</span>
                      <textarea rows={2} className="resize-y rounded-lg border border-line-strong px-2.5 py-2 text-sm" value={agency.address || ''} onChange={(e) => setAgency({ ...agency, address: e.target.value || null })} />
                    </label>
                    <label className="grid gap-1">
                      <span className={LABEL}>{translate("Footer")}</span>
                      <textarea rows={2} className="resize-y rounded-lg border border-line-strong px-2.5 py-2 text-sm" value={agency.quotation_footer || ''} onChange={(e) => setAgency({ ...agency, quotation_footer: e.target.value || null })} />
                    </label>
                  </div>

                  <figure className="m-0 flex flex-[0_1_280px] flex-col gap-2 max-lg:w-full max-lg:flex-none">
                    <figcaption className={LABEL}>{translate("Live preview · customer quote")}</figcaption>
                    <div className="overflow-hidden rounded-[14px] border border-shop-border bg-white shadow-[0_4px_12px_rgba(15,23,42,0.06)]">
                      <div className="flex items-center gap-2 p-3.5 text-white" style={{ background: agency.primary_color }}>
                        {agency.logo_url ? (
                          <img src={agency.logo_url} alt="" className="size-[26px] rounded-[7px] bg-white/20 object-contain" />
                        ) : (
                          <span aria-hidden="true" className="grid size-[26px] place-items-center rounded-[7px] bg-white/20 font-extrabold">
                            {(agency.agency_name || 'A').charAt(0).toUpperCase()}
                          </span>
                        )}
                        <strong>{agency.agency_name || 'Your agency'}</strong>
                      </div>
                      <div className="flex flex-col gap-1.5 p-3.5">
                        <strong>{translate("Istanbul family winter break")}</strong>
                        <span className="text-xs text-shop-muted tabular-nums">{translate("12–18 Dec · 2 adults, 1 child")}</span>
                        <span className="text-xl font-extrabold tabular-nums" style={{ color: agency.primary_color }}>USD 2,298</span>
                        <span className="grid h-9 place-items-center rounded-lg text-[13px] font-bold text-white" style={{ background: agency.primary_color }}>
                          {translate("Accept this quote")}</span>
                      </div>
                    </div>
                  </figure>
                </div>
              )}
              {brandingError && (
                <Banner tone="danger" title={translate("Branding could not be saved")}>
                  {brandingError}
                </Banner>
              )}
            </section>
          )}

          {isAdmin && !brandingLoading && (
            <section id="quote-rules" aria-labelledby="s-rules" className={CARD}>
              <SectionHead id="s-rules" icon={SlidersHorizontal} title="Quote rules and automation" description="Who approves quotes, and the messages and alerts the CRM sends by itself." />
              <div className="grid items-start gap-4 lg:grid-cols-2">
                    <fieldset className="grid gap-2 rounded-lg border border-shop-border p-3">
                      <legend className={`${LABEL} px-1`}>{translate('Manager approval of quotes')}</legend>
                      <select
                        aria-label={translate('Manager approval of quotes')}
                        className="h-10 rounded-lg border border-line-strong bg-white px-2.5 text-sm"
                        value={agency.quote_approval_mode || 'agents'}
                        onChange={(e) => setAgency({ ...agency, quote_approval_mode: e.target.value as 'off' | 'agents' | 'below_margin' })}
                      >
                        <option value="agents">{translate('Every quote an employee locks')}</option>
                        <option value="below_margin">{translate('Only quotes under the minimum margin')}</option>
                        <option value="off">{translate('Off: employees send quotes themselves')}</option>
                      </select>
                      {agency.quote_approval_mode === 'below_margin' && (
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          {translate('Minimum profit')}
                          <input
                            type="number"
                            min={0}
                            max={agency.quote_approval_min_margin_type === 'fixed' ? undefined : 100}
                            step="any"
                            aria-label={translate('Minimum profit')}
                            className="h-10 w-28 rounded-lg border border-line-strong px-2.5 text-sm tabular-nums"
                            value={agency.quote_approval_min_margin ?? 10}
                            onChange={(e) => setAgency({ ...agency, quote_approval_min_margin: Number(e.target.value) })}
                          />
                          <select
                            aria-label={translate('Minimum profit as')}
                            className="h-10 rounded-lg border border-line-strong bg-white px-2.5 text-sm"
                            value={agency.quote_approval_min_margin_type || 'percent'}
                            onChange={(e) => setAgency({ ...agency, quote_approval_min_margin_type: e.target.value as 'percent' | 'fixed' })}
                          >
                            <option value="percent">{translate('% of the price')}</option>
                            <option value="fixed">{translate('amount in the quote currency')}</option>
                          </select>
                        </div>
                      )}
                      <span className="text-xs text-shop-muted">{translate("A manager's own quotes never wait for approval.")}</span>
                    </fieldset>
                    <fieldset className="grid gap-3 rounded-lg border border-shop-border p-3">
                      <legend className={`${LABEL} px-1`}>{translate('Automatic messages and alerts')}</legend>
                      <label className="flex items-start gap-2 text-sm">
                        <input type="checkbox" className="mt-1" checked={Boolean(agency.auto_quote_followup)} onChange={(e) => setAgency({ ...agency, auto_quote_followup: e.target.checked })} />
                        <span>
                          {translate('Follow up on a quote the customer has not answered after')}{' '}
                          <input
                            type="number" min={6} max={336} aria-label={translate('Hours before following up')}
                            className="h-8 w-16 rounded-md border border-line-strong px-1.5 text-sm tabular-nums"
                            value={agency.quote_followup_hours ?? 48}
                            onChange={(e) => setAgency({ ...agency, quote_followup_hours: Number(e.target.value) })}
                          />{' '}{translate('hours (one WhatsApp message)')}
                        </span>
                      </label>
                      <label className="flex items-start gap-2 text-sm">
                        <input type="checkbox" className="mt-1" checked={Boolean(agency.auto_trip_messages)} onChange={(e) => setAgency({ ...agency, auto_trip_messages: e.target.checked })} />
                        <span>{translate('Trip messages: a week before, two days before, on the day, and after the return with a 1–5 rating')}</span>
                      </label>
                      <label className="grid gap-1">
                        <span className={LABEL}>{translate('Emergency number while travelling')}</span>
                        <input className={`${FIELD} tabular-nums`} dir="ltr" placeholder={agency.phone || ''} value={agency.emergency_phone || ''} onChange={(e) => setAgency({ ...agency, emergency_phone: e.target.value || null })} />
                      </label>
                      <label className="grid gap-1">
                        <span className={LABEL}>{translate('Google review link (sent after a rating of 4 or 5)')}</span>
                        <input className={FIELD} dir="ltr" placeholder="https://g.page/r/…" value={agency.google_review_url || ''} onChange={(e) => setAgency({ ...agency, google_review_url: e.target.value || null })} />
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        {translate('Alert managers when a new request has no reply after')}
                        <input
                          type="number" min={0} max={1440} aria-label={translate('Minutes before alerting')}
                          className="h-8 w-16 rounded-md border border-line-strong px-1.5 text-sm tabular-nums"
                          value={agency.lead_wait_alert_minutes ?? 15}
                          onChange={(e) => setAgency({ ...agency, lead_wait_alert_minutes: Number(e.target.value) })}
                        />
                        {translate('minutes (0 = off)')}
                      </label>
                      <span className="text-xs text-shop-muted">{translate('Customer messages go out between 9:00 and 21:00 only.')}</span>
                    </fieldset>
              </div>
            </section>
          )}

          <section id="delivery" aria-labelledby="s-dl" className={CARD}>
            <SectionHead id="s-dl" icon={Send} title="Quote delivery" description="How finished quotes reach customers." />
            <ul className="grid gap-2.5 sm:grid-cols-3">
              {[
                { icon: MessageCircle, text: "WhatsApp is connected through Wasender." },
                { icon: Mail, text: "Email quotes need SMTP credentials on the server." },
                { icon: Link2, text: "Customers open quotes at the public share link." },
              ].map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-2.5 rounded-xl border border-shop-border bg-[#f8fafb] p-3 text-sm text-slate-700">
                  <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-white text-shop-accent shadow-[var(--shadow-card)]">
                    <Icon className="size-4" />
                  </span>
                  {translate(text)}
                </li>
              ))}
            </ul>
          </section>

          <section id="whatsapp" aria-labelledby="s-wa" className={CARD}>
            <SectionHead id="s-wa" icon={MessageCircle} title="WhatsApp" description="Simulate an inbound WhatsApp message — text or a voice note — to test lead intake without a real customer." />
            <div>
              <Button onClick={() => setTestWaOpen(true)}>{translate("Test WhatsApp")}</Button>
            </div>
            <p className="text-sm text-shop-muted">
              {translate("Dealer contacts and WhatsApp groups are managed on the")}{' '}
              <Link to="/dealers" className="font-semibold text-shop-accent hover:underline">
                {translate("Dealers")}</Link>{' '}
              {translate("page.")}</p>
          </section>

          <GoogleApisPanel />

          {isAdmin && <OpsPanel />}

          {isAdmin && dirty > 0 && (
            <div className="sticky bottom-4 z-10 flex items-center gap-2 rounded-xl border border-shop-border bg-white p-2.5 shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
              <span role="status" className="me-auto ps-1.5 text-sm text-shop-muted tabular-nums">
                {translate("{count} unsaved change{suffix}", { count: dirty, suffix: dirty === 1 ? '' : 's' })}
              </span>
              <Button variant="ghost" disabled={brandingSaving} onClick={() => setAgency(saved)}>
                {translate("Discard")}</Button>
              <Button variant="primary" loading={brandingSaving} disabled={!agency.agency_name.trim()} onClick={() => void saveBranding()}>
                {translate("Save settings")}</Button>
            </div>
          )}
        </div>
      </div>

      <TestWhatsAppModal
        open={testWaOpen}
        onClose={() => setTestWaOpen(false)}
        onLeadCreated={() => setTestWaOpen(false)}
      />
    </div>
  )
}
