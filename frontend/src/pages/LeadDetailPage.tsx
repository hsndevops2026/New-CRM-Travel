import CostsPanel from '../components/CostsPanel'
import GroupSelect from '../components/GroupSelect'
import VisasPanel from '../components/VisasPanel'
import DeadlinesPanel from '../components/DeadlinesPanel'
import TravellersPanel from '../components/travellers/TravellersPanel'
import LeadTasksButton from '../components/tasks/LeadTasksButton'
import { t as translate, useI18n } from '../lib/i18n'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CalendarDays, ChevronLeft, CircleAlert, ChevronRight, MessageCircle, PanelRightClose, Phone, Plane, Users } from 'lucide-react'
import ChatWindow from '../components/chat/ChatWindow'
import ComparisonPanel from '../components/ComparisonPanel'
import MarketReferencesPanel from '../components/MarketReferencesPanel'
import PricingPanel from '../components/PricingPanel'
import QuoteSendPanel from '../components/QuoteSendPanel'
import LeadDealerRfqPanel from '../components/LeadDealerRfqPanel'
import LeadDealerResponsesPanel from '../components/LeadDealerResponsesPanel'
import PackageOfferBanner from '../components/PackageOfferBanner'
import SourceOptions from '../components/SourceOptions'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import { Skeleton } from '../components/ui/Skeleton'
import OverflowMenu, { type OverflowItem } from '../components/ui/OverflowMenu'
import StagePath from '../components/ui/StagePath'
import LifecycleBadge from '../components/ui/LifecycleBadge'
import StatusBadge from '../components/ui/StatusBadge'
import Timeline from '../components/ui/Timeline'
import LeadWorkspaceTabs from '../components/leads/LeadWorkspaceTabs'
import BookLeadsModal from '../components/BookLeadsModal'
import LeadDocumentsPanel from '../components/LeadDocumentsPanel'
import TripPlanPanel from '../components/tripPlan/TripPlanPanel'
import {
  deleteLead,
  fetchLeadById,
  fetchLeadAudit,
  formatPhone,
  leadPerson,
  leadTitle,
  retryFlightQuotes,
  retryHotelQuotes,
  retryPackageQuotes,
  transitionLifecycle,
  type Lead,
  type LifecycleStatus,
} from '../lib/leads'
import { useSearch } from '../hooks/useSearch'
import { useConfirm } from '../hooks/useConfirm'
import {
  HAPPY_PATH,
  nextActionFor,
  parseQuoteStep,
  pathStatus,
  primaryCtaForLifecycle,
  type QuoteStep,
} from '../lib/lifecycle'
import { formatDateRange, leadRef, leadTypeLabel, nightsLabel, travelersLabel } from '../lib/leadSummary'
import { buildTabBadges, type TabBadges } from '../lib/leadTabs'
import { fetchDealerRequests, fetchDealerResponses } from '../lib/dealers'
import { fetchVersions } from '../lib/quoteVersions'
import { fetchComparison, fetchQuoteDraft, upsertQuoteDraft, type QuoteDraft } from '../lib/quoteDrafts'
import {
  customerThreadId,
  fetchThreadMessages,
  sendThreadMessage,
  type ChatMessage,
  type ThreadDetail,
} from '../lib/inbox'

function ActivityList({ audit }: { audit: unknown[] }) {
  useI18n()
  const items = (Array.isArray(audit) ? audit.slice(0, 8) : []).map((evt, i) => {
    const item = evt as Record<string, unknown>
    return {
      id: `${String(item.id || i)}`,
      title: String(item.action || 'event').replace(/_/g, ' '),
      subtitle: String(item.created_at || ''),
      body: item.actor_role ? translate("by {value0}", { value0: translate(String(String(item.actor_role))) }) : undefined,
    }
  })
  return <Timeline emptyLabel="No activity yet." items={items} />
}

export default function LeadDetailPage() {
  useI18n()
  const { segment: leadId = '' } = useParams<{ segment: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { setPlaceholder } = useSearch()
  const { confirm, dialog } = useConfirm()

  const [lead, setLead] = useState<Lead | null>(null)
  const [draft, setDraft] = useState<QuoteDraft | null>(null)
  const [audit, setAudit] = useState<unknown[]>([])
  const [chatThread, setChatThread] = useState<ThreadDetail | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [chatSending, setChatSending] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [bookOpen, setBookOpen] = useState(false)
  const [railOpen, setRailOpen] = useState(searchParams.get('tab') === 'chat')
  const [tabBadges, setTabBadges] = useState<TabBadges>({})
  const [loadedLeadId, setLoadedLeadId] = useState(leadId)
  if (leadId !== loadedLeadId) {
    setLoadedLeadId(leadId)
    setLoading(true)
    setError(null)
  }

  const step = parseQuoteStep(searchParams, lead?.lifecycle_status)
  const setStep = (next: QuoteStep) => {
    setSearchParams({ step: next }, { replace: true })
  }

  useEffect(() => {
    setPlaceholder('Search this lead')
  }, [setPlaceholder])

  const load = async () => {
    if (!leadId) return
    setLoading(true)
    setError(null)
    try {
      const [loadedLead, loadedAudit] = await Promise.all([
        fetchLeadById(leadId),
        fetchLeadAudit(leadId),
      ])
      setLead(loadedLead)
      setAudit(loadedAudit)

      let loadedDraft = await fetchQuoteDraft(leadId)
      if (!loadedDraft) loadedDraft = await upsertQuoteDraft(leadId, {})
      setDraft(loadedDraft)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load lead')
    } finally {
      setLoading(false)
    }
  }

  const loadChat = useCallback(async () => {
    if (!leadId) return
    setChatLoading(true)
    setChatError(null)
    try {
      const data = await fetchThreadMessages(customerThreadId(leadId))
      setChatThread(data.thread)
      setChatMessages(data.messages)
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Failed to load chat')
    } finally {
      setChatLoading(false)
    }
  }, [leadId])

  useEffect(() => {
    if (!leadId) return
    let cancelled = false
    Promise.all([fetchLeadById(leadId), fetchLeadAudit(leadId)])
      .then(async ([loadedLead, loadedAudit]) => {
        if (cancelled) return
        setLead(loadedLead)
        setAudit(loadedAudit)
        let loadedDraft = await fetchQuoteDraft(leadId)
        if (!loadedDraft) loadedDraft = await upsertQuoteDraft(leadId, {})
        if (cancelled) return
        setDraft(loadedDraft)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load lead')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leadId])

  useEffect(() => {
    if (!leadId) return
    let cancelled = false
    fetchThreadMessages(customerThreadId(leadId))
      .then((data) => {
        if (cancelled) return
        setChatThread(data.thread)
        setChatMessages(data.messages)
        setChatError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setChatError(err instanceof Error ? err.message : 'Failed to load chat')
      })
      .finally(() => {
        if (!cancelled) setChatLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leadId])

  // Tab chips are a convenience: any of these can fail without blocking the page.
  const stage = lead?.lifecycle_status
  const quoteState = lead?.quote_status
  useEffect(() => {
    if (!leadId) return
    let cancelled = false
    void Promise.allSettled([
      fetchComparison(leadId),
      fetchDealerRequests({ leadId }),
      fetchDealerResponses({ leadId }),
      fetchVersions(leadId),
    ]).then(([comparison, requests, responses, versions]) => {
      if (cancelled) return
      setTabBadges(
        buildTabBadges({
          optionCount: comparison.status === 'fulfilled' ? comparison.value.count : null,
          requestIds: requests.status === 'fulfilled' ? requests.value.map((r) => r.id) : null,
          respondedRequestIds:
            responses.status === 'fulfilled' ? responses.value.map((r) => r.dealer_request_id) : null,
          versions: versions.status === 'fulfilled' ? versions.value : null,
        }),
      )
    })
    return () => {
      cancelled = true
    }
  }, [leadId, stage, quoteState])

  useEffect(() => {
    const timer = window.setInterval(() => void loadChat(), 5000)
    return () => window.clearInterval(timer)
  }, [loadChat])

  const handleRetrySourcing = async () => {
    if (!lead) return
    setBusy(true)
    try {
      if (lead.booking_type === 'package') await retryPackageQuotes(lead.id)
      else if (lead.booking_type === 'hotel') await retryHotelQuotes(lead.id)
      else await retryFlightQuotes(lead.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry sourcing')
    } finally {
      setBusy(false)
    }
  }

  const handleLifecycle = async (next: LifecycleStatus) => {
    if (!lead) return
    if (next === 'booked') {
      setBookOpen(true)
      return
    }
    setBusy(true)
    try {
      const updated = await transitionLifecycle(lead.id, next)
      setLead(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lifecycle update failed')
    } finally {
      setBusy(false)
    }
  }

  const handleSendChat = async (body: string) => {
    setChatSending(true)
    try {
      await sendThreadMessage(customerThreadId(leadId), body)
      await loadChat()
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Failed to send')
      throw err
    } finally {
      setChatSending(false)
    }
  }

  const cta = useMemo(
    () => primaryCtaForLifecycle(lead?.lifecycle_status),
    [lead?.lifecycle_status],
  )

  const handlePrimary = async () => {
    setStep(cta.step)
    if (cta.step === 'source') await handleRetrySourcing()
  }

  const conversation = (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatWindow
        thread={chatThread}
        messages={chatMessages}
        loading={chatLoading}
        sending={chatSending}
        error={chatError}
        onSend={handleSendChat}
        onRefresh={() => void loadChat()}
        compact
      />
      <div className="max-h-48 shrink-0 overflow-y-auto border-t border-shop-border p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-shop-muted">{translate("Activity")}</h3>
        <ActivityList audit={audit} />
      </div>
    </div>
  )

  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label={translate("Loading lead")} className="flex flex-col gap-4 p-4 sm:p-6">
        <Skeleton className="h-3 w-40" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-[22px] w-24 rounded-full" />
        </div>
        <Skeleton className="h-3 w-2/3" />
        <div className="flex gap-1.5">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-20 rounded-full" />
          ))}
        </div>
        <Skeleton className="mt-2 h-24 w-full rounded-[10px]" />
        <Skeleton className="h-48 w-full rounded-[10px]" />
      </div>
    )
  }

  if (error || !lead) {
    return (
      <EmptyState
        tone="danger"
        icon={<CircleAlert />}
        title={error ? translate("This lead could not be loaded") : translate("Lead not found")}
        description={error || 'It may have been deleted, or you may not have access to it.'}
        action={
          <Button variant="primary" onClick={() => navigate('/leads/hotel')}>
            {translate("Back to leads")}</Button>
        }
      />
    )
  }

  const next = nextActionFor(lead.lifecycle_status, lead.quote_status)
  const nights = nightsLabel(lead.nights)
  const listType = ['flight', 'package'].includes(lead.booking_type) ? lead.booking_type : 'hotel'

  const menuItems: OverflowItem[] = [
    {
      id: 'retry',
      label: 'Retry sourcing',
      onClick: () => {
        setStep('source')
        void handleRetrySourcing()
      },
    },
    {
      id: 'inbox',
      label: 'Open in Inbox',
      onClick: () =>
        navigate(`/inbox/${encodeURIComponent(customerThreadId(lead.id))}`),
    },
    {
      id: 'lost',
      label: 'Mark lost',
      onClick: () => void handleLifecycle('lost'),
    },
    {
      id: 'archived',
      label: 'Archive',
      onClick: () => void handleLifecycle('archived'),
    },
    {
      id: 'delete',
      label: 'Delete lead',
      tone: 'danger',
      onClick: () => {
        void confirm({
          title: translate("Delete {value0}?", { value0: translate(String(leadPerson(lead))) }),
          description: 'The lead, its quote draft and versions are removed for everyone. This can’t be undone.',
          confirmLabel: 'Delete lead',
        }).then((ok) => {
          if (ok) void deleteLead(lead.id).then(() => navigate(`/leads/${listType}`))
        })
      },
    },
  ]

  const stageNumber = HAPPY_PATH.indexOf(pathStatus(lead.lifecycle_status)) + 1
  const closed = lead.lifecycle_status === 'lost' || lead.lifecycle_status === 'archived'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-shop-border bg-white px-4 pt-3.5 max-md:px-2 max-md:pt-2 sm:px-6 max-md:sm:px-2">
        <div className="flex flex-col gap-2 md:hidden">
          <div className="flex items-center gap-1">
            <Link
              to={`/leads/${listType}`}
              aria-label={translate("Back to leads")}
              className="grid size-11 shrink-0 place-items-center rounded-[10px] text-shop-ink hover:bg-neutral-bg"
            >
              <ChevronLeft className="size-5" aria-hidden="true" />
            </Link>
            <div className="flex min-w-0 flex-1 flex-col leading-tight">
              <strong className="truncate text-[17px]">{leadPerson(lead)}</strong>
              <span className="truncate text-[13px] text-shop-muted tabular-nums">
                {[
                  lead.destination,
                  formatDateRange(lead.travel_date, lead.return_date),
                  `${lead.adults_count}A${lead.children_count ? ` ${lead.children_count}C` : ''}`,
                ].join(' · ')}
              </span>
            </div>
            <button
              type="button"
              aria-label={railOpen ? translate("Hide chat") : translate("Show chat")}
              aria-pressed={railOpen}
              aria-controls="lead-chat-sidebar"
              onClick={() => setRailOpen((open) => !open)}
              className="grid size-11 shrink-0 place-items-center rounded-[10px] text-shop-ink hover:bg-neutral-bg"
            >
              <MessageCircle className="size-5" aria-hidden="true" />
            </button>
            <LeadTasksButton leadId={lead.id} contactId={lead.contact_id} />
            <OverflowMenu label={translate("More lead actions")} items={menuItems} />
          </div>
          <div className="flex items-center gap-2 px-2">
            <LifecycleBadge status={lead.lifecycle_status} />
            <span className="truncate text-[13px] text-shop-muted">
              {closed ? translate("No longer active") : translate("Stage {value0} of {value1} · next: {value2}", { value0: translate(String(stageNumber)), value1: translate(String(HAPPY_PATH.length)), value2: translate(String(next.text.toLowerCase())) })}
            </span>
          </div>
        </div>

        <nav aria-label={translate("Breadcrumb")} className="mb-3 flex items-center gap-1.5 text-[13px] text-shop-muted max-md:hidden">
          <Link to="/leads/hotel" className="-my-3 py-3 text-slate-600 hover:text-shop-ink hover:underline">
            {translate("Leads")}</Link>
          <span aria-hidden="true">/</span>
          <Link to={`/leads/${listType}`} className="-my-3 py-3 text-slate-600 hover:text-shop-ink hover:underline">
            {listType.charAt(0).toUpperCase() + listType.slice(1)}
          </Link>
          <span aria-hidden="true">/</span>
          <span className="tabular-nums">{leadRef(lead.id)}</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-4 max-md:hidden">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-extrabold tracking-[-0.01em] text-shop-ink">{leadPerson(lead)}</h1>
              <LifecycleBadge status={lead.lifecycle_status} />
              <StatusBadge label={leadTypeLabel(lead.booking_type)} tone="neutral" />
            </div>
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] tabular-nums text-slate-700">
              <li className="flex items-center gap-1.5">
                <Plane className="size-4 text-shop-muted" aria-hidden="true" />
                {leadTitle(lead)}
              </li>
              <li className="flex items-center gap-1.5">
                <CalendarDays className="size-4 text-shop-muted" aria-hidden="true" />
                {formatDateRange(lead.travel_date, lead.return_date)}
                {nights ? ` · ${nights}` : ''}
              </li>
              <li className="flex items-center gap-1.5">
                <Users className="size-4 text-shop-muted" aria-hidden="true" />
                {travelersLabel(lead.adults_count, lead.children_count, lead.children_ages)}
              </li>
              <li>
                <a
                  href={`tel:${formatPhone(lead.phone).replace(/\s+/g, '')}`}
                  className="-my-2.5 flex items-center gap-1.5 py-2.5 text-slate-700 hover:text-shop-ink"
                >
                  <Phone className="size-4 text-shop-muted" aria-hidden="true" />
                  <bdi dir="ltr">{formatPhone(lead.phone)}</bdi>
                </a>
              </li>
            </ul>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              aria-pressed={railOpen}
              aria-controls="lead-chat-sidebar"
              icon={<MessageCircle className="size-4" />}
              onClick={() => setRailOpen((open) => !open)}
            >
              {railOpen ? translate("Hide chat") : translate("Show chat")}
            </Button>
            <OverflowMenu label={translate("More lead actions")} items={menuItems} />
            <Button variant="primary" loading={busy} onClick={() => void handlePrimary()}>
              {translate(cta.label)}
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div className="mt-3 max-md:hidden">
          <StagePath
            current={lead.lifecycle_status || 'intake'}
            allowed={lead.lifecycle_allowed}
            disabled={busy}
            onSelect={(status) => void handleLifecycle(status)}
            hint={lead.lifecycle_status === 'lost' || lead.lifecycle_status === 'archived' ? undefined : translate("Next: {value0}", { value0: translate(String(next.text)) })}
          />
        </div>

        <div className="mt-2 max-md:mt-1.5">
          <LeadWorkspaceTabs step={step} onSelect={setStep} badges={tabBadges} />
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {step === 'source' && (
            <div className="space-y-4">
              <PackageOfferBanner lead={lead} onUpdated={(updated) => setLead(updated)} />
              <SourceOptions
                lead={lead}
                draft={draft}
                onDraftChange={setDraft}
                onCompare={() => setStep('build')}
                onRetry={() => void handleRetrySourcing()}
                retrying={busy}
              />
            </div>
          )}

          {step === 'dealers' && (
            <div className="space-y-4">
              <LeadDealerRfqPanel lead={lead} onUpdated={() => void load()} />
              <LeadDealerResponsesPanel leadId={lead.id} onUpdated={() => void load()} />
            </div>
          )}

          {step === 'market' && <MarketReferencesPanel lead={lead} />}

          {step === 'build' && !draft && <div role="status" className="rounded-[10px] border border-shop-border bg-white p-4 text-sm text-shop-muted">{translate("Preparing the quote builder…")}</div>}
          {step === 'build' && draft && (
            <div className="flex flex-wrap items-start gap-6">
              <section aria-labelledby="cmp-h" className="min-w-0 flex-[999_1_520px]">
                <ComparisonPanel leadId={lead.id} draft={draft} onDraftChange={setDraft} />
              </section>
              <aside className="flex-[1_1_360px] lg:sticky lg:top-0 lg:max-h-[calc(100dvh-15rem)] lg:max-w-[420px] lg:overflow-y-auto">
                <PricingPanel leadId={lead.id} draft={draft} onDraftChange={setDraft} />
              </aside>
            </div>
          )}

          {step === 'trip' && (
            <div className="space-y-4">
              <GroupSelect leadId={lead.id} groupId={lead.group_trip_id ?? null} />
              <TripPlanPanel leadId={lead.id} />
              <TravellersPanel leadId={lead.id} />
              <VisasPanel leadId={lead.id} />
              <DeadlinesPanel leadId={lead.id} />
              <CostsPanel leadId={lead.id} />
            </div>
          )}

          {step === 'send' && (
            <div className="space-y-4">
              {!draft && (
                <div role="status" className="rounded-[10px] border border-shop-border bg-white p-4 text-sm text-shop-muted">
                  {translate("Preparing the quote…")}</div>
              )}
              {draft && <QuoteSendPanel leadId={lead.id} leadPhone={lead.phone} draft={draft} />}
              <LeadDocumentsPanel leadId={lead.id} />
            </div>
          )}
        </div>
        {!(step === 'source' && (draft?.items.length ?? 0) > 0) && (
        <div className="shrink-0 border-t border-shop-border bg-white px-4 pt-3 pb-4 md:hidden">
          <Button variant="primary" block loading={busy} onClick={() => void handlePrimary()} className="h-[52px] rounded-[14px] text-base font-bold max-sm:h-[52px]">
            {translate(cta.label)}
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
        )}
        </div>

        {railOpen && (
          <>
            <button
              type="button"
              aria-label={translate("Close chat")}
              className="absolute inset-0 z-20 bg-black/25 lg:hidden"
              onClick={() => setRailOpen(false)}
            />
            <aside
              id="lead-chat-sidebar"
              aria-label={translate("WhatsApp chat with {value0}", { value0: translate(String(leadPerson(lead))) })}
              className="absolute inset-y-0 end-0 z-30 flex min-h-0 w-[min(100%,21.25rem)] flex-col border-s border-shop-border bg-white shadow-xl lg:static lg:z-0 lg:w-[340px] lg:shrink-0 lg:shadow-none"
            >
              <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-shop-border pe-3 ps-4">
                <MessageCircle className="size-4 text-shop-accent" aria-hidden="true" />
                <strong className="flex-1 text-sm">WhatsApp</strong>
                <Link
                  to={`/inbox/${encodeURIComponent(customerThreadId(lead.id))}`}
                  className="text-[13px] font-semibold text-shop-accent hover:underline"
                >
                  {translate("Open in Inbox")}</Link>
                <Button
                  variant="ghost"
                  iconOnly
                  aria-label={translate("Collapse chat")}
                  icon={<PanelRightClose className="size-4" />}
                  onClick={() => setRailOpen(false)}
                />
              </div>
              {conversation}
            </aside>
          </>
        )}
      </div>
      {lead && (
        <BookLeadsModal
          open={bookOpen}
          leads={[lead]}
          title={translate("Mark as booked")}
          confirmLabel="Book & create portal login"
          onClose={() => setBookOpen(false)}
          onConfirm={async (drafts) => {
            const draft = drafts[0]
            if (!draft) return
            setBusy(true)
            try {
              const updated = await transitionLifecycle(lead.id, 'booked', {
                contact_name: draft.name,
                contact_email: draft.email,
              })
              setLead(updated)
            } finally {
              setBusy(false)
            }
          }}
        />
      )}
      {dialog}
    </div>
  )
}
