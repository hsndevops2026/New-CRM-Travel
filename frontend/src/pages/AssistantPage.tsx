import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CircleAlert, KeyRound, LoaderCircle, MessagesSquare, Plus, Puzzle, Sparkles, Trash2, X } from 'lucide-react'
import AddonsModal from '../components/assistant/AddonsModal'
import Composer, { type ComposerRequest } from '../components/assistant/Composer'
import ConnectionsModal from '../components/assistant/ConnectionsModal'
import Markdown from '../components/assistant/Markdown'
import MessageView from '../components/assistant/MessageView'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import ModalDrawer from '../components/ui/ModalDrawer'
import { useConfirm } from '../hooks/useConfirm'
import { t, useI18n } from '../lib/i18n'
import {
  createConversation,
  deleteConversation,
  fetchConversation,
  fetchConversations,
  fetchAssistantState,
  generateMedia,
  isHiddenMessage,
  loadLastSetup,
  saveLastSetup,
  sendMessage,
  type Attachment,
  type Conversation,
  type Media,
  type AssistantMessage,
  type AssistantState,
  type StreamEvent,
  type ToolSettings,
} from '../lib/assistant'

const SUGGESTIONS = [
  'Which quotes are waiting for a customer reply?',
  'Summarise my pipeline',
  'Write a friendly follow-up for the newest sent quote',
  'Plan a 5-day family itinerary for Dubai with a rough budget',
  'What are the current visa rules for tourists visiting Thailand?',
  'Create a poster image for a Maldives honeymoon package',
]

/** What is shown while a reply is being produced. */
type Draft = { text: string; activity: string | null }

function appendUnique(list: AssistantMessage[], rows: AssistantMessage[]) {
  const seen = new Set(list.map((message) => message.seq))
  return [...list, ...rows.filter((row) => !seen.has(row.seq))]
}

function upsertConversation(list: Conversation[], conversation: Conversation) {
  return [conversation, ...list.filter((entry) => entry.id !== conversation.id)]
}

function ConversationList({
  conversations,
  activeId,
  onOpen,
  onNew,
  onDelete,
}: {
  conversations: Conversation[]
  activeId?: string
  onOpen: (id: string) => void
  onNew: () => void
  onDelete: (conversation: Conversation) => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <Button variant="primary" block icon={<Plus />} onClick={onNew}>
        {t('New chat')}
      </Button>
      {conversations.length === 0 ? (
        <p className="m-0 px-1 pt-2 text-sm text-shop-muted">{t('Your chats will appear here.')}</p>
      ) : (
        <ul className="m-0 flex min-h-0 flex-1 list-none flex-col gap-0.5 overflow-y-auto p-0">
          {conversations.map((conversation) => {
            const active = conversation.id === activeId
            return (
              <li key={conversation.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onOpen(conversation.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex h-9 w-full items-center rounded-lg ps-2.5 pe-9 text-start text-sm max-md:h-11 ${
                    active ? 'bg-tint font-bold text-shop-accent' : 'font-medium text-neutral-fg hover:bg-neutral-bg'
                  }`}
                >
                  <span className="truncate" dir="auto">{conversation.title === 'New chat' ? t('New chat') : conversation.title}</span>
                </button>
                <button
                  type="button"
                  aria-label={t('Delete chat: {value0}', { value0: conversation.title })}
                  onClick={() => onDelete(conversation)}
                  className="absolute end-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-shop-muted opacity-0 hover:bg-white hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 max-md:size-9 max-md:opacity-100"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default function AssistantPage() {
  useI18n()
  const { conversationId } = useParams()
  const navigate = useNavigate()
  const { confirm, dialog } = useConfirm()

  const [state, setState] = useState<AssistantState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])

  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [mediaById, setMediaById] = useState<Record<string, Media>>({})
  const [threadLoading, setThreadLoading] = useState(Boolean(conversationId))
  const [draft, setDraft] = useState<Draft | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [setup, setSetup] = useState(loadLastSetup)

  const [connectionsOpen, setConnectionsOpen] = useState(false)
  const [addonsOpen, setAddonsOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)

  // The conversation whose messages are on screen, and one this page created itself
  // while sending (its messages are already here, so it must not be reloaded or cleared).
  const [shownId, setShownId] = useState(conversationId)
  const [ownedId, setOwnedId] = useState<string | null>(null)
  if (conversationId !== shownId) {
    setShownId(conversationId)
    if (!conversationId || conversationId !== ownedId) {
      setOwnedId(null)
      setMessages([])
      setMediaById({})
      setDraft(null)
      setError(null)
      setThreadLoading(Boolean(conversationId))
    }
  }

  const abortRef = useRef<AbortController | null>(null)
  const activeIdRef = useRef(conversationId)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    activeIdRef.current = conversationId
  }, [conversationId])

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchAssistantState(), fetchConversations()])
      .then(([nextState, list]) => {
        if (cancelled) return
        setState(nextState)
        setConversations(list)
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : t('The Assistant could not be loaded'))
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!conversationId || conversationId === ownedId) return
    let cancelled = false
    fetchConversation(conversationId)
      .then((data) => {
        if (cancelled) return
        setMessages(data.messages)
        setMediaById(Object.fromEntries(data.media.map((item) => [item.id, item])))
        setSetup({ model: data.conversation.model, settings: data.conversation.settings })
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t('This chat could not be loaded'))
      })
      .finally(() => {
        if (!cancelled) setThreadLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [conversationId, ownedId])

  // Keep the newest content in view while a reply streams in.
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [messages, draft])

  // Leaving the page ends any reply that is still streaming.
  useEffect(() => () => abortRef.current?.abort(), [])

  const onMediaUpdate = useCallback((media: Media) => {
    setMediaById((current) => ({ ...current, [media.id]: media }))
  }, [])

  const model = state && state.models.some((entry) => entry.id === setup.model) ? (setup.model as string) : state?.default_model || ''
  const settings = setup.settings
  const setModel = (next: string) => setSetup((current) => ({ ...current, model: next }))
  const setSettings = (next: ToolSettings) => setSetup((current) => ({ ...current, settings: next }))

  const stop = () => abortRef.current?.abort()

  const openConversation = (id: string) => {
    stop()
    setListOpen(false)
    navigate(`/assistant/${id}`)
  }

  const newChat = () => {
    stop()
    setListOpen(false)
    setText('')
    setAttachments([])
    navigate('/assistant')
  }

  /** The conversation to send into, creating one on the first message of a new chat. */
  const ensureConversation = async () => {
    if (conversationId) return conversationId
    const created = await createConversation(model, settings)
    setConversations((list) => upsertConversation(list, created))
    // Marked as ours before navigating, so arriving at its URL neither clears nor reloads it.
    setOwnedId(created.id)
    activeIdRef.current = created.id
    navigate(`/assistant/${created.id}`)
    return created.id
  }

  const sendChat = async () => {
    setError(null)
    setDraft({ text: '', activity: 'Thinking…' })
    const controller = new AbortController()
    abortRef.current = controller
    setStreaming(true)
    try {
      const id = await ensureConversation()
      saveLastSetup(model, settings)
      let accepted = false
      const onEvent = (event: StreamEvent) => {
        if (activeIdRef.current !== id) return
        if (event.type === 'row') {
          // The first stored row confirms the message arrived; only then clear the input.
          if (!accepted) {
            accepted = true
            setText('')
            setAttachments([])
          }
          setMessages((list) => appendUnique(list, [event.row]))
          if (event.row.role === 'assistant') {
            setDraft((current) => (current ? { text: '', activity: 'Thinking…' } : current))
          }
        } else if (event.type === 'delta') {
          setDraft((current) => (current ? { text: current.text + event.text, activity: null } : current))
        } else if (event.type === 'activity') {
          setDraft((current) => (current ? { ...current, activity: event.label } : current))
        } else if (event.type === 'reset') {
          setDraft((current) => (current ? { text: '', activity: 'Thinking…' } : current))
        } else if (event.type === 'media') {
          onMediaUpdate(event.media)
        } else if (event.type === 'done') {
          setConversations((list) => upsertConversation(list, event.conversation))
        } else if (event.type === 'error') {
          setError(event.message)
        }
      }
      await sendMessage(id, { text, attachments, model, settings }, onEvent, controller.signal)
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === 'AbortError'
      if (!aborted) setError(err instanceof Error ? err.message : t('The message could not be sent'))
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setStreaming(false)
      setDraft(null)
    }
  }

  const generate = async (request: Exclude<ComposerRequest, { kind: 'chat' }>) => {
    setError(null)
    setDraft({ text: '', activity: request.kind === 'video' ? 'Starting a video render…' : 'Generating an image…' })
    try {
      const id = await ensureConversation()
      const data = await generateMedia(id, { ...request, prompt: text.trim() })
      if (activeIdRef.current === id) {
        onMediaUpdate(data.media)
        setMessages((list) => appendUnique(list, data.messages))
        setText('')
      }
      setConversations((list) => upsertConversation(list, data.conversation))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Generation failed'))
    } finally {
      setDraft(null)
    }
  }

  const submit = (request: ComposerRequest) => {
    if (request.kind === 'chat') void sendChat()
    else void generate(request)
  }

  const removeConversation = async (conversation: Conversation) => {
    const ok = await confirm({
      title: t('Delete this chat?'),
      description: t('"{value0}" and everything generated in it will be removed. This cannot be undone.', { value0: conversation.title }),
      confirmLabel: t('Delete chat'),
      tone: 'danger',
    })
    if (!ok) return
    try {
      await deleteConversation(conversation.id)
      setConversations((list) => list.filter((entry) => entry.id !== conversation.id))
      if (conversation.id === conversationId) newChat()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('The chat could not be deleted'))
    }
  }

  if (loadError) {
    return (
      <EmptyState
        tone="danger"
        icon={<CircleAlert />}
        title={t(t('The Assistant could not be loaded'))}
        description={loadError}
        action={<Button onClick={() => window.location.reload()}>{t('Try again')}</Button>}
      />
    )
  }

  if (!state) {
    return (
      <div role="status" className="flex h-full items-center justify-center gap-2 text-sm text-shop-muted">
        <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />
        {t('Loading the Assistant…')}
      </div>
    )
  }

  const claudeReady = state.connections.anthropic.active !== null
  const visible = messages.filter((message) => !isHiddenMessage(message))
  const shownTitle = conversations.find((entry) => entry.id === conversationId)?.title
  const activeTitle = !shownTitle || shownTitle === 'New chat' ? t('New chat') : shownTitle
  const list = (
    <ConversationList
      conversations={conversations}
      activeId={conversationId}
      onOpen={openConversation}
      onNew={newChat}
      onDelete={(conversation) => void removeConversation(conversation)}
    />
  )

  return (
    <div className="flex h-full min-h-0">
      <aside aria-label={t('Chats')} className="hidden w-64 shrink-0 flex-col border-e border-shop-border bg-white p-3 lg:flex">
        {list}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-shop-border bg-white px-3 sm:px-6">
          <Button size="sm" className="lg:hidden" icon={<MessagesSquare />} onClick={() => setListOpen(true)}>
            {t('Chats')}
          </Button>
          <h1 dir="auto" className="m-0 min-w-0 flex-1 truncate text-[15px] font-bold">{activeTitle}</h1>
          <Button size="sm" icon={<Puzzle />} onClick={() => setAddonsOpen(true)}>
            <span className="max-sm:sr-only">{t('Add-ons')}</span>
          </Button>
          <Button size="sm" icon={<KeyRound />} onClick={() => setConnectionsOpen(true)}>
            <span className="max-sm:sr-only">{t('Connections')}</span>
            <span
              aria-hidden="true"
              className={`size-2 rounded-full ${claudeReady ? 'bg-shop-accent' : 'bg-amber-500'}`}
            />
            <span className="sr-only">{t(claudeReady ? 'Claude is connected' : 'Claude is not connected')}</span>
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {threadLoading ? (
            <div role="status" className="flex h-full items-center justify-center gap-2 text-sm text-shop-muted">
              <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />
              {t('Loading chat…')}
            </div>
          ) : visible.length === 0 && !draft ? (
            !claudeReady ? (
              <EmptyState
                icon={<KeyRound />}
                title={t('Connect Claude to start')}
                description={
                  t(state.can_manage_agency
                    ? 'Add one Claude API key for the whole agency, or use your own. A claude.ai subscription cannot be used here — it has to be an API key.'
                    : 'Ask an admin to add the agency’s Claude API key, or use your own. A claude.ai subscription cannot be used here — it has to be an API key.')
                }
                action={
                  <Button variant="primary" icon={<KeyRound />} onClick={() => setConnectionsOpen(true)}>
                    {t('Add an API key')}
                  </Button>
                }
              />
            ) : (
              <div className="mx-auto flex h-full w-full max-w-3xl flex-col items-center justify-center gap-5 px-4 py-10 text-center">
                <span aria-hidden="true" className="grid size-14 place-items-center rounded-[14px] bg-tint text-shop-accent">
                  <Sparkles className="size-[26px]" />
                </span>
                <div>
                  <h2 className="m-0 text-xl font-extrabold">{t('What can I help with?')}</h2>
                  <p className="m-0 mt-1 text-shop-muted">
                    {t('Chat with Claude, or switch to Image or Video below. Tools, skills and connectors are in the Tools menu.')}
                  </p>
                </div>
                <ul className="m-0 grid w-full list-none gap-2 p-0 sm:grid-cols-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <li key={suggestion}>
                      <button
                        type="button"
                        onClick={() => setText(t(suggestion))}
                        className="h-full w-full rounded-xl border border-shop-border bg-white px-3.5 py-3 text-start text-sm font-medium text-neutral-fg hover:border-shop-accent hover:bg-tint"
                      >
                        {t(suggestion)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          ) : (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-3 py-5 sm:px-6">
              {visible.map((message) => (
                <MessageView
                  key={message.seq}
                  message={message}
                  conversationId={conversationId || ''}
                  mediaById={mediaById}
                  onMediaUpdate={onMediaUpdate}
                />
              ))}
              {draft && (
                <div className="flex gap-3" aria-live="polite">
                  <span aria-hidden="true" className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-tint text-shop-accent">
                    <Sparkles className="size-4" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    {draft.text && <Markdown text={draft.text} />}
                    {draft.activity && (
                      <span className="inline-flex items-center gap-1.5 text-[13px] text-shop-muted">
                        <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
                        {t(draft.activity)}
                      </span>
                    )}
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>
          )}
        </div>

        {error && (
          <div role="alert" className="flex shrink-0 items-start gap-2 border-t border-shop-border bg-danger-bg px-3 py-2 text-sm text-danger-fg sm:px-6">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 break-words" dir="auto">{t(error)}</span>
            <button type="button" aria-label={t('Dismiss')} onClick={() => setError(null)} className="grid size-6 place-items-center rounded-md hover:bg-white/60">
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

        <Composer
          state={state}
          text={text}
          onTextChange={setText}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          model={model}
          onModelChange={setModel}
          settings={settings}
          onSettingsChange={setSettings}
          busy={draft !== null}
          canStop={streaming}
          onSubmit={submit}
          onStop={stop}
          onManageAddons={() => setAddonsOpen(true)}
          onError={setError}
        />
      </section>

      <ModalDrawer open={listOpen} onClose={() => setListOpen(false)} title={t('Chats')} variant="side">
        <div className="flex h-full flex-col">{list}</div>
      </ModalDrawer>
      <ConnectionsModal open={connectionsOpen} state={state} onClose={() => setConnectionsOpen(false)} onStateChange={setState} />
      <AddonsModal open={addonsOpen} state={state} onClose={() => setAddonsOpen(false)} onStateChange={setState} />
      {dialog}
    </div>
  )
}
