import { t as translate, useI18n } from '../../lib/i18n'
type TimelineItem = {
  id: string
  title: string
  subtitle?: string
  body?: string
}

type Props = {
  items: TimelineItem[]
  emptyLabel?: string
}

export default function Timeline({ items, emptyLabel = 'No events yet.' }: Props) {
  useI18n()
  if (!items.length) return <p className="text-sm text-shop-muted">{translate(emptyLabel)}</p>

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.id} className="rounded-lg border border-shop-border px-3 py-2 text-sm">
          <div className="font-medium">{translate(item.title)}</div>
          {item.subtitle ? <div className="text-xs text-shop-muted">{item.subtitle}</div> : null}
          {item.body ? <div className="mt-1 text-xs text-shop-muted">{item.body}</div> : null}
        </div>
      ))}
    </div>
  )
}
