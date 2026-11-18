import { apiJson } from './api'
import { nameFromEmail } from './people'

export type WebchatSettings = {
  enabled: boolean
  language: 'ar' | 'en'
  title: string | null
  greeting: string | null
  /** null = the agency's main colour. */
  color: string | null
  /** null = left for Arabic, right for English. */
  side: 'left' | 'right' | null
  allowed_origins: string[]
  verify_phone: boolean
  show_staff_replies: boolean
  updated_at?: string
}

/** One user's chat. Empty fields use the agency defaults. */
export type WebchatWidget = {
  id: string
  owner_id: string
  owner_email: string
  owner_role: string
  /** false when the owner's account is not approved: the chat then shows nothing. */
  owner_active: boolean
  public_key: string
  enabled: boolean
  language: 'ar' | 'en' | null
  title: string | null
  greeting: string | null
  color: string | null
  side: 'left' | 'right' | null
  allowed_origins: string[]
  last_used_at: string | null
  key_rotated_at: string | null
  updated_at?: string
  test_page_url: string
  /** Admin list only. */
  lead_count?: number
}

export type WebchatSettingsResponse = {
  /** Agency defaults and phone rules. */
  settings: WebchatSettings
  /** Sites from WEBCHAT_ALLOWED_ORIGINS, used while the CRM list is empty. */
  env_origins: string[]
  script_url: string
  /** Test page of the shared agency chat (no key). */
  test_page_url: string
  my_widget: WebchatWidget
  /** Admins only: every user's chat. */
  widgets?: WebchatWidget[]
}

export type WidgetSettings = Pick<WebchatWidget, 'enabled' | 'language' | 'title' | 'greeting' | 'color' | 'side' | 'allowed_origins'>

export async function fetchWebchatSettings() {
  return apiJson<WebchatSettingsResponse>('/api/webchat-settings')
}

export async function saveWebchatSettings(input: Partial<WebchatSettings>) {
  return apiJson<WebchatSettingsResponse>('/api/webchat-settings', {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export async function saveMyWidget(input: Partial<WidgetSettings>) {
  return apiJson<WebchatSettingsResponse>('/api/webchat-widget', { method: 'PATCH', body: JSON.stringify(input) })
}

export async function rotateMyWidgetKey() {
  return apiJson<WebchatSettingsResponse>('/api/webchat-widget/rotate-key', { method: 'POST' })
}

export async function setWidgetEnabled(id: string, enabled: boolean) {
  return apiJson<WebchatSettingsResponse>(`/api/webchat-widgets/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  })
}

export async function rotateWidgetKey(id: string) {
  return apiJson<WebchatSettingsResponse>(`/api/webchat-widgets/${encodeURIComponent(id)}/rotate-key`, { method: 'POST' })
}

/** The line to paste into a website. With a key, leads from it go to that user. */
export function embedSnippet(scriptUrl: string, key?: string | null) {
  return `<script src="${scriptUrl}"${key ? ` data-key="${key}"` : ''} async></script>`
}

/** A real host name: localhost, an IP, or name.tld (browsers accept spaces and other oddities). */
const HOST = /^(localhost|\[[0-9a-f:.]+\]|[a-z0-9-]+(\.[a-z0-9-]+)+)$/i

/** "agency.com/page" → "https://agency.com". null when it is not a website address. */
export function normalizeOrigin(value: string): string | null {
  let text = value.trim()
  if (!text) return null
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`
  try {
    const url = new URL(text)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    if (!HOST.test(url.hostname)) return null
    return url.origin.toLowerCase()
  } catch {
    return null
  }
}

/** One site per line (or comma separated) → clean list, plus the lines that are not sites. */
export function parseOrigins(text: string) {
  const origins: string[] = []
  const invalid: string[] = []
  for (const line of text.split(/[\n,]+/)) {
    if (!line.trim()) continue
    const origin = normalizeOrigin(line)
    if (!origin) invalid.push(line.trim())
    else if (!origins.includes(origin)) origins.push(origin)
  }
  return { origins, invalid }
}

export type WebAttribution = {
  /** The user whose website chat it was. */
  chat_owner?: { id: string; email: string }
  site?: string
  page_url?: string
  page_title?: string
  referrer?: string
  utm?: Partial<Record<'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_term' | 'utm_content' | 'gclid' | 'fbclid', string>>
}

/** "https://www.google.com/search?q=x" → "google.com". */
export function siteName(url?: string | null) {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/** "From agency.com · via instagram / summer-sale" for leads that came in through the website chat. */
export function webSourceParts(attribution: WebAttribution | null | undefined) {
  if (!attribution) return null
  const site = siteName(attribution.site) || siteName(attribution.page_url)
  const utm = attribution.utm || {}
  const campaign = [utm.utm_source, utm.utm_medium, utm.utm_campaign].filter(Boolean).join(' / ')
  const ads = utm.gclid ? 'Google Ads' : utm.fbclid ? 'Facebook / Instagram' : null
  const referrer = siteName(attribution.referrer)
  const via = campaign || ads || (referrer && referrer !== site ? referrer : null)
  const owner = attribution.chat_owner?.email ? nameFromEmail(attribution.chat_owner.email) : null
  if (!site && !via && !owner) return null
  return { site, via, owner, page: attribution.page_url || null, pageTitle: attribution.page_title || null }
}

/** The look-and-sites form, shared by a user's chat and the agency defaults. Empty = "use the default". */
export type LookDraft = {
  enabled: boolean
  language: '' | 'ar' | 'en'
  title: string
  greeting: string
  color: string
  side: '' | 'left' | 'right'
  origins_text: string
}

export function toLookDraft(s: Pick<WebchatWidget, 'enabled' | 'language' | 'title' | 'greeting' | 'color' | 'side' | 'allowed_origins'>): LookDraft {
  return {
    enabled: s.enabled,
    language: s.language || '',
    title: s.title || '',
    greeting: s.greeting || '',
    color: s.color || '',
    side: s.side || '',
    origins_text: s.allowed_origins.join('\n'),
  }
}

export function lookPatch(draft: LookDraft, origins: string[]) {
  return {
    enabled: draft.enabled,
    language: draft.language || null,
    title: draft.title.trim() || null,
    greeting: draft.greeting.trim() || null,
    color: draft.color || null,
    side: draft.side || null,
    allowed_origins: origins,
  }
}

export const DEFAULT_CHAT_TEXT = {
  ar: { title: 'تحدث معنا', greeting: 'أهلاً بك! اكتب اسمك ورقم هاتفك لنبدأ، وسنساعدك في حجز رحلتك.', start: 'ابدأ المحادثة' },
  en: { title: 'Chat with us', greeting: 'Welcome! Enter your name and phone number to start, and we will help you book your trip.', start: 'Start chat' },
}
