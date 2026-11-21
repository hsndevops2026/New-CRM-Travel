import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Download } from 'lucide-react'
import Button from '../../components/ui/Button'
import { formatPhone } from '../../lib/leads'
import { t as translate, useI18n } from '../../lib/i18n'

export function ReportCard({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  useI18n()
  return (
    <section className="overflow-hidden rounded-xl border border-shop-border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-shop-border bg-[#f8fafc] px-4 py-3">
        <h2 className="text-[15px] font-bold text-shop-ink">{title}</h2>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

export function Stat({
  label,
  value,
  hint,
  icon,
  tone = 'teal',
}: {
  label: string
  value: ReactNode
  hint?: string
  icon: ReactNode
  tone?: 'teal' | 'sky' | 'amber' | 'emerald'
}) {
  const tile = {
    teal: 'bg-tint text-shop-accent',
    sky: 'bg-info-bg text-info-fg',
    amber: 'bg-warn-bg text-warn-fg',
    emerald: 'bg-shop-green-bg text-primary-800',
  }[tone]
  return (
    <div className="flex gap-3 rounded-xl border border-shop-border bg-white p-3.5 shadow-[var(--shadow-card)]">
      <span aria-hidden="true" className={`grid size-10 shrink-0 place-items-center rounded-[10px] [&_svg]:size-[18px] ${tile}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[12px] font-semibold text-shop-muted">{label}</div>
        <div className="mt-0.5 truncate text-xl font-extrabold tracking-[-0.02em] tabular-nums text-shop-ink" dir="ltr">
          {value}
        </div>
        {hint ? <div className="mt-0.5 text-xs text-shop-muted">{hint}</div> : null}
      </div>
    </div>
  )
}

export function Bar({ label, count, max, note }: { label: string; count: number; max: number; note?: string }) {
  const width = max > 0 ? Math.max(4, Math.round((count / max) * 100)) : 0
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-[7.5rem] shrink-0 text-[13px] font-medium text-slate-600">{label}</span>
      <div className="h-7 flex-1 overflow-hidden rounded-lg bg-neutral-bg">
        <div
          className="h-full rounded-lg bg-gradient-to-r from-primary-700 to-primary-500 transition-[width] duration-300"
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="w-[4.5rem] shrink-0 text-end text-[13px] font-bold tabular-nums" dir="ltr">
        {count}
        {note ? <span className="ms-1 text-[11px] font-semibold text-shop-muted">{note}</span> : null}
      </span>
    </div>
  )
}

export function CsvButton({ onClick }: { onClick: () => void }) {
  useI18n()
  return (
    <Button size="sm" variant="ghost" icon={<Download />} onClick={onClick}>
      {translate('Export CSV')}
    </Button>
  )
}

export function LeadLink({ id, name, phone }: { id: string; name: string; phone: string }) {
  return (
    <Link to={`/leads/${id}`} className="font-semibold text-shop-ink underline-offset-2 hover:text-shop-accent hover:underline">
      {name || <span dir="ltr">{formatPhone(phone)}</span>}
    </Link>
  )
}

export function ReportTable({ headers, rows, empty }: { headers: string[]; rows: ReactNode[][]; empty: string }) {
  if (!rows.length) {
    return <p className="px-1 py-6 text-center text-sm text-shop-muted">{empty}</p>
  }
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0 sm:rounded-lg sm:border sm:border-shop-border">
      <table className="min-w-full text-start text-sm">
        <thead>
          <tr className="border-b border-shop-border bg-[#f8fafc] text-[11px] font-semibold tracking-[0.06em] text-slate-500 uppercase">
            {headers.map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2.5 text-start">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-[#eef1f5] transition-colors last:border-0 hover:bg-[#f7fafb]">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-3 align-top">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function AttentionCount({ label, count, tone }: { label: string; count: number; tone: 'danger' | 'warn' | 'neutral' }) {
  const styles = {
    danger: 'border-danger/30 bg-danger-bg text-danger-fg',
    warn: 'border-amber-200 bg-warn-bg text-warn-fg',
    neutral: 'border-shop-border bg-neutral-bg text-neutral-fg',
  }[tone]
  return (
    <div className={`flex min-w-[9rem] flex-1 flex-col gap-0.5 rounded-[10px] border px-3 py-2.5 ${styles}`}>
      <span className="text-[11px] font-semibold tracking-wide uppercase opacity-80">{label}</span>
      <strong className="text-xl font-extrabold tabular-nums" dir="ltr">{count}</strong>
    </div>
  )
}
