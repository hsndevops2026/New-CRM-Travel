import { useEffect, useMemo, useState } from 'react'
import { Download, Send, Trash2, X } from 'lucide-react'
import { useConfirm } from '../hooks/useConfirm'
import { useToast } from '../hooks/useToast'
import { formatWhen } from '../lib/leads'
import Button from './ui/Button'
import FilterPills from './ui/FilterPills'
import StatusBadge from './ui/StatusBadge'
import EmptyState from './ui/EmptyState'
import OverflowMenu from './ui/OverflowMenu'
import {
  approvePredefinedQuoteImport,
  deletePredefinedQuote,
  displayTotal,
  downloadPredefinedQuotePdf,
  fetchPredefinedQuotes,
  formatQuoteMoney,
  quoteSummary,
  quoteTypeLabel,
  type PredefinedQuote,
  type PredefinedQuoteImport,
  type PredefinedQuoteInput,
} from '../lib/predefinedQuotes'
import ImportPredefinedQuoteModal from './ImportPredefinedQuoteModal'
import PredefinedQuoteModal from './PredefinedQuoteModal'
import PredefinedQuotePreview from './PredefinedQuotePreview'
import SendToCustomerModal from './SendToCustomerModal'

type Props = {
  query: string
  editorOpen: boolean
  importOpen: boolean
  onEditorOpenChange: (open: boolean) => void
  onImportOpenChange: (open: boolean) => void
}

function TypeBadge({ type }: { type: string }) {
  const tone = type === 'package' ? 'success' : type === 'flight' ? 'neutral' : 'info'
  return <StatusBadge label={quoteTypeLabel(type)} tone={tone} />
}

const COVER_TONES = ['#0F766E', '#134E4A', '#1E3A8A', '#7C2D12', '#0369A1', '#3F6212', '#334155']

/** 56×40 cover: the photo when there is one, else a flat colour with the destination code. */
function Cover({ quote, className = 'h-10 w-14' }: { quote: PredefinedQuote; className?: string }) {
  if (quote.cover_image_url) {
    return <img src={quote.cover_image_url} alt="" className={`${className} shrink-0 rounded-md object-cover`} />
  }
  const label = (quote.destination || quote.title || '?').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 3).toUpperCase()
  const tone = COVER_TONES[(quote.id.charCodeAt(0) || 0) % COVER_TONES.length]
  return (
    <div
      aria-hidden="true"
      className={`${className} grid shrink-0 place-items-center rounded-md text-[10px] font-bold text-white/85`}
      style={{ background: tone }}
    >
      {label}
    </div>
  )
}

type TypeFilter = 'all' | 'package' | 'hotel' | 'flight'

export default function PredefinedQuotesPanel({
  query,
  editorOpen,
  importOpen,
  onEditorOpenChange,
  onImportOpenChange,
}: Props) {
  const { confirm, dialog } = useConfirm()
  const toast = useToast()
  const [quotes, setQuotes] = useState<PredefinedQuote[]>([])
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deletingSelected, setDeletingSelected] = useState(false)
  const [editing, setEditing] = useState<PredefinedQuote | null>(null)
  const [preview, setPreview] = useState<PredefinedQuote | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [sendToCustomer, setSendToCustomer] = useState<PredefinedQuote | null>(null)
  const [importReview, setImportReview] = useState<{
    record: PredefinedQuoteImport
    targetQuoteId: string | null
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchPredefinedQuotes()
      .then((next) => {
        if (cancelled) return
        setQuotes(next)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load quotes')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const typeCounts = useMemo(
    () => ({
      all: quotes.length,
      package: quotes.filter((q) => q.quote_type === 'package').length,
      hotel: quotes.filter((q) => q.quote_type === 'hotel').length,
      flight: quotes.filter((q) => q.quote_type === 'flight').length,
    }),
    [quotes],
  )

  const filteredQuotes = useMemo(() => {
    const term = query.trim().toLowerCase()
    const ofType = typeFilter === 'all' ? quotes : quotes.filter((q) => q.quote_type === typeFilter)
    if (!term) return ofType
    return ofType.filter((quote) =>
      [
        quote.title,
        quote.destination,
        quote.origin,
        quote.quote_type,
        quoteTypeLabel(quote.quote_type),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term),
    )
  }, [quotes, query, typeFilter])

  const visibleIds = useMemo(() => filteredQuotes.map((quote) => quote.id), [filteredQuotes])
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))

  const toggleOne = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const toggleAllVisible = (checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      visibleIds.forEach((id) => {
        if (checked) next.add(id)
        else next.delete(id)
      })
      return next
    })
  }

  const handleSaved = (saved: PredefinedQuote) => {
    setQuotes((prev) => {
      const without = prev.filter((item) => item.id !== saved.id)
      return [saved, ...without]
    })
    onEditorOpenChange(false)
    setEditing(null)
  }

  const handleDelete = async (quote: PredefinedQuote) => {
    const ok = await confirm({
      title: `Delete “${quote.title}”?`,
      description: 'The template is removed from the library. Leads that already used it keep their copy. This can’t be undone.',
      confirmLabel: 'Delete template',
    })
    if (!ok) return
    try {
      await deletePredefinedQuote(quote.id)
      setQuotes((prev) => prev.filter((item) => item.id !== quote.id))
      setSelected((current) => {
        const next = new Set(current)
        next.delete(quote.id)
        return next
      })
      if (preview?.id === quote.id) setPreview(null)
    } catch (err) {
      toast.show({ tone: 'error', message: err instanceof Error ? err.message : 'Failed to delete template' })
    }
  }

  const handleDeleteSelected = async () => {
    const ids = [...selected].filter((id) => quotes.some((quote) => quote.id === id))
    if (!ids.length) return

    const label = `${ids.length} template${ids.length === 1 ? '' : 's'}`
    const ok = await confirm({
      title: `Delete ${label}?`,
      description: 'The selected templates are removed from the library. Leads that already used them keep their copies. This can’t be undone.',
      confirmLabel: `Delete ${label}`,
    })
    if (!ok) return

    setDeletingSelected(true)
    const results = await Promise.allSettled(ids.map((id) => deletePredefinedQuote(id)))
    const deletedIds = ids.filter((_, index) => results[index].status === 'fulfilled')
    const failedIds = ids.filter((_, index) => results[index].status === 'rejected')

    if (deletedIds.length) {
      const removed = new Set(deletedIds)
      setQuotes((current) => current.filter((quote) => !removed.has(quote.id)))
      if (preview && removed.has(preview.id)) setPreview(null)
    }
    setSelected(new Set(failedIds))
    setDeletingSelected(false)

    if (failedIds.length) {
      toast.show({
        tone: 'error',
        message: deletedIds.length
          ? `Deleted ${deletedIds.length}; ${failedIds.length} failed and remain selected.`
          : `Could not delete ${label}. Please try again.`,
      })
    } else {
      toast.show({ tone: 'success', message: `Deleted ${label}.` })
    }
  }

  const handleDownload = async (quote: PredefinedQuote) => {
    setDownloadingId(quote.id)
    try {
      await downloadPredefinedQuotePdf(quote)
    } catch (err) {
      toast.show({ tone: 'error', message: err instanceof Error ? err.message : 'Failed to download the PDF' })
    } finally {
      setDownloadingId(null)
    }
  }

  const closeEditor = () => {
    onEditorOpenChange(false)
    setEditing(null)
  }

  // A brochure with several hotels yields several packages to review. Return to the
  // list after each one instead of making the reviewer reopen the import dialog.
  const backToImportList = (record?: PredefinedQuoteImport) => {
    if ((record?.batch_total ?? 0) > 1) onImportOpenChange(true)
  }

  const approveImport = async (payload: PredefinedQuoteInput) => {
    if (!importReview) throw new Error('No brochure import selected')
    const result = await approvePredefinedQuoteImport(
      importReview.record.id,
      payload,
      importReview.targetQuoteId,
    )
    return result.quote
  }

  const quoteMenu = (quote: PredefinedQuote) => [
    { id: 'view', label: 'View', onClick: () => setPreview(quote) },
    { id: 'edit', label: 'Edit', onClick: () => setEditing(quote) },
    {
      id: 'download',
      label: downloadingId === quote.id ? 'Downloading…' : 'Download',
      onClick: () => void handleDownload(quote),
    },
    { id: 'send', label: 'Send to customer', onClick: () => setSendToCustomer(quote) },
    { id: 'delete', label: 'Delete', tone: 'danger' as const, onClick: () => void handleDelete(quote) },
  ]

  return (
    <>
      {!loading && !error && quotes.length > 0 && (
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
          <FilterPills
            ariaLabel="Type"
            value={typeFilter}
            onChange={(id) => setTypeFilter(id as TypeFilter)}
            items={[
              { id: 'all', label: 'All', count: typeCounts.all },
              { id: 'package', label: 'Flight + Hotel', count: typeCounts.package },
              { id: 'hotel', label: 'Hotel', count: typeCounts.hotel },
              { id: 'flight', label: 'Flight', count: typeCounts.flight },
            ]}
          />
          {filteredQuotes.length > 0 && (
            <label className="flex min-h-9 items-center gap-2 text-xs font-semibold text-shop-muted">
              <input
                type="checkbox"
                aria-label="Select all visible templates"
                checked={allVisibleSelected}
                disabled={deletingSelected}
                onChange={(event) => toggleAllVisible(event.target.checked)}
              />
              Select all
            </label>
          )}
        </div>
      )}

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[10px] border border-shop-border bg-white px-3.5 py-2.5 text-sm shadow-sm">
          <span className="mr-auto font-semibold">
            {selected.size} template{selected.size === 1 ? '' : 's'} selected
          </span>
          <Button
            size="sm"
            variant="ghost"
            icon={<X />}
            disabled={deletingSelected}
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 />}
            loading={deletingSelected}
            onClick={() => void handleDeleteSelected()}
          >
            Delete
          </Button>
        </div>
      )}

      <section className="overflow-hidden rounded-[10px] border border-shop-border bg-white">
        {loading && <div role="status" className="px-4 py-16 text-center text-shop-muted">Loading quotes…</div>}
        {!loading && error && <div role="alert" className="px-4 py-16 text-center text-danger-fg">{error}</div>}
        {!loading && !error && quotes.length === 0 && (
          <EmptyState
            title="No templates yet"
            description="Create a hotel, flight, or flight + hotel template to reuse on leads."
            action={
              <Button type="button" variant="primary" onClick={() => onEditorOpenChange(true)}>
                New template
              </Button>
            }
          />
        )}
        {!loading && !error && quotes.length > 0 && filteredQuotes.length === 0 && (
          <div className="px-4 py-16 text-center text-shop-muted">No templates match this search.</div>
        )}

        {!loading && !error && filteredQuotes.length > 0 && (
          <>
            <div className="lg:hidden">
              {filteredQuotes.map((quote) => (
                <article
                  key={quote.id}
                  className={`border-b border-neutral-bg p-4 last:border-b-0 ${selected.has(quote.id) ? 'bg-tint' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${quote.title}`}
                      checked={selected.has(quote.id)}
                      disabled={deletingSelected}
                      onChange={(event) => toggleOne(quote.id, event.target.checked)}
                      className="mt-3 size-4 shrink-0"
                    />
                    <Cover quote={quote} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-bold">{quote.title}</h3>
                        <TypeBadge type={quote.quote_type} />
                      </div>
                      <p className="mt-1 text-sm text-shop-muted">{quoteSummary(quote)}</p>
                      <div className="mt-1.5 font-bold tabular-nums">
                        {formatQuoteMoney(displayTotal(quote), quote.currency)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setPreview(quote)}>
                      Preview
                    </Button>
                    <OverflowMenu portal align="left" label={`More actions for ${quote.title}`} items={quoteMenu(quote)} />
                  </div>
                </article>
              ))}
            </div>

            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead>
                  <tr className="border-b border-shop-border bg-shop-bg text-xs font-semibold text-slate-600">
                    <th className="w-10 px-3 py-2.5">
                      <input
                        type="checkbox"
                        aria-label="Select all visible templates in table"
                        checked={allVisibleSelected}
                        disabled={deletingSelected}
                        onChange={(event) => toggleAllVisible(event.target.checked)}
                      />
                    </th>
                    <th className="relative w-[72px] px-3.5 py-2.5">
                      <span className="sr-only">Cover</span>
                    </th>
                    <th className="px-3 py-2.5">Template</th>
                    <th className="px-3 py-2.5">Type</th>
                    <th className="px-3 py-2.5">Trip</th>
                    <th className="px-3 py-2.5 text-right">Total</th>
                    <th className="px-3 py-2.5">Updated</th>
                    <th className="px-3.5 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredQuotes.map((quote) => (
                    <tr
                      key={quote.id}
                      className={`border-b border-neutral-bg last:border-0 hover:bg-shop-bg ${selected.has(quote.id) ? 'bg-tint' : ''}`}
                    >
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          aria-label={`Select ${quote.title}`}
                          checked={selected.has(quote.id)}
                          disabled={deletingSelected}
                          onChange={(event) => toggleOne(quote.id, event.target.checked)}
                        />
                      </td>
                      <td className="px-3.5 py-2.5">
                        <Cover quote={quote} />
                      </td>
                      <td className="px-3 py-2.5">
                        <strong>{quote.title}</strong>
                      </td>
                      <td className="px-3 py-2.5">
                        <TypeBadge type={quote.quote_type} />
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">{quoteSummary(quote)}</td>
                      <td className="px-3 py-2.5 text-right font-bold whitespace-nowrap tabular-nums">
                        {formatQuoteMoney(displayTotal(quote), quote.currency)}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-shop-muted tabular-nums">
                        {formatWhen(quote.updated_at || quote.created_at)}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <div className="flex items-center justify-end gap-0.5">
                          <Button size="sm" variant="ghost" onClick={() => setPreview(quote)}>
                            Preview
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            iconOnly
                            aria-label={`Download PDF of ${quote.title}`}
                            loading={downloadingId === quote.id}
                            icon={<Download />}
                            onClick={() => void handleDownload(quote)}
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            iconOnly
                            aria-label={`Send ${quote.title} to a customer`}
                            icon={<Send />}
                            onClick={() => setSendToCustomer(quote)}
                          />
                          <OverflowMenu
                            portal
                            label={`More actions for ${quote.title}`}
                            items={quoteMenu(quote).filter((i) => !['view', 'download', 'send'].includes(i.id))}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {dialog}
      <PredefinedQuoteModal
        open={editorOpen || editing !== null}
        quote={editorOpen ? null : editing}
        onClose={closeEditor}
        onSaved={handleSaved}
      />
      <ImportPredefinedQuoteModal
        open={importOpen}
        quotes={quotes}
        onClose={() => onImportOpenChange(false)}
        onApproved={(saved) => setQuotes((prev) => [saved, ...prev.filter((item) => item.id !== saved.id)])}
        onReview={(record, targetQuoteId) => {
          setImportReview({ record, targetQuoteId })
          onImportOpenChange(false)
        }}
      />
      <PredefinedQuoteModal
        open={Boolean(importReview)}
        initialQuote={importReview?.record.extracted_payload || null}
        draftKey={importReview?.record.id}
        title="Review AI-imported quote"
        submitLabel={importReview?.targetQuoteId ? 'Approve and update quote' : 'Approve and create quote'}
        onSubmitInput={approveImport}
        onClose={() => {
          const record = importReview?.record
          setImportReview(null)
          backToImportList(record)
        }}
        onSaved={(saved) => {
          const record = importReview?.record
          handleSaved(saved)
          setImportReview(null)
          backToImportList(record)
        }}
      />
      <PredefinedQuotePreview
        open={Boolean(preview)}
        quote={preview}
        onClose={() => setPreview(null)}
        onEdit={() => {
          if (!preview) return
          setEditing(preview)
          setPreview(null)
        }}
      />
      <SendToCustomerModal
        open={Boolean(sendToCustomer)}
        quote={sendToCustomer}
        onClose={() => setSendToCustomer(null)}
      />
    </>
  )
}
