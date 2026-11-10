import { t as translate, useI18n } from '../../lib/i18n'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'

export type OverflowItem = {
  id: string
  label: string
  onClick: () => void
  tone?: 'default' | 'danger'
  disabled?: boolean
}

type Props = {
  items: OverflowItem[]
  label?: string
  align?: 'left' | 'right'
  trigger?: ReactNode
  /** Render outside clipped table/card containers and position against the trigger. */
  portal?: boolean
}

export default function OverflowMenu({ items, label = 'More actions', align = 'right', trigger, portal = false }: Props) {
  useI18n()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const visible = items.filter(Boolean)

  const updatePosition = useCallback(() => {
    if (!portal || !open || !rootRef.current) return
    const triggerRect = rootRef.current.getBoundingClientRect()
    const menuRect = menuRef.current?.getBoundingClientRect()
    const menuWidth = menuRect?.width || 176
    const menuHeight = menuRect?.height || visible.length * 40 + 8
    const gutter = 8
    const gap = 4

    let top = triggerRect.bottom + gap
    if (top + menuHeight > window.innerHeight - gutter && triggerRect.top - menuHeight - gap >= gutter) {
      top = triggerRect.top - menuHeight - gap
    }

    let left = align === 'left' ? triggerRect.left : triggerRect.right - menuWidth
    left = Math.max(gutter, Math.min(left, window.innerWidth - menuWidth - gutter))
    setPosition({ top, left })
  }, [align, open, portal, visible.length])

  useLayoutEffect(() => {
    if (!open || !portal) return
    updatePosition()
  }, [open, portal, updatePosition])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node) || menuRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    if (portal) {
      window.addEventListener('resize', updatePosition)
      window.addEventListener('scroll', updatePosition, true)
    }
    return () => {
      window.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, portal, updatePosition])

  if (!visible.length) return null

  const menu = open ? (
    <div
      ref={menuRef}
      role="menu"
      style={portal ? (position ? { top: position.top, left: position.left } : { top: 0, left: 0, visibility: 'hidden' }) : undefined}
      className={`${portal ? 'fixed z-[120]' : 'absolute z-20 mt-1'} min-w-44 rounded-lg border border-shop-border bg-white p-1 shadow-lg ${
        portal ? '' : align === 'left' ? 'start-0' : 'end-0'
      }`}
    >
      {visible.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          className={`w-full rounded-md px-3 py-2 text-start text-sm font-medium disabled:opacity-50 max-sm:py-3 ${
            item.tone === 'danger'
              ? 'text-danger hover:bg-danger-bg'
              : 'text-shop-ink hover:bg-neutral-bg'
          }`}
          onClick={(event) => {
            event.stopPropagation()
            setOpen(false)
            item.onClick()
          }}
        >
          {translate(item.label)}
        </button>
      ))}
    </div>
  ) : null

  return (
    <div className="relative" ref={rootRef}>
      {trigger ? (
        <div onClick={() => setOpen((value) => !value)}>{trigger}</div>
      ) : (
        <button
          type="button"
          aria-label={translate(label)}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(event) => {
            event.stopPropagation()
            setOpen((value) => !value)
          }}
          className="flex size-9 items-center justify-center rounded-lg text-neutral-fg hover:bg-neutral-bg max-sm:size-11"
        >
          <MoreHorizontal className="size-4" />
        </button>
      )}
      {portal && menu ? createPortal(menu, document.body) : menu}
    </div>
  )
}
