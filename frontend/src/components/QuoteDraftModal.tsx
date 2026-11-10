import { t as translate, useI18n } from '../lib/i18n'
import { useEffect, useState } from 'react'
import ComparisonPanel from './ComparisonPanel'
import PricingPanel from './PricingPanel'
import QuoteSendPanel from './QuoteSendPanel'
import { fetchQuoteDraft, upsertQuoteDraft, type QuoteDraft } from '../lib/quoteDrafts'
import { type Lead } from '../lib/leads'

type Props = {
  open: boolean
  lead: Lead | null
  onClose: () => void
}

type Tab = 'comparison' | 'pricing' | 'send'

function QuoteDraftModalBody({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  useI18n()
  const [tab, setTab] = useState<Tab>('comparison')
  const [draft, setDraft] = useState<QuoteDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        let d = await fetchQuoteDraft(lead.id)
        if (!d) d = await upsertQuoteDraft(lead.id, {})
        if (cancelled) return
        setDraft(d)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load draft')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [lead.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const tabs: { id: Tab; label: string }[] = [
    { id: 'comparison', label: 'Comparison' },
    { id: 'pricing', label: 'Pricing' },
    { id: 'send', label: 'Send' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="flex max-h-[94dvh] w-full max-w-2xl flex-col rounded-t-2xl bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-xl">
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-shop-border px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{translate("Quote Draft")}</h2>
            <p className="mt-0.5 truncate text-sm text-shop-muted">
              {[lead.destination, lead.travel_date ? lead.travel_date.slice(0, 10) : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-shop-muted hover:bg-shop-bg">
            ✕
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex shrink-0 gap-1 border-b border-shop-border px-4 py-2 sm:px-5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'bg-shop-ink text-white'
                  : 'text-shop-muted hover:bg-shop-bg'
              }`}
            >
              {translate(t.label)}
              {t.id === 'pricing' && draft && draft.items.length > 0 && (
                <span className="ms-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-emerald-100 px-1 text-xs font-semibold text-emerald-800">
                  {draft.items.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {loading && (
            <p className="py-16 text-center text-sm text-shop-muted">{translate("Loading…")}</p>
          )}
          {!loading && error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
              {translate(error)}
            </div>
          )}
          {!loading && !error && tab === 'comparison' && (
            <ComparisonPanel
              leadId={lead.id}
              draft={draft}
              onDraftChange={(updated) => {
                setDraft(updated)
                setTab('pricing')
              }}
            />
          )}
          {!loading && !error && tab === 'pricing' && (
            <PricingPanel
              leadId={lead.id}
              draft={draft}
              onDraftChange={setDraft}
            />
          )}
          {!loading && !error && tab === 'send' && (
            <QuoteSendPanel
              leadId={lead.id}
              leadPhone={lead.phone || null}
              draft={draft}
            />
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-shop-border px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg border border-shop-border px-3 py-2 text-sm font-medium hover:bg-shop-bg"
          >
            {translate("Close")}</button>
        </div>
      </div>
    </div>
  )
}

export default function QuoteDraftModal({ open, lead, onClose }: Props) {
  useI18n()
  if (!open || !lead) return null
  return <QuoteDraftModalBody key={lead.id} lead={lead} onClose={onClose} />
}
