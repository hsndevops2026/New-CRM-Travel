import { useEffect, useState } from 'react'
import { Bot, BotOff } from 'lucide-react'
import Button from '../ui/Button'
import { fetchAiHandover, setAiPaused, type AiHandover } from '../../lib/inbox'
import { locale, t as translate, useI18n } from '../../lib/i18n'

type Props = {
  threadId: string
  /** Changes when messages change, so an agent reply (which pauses the AI) refreshes the state. */
  refreshKey?: number
}

export default function AiHandoverToggle({ threadId, refreshKey = 0 }: Props) {
  useI18n()
  const [state, setState] = useState<AiHandover | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchAiHandover(threadId)
      .then((next) => { if (!cancelled) { setState(next); setError(null) } })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load AI status') })
    return () => { cancelled = true }
  }, [threadId, refreshKey])

  if (!state && !error) return null

  const toggle = async () => {
    if (!state) return
    setBusy(true)
    try {
      setState(await setAiPaused(threadId, !state.paused))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update AI status')
    } finally {
      setBusy(false)
    }
  }

  const since = state?.paused_at
    ? new Date(state.paused_at).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    : ''
  const who = state?.paused_by_email || (state?.reason === 'customer_request' ? translate('customer request') : '')
  const title = state?.paused
    ? translate('AI paused by {value0} · {value1}', { value0: who || '—', value1: since })
    : translate('The AI assistant is answering this customer')

  return (
    <div className="flex items-center gap-2">
      {error ? <span className="text-xs text-red-600">{translate(error)}</span> : null}
      {state ? (
        <Button
          variant={state.paused ? 'primary' : 'secondary'}
          icon={state.paused ? <Bot /> : <BotOff />}
          onClick={() => void toggle()}
          disabled={busy}
          title={title}
          aria-pressed={state.paused}
        >
          {state.paused ? translate('Resume AI') : translate('Pause AI')}
        </Button>
      ) : null}
    </div>
  )
}
