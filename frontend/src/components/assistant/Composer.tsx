import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowUp, FileText, Image as ImageIcon, MessageSquare, Paperclip, SlidersHorizontal, Square, Video, X } from 'lucide-react'
import SegmentedControl from '../ui/SegmentedControl'
import { t, useI18n } from '../../lib/i18n'
import {
  readFileAsBase64,
  type Attachment,
  type AssistantState,
  type ToolSettings,
} from '../../lib/assistant'

export type ComposerMode = 'chat' | 'image' | 'video'

export type ComposerRequest =
  | { kind: 'chat' }
  | { kind: 'image'; aspect: 'square' | 'landscape' | 'portrait' }
  | { kind: 'video'; seconds: 4 | 8 | 12; orientation: 'landscape' | 'portrait' }

type Props = {
  state: AssistantState
  text: string
  onTextChange: (text: string) => void
  attachments: Attachment[]
  onAttachmentsChange: (attachments: Attachment[]) => void
  model: string
  onModelChange: (model: string) => void
  settings: ToolSettings
  onSettingsChange: (settings: ToolSettings) => void
  /** A reply is streaming or media is being generated. */
  busy: boolean
  /** Only a streaming chat reply can be stopped. */
  canStop: boolean
  onSubmit: (request: ComposerRequest) => void
  onStop: () => void
  onManageAddons: () => void
  onError: (message: string) => void
}

const MAX_FILES = 4
const MAX_FILE_BYTES = 4 * 1024 * 1024
const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/markdown,text/csv,.md,.txt,.csv'

function mediaTypeOf(file: File) {
  if (file.type) return file.type
  const name = file.name.toLowerCase()
  if (name.endsWith('.md')) return 'text/markdown'
  if (name.endsWith('.csv')) return 'text/csv'
  return 'text/plain'
}

const selectClass =
  'h-8 rounded-lg border border-line-strong bg-white px-2 text-[13px] font-medium text-shop-ink max-sm:h-10'

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className={`flex items-start gap-2.5 rounded-lg px-2 py-1.5 ${disabled ? 'opacity-60' : 'hover:bg-neutral-bg'}`}>
      <input
        type="checkbox"
        className="mt-0.5 size-4 accent-[var(--color-shop-accent)]"
        checked={checked && !disabled}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="text-[13px] font-semibold">{label}</span>
        {hint ? <span className="text-xs text-shop-muted">{hint}</span> : null}
      </span>
    </label>
  )
}

export default function Composer({
  state,
  text,
  onTextChange,
  attachments,
  onAttachmentsChange,
  model,
  onModelChange,
  settings,
  onSettingsChange,
  busy,
  canStop,
  onSubmit,
  onStop,
  onManageAddons,
  onError,
}: Props) {
  useI18n()
  const [mode, setMode] = useState<ComposerMode>('chat')
  const [aspect, setAspect] = useState<'square' | 'landscape' | 'portrait'>('landscape')
  const [seconds, setSeconds] = useState<4 | 8 | 12>(4)
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape')
  const [toolsOpen, setToolsOpen] = useState(false)
  const toolsRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  const claudeReady = state.connections.anthropic.active !== null
  const mediaReady = mode === 'video' ? state.media.video : state.media.image
  const ready = mode === 'chat' ? claudeReady : mediaReady
  const hasInput = text.trim().length > 0 || (mode === 'chat' && attachments.length > 0)

  const skills = state.addons.filter((addon) => addon.kind === 'skill')
  const connectors = state.addons.filter((addon) => addon.kind === 'mcp')
  const activeTools =
    Number(settings.crm_data) +
    Number(settings.trip_planner) +
    Number(settings.web_search) +
    Number(settings.image_gen && state.media.image) +
    Number(settings.video_gen && state.media.video) +
    settings.skills.length +
    settings.addons.filter((id) => state.addons.some((addon) => addon.id === id && addon.available)).length

  useEffect(() => {
    if (!toolsOpen) return
    const onPointer = (event: MouseEvent) => {
      if (!toolsRef.current?.contains(event.target as Node)) setToolsOpen(false)
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setToolsOpen(false)
    }
    window.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [toolsOpen])

  // Grow with the text up to a few lines, then scroll.
  useEffect(() => {
    const element = textRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`
  }, [text])

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (busy || !ready || !hasInput) return
    if (mode === 'chat') onSubmit({ kind: 'chat' })
    else if (mode === 'image') onSubmit({ kind: 'image', aspect })
    else onSubmit({ kind: 'video', seconds, orientation })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  const addFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files || [])
    event.target.value = ''
    if (!picked.length) return
    if (attachments.length + picked.length > MAX_FILES) {
      onError(t('Attach at most {value0} files', { value0: MAX_FILES }))
      return
    }
    const tooBig = picked.find((file) => file.size > MAX_FILE_BYTES)
    if (tooBig) {
      onError(t('{value0} is larger than 4 MB', { value0: tooBig.name }))
      return
    }
    try {
      const added = await Promise.all(
        picked.map(async (file) => ({
          name: file.name,
          media_type: mediaTypeOf(file),
          data: await readFileAsBase64(file),
        })),
      )
      onAttachmentsChange([...attachments, ...added])
    } catch (error) {
      onError(error instanceof Error ? error.message : t('The file could not be read'))
    }
  }

  const toggleIn = (list: string[], id: string, on: boolean) =>
    on ? [...new Set([...list, id])] : list.filter((entry) => entry !== id)

  const placeholder = t(
    !ready
      ? mode === 'chat'
        ? 'Connect Claude to start chatting'
        : 'Add an OpenAI key under Connections to generate images and videos'
      : mode === 'chat'
        ? 'Ask about your leads, or ask for a message, a document, an image or a video…'
        : mode === 'image'
          ? 'Describe the image you want…'
          : 'Describe the video you want…',
  )

  return (
    <form onSubmit={submit} className="shrink-0 border-t border-shop-border bg-white px-3 pb-3 pt-2.5 sm:px-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
        <div className="relative flex flex-wrap items-center gap-2">
          <SegmentedControl
            ariaLabel={t('What to generate')}
            value={mode}
            onChange={(id) => setMode(id as ComposerMode)}
            items={[
              { id: 'chat', label: t('Chat'), icon: <MessageSquare /> },
              { id: 'image', label: t('Image'), icon: <ImageIcon /> },
              { id: 'video', label: t('Video'), icon: <Video /> },
            ]}
          />

          {mode === 'chat' && (
            <>
              <label className="sr-only" htmlFor="assistant-model">{t('Model')}</label>
              <select id="assistant-model" value={model} onChange={(event) => onModelChange(event.target.value)} className={selectClass}>
                {state.models.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label} — {t(entry.note)}
                  </option>
                ))}
              </select>

              <div ref={toolsRef}>
                <button
                  type="button"
                  onClick={() => setToolsOpen((open) => !open)}
                  aria-haspopup="dialog"
                  aria-expanded={toolsOpen}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-white px-2.5 text-[13px] font-semibold hover:bg-neutral-bg max-sm:h-10"
                >
                  <SlidersHorizontal className="size-4" aria-hidden="true" />
                  {t('Tools')}
                  <span className="rounded-full bg-tint px-1.5 text-xs tabular-nums text-shop-accent">{activeTools}</span>
                </button>
                {toolsOpen && (
                  <div
                    role="dialog"
                    aria-label={t('Tools Claude can use')}
                    className="absolute bottom-full start-0 z-30 mb-2 max-h-[60vh] w-[min(320px,calc(100vw-24px))] overflow-y-auto rounded-xl border border-shop-border bg-white p-2 shadow-[0_8px_24px_rgba(15,23,42,.14)]"
                  >
                    <p className="m-0 px-2 pb-1 pt-1 text-xs font-bold uppercase tracking-wide text-shop-muted">{t('This CRM')}</p>
                    <Toggle
                      label={t('CRM data')}
                      hint={t('Look up your leads, quotes, reminders and packages')}
                      checked={settings.crm_data}
                      onChange={(on) => onSettingsChange({ ...settings, crm_data: on })}
                    />
                    <Toggle
                      label={t('Trip planner')}
                      hint={t('Ideas for a customer as cards you can add to the lead')}
                      checked={settings.trip_planner}
                      onChange={(on) => onSettingsChange({ ...settings, trip_planner: on })}
                    />

                    <p className="m-0 px-2 pb-1 pt-3 text-xs font-bold uppercase tracking-wide text-shop-muted">{t('Built in')}</p>
                    <Toggle
                      label={t('Web search')}
                      hint={t('Look things up on the internet')}
                      checked={settings.web_search}
                      onChange={(on) => onSettingsChange({ ...settings, web_search: on })}
                    />
                    <Toggle
                      label={t('Image generation')}
                      hint={t(state.media.image ? 'Claude can create pictures (OpenAI)' : 'Needs an OpenAI key')}
                      checked={settings.image_gen}
                      disabled={!state.media.image}
                      onChange={(on) => onSettingsChange({ ...settings, image_gen: on })}
                    />
                    <Toggle
                      label={t('Video generation')}
                      hint={t(state.media.video ? 'Claude can create short clips (OpenAI)' : 'Needs an OpenAI key')}
                      checked={settings.video_gen}
                      disabled={!state.media.video}
                      onChange={(on) => onSettingsChange({ ...settings, video_gen: on })}
                    />

                    <p className="m-0 px-2 pb-1 pt-3 text-xs font-bold uppercase tracking-wide text-shop-muted">{t('Skills')}</p>
                    {state.builtin_skills.map((skill) => (
                      <Toggle
                        key={skill.id}
                        label={t(skill.name)}
                        hint={t(skill.description)}
                        checked={settings.skills.includes(skill.id)}
                        onChange={(on) => onSettingsChange({ ...settings, skills: toggleIn(settings.skills, skill.id, on) })}
                      />
                    ))}
                    {skills.map((skill) => (
                      <Toggle
                        key={skill.id}
                        label={skill.name}
                        hint={skill.available ? skill.description || t('Custom skill') : t('Uploaded with a different Claude key')}
                        checked={settings.addons.includes(skill.id)}
                        disabled={!skill.available}
                        onChange={(on) => onSettingsChange({ ...settings, addons: toggleIn(settings.addons, skill.id, on) })}
                      />
                    ))}

                    {connectors.length > 0 && (
                      <p className="m-0 px-2 pb-1 pt-3 text-xs font-bold uppercase tracking-wide text-shop-muted">{t('Connectors')}</p>
                    )}
                    {connectors.map((connector) => (
                      <Toggle
                        key={connector.id}
                        label={connector.name}
                        hint={connector.url || undefined}
                        checked={settings.addons.includes(connector.id)}
                        onChange={(on) => onSettingsChange({ ...settings, addons: toggleIn(settings.addons, connector.id, on) })}
                      />
                    ))}

                    <button
                      type="button"
                      onClick={() => {
                        setToolsOpen(false)
                        onManageAddons()
                      }}
                      className="mt-2 w-full rounded-lg px-2 py-2 text-start text-[13px] font-semibold text-shop-accent hover:bg-tint"
                    >
                      {t('Add skills, plugins and connectors…')}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {mode === 'image' && (
            <>
              <label className="sr-only" htmlFor="assistant-aspect">{t('Shape')}</label>
              <select id="assistant-aspect" value={aspect} onChange={(event) => setAspect(event.target.value as typeof aspect)} className={selectClass}>
                <option value="landscape">{t('Landscape')}</option>
                <option value="square">{t('Square')}</option>
                <option value="portrait">{t('Portrait')}</option>
              </select>
            </>
          )}

          {mode === 'video' && (
            <>
              <label className="sr-only" htmlFor="assistant-seconds">{t('Length')}</label>
              <select id="assistant-seconds" value={seconds} onChange={(event) => setSeconds(Number(event.target.value) as typeof seconds)} className={selectClass}>
                <option value={4}>{t('{value0} seconds', { value0: 4 })}</option>
                <option value={8}>{t('{value0} seconds', { value0: 8 })}</option>
                <option value={12}>{t('{value0} seconds', { value0: 12 })}</option>
              </select>
              <label className="sr-only" htmlFor="assistant-orientation">{t('Orientation')}</label>
              <select id="assistant-orientation" value={orientation} onChange={(event) => setOrientation(event.target.value as typeof orientation)} className={selectClass}>
                <option value="landscape">{t('Landscape 16:9')}</option>
                <option value="portrait">{t('Portrait 9:16')}</option>
              </select>
            </>
          )}
        </div>

        {mode === 'chat' && attachments.length > 0 && (
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {attachments.map((file, index) => (
              <li key={`${file.name}-${index}`} className="inline-flex items-center gap-1.5 rounded-lg border border-shop-border bg-shop-bg py-1 ps-2.5 pe-1 text-xs font-medium">
                {file.media_type.startsWith('image/') ? (
                  <ImageIcon className="size-3.5 text-shop-muted" aria-hidden="true" />
                ) : (
                  <FileText className="size-3.5 text-shop-muted" aria-hidden="true" />
                )}
                <span className="max-w-[160px] truncate">{file.name}</span>
                <button
                  type="button"
                  aria-label={t('Remove {value0}', { value0: file.name })}
                  onClick={() => onAttachmentsChange(attachments.filter((_, at) => at !== index))}
                  className="grid size-6 place-items-center rounded-md text-neutral-fg hover:bg-neutral-bg"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-end gap-2 rounded-2xl border border-line-strong bg-white p-1.5 focus-within:border-shop-accent">
          {mode === 'chat' && (
            <>
              <input ref={fileRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(event) => void addFiles(event)} />
              <button
                type="button"
                aria-label={t('Attach files')}
                title={t('Attach images, PDFs or text files')}
                disabled={!ready || busy}
                onClick={() => fileRef.current?.click()}
                className="grid size-9 shrink-0 place-items-center rounded-xl text-neutral-fg hover:bg-neutral-bg disabled:opacity-40 max-sm:size-11"
              >
                <Paperclip className="size-4" aria-hidden="true" />
              </button>
            </>
          )}
          <label className="sr-only" htmlFor="assistant-input">{t('Message')}</label>
          <textarea
            id="assistant-input"
            ref={textRef}
            rows={1}
            value={text}
            disabled={!ready}
            onChange={(event) => onTextChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            dir="auto"
            className="max-h-[200px] min-h-9 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-[15px] outline-none placeholder:text-shop-muted focus-visible:outline-none"
          />
          {busy && canStop ? (
            <button
              type="button"
              onClick={onStop}
              aria-label={t('Stop generating')}
              className="grid size-9 shrink-0 place-items-center rounded-xl bg-shop-ink text-white hover:bg-chat-header-light max-sm:size-11"
            >
              <Square className="size-3.5 fill-current" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="submit"
              aria-label={t(mode === 'chat' ? 'Send message' : mode === 'image' ? 'Generate image' : 'Generate video')}
              disabled={busy || !ready || !hasInput}
              className="grid size-9 shrink-0 place-items-center rounded-xl bg-shop-accent text-white hover:bg-primary-800 disabled:bg-neutral-bg disabled:text-slate-400 max-sm:size-11"
            >
              <ArrowUp className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </form>
  )
}
