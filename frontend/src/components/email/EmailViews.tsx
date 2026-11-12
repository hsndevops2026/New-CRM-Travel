import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PackagePlus, Paperclip, Send, X } from 'lucide-react'
import { importPackagesFromEmail, isImportableAttachment } from '../../lib/predefinedQuotes'
import Button from '../ui/Button'
import { t as translate, useI18n } from '../../lib/i18n'
import {
  downloadAttachment,
  formatEmailDate,
  sendEmail,
  senderName,
  type EmailDetail,
  type EmailSummary,
} from '../../lib/email'

export function EmailList({
  messages,
  selectedId,
  onOpen,
}: {
  messages: EmailSummary[]
  selectedId?: string | null
  onOpen: (m: EmailSummary) => void
}) {
  useI18n()
  return (
    <ul className="divide-y divide-shop-border">
      {messages.map((m) => (
        <li key={m.id}>
          <button
            type="button"
            onClick={() => onOpen(m)}
            className={`flex w-full flex-col gap-0.5 px-3 py-2.5 text-start hover:bg-neutral-bg ${selectedId === m.id ? 'bg-neutral-bg' : ''}`}
          >
            <span className="flex items-center gap-2">
              <span dir="auto" className={`flex-1 truncate text-sm ${m.isUnread ? 'font-extrabold' : 'font-semibold'} text-shop-ink`}>
                {m.isSent ? `${translate('To')}: ${senderName(m.to)}` : senderName(m.from)}
              </span>
              <span className="shrink-0 text-xs text-shop-muted tabular-nums">{formatEmailDate(m.date)}</span>
            </span>
            <span dir="auto" className="truncate text-sm text-shop-ink">{m.subject || translate('(no subject)')}</span>
            <span dir="auto" className="truncate text-xs text-shop-muted">{m.snippet}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/**
 * Shows a message. HTML mail goes into a sandboxed iframe with no script
 * permission, so an email cannot run code or reach the CRM's session.
 */
export function EmailReader({ accountId, message, onReply }: { accountId: string; message: EmailDetail; onReply?: () => void }) {
  useI18n()
  const [error, setError] = useState<string | null>(null)
  // Supplier price lists: read the email text or an attachment into packages for review.
  const [reading, setReading] = useState<string | null>(null)
  const [found, setFound] = useState<number | null>(null)
  const importable = message.attachments.filter((a) => isImportableAttachment(a.filename, a.mimeType))
  const toPackages = async (key: string, attachmentId?: string) => {
    setReading(key)
    setError(null)
    setFound(null)
    try {
      const { importRecords } = await importPackagesFromEmail(accountId, message.id, attachmentId)
      setFound(importRecords.filter((r) => r.status === 'needs_review').length)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setReading(null)
    }
  }
  return (
    <article className="flex flex-col gap-3">
      <header className="space-y-1">
        <h2 dir="auto" className="text-lg font-bold text-shop-ink">{message.subject || translate('(no subject)')}</h2>
        <p dir="auto" className="text-sm text-shop-muted">
          <span className="font-semibold text-shop-ink">{message.from}</span>
          {message.to ? <> → <span dir="auto">{message.to}</span></> : null}
        </p>
        <p className="text-xs text-shop-muted">{message.date}</p>
      </header>
      {message.body.html ? (
        <iframe
          title={message.subject || 'email'}
          sandbox=""
          srcDoc={message.body.html}
          className="h-[480px] w-full rounded-lg border border-shop-border bg-white"
        />
      ) : (
        <pre dir="auto" className="whitespace-pre-wrap rounded-lg border border-shop-border bg-white p-3 font-sans text-sm text-shop-ink">
          {message.body.text || ''}
        </pre>
      )}
      {message.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {message.attachments.map((a) => (
            <Button
              key={a.attachmentId}
              variant="secondary"
              icon={<Paperclip />}
              onClick={() => downloadAttachment(accountId, message.id, a).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed'))}
            >
              <span dir="auto">{a.filename}</span>
            </Button>
          ))}
        </div>
      )}
      <section className="flex flex-col gap-2 rounded-lg border border-shop-border bg-shop-bg p-3">
        <p className="text-xs font-semibold text-slate-600">{translate('Price list from a supplier? Turn it into packages')}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<PackagePlus />} loading={reading === 'body'} disabled={Boolean(reading)} onClick={() => void toPackages('body')}>
            {translate('Read the email text')}
          </Button>
          {importable.map((a) => (
            <Button
              key={a.attachmentId}
              size="sm"
              icon={<PackagePlus />}
              loading={reading === a.attachmentId}
              disabled={Boolean(reading)}
              onClick={() => void toPackages(a.attachmentId, a.attachmentId)}
            >
              <span dir="auto">{a.filename}</span>
            </Button>
          ))}
        </div>
        {reading ? <p className="text-xs text-shop-muted">{translate('Reading… this takes up to a minute.')}</p> : null}
        {found != null ? (
          <p role="status" className="text-sm text-shop-ink">
            {found
              ? translate('{value0} package(s) waiting for your review.', { value0: String(found) })
              : translate("Nothing new to review — this was read before.")}{' '}
            <Link to="/quotes?review=1" className="font-semibold text-shop-accent hover:underline">{translate('Review them')}</Link>
          </p>
        ) : null}
      </section>
      {error ? <p className="text-sm text-red-600">{translate(error)}</p> : null}
      {onReply ? (
        <div>
          <Button variant="primary" icon={<Send />} onClick={onReply}>{translate('Reply')}</Button>
        </div>
      ) : null}
    </article>
  )
}

export function EmailComposer({
  accountId,
  fromEmail,
  initial,
  onSent,
  onCancel,
}: {
  accountId: string
  fromEmail: string
  initial?: { to?: string; subject?: string; body?: string }
  onSent: () => void
  onCancel: () => void
}) {
  useI18n()
  const [to, setTo] = useState(initial?.to || '')
  const [subject, setSubject] = useState(initial?.subject || '')
  const [body, setBody] = useState(initial?.body || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = 'w-full rounded-lg border border-shop-border bg-white px-3 py-2 text-sm text-shop-ink'
  return (
    <form
      className="flex flex-col gap-2 rounded-xl border border-shop-border bg-white p-3"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError(null)
        try {
          await sendEmail({ accountId, to, subject, body })
          onSent()
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to send the email')
        } finally {
          setBusy(false)
        }
      }}
    >
      <p className="text-xs text-shop-muted">{translate('From')}: <span dir="ltr">{fromEmail}</span></p>
      <input aria-label={translate('To')} placeholder={translate('To')} value={to} onChange={(e) => setTo(e.target.value)} dir="ltr" className={input} required type="email" />
      <input aria-label={translate('Subject')} placeholder={translate('Subject')} value={subject} onChange={(e) => setSubject(e.target.value)} dir="auto" className={input} />
      <textarea aria-label={translate('Message')} rows={8} value={body} onChange={(e) => setBody(e.target.value)} dir="auto" className={`${input} resize-y`} required />
      {error ? <p role="alert" className="text-sm text-red-600">{translate(error)}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" icon={<Send />} disabled={busy || !to.trim() || !body.trim()}>{translate('Send')}</Button>
        <Button variant="ghost" icon={<X />} onClick={onCancel}>{translate('Cancel')}</Button>
      </div>
    </form>
  )
}
