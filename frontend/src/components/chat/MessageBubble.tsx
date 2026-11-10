import { Check, CheckCheck, CircleAlert } from 'lucide-react'
import type { BubbleState } from '../../lib/inboxView'

type Props = {
  direction: 'inbound' | 'outbound'
  body: string
  time?: string
  /** How far a message we sent got. Ignored for messages we received. */
  delivery?: BubbleState['delivery']
  sender?: string | null
  /** The text is a speech-to-text transcript of a WhatsApp voice note. */
  voice?: boolean
  /** A WhatsApp poll the bot sent, or the customer's vote on one. */
  poll?: 'sent' | 'vote'
  /** Resend a message that did not go through. */
  onRetry?: () => void
}

/** Chat bubble (design system): white for the customer, teal tint for us. */
export default function MessageBubble({ direction, body, time, delivery = 'none', sender, voice, poll, onRetry }: Props) {
  const outbound = direction === 'outbound'
  const failed = delivery === 'failed'
  return (
    <div className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[85%]">
        {sender && !outbound && <p className="mb-0.5 px-1 text-[11px] font-semibold text-shop-muted">{sender}</p>}
        <div
          className={`text-[13px] whitespace-pre-wrap px-2.5 py-[7px] ${
            outbound
              ? `rounded-[12px_12px_4px_12px] ${failed ? 'border border-red-200 bg-white' : 'bg-chat-outbound'}`
              : 'rounded-[12px_12px_12px_4px] bg-chat-inbound'
          }`}
        >
          {voice && (
            <p className="mb-1 text-[11px] font-bold tracking-[0.06em] text-shop-muted uppercase">Voice message · transcribed</p>
          )}
          {poll && (
            <p className="mb-1 text-[11px] font-bold tracking-[0.06em] text-shop-muted uppercase">
              {poll === 'sent' ? 'WhatsApp poll' : 'Poll vote'}
            </p>
          )}
          {body}
          <div
            className={`mt-0.5 flex items-center justify-end gap-1 text-[11px] tabular-nums ${
              outbound ? 'text-primary-800' : 'text-shop-muted'
            }`}
          >
            {time}
            {delivery === 'sent' && <Check className="size-3.5" aria-label="Sent" role="img" />}
            {delivery === 'delivered' && <CheckCheck className="size-3.5 text-shop-accent" aria-label="Delivered" role="img" />}
          </div>
        </div>
        {failed && (
          <p className="mt-1 flex items-center justify-end gap-1.5 text-xs font-semibold text-danger-fg">
            <CircleAlert className="size-3.5" aria-hidden="true" />
            Not delivered
            {onRetry && (
              <>
                {' · '}
                <button type="button" onClick={onRetry} className="underline hover:text-danger">
                  Retry
                </button>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  )
}
