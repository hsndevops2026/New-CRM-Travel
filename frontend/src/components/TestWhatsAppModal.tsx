import { t as translate, useI18n } from '../lib/i18n'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  simulateVoiceMessage,
  simulateWhatsAppMessage,
  type Lead,
  type SimulateWhatsAppResult,
} from '../lib/leads'
import VoiceNoteRecorder from './VoiceNoteRecorder'

type Props = {
  open: boolean
  onClose: () => void
  onLeadCreated: (lead: Lead) => void
}

type ChatLine = {
  id: string
  role: 'user' | 'bot' | 'system'
  text: string
}

const DEFAULT_PHONE = '9990001111'

/** What "No" means for this request — a flight offer must not say "search hotels". */
function searchWhat(bookingType?: string | null) {
  if (bookingType === 'flight') return 'flights'
  if (bookingType === 'package') return 'flights and hotels'
  return 'hotels'
}

export default function TestWhatsAppModal({ open, onClose, onLeadCreated }: Props) {
  useI18n()
  const [phone, setPhone] = useState(DEFAULT_PHONE)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lines, setLines] = useState<ChatLine[]>([])
  const [lastCollected, setLastCollected] = useState<Record<string, unknown> | null>(null)
  const [lastMissing, setLastMissing] = useState<string[]>([])
  const [awaitingPackage, setAwaitingPackage] = useState(false)
  const [offeredPackageTitle, setOfferedPackageTitle] = useState<string | null>(null)
  const [offerType, setOfferType] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const voiceAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!open) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [open, lines])

  // Stop polling a voice test once the dialog is closed or unmounted.
  useEffect(() => {
    if (!open) voiceAbortRef.current?.abort()
  }, [open])
  useEffect(() => () => voiceAbortRef.current?.abort(), [])

  if (!open) return null

  const resetChat = () => {
    setLines([])
    setLastCollected(null)
    setLastMissing([])
    setAwaitingPackage(false)
    setOfferedPackageTitle(null)
    setOfferType(null)
    setError(null)
    setMessage('')
  }

  const applyResult = (result: SimulateWhatsAppResult) => {
    const botLines: ChatLine[] = []
    if (result.restart_notice) {
      botLines.push({
        id: `s-${Date.now()}`,
        role: 'system',
        text: result.restart_notice,
      })
    }
    botLines.push({
      id: `b-${Date.now() + 1}`,
      role: 'bot',
      text: result.reply || '(no reply)',
    })
    if (result.awaiting_package && result.lead) {
      const title = result.predefined_quote?.title || 'matching package'
      botLines.push({
        id: `pkg-${Date.now() + 2}`,
        role: 'system',
        text: translate("Lead created. Offered “{value0}”. Reply Yes to take it, or No to search {value1}.", { value0: translate(String(title)), value1: translate(String(searchWhat(result.lead.booking_type))) }),
      })
      onLeadCreated(result.lead)
    } else if (result.complete && result.lead) {
      botLines.push({
        id: `done-${Date.now() + 2}`,
        role: 'system',
        text: result.lead.predefined_quote_id
          ? translate("Package attached to lead ({value0}…).", { value0: translate(String(result.lead.id.slice(0, 8))) })
          : translate("Lead created ({value0}…). Quotes will fetch in the background.", { value0: translate(String(result.lead.id.slice(0, 8))) }),
      })
      onLeadCreated(result.lead)
    }
    setLines((prev) => [...prev, ...botLines])
    setLastCollected(result.collected || null)
    setLastMissing(result.missing || [])
    setAwaitingPackage(Boolean(result.awaiting_package))
    setOfferedPackageTitle(result.predefined_quote?.title || null)
    setOfferType(result.lead?.booking_type || null)
  }

  const sendText = async (text: string) => {
    if (!text || sending) return

    setSending(true)
    setError(null)
    setLines((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: 'user', text },
    ])

    try {
      const result = await simulateWhatsAppMessage({ message: text, phone })
      applyResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send test message')
    } finally {
      setSending(false)
    }
  }

  const setLineText = (id: string, text: string) =>
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, text } : line)))

  /**
   * Sends a voice note through the real voice queue + worker. It is transcribed and run
   * through the same intake as typed text; nothing is sent to WhatsApp.
   */
  const sendVoice = async (clip: { blob: Blob; seconds: number | null; fileName?: string }) => {
    if (sending) return
    setSending(true)
    setError(null)

    const lineId = `v-${Date.now()}`
    const length = clip.seconds ? ` (${Math.round(clip.seconds)}s)` : ''
    setLines((prev) => [
      ...prev,
      { id: lineId, role: 'user', text: translate("🎤 Voice note{value0} — queued…", { value0: translate(String(length)) }) },
    ])

    voiceAbortRef.current?.abort()
    const controller = new AbortController()
    voiceAbortRef.current = controller

    try {
      const outcome = await simulateVoiceMessage(clip.blob, {
        phone,
        seconds: clip.seconds,
        fileName: clip.fileName,
        signal: controller.signal,
        onStatus: (status) => {
          if (status.status === 'processing') {
            // Show what was heard as soon as the transcript exists, before the lead step ends.
            setLineText(
              lineId,
              status.transcript ? `🎤 “${status.transcript}”` : translate("🎤 Voice note{value0} — transcribing…", { value0: translate(String(length)) }),
            )
          }
        },
      })

      setLineText(lineId, outcome.transcript ? `🎤 “${outcome.transcript}”` : translate("🎤 Voice note{value0}", { value0: translate(String(length)) }))
      if (outcome.result) {
        applyResult(outcome.result)
      } else {
        // Silence / too long: no lead intake ran, but there is a reply the customer would get.
        setLines((prev) => [
          ...prev,
          { id: `b-${Date.now()}`, role: 'bot', text: outcome.reply || '(no reply)' },
        ])
      }
    } catch (err) {
      if (controller.signal.aborted) return
      setLineText(lineId, translate("🎤 Voice note{value0} — failed", { value0: translate(String(length)) }))
      setError(err instanceof Error ? err.message : 'Failed to process the voice note')
    } finally {
      setSending(false)
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const text = message.trim()
    if (!text || sending) return
    setMessage('')
    await sendText(text)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="flex max-h-[92dvh] w-full max-w-2xl flex-col rounded-t-2xl bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-shop-border px-4 py-4 sm:px-5">
          <div>
            <h2 className="text-lg font-semibold">{translate("Test WhatsApp")}</h2>
            <p className="text-xs text-shop-muted">
              {translate("Same intake as WhatsApp, typed or spoken — no real message is sent. Keep the phone to continue a chat.")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-shop-muted hover:bg-shop-bg"
          >
            ✕
          </button>
        </div>

        <div className="grid shrink-0 gap-2 border-b border-shop-border px-4 py-3 sm:grid-cols-[1fr_auto] sm:px-5">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">{translate("Test phone")}</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="min-h-11 rounded-lg border border-shop-border px-3 py-2"
              placeholder="9990001111"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={resetChat}
              className="min-h-11 w-full rounded-lg border border-shop-border px-3 py-2 text-sm font-medium hover:bg-shop-bg sm:w-auto"
            >
              {translate("Clear chat")}</button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-shop-bg/40 px-4 py-4 sm:px-5">
          {lines.length === 0 && (
            <p className="text-sm text-shop-muted">
              {translate("Example: “Need a hotel in Dubai from 20 Sep to 25 Sep for 2 adults, 0 children”. If a predefined package matches the city and those dates, it will be offered here first. Or record a voice note: it goes through the same queue as a real WhatsApp voice note.")}</p>
          )}
          {lines.map((line) => (
            <div
              key={line.id}
              className={`flex ${line.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                  line.role === 'user'
                    ? 'rounded-ee-md bg-shop-ink text-white'
                    : line.role === 'system'
                      ? 'rounded-es-md border border-amber-200 bg-amber-50 text-amber-900'
                      : 'rounded-es-md border border-shop-border bg-white text-shop-ink'
                }`}
              >
                {line.text}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {awaitingPackage && (
          <div className="shrink-0 border-t border-violet-200 bg-violet-50 px-4 py-3 sm:px-5">
            <p className="text-sm font-medium text-violet-900">
              {offeredPackageTitle
                ? translate("Take “{value0}”?", { value0: translate(String(offeredPackageTitle)) })
                : translate("Take this predefined package?")}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={sending}
                onClick={() => void sendText('yes')}
                className="rounded-lg bg-violet-800 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-900 disabled:opacity-50"
              >
                {translate("Yes, take package")}</button>
              <button
                type="button"
                disabled={sending}
                onClick={() => void sendText('no')}
                className="rounded-lg border border-shop-border bg-white px-4 py-2 text-sm font-semibold hover:bg-shop-bg disabled:opacity-50"
              >
                {translate("No, search")}{' '}{searchWhat(offerType)}
              </button>
            </div>
          </div>
        )}

        {(lastMissing.length > 0 || lastCollected) && !awaitingPackage && (
          <div className="shrink-0 border-t border-shop-border px-4 py-2 text-xs text-shop-muted sm:px-5">
            {lastMissing.length > 0 ? (
              <span>{translate("Still need:")}{' '}{lastMissing.join(', ')}</span>
            ) : (
              <span>{translate("Collected fields look complete")}</span>
            )}
          </div>
        )}

        {error && (
          <div className="shrink-0 border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 sm:px-5">
            {translate(error)}
          </div>
        )}

        <div className="shrink-0 border-t border-shop-border bg-shop-bg/40 px-4 py-3 sm:px-5">
          <VoiceNoteRecorder disabled={sending} onSend={(clip) => void sendVoice(clip)} />
        </div>

        <form
          onSubmit={submit}
          className="flex shrink-0 gap-2 border-t border-shop-border px-4 py-3 sm:px-5"
        >
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            placeholder={translate("Type a WhatsApp-style message…")}
            className="min-h-11 flex-1 resize-none rounded-lg border border-shop-border px-3 py-2 text-sm outline-none focus:border-shop-ink"
          />
          <button
            type="submit"
            disabled={sending || !message.trim()}
            className="self-end rounded-lg bg-shop-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-50"
          >
            {sending ? '…' : translate("Send")}
          </button>
        </form>
      </div>
    </div>
  )
}
