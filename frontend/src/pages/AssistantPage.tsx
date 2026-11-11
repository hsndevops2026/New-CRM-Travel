import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Database, Map, Send, Sparkles, Trash2 } from 'lucide-react'
import Button from '../components/ui/Button'
import PageHeader from '../components/ui/PageHeader'
import { askAssistant, type AssistantMessage, type AssistantMode } from '../lib/assistant'
import SuggestionCards from '../components/assistant/SuggestionCards'
import { t as translate, useI18n } from '../lib/i18n'

const STORAGE_KEY = 'travel.assistant.chat'

const SUGGESTIONS: Record<AssistantMode, string[]> = {
  data: [
    'Which quotes are waiting for a customer reply?',
    'Which reminders are overdue?',
    'Summarise my pipeline',
    'Write a friendly follow-up for the newest sent quote',
  ],
  planner: [
    'Suggest activities for a family with two children in Istanbul',
    'Suggest trips that fit a budget of 1500 dollars for two people',
    'Suggest destinations with good weather next month',
  ],
}

function loadHistory(): AssistantMessage[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveHistory(messages: AssistantMessage[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)))
  } catch {
    // Storage can be unavailable (private mode); the chat still works in memory.
  }
}

export default function AssistantPage() {
  useI18n()
  const [messages, setMessages] = useState<AssistantMessage[]>(loadHistory)
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<AssistantMode>('data')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    saveHistory(messages)
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' })
  }, [messages, busy])

  const send = async (text: string) => {
    const question = text.trim()
    if (!question || busy) return
    const next: AssistantMessage[] = [...messages, { role: 'user', content: question }]
    setMessages(next)
    setInput('')
    setBusy(true)
    setError(null)
    try {
      const { reply, suggestions } = await askAssistant(next, mode)
      setMessages([...next, { role: 'assistant', content: reply || translate('No answer.'), suggestions }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The assistant could not answer right now')
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void send(input)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send(input)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={translate('Assistant')}
        subtitle={translate('Ask about your leads, quotes and reminders. It reads the CRM but never sends or changes anything.')}
        actions={
          <div className="flex items-center gap-2">
            <div role="group" aria-label={translate('Assistant mode')} className="flex rounded-xl border border-shop-border bg-white p-0.5">
              <Button
                variant={mode === 'data' ? 'primary' : 'ghost'}
                icon={<Database />}
                aria-pressed={mode === 'data'}
                onClick={() => setMode('data')}
              >
                {translate('My data only')}
              </Button>
              <Button
                variant={mode === 'planner' ? 'primary' : 'ghost'}
                icon={<Map />}
                aria-pressed={mode === 'planner'}
                onClick={() => setMode('planner')}
              >
                {translate('Trip planner')}
              </Button>
            </div>
            {messages.length ? (
              <Button variant="ghost" icon={<Trash2 />} onClick={() => setMessages([])}>
                {translate('New chat')}
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-4">
        {messages.length === 0 && (
          <div className="mx-auto mt-6 max-w-xl text-center">
            <Sparkles className="mx-auto size-8 text-shop-muted" aria-hidden />
            <p className="mt-3 text-sm text-shop-muted">
              {mode === 'planner'
                ? translate('Trip planner: ideas for the customer. General suggestions are marked, and prices only come from your packages.')
                : translate('Answers only from your CRM data.')}
            </p>
            <p className="mt-1 text-sm text-shop-muted">{translate('Try one of these:')}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS[mode].map((s) => (
                <Button key={s} variant="secondary" onClick={() => void send(translate(s))}>
                  {translate(s)}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {messages.map((m, i) => (
            <div key={i} className={`flex max-w-[85%] flex-col ${m.role === 'user' ? 'self-end' : 'self-start'}`}>
              <div
                dir="auto"
                className={`whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-shop-ink text-white'
                    : 'border border-shop-border bg-white text-shop-ink'
                }`}
              >
                {m.content}
              </div>
              {m.suggestions?.length ? <SuggestionCards cards={m.suggestions} /> : null}
            </div>
          ))}
          {busy && (
            <p role="status" className="self-start text-sm text-shop-muted">
              {translate('Looking it up…')}
            </p>
          )}
          {error && <p className="self-start text-sm text-red-600">{translate(error)}</p>}
          <div ref={bottomRef} />
        </div>
      </div>

      <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-3xl items-end gap-2 border-t border-shop-border pt-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          dir="auto"
          placeholder={translate('Ask the assistant…')}
          aria-label={translate('Ask the assistant…')}
          className="min-h-[44px] flex-1 resize-none rounded-xl border border-shop-border bg-white px-3 py-2 text-sm text-shop-ink focus:outline-none"
          disabled={busy}
        />
        <Button type="submit" variant="primary" icon={<Send />} disabled={busy || !input.trim()}>
          {translate('Send')}
        </Button>
      </form>
    </div>
  )
}
