import { useEffect } from 'react'
import { CircleAlert, Download, LoaderCircle } from 'lucide-react'
import { apiUrl } from '../../lib/api'
import { fetchMedia, type Media } from '../../lib/assistant'
import { t, useI18n } from '../../lib/i18n'

type Props = {
  media: Media
  /** Called when a rendering video finishes or fails. Must be stable between renders. */
  onUpdate: (media: Media) => void
}

const POLL_MS = 5000

/** A generated image or video. A video that is still rendering checks back until it is ready. */
export default function MediaCard({ media, onUpdate }: Props) {
  useI18n()
  useEffect(() => {
    if (media.status !== 'pending') return
    let cancelled = false
    const timer = window.setInterval(() => {
      fetchMedia(media.id)
        .then((next) => {
          if (!cancelled && next.status !== 'pending') onUpdate(next)
        })
        .catch(() => undefined)
    }, POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [media.id, media.status, onUpdate])

  if (media.status === 'failed') {
    return (
      <div role="alert" className="flex max-w-md items-start gap-2 rounded-[10px] bg-danger-bg p-3 text-sm text-danger-fg">
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          <strong>{t(media.kind === 'video' ? 'The video could not be generated.' : 'The image could not be generated.')}</strong>{' '}
          <span dir="auto">{media.error}</span>
        </span>
      </div>
    )
  }

  if (media.status === 'pending' || !media.url) {
    return (
      <div
        role="status"
        className="flex aspect-video w-full max-w-md flex-col items-center justify-center gap-2 rounded-xl border border-shop-border bg-neutral-bg text-sm text-shop-muted"
      >
        <LoaderCircle className="size-5 motion-safe:animate-spin" aria-hidden="true" />
        <span>{t(media.kind === 'video' ? 'Rendering video — this takes a few minutes' : 'Generating image…')}</span>
      </div>
    )
  }

  // Files kept in the database are served by the API, which may live on another host.
  const src = media.url.startsWith('/') ? apiUrl(media.url) : media.url

  return (
    <figure className="m-0 flex w-full max-w-md flex-col gap-1.5">
      {media.kind === 'video' ? (
        <video src={src} controls preload="metadata" className="w-full rounded-xl border border-shop-border bg-black" />
      ) : (
        <a href={src} target="_blank" rel="noopener noreferrer" aria-label={t('Open image in a new tab')}>
          <img src={src} alt={media.prompt} loading="lazy" className="w-full rounded-xl border border-shop-border" />
        </a>
      )}
      <figcaption className="flex items-start justify-between gap-3 text-xs text-shop-muted">
        <span className="line-clamp-2" dir="auto">{media.prompt}</span>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          download
          className="inline-flex shrink-0 items-center gap-1 font-semibold text-shop-accent"
        >
          <Download className="size-3.5" aria-hidden="true" />
          {t('Open')}
        </a>
      </figcaption>
    </figure>
  )
}
