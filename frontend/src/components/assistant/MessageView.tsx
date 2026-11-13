import { useState } from 'react'
import { ChevronRight, Database, Download, FileText, Globe, Image as ImageIcon, Sparkles, Video, Wrench } from 'lucide-react'
import { useToast } from '../../hooks/useToast'
import {
  downloadOutputFile,
  formatBytes,
  messageParts,
  type Media,
  type OutputFile,
  type AssistantMessage,
  type ViewPart,
} from '../../lib/assistant'
import { t, useI18n } from '../../lib/i18n'
import Markdown from './Markdown'
import MediaCard from './MediaCard'
import SuggestionCards from './SuggestionCards'

type Props = {
  message: AssistantMessage
  conversationId: string
  mediaById: Record<string, Media>
  onMediaUpdate: (media: Media) => void
}

function Step({ part }: { part: Extract<ViewPart, { kind: 'step' }> }) {
  const Icon = part.label.includes('web') || part.label.includes('page') ? Globe : part.label.includes('lead') || part.label.includes('ackage') || part.label.includes('pipeline') || part.label.includes('reminder') || part.label.includes('quote') ? Database : Wrench
  return (
    <div className="flex items-start gap-1.5 text-[13px] text-shop-muted">
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">
        <span className="font-semibold text-neutral-fg">{t(part.label)}</span>
        {part.detail ? <span className="line-clamp-1 break-all"> · {part.detail}</span> : null}
      </span>
    </div>
  )
}

function Sources({ items }: { items: { title: string; url: string }[] }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
      {items.slice(0, 6).map((item) => (
        <li key={item.url}>
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex max-w-[220px] items-center gap-1 rounded-full border border-shop-border bg-white px-2.5 py-1 text-xs font-medium text-neutral-fg no-underline hover:bg-neutral-bg"
          >
            <Globe className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{item.title}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}

function FileButton({ file, conversationId }: { file: OutputFile; conversationId: string }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const download = () => {
    setBusy(true)
    downloadOutputFile(conversationId, file)
      .catch((error: unknown) => {
        toast.show({ message: error instanceof Error ? error.message : t('Download failed'), tone: 'error' })
      })
      .finally(() => setBusy(false))
  }
  return (
    <button
      type="button"
      onClick={download}
      disabled={busy}
      className="flex max-w-xs items-center gap-2.5 rounded-[10px] border border-shop-border bg-white px-3 py-2 text-start hover:bg-neutral-bg disabled:opacity-60"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-tint text-shop-accent">
        <FileText className="size-4" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <strong className="truncate text-[13px]">{file.filename}</strong>
        <span className="text-xs text-shop-muted">
          {busy ? t('Downloading…') : [t('Download'), formatBytes(file.size_bytes)].filter(Boolean).join(' · ')}
        </span>
      </span>
      <Download className="ms-auto size-4 shrink-0 text-neutral-fg" aria-hidden="true" />
    </button>
  )
}

export default function MessageView({ message, conversationId, mediaById, onMediaUpdate }: Props) {
  useI18n()
  const parts = messageParts(message)
  const media = (message.meta.media || []).map((id) => mediaById[id]).filter(Boolean)
  const files = message.meta.files || []

  if (message.role === 'user') {
    const ModeIcon = message.meta.mode === 'video' ? Video : ImageIcon
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[85%] flex-col items-end gap-1.5">
          {message.meta.mode && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-shop-muted">
              <ModeIcon className="size-3.5" aria-hidden="true" />
              {t(message.meta.mode === 'video' ? 'Video request' : 'Image request')}
            </span>
          )}
          {parts.some((part) => part.kind === 'image' || part.kind === 'document') && (
            <div className="flex flex-wrap justify-end gap-1.5">
              {parts.map((part, index) =>
                part.kind === 'image' ? (
                  <img key={index} src={part.src} alt={t('Attached')} className="size-20 rounded-lg border border-shop-border object-cover" />
                ) : part.kind === 'document' ? (
                  <span key={index} className="inline-flex items-center gap-1.5 rounded-lg border border-shop-border bg-white px-2.5 py-1.5 text-xs font-medium">
                    <FileText className="size-3.5 text-shop-muted" aria-hidden="true" />
                    <span className="max-w-[180px] truncate">{part.name === 'Document' ? t('Document') : part.name}</span>
                  </span>
                ) : null,
              )}
            </div>
          )}
          {parts.map((part, index) =>
            part.kind === 'text' ? (
              <div key={index} dir="auto" className="whitespace-pre-wrap break-words rounded-2xl rounded-ee-md bg-chat-outbound px-3.5 py-2 text-[15px]">
                {part.text}
              </div>
            ) : null,
          )}
        </div>
      </div>
    )
  }

  const suggestions = message.meta.suggestions || []
  if (!parts.length && !media.length && !files.length && !suggestions.length) return null

  return (
    <div className="flex gap-3">
      <span aria-hidden="true" className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-tint text-shop-accent">
        <Sparkles className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        {parts.map((part, index) => {
          if (part.kind === 'text') return <Markdown key={index} text={part.text} />
          if (part.kind === 'step') return <Step key={index} part={part} />
          if (part.kind === 'sources') return <Sources key={index} items={part.items} />
          if (part.kind === 'thinking') {
            return (
              <details key={index} className="group text-[13px] text-shop-muted">
                <summary className="flex w-fit list-none items-center gap-1 font-semibold [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden="true" />
                  {t('Thought process')}
                </summary>
                <div className="mt-1.5 whitespace-pre-wrap border-s-2 border-shop-border ps-3">{part.text}</div>
              </details>
            )
          }
          return null
        })}
        {suggestions.length > 0 && <SuggestionCards cards={suggestions} lead={message.meta.lead} />}
        {media.map((item) => (
          <MediaCard key={item.id} media={item} onUpdate={onMediaUpdate} />
        ))}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {files.map((file) => (
              <FileButton key={file.file_id} file={file} conversationId={conversationId} />
            ))}
          </div>
        )}
        {message.meta.truncated && (
          <p className="m-0 text-xs text-warn-fg">{t('This reply reached the length limit. Ask Claude to continue.')}</p>
        )}
      </div>
    </div>
  )
}
