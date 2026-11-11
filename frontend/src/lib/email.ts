import { apiFetch } from './api'
import { locale } from './i18n'

export type EmailAccount = { id: string; email: string; is_default: boolean; created_at: string }

export type EmailSummary = {
  id: string
  threadId: string
  from: string
  to: string
  subject: string
  date: string
  snippet: string
  isUnread: boolean
  isSent: boolean
}

export type EmailAttachment = { filename: string; mimeType: string; size: number; attachmentId: string }

export type EmailDetail = EmailSummary & {
  body: { text: string | null; html: string | null }
  attachments: EmailAttachment[]
}

export class ReauthRequired extends Error {
  constructor() {
    super('reauth_required')
  }
}

async function json<T>(res: Response, fallback: string): Promise<T> {
  const data = await res.json().catch(() => ({}))
  if (res.status === 409 && data.error === 'reauth_required') throw new ReauthRequired()
  if (!res.ok) throw new Error(data.error || fallback)
  return data as T
}

export async function fetchEmailStatus() {
  return json<{ configured: boolean }>(await apiFetch('/api/email/status'), 'Failed to load email status')
}

/** Starts Google sign-in: the browser leaves the CRM and comes back to /email. */
export async function startGmailConnect() {
  const { url } = await json<{ url: string }>(await apiFetch('/api/email/connect', { method: 'POST' }), 'Could not start Gmail connection')
  window.location.assign(url)
}

export async function fetchEmailAccounts() {
  return (await json<{ accounts: EmailAccount[] }>(await apiFetch('/api/email/accounts'), 'Failed to load accounts')).accounts
}

export async function setDefaultEmailAccount(id: string) {
  await json(await apiFetch(`/api/email/accounts/${encodeURIComponent(id)}/default`, { method: 'PATCH' }), 'Failed to update account')
}

export async function disconnectEmailAccount(id: string) {
  const res = await apiFetch(`/api/email/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!res.ok) await json(res, 'Failed to disconnect account')
}

export async function fetchEmails(accountId: string, opts: { search?: string; pageToken?: string | null } = {}) {
  const params = new URLSearchParams({ accountId })
  if (opts.search?.trim()) params.set('search', opts.search.trim())
  if (opts.pageToken) params.set('pageToken', opts.pageToken)
  return json<{ messages: EmailSummary[]; nextPageToken: string | null }>(
    await apiFetch(`/api/email/messages?${params}`),
    'Failed to load messages',
  )
}

export async function fetchEmail(accountId: string, id: string) {
  return json<EmailDetail>(
    await apiFetch(`/api/email/messages/${encodeURIComponent(id)}?accountId=${encodeURIComponent(accountId)}`),
    'Failed to load the message',
  )
}

export async function sendEmail(input: { accountId: string; to: string; subject: string; body: string }) {
  return json<{ id: string; threadId: string }>(
    await apiFetch('/api/email/messages/send', { method: 'POST', body: JSON.stringify(input) }),
    'Failed to send the email',
  )
}

/** Attachments need the Bearer token, so they are fetched and saved from memory. */
export async function downloadAttachment(accountId: string, messageId: string, att: EmailAttachment) {
  const params = new URLSearchParams({ accountId, filename: att.filename })
  const res = await apiFetch(
    `/api/email/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(att.attachmentId)}?${params}`,
  )
  if (!res.ok) await json(res, 'Failed to download the attachment')
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = att.filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function fetchContactEmails(contactId: string, pageToken?: string | null) {
  const params = pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ''
  return json<{
    connected: boolean
    no_email?: boolean
    account?: { id: string; email: string }
    messages: EmailSummary[]
    nextPageToken: string | null
  }>(await apiFetch(`/api/contacts/${encodeURIComponent(contactId)}/emails${params}`), 'Failed to load emails')
}

/** "Rana Ahmed <rana@x.com>" → "Rana Ahmed"; a bare address stays as is. */
export function senderName(from: string) {
  const match = /^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/.exec(from)
  return (match ? match[1] : from).trim()
}

/** "Rana <rana@x.com>" → "rana@x.com". */
export function senderAddress(from: string) {
  const match = /<([^>]+)>/.exec(from)
  return (match ? match[1] : from).trim()
}

/** Today: time only; older: day and month. */
export function formatEmailDate(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  const sameDay = d.toDateString() === new Date().toDateString()
  return d.toLocaleString(locale(), sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' })
}

