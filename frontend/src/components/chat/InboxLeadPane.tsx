import { t as translate, useI18n } from '../../lib/i18n'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../ui/Button'
import LifecycleBadge from '../ui/LifecycleBadge'
import StatusBadge from '../ui/StatusBadge'
import { fetchLeadById, leadTitle, type Lead } from '../../lib/leads'
import { fetchDealerRequests, fetchDealerResponses } from '../../lib/dealers'
import { fetchComparison } from '../../lib/quoteDrafts'
import { formatDateRange, leadRef, leadTypeLabel, nightsLabel, travelersLabel } from '../../lib/leadSummary'
import { nextActionFor } from '../../lib/lifecycle'
import type { ThreadKind } from '../../lib/inbox'

type Props = {
  leadId?: string | null
  kind?: ThreadKind | null
  /** Whether the panel is shown at all (the toggle in the chat header). */
  open?: boolean
}

type Progress = { options: number | null; asked: number | null; replied: number | null }

const CAP = 'text-[11px] font-bold tracking-[0.06em] text-shop-muted uppercase'

function sourcingBadge(lead: Lead) {
  if (lead.quote_status === 'processing') return <StatusBadge label={translate("Searching")} tone="info" />
  if (lead.quote_status === 'error') return <StatusBadge label={translate("Failed")} tone="danger" />
  if (lead.quote_status === 'completed' || lead.quote_status === 'package') return <StatusBadge label={translate("Done")} tone="success" />
  return <StatusBadge label={translate("Not started")} tone="neutral" />
}

export default function InboxLeadPane({ leadId, kind, open = true }: Props) {
  useI18n()
  const navigate = useNavigate()
  const [lead, setLead] = useState<Lead | null>(null)
  const [progress, setProgress] = useState<Progress>({ options: null, asked: null, replied: null })
  const [error, setError] = useState<string | null>(null)
  const [loadedLeadId, setLoadedLeadId] = useState(leadId ?? null)
  if (leadId !== loadedLeadId) {
    setLoadedLeadId(leadId ?? null)
    setLead(null)
    setProgress({ options: null, asked: null, replied: null })
    setError(null)
  }

  useEffect(() => {
    if (!leadId) return
    let cancelled = false
    fetchLeadById(leadId)
      .then((next) => {
        if (cancelled) return
        setLead(next)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setLead(null)
        setError(err instanceof Error ? err.message : 'Failed to load lead')
      })
    // The progress block is a convenience — any of these may fail without hiding the lead.
    void Promise.allSettled([fetchComparison(leadId), fetchDealerRequests({ leadId }), fetchDealerResponses({ leadId })]).then(
      ([options, requests, responses]) => {
        if (cancelled) return
        const asked = requests.status === 'fulfilled' ? new Set(requests.value.map((r) => r.id)) : null
        const repliedIds =
          asked && responses.status === 'fulfilled'
            ? new Set(responses.value.map((r) => r.dealer_request_id).filter((id) => asked.has(id)))
            : null
        setProgress({
          options: options.status === 'fulfilled' ? options.value.count : null,
          asked: asked ? asked.size : null,
          replied: repliedIds ? repliedIds.size : null,
        })
      },
    )
    return () => {
      cancelled = true
    }
  }, [leadId])

  if (!open) return null

  const shell = 'hidden w-[320px] min-w-[280px] shrink-0 flex-col overflow-y-auto border-s border-shop-border bg-white xl:flex'

  if (!leadId) {
    return (
      <aside aria-label={translate("Lead summary")} className={`${shell} p-4`}>
        <h2 className={CAP}>{kind === 'group' ? translate("Group") : kind === 'dealer' ? translate("Dealer") : translate("Linked lead")}</h2>
        <p className="mt-2 text-sm text-shop-muted">
          {kind === 'group'
            ? translate("This is a WhatsApp group. Messages you send here go to everyone in the group.")
            : kind === 'dealer'
              ? translate("A dealer conversation. Replies with the REQ code are read by AI and added to the lead as offers.")
              : translate("No lead is linked to this conversation yet.")}
        </p>
      </aside>
    )
  }

  const next = lead ? nextActionFor(lead.lifecycle_status, lead.quote_status) : null

  return (
    <aside aria-label={translate("Lead summary")} className={shell}>
      {error && (
        <p role="alert" className="m-4 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
          {translate(error)}
        </p>
      )}
      {!lead && !error && <p role="status" className="p-4 text-sm text-shop-muted">{translate("Loading lead…")}</p>}
      {lead && next && (
        <>
          <div className="flex flex-col gap-3 border-b border-shop-border p-4">
            <div className="flex items-center justify-between">
              <span className={CAP}>{translate("Linked lead")}</span>
              <LifecycleBadge status={lead.lifecycle_status} />
            </div>
            <div className="flex flex-col gap-0.5">
              <strong className="text-base">{leadTitle(lead)}</strong>
              <span className="text-[13px] text-shop-muted">
                {leadTypeLabel(lead.booking_type)} · {leadRef(lead.id)}
              </span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
              <dt className="text-shop-muted">{translate("Dates")}</dt>
              <dd className="tabular-nums">
                {formatDateRange(lead.travel_date, lead.return_date)}
                {nightsLabel(lead.nights) ? ` · ${nightsLabel(lead.nights)}` : ''}
              </dd>
              <dt className="text-shop-muted">{translate("Travelers")}</dt>
              <dd>{travelersLabel(lead.adults_count, lead.children_count, lead.children_ages)}</dd>
            </dl>
          </div>

          <div className="flex flex-col gap-2.5 border-b border-shop-border p-4">
            <span className={CAP}>{translate("Progress")}</span>
            <div className="flex items-center justify-between text-sm">
              <span>{translate("Live sources")}</span>
              {sourcingBadge(lead)}
            </div>
            {progress.asked != null && progress.asked > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span>{translate("Dealer RFQs")}</span>
                <StatusBadge
                  label={translate("{value0} of {value1} replied", { value0: translate(String(progress.replied ?? 0)), value1: translate(String(progress.asked)) })}
                  tone={(progress.replied ?? 0) >= progress.asked ? 'success' : 'warning'}
                />
              </div>
            )}
            {progress.options != null && (
              <div className="flex items-center justify-between text-sm">
                <span>{translate("Options to compare")}</span>
                <strong className="tabular-nums">{progress.options}</strong>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2.5 p-4">
            <span className={CAP}>{translate("Next action")}</span>
            <p className={next.blocker ? 'font-semibold text-danger-fg' : ''}>{next.text}</p>
            <Button
              block
              className="border-shop-accent text-shop-accent"
              onClick={() => navigate(`/leads/${lead.id}?step=build`)}
            >
              {translate("Build quote")}</Button>
            <Button block variant="ghost" onClick={() => navigate(`/leads/${lead.id}`)}>
              {translate("Open full lead")}</Button>
          </div>
        </>
      )}
    </aside>
  )
}
