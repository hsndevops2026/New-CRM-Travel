import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck } from 'lucide-react'
import { locale, t as translate, useI18n } from '../lib/i18n'
import {
  fetchNotifications,
  markNotificationsRead,
  notificationLink,
  notificationText,
  type StaffNotification,
} from '../lib/notifications'

const POLL_MS = 30_000

function timeAgo(value: string) {
  const d = new Date(value)
  const mins = Math.round((Date.now() - d.getTime()) / 60_000)
  if (mins < 1) return translate('now')
  if (mins < 60) return translate('{value0} min', { value0: mins })
  if (mins < 24 * 60) return translate('{value0} h', { value0: Math.round(mins / 60) })
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' })
}

/** Header bell: unread count, a short list, and a link to each item. Checks every 30 seconds while the tab is visible. */
export default function NotificationBell() {
  useI18n()
  const navigate = useNavigate()
  const [items, setItems] = useState<StaffNotification[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)

  const apply = (r: { notifications: StaffNotification[]; unread: number }) => {
    setItems(r.notifications)
    setUnread(r.unread)
  }

  const refresh = useCallback(() => {
    fetchNotifications().then(apply).catch(() => { /* keep the last list; the next poll retries */ })
  }, [])

  useEffect(() => {
    refresh()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const openItem = (n: StaffNotification) => {
    setOpen(false)
    if (!n.read_at) markNotificationsRead({ ids: [n.id] }).then(apply).catch(() => {})
    const link = notificationLink(n)
    if (link) navigate(link)
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={unread ? translate('Notifications, {value0} unread', { value0: unread }) : translate('Notifications')}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative flex size-11 items-center justify-center rounded-lg text-shop-ink hover:bg-neutral-bg"
      >
        <Bell className="size-5" strokeWidth={1.8} />
        {unread > 0 && (
          <span className="absolute end-1.5 top-1.5 grid min-w-[18px] place-items-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white tabular-nums">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={translate('Notifications')}
          className="absolute end-0 top-12 z-50 w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-xl border border-shop-border bg-white shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-shop-border px-3 py-2">
            <strong className="text-sm text-shop-ink">{translate('Notifications')}</strong>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => markNotificationsRead({ all: true }).then(apply).catch(() => {})}
                className="inline-flex items-center gap-1 text-xs font-semibold text-shop-muted hover:text-shop-ink"
              >
                <CheckCheck className="size-4" aria-hidden="true" />
                {translate('Mark all as read')}
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="p-4 text-sm text-shop-muted">{translate('No notifications yet.')}</p>
          ) : (
            <ul className="max-h-[420px] divide-y divide-shop-border overflow-y-auto">
              {items.map((n) => {
                const { title, detail } = notificationText(n)
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openItem(n)}
                      className={`flex w-full gap-2 px-3 py-2.5 text-start hover:bg-neutral-bg ${n.read_at ? '' : 'bg-shop-green-bg/40'}`}
                    >
                      <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read_at ? 'bg-transparent' : 'bg-red-600'}`} />
                      <span className="min-w-0 flex-1">
                        <span dir="auto" className={`block text-sm text-shop-ink ${n.read_at ? '' : 'font-bold'}`}>{title}</span>
                        {detail ? <span dir="auto" className="block truncate text-xs text-shop-muted">{detail}</span> : null}
                      </span>
                      <span className="shrink-0 text-xs text-shop-muted">{timeAgo(n.created_at)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
