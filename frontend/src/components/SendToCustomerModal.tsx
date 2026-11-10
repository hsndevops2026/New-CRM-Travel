import { useState, type FormEvent } from 'react'
import { Send } from 'lucide-react'
import Button from './ui/Button'
import ModalDrawer from './ui/ModalDrawer'
import { sendQuoteToCustomer, type PredefinedQuote } from '../lib/predefinedQuotes'
import { composeInternationalPhone, COUNTRY_DIALS, DEFAULT_DIAL } from '../lib/phone'
import { formatPhone } from '../lib/leads'

type Props = {
  open: boolean
  quote: PredefinedQuote | null
  onClose: () => void
  onSent?: (to: string) => void
}

const FIELD = 'h-9 w-full rounded-lg border border-line-strong bg-white px-2.5 text-sm max-sm:h-11'
const LABEL = 'text-xs font-semibold text-slate-600'

function Form({ quote, onClose, onSent }: { quote: PredefinedQuote; onClose: () => void; onSent?: (to: string) => void }) {
  const [dial, setDial] = useState(DEFAULT_DIAL)
  const [local, setLocal] = useState('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const phone = composeInternationalPhone(dial, local)
  const ready = local.replace(/\D/g, '').length >= 5

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!ready || sending) return
    setSending(true)
    setError(null)
    try {
      const result = await sendQuoteToCustomer(quote.id, { phone, note: note.trim() || undefined })
      setSentTo(result.to)
      onSent?.(result.to)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send the quote')
    } finally {
      setSending(false)
    }
  }

  return (
    <ModalDrawer
      open
      title="Send to customer"
      subtitle={quote.title}
      onClose={onClose}
      maxWidthClassName="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{sentTo ? 'Close' : 'Cancel'}</Button>
          {!sentTo && (
            <Button variant="primary" type="submit" form="send-customer-form" icon={<Send />} loading={sending} disabled={!ready}>
              Send on WhatsApp
            </Button>
          )}
        </div>
      }
    >
      {sentTo ? (
        <div role="status" className="rounded-lg bg-shop-green-bg px-3.5 py-3 text-sm text-primary-800">
          Sent to <strong className="tabular-nums">{formatPhone(sentTo)}</strong> on WhatsApp.
        </div>
      ) : (
        <form id="send-customer-form" onSubmit={(e) => void submit(e)} className="grid gap-3.5">
          <div className="grid gap-1">
            <span className={LABEL}>
              Customer’s WhatsApp number <span className="text-danger">*</span>
            </span>
            <div className="flex gap-2">
              <label className="sr-only" htmlFor="customer-dial">Country code</label>
              <select
                id="customer-dial"
                className={`${FIELD.replace('w-full', 'w-[9.5rem]')} shrink-0`}
                value={dial}
                onChange={(e) => setDial(e.target.value)}
              >
                {COUNTRY_DIALS.map((country) => (
                  <option key={country.iso} value={country.dial}>
                    +{country.dial} {country.name}
                  </option>
                ))}
              </select>
              <input
                aria-label="Number"
                inputMode="tel"
                autoComplete="off"
                autoFocus
                className={`${FIELD.replace('w-full', 'w-0')} min-w-0 flex-1 tabular-nums`}
                placeholder="50 123 4567"
                value={local}
                onChange={(e) => setLocal(e.target.value)}
              />
            </div>
            <span className="text-xs text-shop-muted tabular-nums">
              {ready ? `Sends to ${formatPhone(phone)}` : 'Choose a country code, then type the number.'}
            </span>
          </div>

          <label className="grid gap-1">
            <span className={LABEL}>Message before the package (optional)</span>
            <textarea
              rows={3}
              className="resize-y rounded-lg border border-line-strong px-2.5 py-2 text-sm"
              placeholder="Hi Sarah, as discussed — here is the package:"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <p className="text-xs text-shop-muted">
            The customer gets the package details — trip, dates, hotels, flights and total — as a WhatsApp message.
          </p>

          {error && (
            <div role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
              {error}
            </div>
          )}
        </form>
      )}
    </ModalDrawer>
  )
}

export default function SendToCustomerModal({ open, quote, onClose, onSent }: Props) {
  if (!open || !quote) return null
  return <Form key={quote.id} quote={quote} onClose={onClose} onSent={onSent} />
}
