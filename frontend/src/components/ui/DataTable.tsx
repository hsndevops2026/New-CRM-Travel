import type { KeyboardEvent, ReactNode } from 'react'

type Column<T> = {
  key: string
  header: string
  className?: string
  render: (row: T) => ReactNode
}

type Props<T> = {
  columns: Array<Column<T>>
  rows: T[]
  rowKey: (row: T) => string
  emptyLabel?: string
  onRowClick?: (row: T) => void
}

export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyLabel = 'No rows',
  onRowClick,
}: Props<T>) {
  if (!rows.length) {
    return <p className="px-4 py-16 text-center text-sm text-shop-muted">{emptyLabel}</p>
  }

  const activate = (row: T) => onRowClick?.(row)
  const isInteractive = (target: EventTarget | null) => target instanceof Element
    && Boolean(target.closest('button, a, input, select, textarea, [role="menuitem"]'))
  const onKey = (event: KeyboardEvent<HTMLTableRowElement>, row: T) => {
    if (!onRowClick) return
    if (isInteractive(event.target)) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activate(row)
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="border-b border-shop-border bg-shop-bg text-xs font-semibold text-slate-600">
            {columns.map((col) => (
              <th key={col.key} className={`whitespace-nowrap px-3 py-2.5 ${col.className || ''}`}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={`border-b border-neutral-bg last:border-0 hover:bg-shop-bg ${
                onRowClick ? 'cursor-pointer focus-visible:bg-shop-bg' : ''
              }`}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? (event) => { if (!isInteractive(event.target)) activate(row) } : undefined}
              onKeyDown={onRowClick ? (event) => onKey(event, row) : undefined}
            >
              {columns.map((col) => (
                <td key={col.key} className={`px-3 py-3 ${col.className || ''}`}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
