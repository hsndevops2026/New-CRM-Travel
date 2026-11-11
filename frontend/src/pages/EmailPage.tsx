import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Mail, PenLine, Plus, Search, Star, Trash2 } from 'lucide-react'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import PageHeader from '../components/ui/PageHeader'
import { EmailComposer, EmailList, EmailReader } from '../components/email/EmailViews'
import { useConfirm } from '../hooks/useConfirm'
import { t as translate, useI18n } from '../lib/i18n'
import {
  disconnectEmailAccount,
  fetchEmail,
  fetchEmailAccounts,
  fetchEmails,
  fetchEmailStatus,
  ReauthRequired,
  senderAddress,
  setDefaultEmailAccount,
  startGmailConnect,
  type EmailAccount,
  type EmailDetail,
  type EmailSummary,
} from '../lib/email'

const CONNECT_ERRORS: Record<string, string> = {
  access_denied: 'Google access was not granted.',
  invalid_state: 'The Google sign-in expired. Please try again.',
  connect_failed: 'Connecting Gmail failed. Please try again.',
}

export default function EmailPage() {
  useI18n()
  const [params, setParams] = useSearchParams()
  const { confirm, dialog } = useConfirm()
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [accounts, setAccounts] = useState<EmailAccount[] | null>(null)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [messages, setMessages] = useState<EmailSummary[]>([])
  const [nextPage, setNextPage] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<EmailDetail | null>(null)
  const [composing, setComposing] = useState<null | { to?: string; subject?: string }>(null)
  const [reauth, setReauth] = useState(false)
  // Result of the Google redirect (?connected=1 or ?error=...), read once on arrival.
  const [error, setError] = useState<string | null>(() => {
    const err = params.get('error')
    return err ? CONNECT_ERRORS[err] || 'Connecting Gmail failed. Please try again.' : null
  })
  const [notice, setNotice] = useState<string | null>(() => (params.get('connected') ? 'Gmail connected.' : null))

  const account = accounts?.find((a) => a.id === accountId) || null

  const loadAccounts = useCallback(async () => {
    const list = await fetchEmailAccounts()
    setAccounts(list)
    setAccountId((current) => (current && list.some((a) => a.id === current) ? current : list.find((a) => a.is_default)?.id || list[0]?.id || null))
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchEmailStatus(), fetchEmailAccounts()])
      .then(([status, list]) => {
        if (cancelled) return
        setConfigured(status.configured)
        setAccounts(list)
        setAccountId(list.find((a) => a.is_default)?.id || list[0]?.id || null)
      })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load accounts') })
    return () => { cancelled = true }
  }, [])

  // Clean the Google result out of the address bar once it has been shown.
  useEffect(() => {
    if (params.get('connected') || params.get('error')) setParams({}, { replace: true })
  }, [params, setParams])

  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    fetchEmails(accountId, { search: query })
      .then((r) => {
        if (cancelled) return
        setMessages(r.messages)
        setNextPage(r.nextPageToken)
        setReauth(false)
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof ReauthRequired) setReauth(true)
        else setError(err instanceof Error ? err.message : 'Failed to load messages')
      })
    return () => { cancelled = true }
  }, [accountId, query])

  const loadMore = async () => {
    if (!accountId || !nextPage) return
    try {
      const r = await fetchEmails(accountId, { search: query, pageToken: nextPage })
      setMessages((prev) => [...prev, ...r.messages])
      setNextPage(r.nextPageToken)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages')
    }
  }

  const openMessage = async (m: EmailSummary) => {
    if (!accountId) return
    setComposing(null)
    try {
      setOpen(await fetchEmail(accountId, m.id))
    } catch (err) {
      if (err instanceof ReauthRequired) setReauth(true)
      else setError(err instanceof Error ? err.message : 'Failed to load the message')
    }
  }

  const connect = () => startGmailConnect().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not start Gmail connection'))

  const disconnect = async (a: EmailAccount) => {
    const ok = await confirm({
      title: translate('Disconnect {value0}?', { value0: a.email }),
      description: translate('The CRM will stop reading and sending mail from this account. Your Gmail itself is not changed.'),
      confirmLabel: translate('Disconnect'),
      tone: 'danger',
    })
    if (!ok) return
    await disconnectEmailAccount(a.id)
    setOpen(null)
    await loadAccounts()
  }

  if (configured === false) {
    return (
      <div className="space-y-4">
        <PageHeader title={translate('Email')} />
        <EmptyState
          icon={<Mail />}
          title={translate('Gmail is not set up on the server yet')}
          description={translate('An admin needs to add the Google settings (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI and EMAIL_TOKEN_ENCRYPTION_KEY).')}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-8">
      {dialog}
      <PageHeader
        title={translate('Email')}
        subtitle={translate('Your Gmail inside the CRM: read, search and reply.')}
        actions={
          <div className="flex flex-wrap gap-2">
            {account && (
              <Button variant="primary" icon={<PenLine />} onClick={() => { setOpen(null); setComposing({}) }}>
                {translate('New email')}
              </Button>
            )}
            <Button variant="secondary" icon={<Plus />} onClick={() => void connect()}>
              {accounts?.length ? translate('Connect another Gmail') : translate('Connect Gmail')}
            </Button>
          </div>
        }
      />

      {notice ? <p role="status" className="rounded-lg bg-shop-green-bg px-3 py-2 text-sm text-shop-ink">{translate(notice)}</p> : null}
      {error ? <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">{translate(error)}</p> : null}

      {accounts && accounts.length === 0 && (
        <EmptyState
          icon={<Mail />}
          title={translate('No Gmail connected')}
          description={translate('Connect your work Gmail to read and send customer emails from here.')}
          action={<Button variant="primary" onClick={() => void connect()}>{translate('Connect Gmail')}</Button>}
        />
      )}

      {accounts && accounts.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {accounts.map((a) => (
              <span key={a.id} className={`inline-flex items-center gap-1 rounded-full border px-1 py-0.5 ${a.id === accountId ? 'border-shop-ink bg-white' : 'border-shop-border bg-white'}`}>
                <button type="button" onClick={() => { setOpen(null); setAccountId(a.id) }} className="px-2 text-sm font-semibold text-shop-ink" dir="ltr">
                  {a.email}
                </button>
                {a.is_default ? (
                  <Star className="size-4 fill-current text-amber-500" aria-label={translate('Default')} />
                ) : (
                  <Button variant="ghost" iconOnly icon={<Star />} aria-label={translate('Make default')}
                    onClick={() => setDefaultEmailAccount(a.id).then(loadAccounts)} />
                )}
                <Button variant="ghost" iconOnly icon={<Trash2 />} aria-label={translate('Disconnect')} onClick={() => void disconnect(a)} />
              </span>
            ))}
          </div>

          {reauth && (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg bg-warn-bg px-3 py-2 text-sm">
              {translate('Gmail access expired for this account.')}
              <Button variant="primary" onClick={() => void connect()}>{translate('Connect again')}</Button>
            </div>
          )}

          <form
            className="flex max-w-xl items-center gap-2"
            onSubmit={(e) => { e.preventDefault(); setOpen(null); setQuery(search) }}
          >
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={translate('Search by email address')}
              aria-label={translate('Search by email address')}
              dir="ltr"
              className="flex-1 rounded-lg border border-shop-border bg-white px-3 py-2 text-sm"
            />
            <Button type="submit" variant="secondary" icon={<Search />}>{translate('Search')}</Button>
            {query ? <Button variant="ghost" onClick={() => { setSearch(''); setQuery('') }}>{translate('Inbox')}</Button> : null}
          </form>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <section className="overflow-hidden rounded-xl border border-shop-border bg-white">
              {messages.length ? (
                <EmailList messages={messages} selectedId={open?.id} onOpen={(m) => void openMessage(m)} />
              ) : (
                <p className="p-4 text-sm text-shop-muted">{translate('No messages.')}</p>
              )}
              {nextPage ? (
                <div className="border-t border-shop-border p-2 text-center">
                  <Button variant="ghost" onClick={() => void loadMore()}>{translate('Load more')}</Button>
                </div>
              ) : null}
            </section>
            <section>
              {composing && account ? (
                <EmailComposer
                  accountId={account.id}
                  fromEmail={account.email}
                  initial={composing}
                  onCancel={() => setComposing(null)}
                  onSent={() => { setComposing(null); setNotice('Email sent.') }}
                />
              ) : open && account ? (
                <EmailReader
                  accountId={account.id}
                  message={open}
                  onReply={() => setComposing({
                    to: senderAddress(open.isSent ? open.to : open.from),
                    subject: /^re:/i.test(open.subject) ? open.subject : `Re: ${open.subject}`,
                  })}
                />
              ) : (
                <p className="rounded-xl border border-dashed border-shop-border p-6 text-center text-sm text-shop-muted">
                  {translate('Choose a message to read it.')}
                </p>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
