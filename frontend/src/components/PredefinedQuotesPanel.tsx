import { setPackagePublic } from '../lib/growth'
import { useAuth } from '../context/AuthContext'
import { t as translate, useI18n } from '../lib/i18n'
import { useEffect, useMemo, useState } from 'react'
import { CircleAlert, Download, LayoutGrid, List, Search, Send, Trash2, X } from 'lucide-react'
import { useConfirm } from '../hooks/useConfirm'
import { useToast } from '../hooks/useToast'
import { formatWhen } from '../lib/leads'
import Button from './ui/Button'
import FilterPills from './ui/FilterPills'
import StatusBadge from './ui/StatusBadge'
import EmptyState from './ui/EmptyState'
import OverflowMenu from './ui/OverflowMenu'
import SegmentedControl from './ui/SegmentedControl'
import {
  approvePredefinedQuoteImport,
  deletePredefinedQuote,
  displayTotal,
  downloadPredefinedQuotePdf,
  fetchPredefinedQuotes,
  formatQuoteMoney,
  quoteSummaryParts,
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
  onClearQuery?: () => void
}

function TypeBadge({ type }: { type: string }) {
  useI18n()
  const tone = type === 'package' ? 'success' : type === 'flight' ? 'neutral' : 'info'
  return <StatusBadge label={quoteTypeLabel(type)} tone={tone} />
}

const COVER_TONES = ['#0F766E', '#134E4A', '#1E3A8A', '#7C2D12', '#0369A1', '#3F6212', '#334155']

/** 56×40 cover: the photo when there is one, else a flat colour with the destination code. */
function Cover({ quote, className = 'h-10 w-14 rounded-md', large = false }: { quote: PredefinedQuote; className?: string; large?: boolean }) {
  useI18n()
  const [broken, setBroken] = useState(false)
  if (quote.cover_image_url && !broken) {
    return <img src={quote.cover_image_url} alt="" onError={() => setBroken(true)} className={`${className} shrink-0 object-cover`} />
  }
  const label = (quote.destination || quote.title || '?').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 3).toUpperCase()
  const tone = COVER_TONES[(quote.id.charCodeAt(0) || 0) % COVER_TONES.length]
  return (
    <div
      aria-hidden="true"
      className={`${className} grid shrink-0 place-items-center font-bold text-white/85 ${large ? 'text-3xl tracking-[0.12em]' : 'text-[10px]'}`}
      style={{ background: `linear-gradient(135deg, ${tone}, ${tone}cc)` }}
    >
      {translate(label)}
    </div>
  )
}

/** Route, dates, hotels and flights, each kept in its own direction (an English city in an Arabic line). */
function SummaryLine({ quote }: { quote: PredefinedQuote }) {
  const parts = quoteSummaryParts(quote)
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && ' · '}
          <bdi>{part}</bdi>
        </span>
      ))}
    </>
  )
}

type View = 'grid' | 'list'
const VIEW_KEY = 'quotes:view'
function savedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

type TypeFilter = 'all' | 'package' | 'hotel' | 'flight'

export default function PredefinedQuotesPanel({
  query,
  editorOpen,
  importOpen,
  onEditorOpenChange,
  onImportOpenChange,
  onClearQuery,
}: Props) {
  useI18n()
  const { admin } = useAuth()
  const isAdmin = admin?.role === 'admin'
  const { confirm, dialog } = useConfirm()
  const toast = useToast()
  const [quotes, setQuotes] = useState<PredefinedQuote[]>([])
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [view, setViewState] = useState<View>(savedView)
  const setView = (next: View) => {
    setViewState(next)
    try { localStorage.setItem(VIEW_KEY, next) } catch { /* the choice just is not remembered */ }
  }
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

  const load = () => {
    setLoading(true)
    return fetchPredefinedQuotes()
      .then((next) => {
        setQuotes(next)
        setError(null)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load quotes')
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    void load()
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
      title: translate("Delete “{value0}”?", { value0: translate(String(quote.title)) }),
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

    const label = translate("{value0} template{value1}", { value0: translate(String(ids.length)), value1: translate(String(ids.length === 1 ? '' : 's')) })
    const ok = await confirm({
      title: translate("Delete {value0}?", { value0: translate(String(label)) }),
      description: 'The selected templates are removed from the library. Leads that already used them keep their copies. This can’t be undone.',
      confirmLabel: translate("Delete {value0}", { value0: translate(String(label)) }),
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
          ? translate("Deleted {value0}; {value1} failed and remain selected.", { value0: translate(String(deletedIds.length)), value1: translate(String(failedIds.length)) })
          : translate("Could not delete {value0}. Please try again.", { value0: translate(String(label)) }),
      })
    } else {
      toast.show({ tone: 'success', message: translate("Deleted {value0}.", { value0: translate(String(label)) }) })
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

  const togglePublic = async (quote: PredefinedQuote) => {
    try {
      const next = await setPackagePublic(quote.id, !quote.is_public)
      setQuotes((prev) => prev.map((q) => (q.id === quote.id ? { ...q, is_public: next.is_public } : q)))
    } catch {
      /* the menu stays as it was */
    }
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
    ...(isAdmin
      ? [{
          id: 'public',
          label: quote.is_public ? 'Hide from offers page' : 'Show on offers page',
          onClick: () => void togglePublic(quote),
        }]
      : []),
    { id: 'delete', label: 'Delete', tone: 'danger' as const, onClick: () => void handleDelete(quote) },
  ]

  // Cards have their own boxes; the table and the empty/loading states share one.
  const showCards = !loading && !error && filteredQuotes.length > 0

  return (
    <>
      {!loading && !error && quotes.length > 0 && (
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
          <FilterPills
            ariaLabel="Type"
            value={typeFilter}
            onChange={(id) => setTypeFilter(id as TypeFilter)}
            items={[
              { id: 'all', label: translate("All"), count: typeCounts.all },
              { id: 'package', label: translate("Flight + Hotel"), count: typeCounts.package },
              { id: 'hotel', label: translate("Hotel"), count: typeCounts.hotel },
              { id: 'flight', label: translate("Flight"), count: typeCounts.flight },
            ]}
          />
          <div className="flex flex-wrap items-center gap-3">
            {filteredQuotes.length > 0 && (
              <label className="flex min-h-9 items-center gap-2 text-xs font-semibold text-shop-muted">
                <input
                  type="checkbox"
                  aria-label={translate("Select all visible templates")}
                  checked={allVisibleSelected}
                  disabled={deletingSelected}
                  onChange={(event) => toggleAllVisible(event.target.checked)}
                />
                {translate("Select all")}</label>
            )}
            <div className="max-lg:hidden">
              <SegmentedControl
                ariaLabel="Library view"
                value={view}
                onChange={(id) => setView(id as View)}
                items={[
                  { id: 'grid', label: 'Grid', icon: <LayoutGrid strokeWidth={1.8} /> },
                  { id: 'list', label: 'List', icon: <List strokeWidth={1.8} /> },
                ]}
              />
            </div>
          </div>
        </div>
      )}

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[10px] border border-shop-border bg-white px-3.5 py-2.5 text-sm shadow-sm">
          <span className="me-auto font-semibold">
            {translate("{count} template{suffix} selected", { count: selected.size, suffix: selected.size === 1 ? '' : 's' })}</span>
          <Button
            size="sm"
            variant="ghost"
            icon={<X />}
            disabled={deletingSelected}
            onClick={() => setSelected(new Set())}
          >
            {translate("Clear")}</Button>
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 />}
            loading={deletingSelected}
            onClick={() => void handleDeleteSelected()}
          >
            {translate("Delete")}</Button>
        </div>
      )}

      <section className={showCards ? '' : 'overflow-hidden rounded-xl border border-shop-border bg-white'}>
        {loading && <div role="status" className="px-4 py-16 text-center text-shop-muted">{translate("Loading quotes…")}</div>}
        {!loading && error && (
          <EmptyState
            tone="danger"
            icon={<CircleAlert />}
            title={translate("Quotes could not be loaded")}
            description={translate(error)}
            action={<Button variant="primary" onClick={() => void load()}>{translate("Retry")}</Button>}
          />
        )}
        {!loading && !error && quotes.length === 0 && (
          <EmptyState
            title={translate("No templates yet")}
            description={translate("Create a hotel, flight, or flight + hotel template to reuse on leads.")}
            action={
              <Button type="button" variant="primary" onClick={() => onEditorOpenChange(true)}>
                {translate("New template")}</Button>
            }
          />
        )}
        {!loading && !error && quotes.length > 0 && filteredQuotes.length === 0 && (
          <EmptyState
            tone="neutral"
            icon={<Search />}
            title={translate("No templates match this search.")}
            action={
              <Button
                onClick={() => {
                  onClearQuery?.()
                  setTypeFilter('all')
                }}
              >
                {translate("Clear filters")}
              </Button>
            }
          />
        )}

        {!loading && !error && filteredQuotes.length > 0 && (
          <>
            <ul className={`m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(280px,100%),1fr))] gap-4 p-0 ${view === 'list' ? 'lg:hidden' : ''}`}>
              {filteredQuotes.map((quote) => {
                const isSelected = selected.has(quote.id)
                return (
                  <li
                    key={quote.id}
                    className={`group flex flex-col overflow-hidden rounded-xl border bg-white shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-raised)] ${isSelected ? 'border-shop-accent ring-2 ring-shop-accent/20' : 'border-shop-border'}`}
                  >
                    <div className="relative">
                      <button type="button" onClick={() => setPreview(quote)} className="block w-full" aria-label={translate("Preview {value0}", { value0: quote.title })}>
                        <Cover quote={quote} className="h-40 w-full" large />
                      </button>
                      <label className="absolute start-2.5 top-2.5 grid size-8 cursor-pointer place-items-center rounded-lg bg-white/90 shadow-sm backdrop-blur">
                        <input
                          type="checkbox"
                          aria-label={translate("Select {value0}", { value0: translate(String(quote.title)) })}
                          checked={isSelected}
                          disabled={deletingSelected}
                          onChange={(event) => toggleOne(quote.id, event.target.checked)}
                          className="size-4"
                        />
                      </label>
                      <div className="absolute end-2.5 top-2.5 flex flex-wrap justify-end gap-1.5">
                        <TypeBadge type={quote.quote_type} />
                      </div>
                      {quote.is_public && (
                        <span className="absolute bottom-2.5 start-2.5 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-primary-800 shadow-sm">{translate('On offers page')}</span>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-1.5 p-4">
                      <h3 dir="auto" className="m-0 line-clamp-2 text-start text-[15px] leading-snug font-bold">{quote.title}</h3>
                      <p className="m-0 line-clamp-2 text-[13px] text-shop-muted"><SummaryLine quote={quote} /></p>
                      <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                        <div className="flex flex-col leading-tight">
                          <span className="text-[11px] font-semibold tracking-[0.06em] text-shop-muted uppercase">{translate("Total")}</span>
                          <span className="text-lg font-extrabold tabular-nums">{formatQuoteMoney(displayTotal(quote), quote.currency)}</span>
                        </div>
                        <span className="text-xs text-shop-muted tabular-nums"><bdi dir="ltr">{formatWhen(quote.updated_at || quote.created_at)}</bdi></span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 border-t border-[#eef1f5] px-2.5 py-2">
                      <Button size="sm" variant="ghost" onClick={() => setPreview(quote)}>
                        {translate("Preview")}</Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        aria-label={translate("Download PDF of {value0}", { value0: translate(String(quote.title)) })}
                        loading={downloadingId === quote.id}
                        icon={<Download />}
                        onClick={() => void handleDownload(quote)}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        aria-label={translate("Send {value0} to a customer", { value0: translate(String(quote.title)) })}
                        icon={<Send />}
                        onClick={() => setSendToCustomer(quote)}
                      />
                      <span className="ms-auto">
                        <OverflowMenu
                          label={translate("More actions for {value0}", { value0: translate(String(quote.title)) })}
                          items={quoteMenu(quote).filter((i) => !['view', 'download', 'send'].includes(i.id))}
                        />
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>

            <div className={`hidden overflow-x-auto rounded-xl border border-shop-border bg-white shadow-[var(--shadow-card)] ${view === 'list' ? 'lg:block' : ''}`}>
              <table className="w-full min-w-[980px] text-start text-sm">
                <thead>
                  <tr className="border-b border-shop-border bg-[#f8fafc] text-[11px] font-semibold tracking-[0.06em] text-slate-500 uppercase [&>th]:text-start">
                    <th className="w-10 px-3 py-2.5">
                      <input
                        type="checkbox"
                        aria-label={translate("Select all visible templates in table")}
                        checked={allVisibleSelected}
                        disabled={deletingSelected}
                        onChange={(event) => toggleAllVisible(event.target.checked)}
                      />
                    </th>
                    <th className="relative w-[72px] px-3.5 py-2.5">
                      <span className="sr-only">{translate("Cover")}</span>
                    </th>
                    <th className="px-3 py-2.5">{translate("Template")}</th>
                    <th className="px-3 py-2.5">{translate("Type")}</th>
                    <th className="px-3 py-2.5">{translate("Trip")}</th>
                    <th className="px-3 py-2.5 !text-end">{translate("Total")}</th>
                    <th className="px-3 py-2.5">{translate("Updated")}</th>
                    <th className="px-3.5 py-2.5 !text-end">{translate("Actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredQuotes.map((quote) => (
                    <tr
                      key={quote.id}
                      className={`border-b border-[#eef1f5] transition-colors last:border-0 hover:bg-[#f7fafb] ${selected.has(quote.id) ? 'bg-tint' : ''}`}
                    >
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          aria-label={translate("Select {value0}", { value0: translate(String(quote.title)) })}
                          checked={selected.has(quote.id)}
                          disabled={deletingSelected}
                          onChange={(event) => toggleOne(quote.id, event.target.checked)}
                        />
                      </td>
                      <td className="px-3.5 py-2.5">
                        <Cover quote={quote} />
                      </td>
                      <td className="px-3 py-2.5">
                        <strong dir="auto">{quote.title}</strong>
                      </td>
                      <td className="px-3 py-2.5">
                        <TypeBadge type={quote.quote_type} />
                      </td>
                      <td className="px-3 py-2.5 text-slate-700"><SummaryLine quote={quote} /></td>
                      <td className="px-3 py-2.5 text-end font-bold whitespace-nowrap tabular-nums">
                        {formatQuoteMoney(displayTotal(quote), quote.currency)}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-shop-muted tabular-nums">
                        <bdi dir="ltr">{formatWhen(quote.updated_at || quote.created_at)}</bdi>
                      </td>
                      <td className="px-3.5 py-2.5">
                        <div className="flex items-center justify-end gap-0.5">
                          <Button size="sm" variant="ghost" onClick={() => setPreview(quote)}>
                            {translate("Preview")}</Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            iconOnly
                            aria-label={translate("Download PDF of {value0}", { value0: translate(String(quote.title)) })}
                            loading={downloadingId === quote.id}
                            icon={<Download />}
                            onClick={() => void handleDownload(quote)}
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            iconOnly
                            aria-label={translate("Send {value0} to a customer", { value0: translate(String(quote.title)) })}
                            icon={<Send />}
                            onClick={() => setSendToCustomer(quote)}
                          />
                          <OverflowMenu
                            portal
                            label={translate("More actions for {value0}", { value0: translate(String(quote.title)) })}
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
        title={translate("Review AI-imported quote")}
        submitLabel={importReview?.targetQuoteId ? translate("Approve and update quote") : translate("Approve and create quote")}
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
