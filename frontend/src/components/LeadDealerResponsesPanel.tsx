import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import Button from './ui/Button'
import StatusBadge from './ui/StatusBadge'
import { HighlightBadge } from './ui/SourceBadge'
import {
  confirmBestOffer,
  fetchDealerResponses,
  reviewResponse,
  type DealerResponse,
} from '../lib/dealers'
import { dealerThreadId, groupThreadId } from '../lib/inbox'

type Props = {
  leadId: string
  onUpdated?: () => void
}

function money(extracted?: Record<string, unknown> | null) {
  const total = extracted?.total_price
  const perNight = extracted?.price_per_night
  const currency = String(extracted?.currency || 'USD')
  const value = total ?? perNight
  if (value == null || value === '') return null
  const amount = Number(value)
  if (!Number.isFinite(amount)) return String(value)
  try {
    return amount.toLocaleString(undefined, { style: 'currency', currency })
  } catch {
    return `${currency} ${amount}`
  }
}

const CAP = 'text-[11px] font-bold tracking-[0.06em] text-shop-muted uppercase'

function Fact({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`grid gap-0.5 ${wide ? 'col-span-2' : ''}`}>
      <dt className="text-xs font-semibold text-slate-600">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{value}</dd>
    </div>
  )
}

function ResponseCard({
  response,
  onAction,
}: {
  response: DealerResponse
  onAction: () => void
}) {
  const [acting, setActing] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const navigate = useNavigate()
  const extracted = response.extracted || {}
  const price = money(extracted)

  const run = async (action: () => Promise<unknown>) => {
    setActing(true)
    setFailure(null)
    try {
      await action()
      onAction()
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'That did not work — try again')
    } finally {
      setActing(false)
    }
  }

  const chatId = response.whatsapp_group_jid
    ? groupThreadId(response.whatsapp_group_jid)
    : dealerThreadId(response.dealer_request_id)

  const included = [extracted.airline, extracted.hotel_name, extracted.room_type].filter(Boolean).map(String).join(' · ')

  return (
    <article aria-label={`Reply from ${response.dealer_name || 'dealer'}`} className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex flex-wrap items-center gap-2 text-base font-bold">
          Dealer reply · {response.dealer_name || 'Dealer'}
          <span className="font-mono text-xs font-normal text-shop-muted">{response.request_code}</span>
          {response.is_best && <HighlightBadge kind="best_value" />}
          {!response.is_best && response.is_recommended && <HighlightBadge kind="ai_pick" />}
          <StatusBadge
            label={response.review_status}
            tone={response.review_status === 'approved' ? 'success' : response.review_status === 'rejected' ? 'danger' : 'warning'}
          />
        </h3>
        <StatusBadge label="Parsed by AI · check before using" tone="outlineDealer" icon={<Sparkles />} />
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-3">
        <div className="flex flex-col gap-2 rounded-[10px] border border-shop-border bg-[#EFF3F6] p-3.5">
          <span className={CAP}>Original WhatsApp message</span>
          <div className="whitespace-pre-line rounded-[12px_12px_12px_4px] bg-white px-2.5 py-2 text-[13px]">
            {response.raw_text}
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-[10px] border border-shop-border bg-white p-3.5">
          <span className={CAP}>Structured offer</span>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            {included ? <Fact label="Includes" value={included} wide /> : null}
            {price ? <Fact label={extracted.total_price != null ? 'Net total' : 'Per night'} value={price} /> : null}
            {extracted.board_name ? <Fact label="Board" value={String(extracted.board_name)} /> : null}
            {extracted.validity ? <Fact label="Offer valid until" value={String(extracted.validity)} /> : null}
            {extracted.cancellation_terms ? <Fact label="Cancellation" value={String(extracted.cancellation_terms)} /> : null}
          </dl>
          {!included && !price && !extracted.board_name && !extracted.cancellation_terms ? (
            <p className="text-[13px] text-shop-muted">Nothing could be read from this message — check the original.</p>
          ) : null}
          {response.extraction_errors && response.extraction_errors.length > 0 ? (
            <p className="text-xs text-warn-fg">Check: {response.extraction_errors.join(', ')}</p>
          ) : null}
        </div>
      </div>

      {response.is_recommended && response.ai_rank_reason && (
        <p className="rounded-lg bg-[#F5F3FF] px-2.5 py-2 text-[13px] text-dealer-fg">{response.ai_rank_reason}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {response.review_status === 'pending' && (
          <>
            <Button variant="primary" disabled={acting} onClick={() => void run(() => reviewResponse(response.id, true))}>
              Approve
            </Button>
            <Button variant="secondary" disabled={acting} onClick={() => void run(() => reviewResponse(response.id, false))}>
              Reject
            </Button>
          </>
        )}
        {!response.is_best && response.review_status !== 'rejected' && (
          <Button variant="secondary" disabled={acting} onClick={() => void run(() => confirmBestOffer(response.id))}>
            Confirm best
          </Button>
        )}
        <Button variant="ghost" onClick={() => navigate(`/inbox/${encodeURIComponent(chatId)}`)}>
          View chat
        </Button>
        {response.review_status === 'approved' && (
          <span className="text-[13px] text-primary-800">Approved — available in Build under Dealer offers.</span>
        )}
      </div>
      {failure && (
        <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
          {failure}
        </p>
      )}
    </article>
  )
}

export default function LeadDealerResponsesPanel({ leadId, onUpdated }: Props) {
  const [responses, setResponses] = useState<DealerResponse[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const all = await fetchDealerResponses({ leadId })
      setResponses(all)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    fetchDealerResponses({ leadId })
      .then((all) => {
        if (!cancelled) setResponses(all)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leadId])

  if (loading) return <p role="status" className="text-sm text-shop-muted">Loading dealer responses…</p>
  if (!responses.length) {
    return (
      <section className="rounded-[10px] border border-dashed border-line-strong bg-white p-6 text-center text-sm text-shop-muted">
        No dealer quotes yet. Send an RFQ above. Replies with the REQ code are extracted by AI.
      </section>
    )
  }

  const pending = responses.filter((r) => r.review_status === 'pending')

  return (
    <section className="flex flex-col gap-5">
      {pending.length > 0 && (
        <p className="rounded-lg bg-warn-bg px-3.5 py-2.5 text-[13px] text-warn-fg">
          {pending.length} pending — approve to add to Build, or confirm Best to approve automatically.
        </p>
      )}
      {responses.map((r) => (
        <ResponseCard
          key={r.id}
          response={r}
          onAction={() => {
            void load()
            onUpdated?.()
          }}
        />
      ))}
    </section>
  )
}
