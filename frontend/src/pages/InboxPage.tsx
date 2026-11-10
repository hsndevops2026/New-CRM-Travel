import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import ChatThreadList from '../components/chat/ChatThreadList'
import ChatWindow from '../components/chat/ChatWindow'
import InboxLeadPane from '../components/chat/InboxLeadPane'
import FilterPills from '../components/ui/FilterPills'
import { filterThreads, threadCounts, type InboxFilter } from '../lib/inboxView'
import {
  fetchThreadMessages,
  fetchThreads,
  sendThreadMessage,
  type ChatMessage,
  type Thread,
  type ThreadDetail,
} from '../lib/inbox'
import { useSearch } from '../hooks/useSearch'

const FILTERS: Array<{ id: InboxFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'customer', label: 'Customers' },
  { id: 'dealer', label: 'Dealers' },
  { id: 'group', label: 'Groups' },
]

export default function InboxPage() {
  const navigate = useNavigate()
  const { threadId: routeThreadId } = useParams<{ threadId?: string }>()
  const [searchParams] = useSearchParams()
  const leadFilter = searchParams.get('lead')
  const { query, setPlaceholder } = useSearch()

  const [filter, setFilter] = useState<InboxFilter>('all')
  const [leadPanelOpen, setLeadPanelOpen] = useState(true)
  const [threads, setThreads] = useState<Thread[]>([])
  const [threadsLoading, setThreadsLoading] = useState(true)
  const [activeThread, setActiveThread] = useState<ThreadDetail | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mobileShowChat, setMobileShowChat] = useState(Boolean(routeThreadId))

  const activeId = routeThreadId ? decodeURIComponent(routeThreadId) : null

  useEffect(() => {
    setPlaceholder('Search conversations, phone numbers…')
  }, [setPlaceholder])

  const loadThreads = useCallback(async () => {
    setThreadsLoading(true)
    try {
      let list = await fetchThreads('all')
      if (query.trim()) {
        const term = query.trim().toLowerCase()
        list = list.filter(
          (t) =>
            t.title.toLowerCase().includes(term) ||
            t.subtitle.toLowerCase().includes(term) ||
            t.last_message.toLowerCase().includes(term),
        )
      }
      setThreads(list)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inbox')
    } finally {
      setThreadsLoading(false)
    }
  }, [query])

  const loadMessages = useCallback(async (id: string) => {
    setMessagesLoading(true)
    setError(null)
    try {
      const data = await fetchThreadMessages(id)
      setActiveThread(data.thread)
      setMessages(data.messages)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages')
    } finally {
      setMessagesLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const run = () => {
      fetchThreads('all')
        .then((list) => {
          if (cancelled) return
          let next = list
          if (query.trim()) {
            const term = query.trim().toLowerCase()
            next = list.filter(
              (t) =>
                t.title.toLowerCase().includes(term) ||
                t.subtitle.toLowerCase().includes(term) ||
                t.last_message.toLowerCase().includes(term),
            )
          }
          setThreads(next)
          setError(null)
        })
        .catch((err) => {
          if (cancelled) return
          setError(err instanceof Error ? err.message : 'Failed to load inbox')
        })
        .finally(() => {
          if (!cancelled) setThreadsLoading(false)
        })
    }
    run()
    const timer = window.setInterval(run, 10000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [query])

  useEffect(() => {
    if (leadFilter && !routeThreadId) {
      navigate(`/inbox/${encodeURIComponent(`customer:${leadFilter}`)}`, { replace: true })
    }
  }, [leadFilter, routeThreadId, navigate])

  const [prevActiveId, setPrevActiveId] = useState<string | null>(activeId)
  if (activeId !== prevActiveId) {
    setPrevActiveId(activeId)
    if (!activeId) {
      setActiveThread(null)
      setMessages([])
    } else {
      setActiveThread(null)
      setMessages([])
      setMessagesLoading(true)
      setError(null)
    }
  }

  useEffect(() => {
    if (!activeId) return
    let cancelled = false
    const run = () => {
      fetchThreadMessages(activeId)
        .then((data) => {
          if (cancelled) return
          setActiveThread(data.thread)
          setMessages(data.messages)
        })
        .catch((err) => {
          if (cancelled) return
          setError(err instanceof Error ? err.message : 'Failed to load messages')
        })
        .finally(() => {
          if (!cancelled) setMessagesLoading(false)
        })
    }
    run()
    const timer = window.setInterval(run, 5000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeId])

  const selectThread = (thread: Thread) => {
    setMobileShowChat(true)
    navigate(`/inbox/${encodeURIComponent(thread.id)}`)
  }

  const handleSend = async (body: string) => {
    if (!activeId) return
    setSending(true)
    try {
      await sendThreadMessage(activeId, body)
      await loadMessages(activeId)
      await loadThreads()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Message could not be sent')
      throw err
    } finally {
      setSending(false)
    }
  }

  const filteredThreads = useMemo(() => filterThreads(threads, filter), [threads, filter])
  const counts = useMemo(() => threadCounts(threads), [threads])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 overflow-hidden bg-white">
        <section
          aria-label="Conversations"
          className={`flex w-full shrink-0 flex-col border-r border-shop-border bg-white md:w-[300px] lg:w-[340px] ${
            mobileShowChat && activeId ? 'hidden md:flex' : 'flex'
          }`}
        >
          <div className="flex shrink-0 flex-col gap-2.5 border-b border-shop-border px-3.5 pt-3.5 pb-2.5">
            <div className="flex items-center justify-between">
              <h1 className="text-lg font-extrabold">Inbox</h1>
              <span className="text-xs text-shop-muted tabular-nums">
                {counts.all} conversation{counts.all === 1 ? '' : 's'}
              </span>
            </div>
            <FilterPills
              ariaLabel="Filter conversations"
              value={filter}
              onChange={(id) => setFilter(id as InboxFilter)}
              items={FILTERS.map((f) => ({ ...f, count: counts[f.id] }))}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {error && !activeId && <p role="alert" className="m-3 rounded-lg bg-danger-bg p-3 text-sm text-danger-fg">{error}</p>}
            <ChatThreadList
              threads={filteredThreads}
              activeId={activeId}
              loading={threadsLoading}
              onSelect={selectThread}
              emptyMessage={query.trim() ? 'No conversations match this search.' : filter !== 'all' ? `No ${filter} conversations in this filter. Try All.` : undefined}
            />
          </div>
        </section>

        <section
          aria-label={activeThread ? `Conversation with ${activeThread.title}` : 'Conversation'}
          className={`min-w-0 flex-1 flex-col ${
            !mobileShowChat || !activeId ? 'hidden md:flex' : 'flex'
          }`}
        >
          {activeId && (
            <button
              type="button"
              className="flex h-11 shrink-0 items-center gap-1.5 border-b border-shop-border bg-white px-4 text-left text-sm font-semibold text-shop-ink md:hidden"
              onClick={() => setMobileShowChat(false)}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              Conversations
            </button>
          )}
          <ChatWindow
            thread={activeThread}
            messages={messages}
            loading={messagesLoading}
            sending={sending}
            error={error}
            onSend={handleSend}
            onRefresh={() => activeId && void loadMessages(activeId)}
            onOpenLead={(leadId) => navigate(`/leads/${leadId}`)}
            leadPanelOpen={leadPanelOpen}
            onToggleLeadPanel={() => setLeadPanelOpen((open) => !open)}
          />
        </section>

        <InboxLeadPane
          leadId={activeThread?.lead_id || (leadFilter ?? null)}
          kind={activeThread?.kind || null}
          open={leadPanelOpen && Boolean(activeId)}
        />
      </div>
    </div>
  )
}
