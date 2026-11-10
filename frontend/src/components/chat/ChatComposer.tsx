import { t as translate, useI18n } from '../../lib/i18n'
import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { Send } from 'lucide-react'
import Button from '../ui/Button'
import { QUICK_REPLIES } from '../../lib/inboxView'

type Props = {
  disabled?: boolean
  sending?: boolean
  onSend: (text: string) => Promise<void>
  placeholder?: string
  /** Show the canned-reply pills (customer conversations). */
  quickReplies?: boolean
  /** Label for the composer, e.g. "Message Sarah Ahmed". */
  label?: string
}

export default function ChatComposer({
  disabled,
  sending,
  onSend,
  placeholder = 'Type a message…',
  quickReplies = false,
  label = 'Message',
}: Props) {
  useI18n()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    const value = text.trim()
    if (!value || disabled || sending) return
    setError(null)
    try {
      await onSend(value)
      setText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Message could not be sent. Try again.')
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2 border-t border-shop-border bg-white px-3 py-2.5 sm:px-4">
      {quickReplies && (
        <div className="flex flex-wrap gap-1.5">
          {QUICK_REPLIES.map((reply) => (
            <button
              key={reply.id}
              type="button"
              disabled={disabled || sending}
              onClick={() => setText((current) => (current.trim() ? `${current.trim()} ${reply.text}` : reply.text))}
              className="h-7 rounded-full border border-shop-border bg-white px-3 text-xs font-semibold text-neutral-fg hover:bg-neutral-bg disabled:opacity-50 max-sm:h-9"
            >
              {translate(reply.label)}
            </button>
          ))}
        </div>
      )}
      {error && <p role="alert" className="text-xs text-danger-fg">{translate(error)}</p>}
      <div className="flex items-end gap-2">
        <textarea
          aria-label={translate(label)}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled || sending}
          rows={1}
          placeholder={placeholder}
          className="max-h-32 min-h-10 flex-1 resize-none rounded-lg border border-line-strong bg-white px-3 py-[9px] text-sm disabled:opacity-50"
        />
        <Button type="submit" variant="primary" icon={<Send />} loading={sending} disabled={disabled || !text.trim()} className="h-10">
          {translate("Send")}</Button>
      </div>
    </form>
  )
}
