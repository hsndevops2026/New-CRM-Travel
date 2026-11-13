import { apiFetch, apiJson } from './api'

/** A content block exactly as the model API returns it; narrowed by `type` where used. */
export type ContentBlock = { type: string; [key: string]: unknown }

export type OutputFile = {
  file_id: string
  filename: string
  mime_type: string | null
  size_bytes: number | null
}

/** One Trip planner idea. Prices only ever come from a real agency package. */
export type AssistantSuggestion = {
  title: string
  details: string
  kind: 'activity' | 'trip_idea' | 'package'
  source: 'system' | 'general'
  package_id: string | null
  price: number | null
  currency: string | null
}

export type AssistantLead = { id: string; customer_name: string; destination: string }

/** Text the employee copies for the customer: only the cards they ticked. */
export function suggestionsToText(cards: AssistantSuggestion[]): string {
  return cards
    .map((c, i) => {
      const price = c.price != null && c.currency ? ` (${c.price.toLocaleString('en-US')} ${c.currency})` : ''
      return `${i + 1}. ${c.title}${price}\n${c.details}`
    })
    .join('\n\n')
}

export type MessageMeta = {
  /** Set on a user message sent in Image or Video mode. */
  mode?: 'image' | 'video'
  /** The reply to an Image/Video mode request — only its media is worth showing. */
  direct?: boolean
  media?: string[]
  files?: OutputFile[]
  refusal?: boolean
  truncated?: boolean
  step_limit?: boolean
  model?: string
  /** Trip planner cards Claude proposed in this step, already checked against real packages. */
  suggestions?: AssistantSuggestion[]
  lead?: AssistantLead | null
}

export type AssistantMessage = {
  seq: number
  role: 'user' | 'assistant'
  content: ContentBlock[]
  meta: MessageMeta
  created_at: string
}

export type Media = {
  id: string
  kind: 'image' | 'video'
  prompt: string
  status: 'pending' | 'ready' | 'failed'
  url: string | null
  mime: string | null
  error: string | null
  created_at: string
}

export type ToolSettings = {
  web_search: boolean
  image_gen: boolean
  video_gen: boolean
  /** Read-only lookups in this CRM (leads, quotes, reminders, packages). */
  crm_data: boolean
  /** Ideas for a customer, returned as cards that can be added to the lead's program. */
  trip_planner: boolean
  /** Built-in skill ids (pptx, xlsx, docx, pdf). */
  skills: string[]
  /** Ids of custom skills and connectors switched on. */
  addons: string[]
}

export type Conversation = {
  id: string
  title: string
  model: string
  settings: ToolSettings
  created_at: string
  updated_at: string
}

export type KeySource = 'user' | 'agency' | 'env'
export type Provider = 'anthropic' | 'openai'

export type ConnectionInfo = {
  /** Which key requests run on: a personal key wins over the agency key. */
  active: KeySource | null
  user: { hint: string; updated_at: string } | null
  agency: { hint: string; updated_at: string } | null
  env: boolean
}

export type Addon = {
  id: string
  kind: 'skill' | 'mcp'
  name: string
  scope: 'user' | 'agency'
  description: string | null
  url: string | null
  has_token: boolean
  /** False for a custom skill uploaded with a different Claude key than the one in use. */
  available: boolean
  created_at: string
}

export type AssistantState = {
  connections: Record<Provider, ConnectionInfo>
  can_manage_agency: boolean
  models: { id: string; label: string; note: string }[]
  default_model: string
  media: { image: boolean; video: boolean }
  builtin_skills: { id: string; name: string; description: string }[]
  addons: Addon[]
}

export type Attachment = { name: string; media_type: string; data: string }

export type StreamEvent =
  | { type: 'row'; row: AssistantMessage }
  | { type: 'delta'; text: string }
  | { type: 'activity'; label: string }
  | { type: 'reset' }
  | { type: 'media'; media: Media }
  | { type: 'done'; conversation: Conversation }
  | { type: 'error'; message: string }

export const DEFAULT_SETTINGS: ToolSettings = {
  web_search: true,
  image_gen: true,
  video_gen: true,
  crm_data: true,
  trip_planner: false,
  skills: [],
  addons: [],
}

const BASE = '/api/assistant'

export const fetchAssistantState = () => apiJson<AssistantState>(`${BASE}/state`)

export const saveProviderKey = (provider: Provider, scope: 'user' | 'agency', apiKey: string) =>
  apiJson<AssistantState>(`${BASE}/connections/${provider}`, {
    method: 'PUT',
    body: JSON.stringify({ scope, api_key: apiKey }),
  })

export const removeProviderKey = (provider: Provider, scope: 'user' | 'agency') =>
  apiJson<AssistantState>(`${BASE}/connections/${provider}?scope=${scope}`, { method: 'DELETE' })

export async function fetchConversations() {
  const data = await apiJson<{ conversations: Conversation[] }>(`${BASE}/conversations`)
  return data.conversations
}

export async function createConversation(model: string, settings: ToolSettings) {
  const data = await apiJson<{ conversation: Conversation }>(`${BASE}/conversations`, {
    method: 'POST',
    body: JSON.stringify({ model, settings }),
  })
  return data.conversation
}

export const fetchConversation = (id: string) =>
  apiJson<{ conversation: Conversation; messages: AssistantMessage[]; media: Media[] }>(
    `${BASE}/conversations/${id}`,
  )

export const deleteConversation = (id: string) =>
  apiJson<{ ok: boolean }>(`${BASE}/conversations/${id}`, { method: 'DELETE' })

export type GenerateInput =
  | { kind: 'image'; prompt: string; aspect: 'square' | 'landscape' | 'portrait' }
  | { kind: 'video'; prompt: string; seconds: 4 | 8 | 12; orientation: 'landscape' | 'portrait' }

export const generateMedia = (conversationId: string, input: GenerateInput) =>
  apiJson<{ conversation: Conversation; messages: AssistantMessage[]; media: Media }>(
    `${BASE}/conversations/${conversationId}/generate`,
    { method: 'POST', body: JSON.stringify(input) },
  )

export async function fetchMedia(id: string) {
  const data = await apiJson<{ media: Media }>(`${BASE}/media/${id}`)
  return data.media
}

export const addConnector = (input: { name: string; url: string; token: string; scope: 'user' | 'agency' }) =>
  apiJson<AssistantState>(`${BASE}/addons/connector`, { method: 'POST', body: JSON.stringify(input) })

export const installBundle = (file: string, scope: 'user' | 'agency') =>
  apiJson<AssistantState & { installed: Addon[]; skipped: string[] }>(`${BASE}/addons/bundle`, {
    method: 'POST',
    body: JSON.stringify({ file, scope }),
  })

export const removeAddon = (id: string) => apiJson<AssistantState>(`${BASE}/addons/${id}`, { method: 'DELETE' })

/**
 * Read a newline-delimited JSON stream, calling `onEvent` for each complete line.
 * Chunks can split a line (or a multi-byte character) anywhere, so text is buffered.
 */
export async function readNdjson(stream: ReadableStream<Uint8Array>, onEvent: (event: StreamEvent) => void) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const flush = (line: string) => {
    const text = line.trim()
    if (!text) return
    try {
      onEvent(JSON.parse(text) as StreamEvent)
    } catch {
      // A malformed line is skipped rather than ending the whole reply.
    }
  }
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      flush(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
    }
  }
  flush(buffer + decoder.decode())
}

/** Send a chat message; events arrive through `onEvent` until the reply is complete. */
export async function sendMessage(
  conversationId: string,
  body: { text: string; attachments: Attachment[]; model: string; settings: ToolSettings },
  onEvent: (event: StreamEvent) => void,
  signal: AbortSignal,
) {
  const response = await apiFetch(`${BASE}/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error || `Message could not be sent (${response.status})`)
  }
  await readNdjson(response.body, onEvent)
}

/** Download a document Claude produced; needs the login token, so it cannot be a plain link. */
export async function downloadOutputFile(conversationId: string, file: OutputFile) {
  const response = await apiFetch(`${BASE}/conversations/${conversationId}/files/${encodeURIComponent(file.file_id)}`)
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error || 'The file could not be downloaded')
  }
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = file.filename || 'file'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`${file.name} could not be read`))
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.readAsDataURL(file)
  })
}

// ── Turning stored messages into something to show ──────────────────────────────────────

export type ViewPart =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'step'; label: string; detail?: string }
  | { kind: 'sources'; items: { title: string; url: string }[] }
  | { kind: 'image'; src: string }
  | { kind: 'document'; name: string }

const str = (value: unknown) => (typeof value === 'string' ? value : '')
const obj = (value: unknown) => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {})

/** Tool results are sent back as a "user" message; they are plumbing, not something to show. */
export function isHiddenMessage(message: AssistantMessage) {
  return (
    message.role === 'user' &&
    message.content.length > 0 &&
    message.content.every((block) => block.type === 'tool_result')
  )
}

/** What each CRM lookup is called in the reply's step list. */
const CRM_STEPS: Record<string, string> = {
  search_leads: 'Searched leads',
  get_lead: 'Opened a lead',
  pipeline_summary: 'Checked the pipeline',
  list_overdue_reminders: 'Checked overdue reminders',
  list_quotes_waiting_for_customer: 'Checked quotes waiting for a reply',
  search_packages: 'Searched packages',
}

function stepFor(block: ContentBlock): ViewPart | null {
  const name = str(block.name)
  const input = obj(block.input)
  if (block.type === 'server_tool_use') {
    if (name === 'web_search') return { kind: 'step', label: 'Searched the web', detail: str(input.query) }
    if (name === 'web_fetch') return { kind: 'step', label: 'Read a page', detail: str(input.url) }
    return { kind: 'step', label: 'Ran code' }
  }
  if (block.type === 'mcp_tool_use') {
    return { kind: 'step', label: `Used ${str(block.server_name) || 'a connector'}`, detail: name }
  }
  if (block.type === 'tool_use') {
    if (name === 'generate_image') return { kind: 'step', label: 'Generated an image', detail: str(input.prompt) }
    if (name === 'generate_video') return { kind: 'step', label: 'Started a video', detail: str(input.prompt) }
    if (name === 'propose_suggestions') return { kind: 'step', label: 'Prepared suggestions' }
    const crm = CRM_STEPS[name]
    if (crm) return { kind: 'step', label: crm, detail: str(input.text) || str(input.destination) || undefined }
    return { kind: 'step', label: 'Used a tool', detail: name || undefined }
  }
  if (block.type === 'fallback') return { kind: 'step', label: 'Answered by a fallback model' }
  return null
}

/** The visible pieces of one message, in order. */
export function messageParts(message: AssistantMessage): ViewPart[] {
  const parts: ViewPart[] = []
  for (const block of message.content) {
    if (block.type === 'text') {
      // The note recorded for an Image/Video mode request is for Claude, not the reader.
      if (message.meta.direct) continue
      const text = str(block.text)
      if (text.trim()) parts.push({ kind: 'text', text })
    } else if (block.type === 'thinking') {
      const text = str(block.thinking)
      if (text.trim()) parts.push({ kind: 'thinking', text })
    } else if (block.type === 'image') {
      const source = obj(block.source)
      if (source.type === 'base64') {
        parts.push({ kind: 'image', src: `data:${str(source.media_type)};base64,${str(source.data)}` })
      } else if (source.type === 'url') {
        parts.push({ kind: 'image', src: str(source.url) })
      }
    } else if (block.type === 'document') {
      parts.push({ kind: 'document', name: str(block.title) || 'Document' })
    } else if (block.type === 'web_search_tool_result') {
      const results = Array.isArray(block.content) ? block.content : []
      const items = results
        .map((entry) => obj(entry))
        .filter((entry) => entry.type === 'web_search_result' && /^https?:\/\//.test(str(entry.url)))
        .map((entry) => ({ title: str(entry.title) || str(entry.url), url: str(entry.url) }))
      if (items.length) parts.push({ kind: 'sources', items })
    } else {
      const step = stepFor(block)
      if (step) parts.push(step)
    }
  }
  return parts
}

export function formatBytes(bytes: number | null) {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const SETTINGS_KEY = 'assistant:last-setup'

/** The model and tools last used, so a new chat starts the way the previous one was set up. */
export function loadLastSetup(): { model: string | null; settings: ToolSettings } {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null') as
      | { model?: string; settings?: Partial<ToolSettings> }
      | null
    return {
      model: typeof saved?.model === 'string' ? saved.model : null,
      settings: { ...DEFAULT_SETTINGS, ...(saved?.settings || {}) },
    }
  } catch {
    return { model: null, settings: DEFAULT_SETTINGS }
  }
}

export function saveLastSetup(model: string, settings: ToolSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ model, settings }))
  } catch {
    // Storage can be unavailable (private mode); the setup simply is not remembered.
  }
}
