import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PenLine } from 'lucide-react'
import Button from '../ui/Button'
import { EmailComposer, EmailList, EmailReader } from './EmailViews'
import { t as translate, useI18n } from '../../lib/i18n'
import { fetchContactEmails, fetchEmail, ReauthRequired, type EmailDetail, type EmailSummary } from '../../lib/email'

type State = Awaited<ReturnType<typeof fetchContactEmails>>

/** Mail with this customer, from the employee's default Gmail account. */
export default function ContactEmailsPanel({ contactId, contactEmail }: { contactId: string; contactEmail?: string | null }) {
  useI18n()
  const [state, setState] = useState<State | null>(null)
  const [open, setOpen] = useState<EmailDetail | null>(null)
  const [composing, setComposing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchContactEmails(contactId)
      .then((s) => { if (!cancelled) { setState(s); setError(null) } })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof ReauthRequired ? 'Gmail access expired for this account.' : err instanceof Error ? err.message : 'Failed to load emails')
      })
    return () => { cancelled = true }
  }, [contactId])

  const openMessage = async (m: EmailSummary) => {
    if (!state?.account) return
    try { setOpen(await fetchEmail(state.account.id, m.id)) } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load the message') }
  }

  if (error) {
    return (
      <p className="text-sm text-red-600">
        {translate(error)} <Link to="/email" className="font-bold underline">{translate('Open Email')}</Link>
      </p>
    )
  }
  if (!state) return <p role="status" className="text-sm text-shop-muted">{translate('Loading…')}</p>
  if (!state.connected) {
    return (
      <p className="text-sm text-shop-muted">
        {translate('Connect your Gmail to see emails with this customer.')}{' '}
        <Link to="/email" className="font-bold text-shop-ink underline">{translate('Connect Gmail')}</Link>
      </p>
    )
  }
  if (state.no_email) {
    return <p className="text-sm text-shop-muted">{translate('This customer has no email address. Add one with Edit to see their emails.')}</p>
  }

  const account = state.account!
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-shop-muted">
          {translate('Emails with {value0} in {value1}', { value0: contactEmail || '', value1: account.email })}
        </p>
        <Button variant="secondary" icon={<PenLine />} onClick={() => { setOpen(null); setComposing(true) }}>{translate('New email')}</Button>
      </div>
      {composing ? (
        <EmailComposer accountId={account.id} fromEmail={account.email} initial={{ to: contactEmail || '' }}
          onCancel={() => setComposing(false)} onSent={() => setComposing(false)} />
      ) : null}
      {open ? (
        <div className="space-y-2">
          <Button variant="ghost" onClick={() => setOpen(null)}>{translate('Back to list')}</Button>
          <EmailReader accountId={account.id} message={open} />
        </div>
      ) : state.messages.length ? (
        <div className="overflow-hidden rounded-xl border border-shop-border bg-white">
          <EmailList messages={state.messages} onOpen={(m) => void openMessage(m)} />
        </div>
      ) : (
        <p className="text-sm text-shop-muted">{translate('No emails with this customer yet.')}</p>
      )}
    </div>
  )
}
