import { useEffect, useState } from 'react'
import { CheckCircle2, CircleAlert, FileText, Send, Users } from 'lucide-react'
import EmptyState from '../../components/ui/EmptyState'
import LifecycleBadge from '../../components/ui/LifecycleBadge'
import { Skeleton, TableSkeleton } from '../../components/ui/Skeleton'
import { t as translate, useI18n } from '../../lib/i18n'
import {
  downloadCsv,
  fetchPipelineReport,
  toCsv,
  type PipelineReport,
} from '../../lib/reports'
import { useReportRange } from './ReportRangeContext'
import { Bar, CsvButton, ReportCard, Stat } from './reportUi'
import { money, SOURCE_LABEL, STAGE_LABEL, stampDay } from './reportFormat'

export default function PipelineReportPage() {
  useI18n()
  const { range } = useReportRange()
  const [pipeline, setPipeline] = useState<PipelineReport | null>(null)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rangeKey = range ? `${range.from}:${range.to}` : null
  const ready = Boolean(rangeKey && loadedKey === rangeKey && pipeline)

  useEffect(() => {
    if (!range || !rangeKey) return
    let cancelled = false
    fetchPipelineReport(range)
      .then((p) => {
        if (cancelled) return
        setPipeline(p)
        setLoadedKey(rangeKey)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to build the report')
      })
    return () => { cancelled = true }
  }, [range, rangeKey])

  if (!range) return null

  if (error) {
    return (
      <EmptyState
        tone="danger"
        icon={<CircleAlert />}
        title={translate('Reports could not be loaded')}
        description={translate(error)}
      />
    )
  }

  if (!ready || !pipeline) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="rounded-xl border border-shop-border bg-white p-3.5">
              <Skeleton className="size-10 rounded-[10px]" />
              <Skeleton className="mt-3 h-3 w-1/2" />
              <Skeleton className="mt-2 h-6 w-1/3" />
            </div>
          ))}
        </div>
        <div className="overflow-hidden rounded-xl border border-shop-border bg-white">
          <TableSkeleton rows={5} label={translate('Loading reports')} />
        </div>
      </div>
    )
  }

  if (!pipeline) return null

  const funnelMax = pipeline.funnel[0]?.count || 0
  const sourceMax = Math.max(0, ...pipeline.by_source.map((s) => s.count), 0)

  const exportPipeline = () => {
    const rows: unknown[][] = [
      ...pipeline.funnel.map((f) => [translate(STAGE_LABEL[f.stage]), f.count, f.rate == null ? '' : `${f.rate}%`]),
      [translate('Lost'), pipeline.lost, ''],
      ...pipeline.by_source.map((s) => [`${translate('Source')}: ${translate(SOURCE_LABEL[s.source] || s.source)}`, s.count, '']),
      [translate('Quotes sent'), pipeline.quotes_sent, ''],
      [translate('Quotes accepted'), pipeline.quotes_accepted, ''],
      ...pipeline.accepted_value.map((v) => [`${translate('Accepted value')} (${v.currency})`, v.total, v.count]),
    ]
    downloadCsv(`pipeline-${stampDay()}.csv`, toCsv([translate('Metric'), translate('Count'), translate('Rate')], rows))
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={translate('New leads')} value={pipeline.new_leads} icon={<Users />} tone="teal" />
        <Stat label={translate('Quotes sent')} value={pipeline.quotes_sent} icon={<Send />} tone="sky" />
        <Stat label={translate('Quotes accepted')} value={pipeline.quotes_accepted} icon={<CheckCircle2 />} tone="emerald" />
        <Stat
          label={translate('Accepted value')}
          value={pipeline.accepted_value.length ? pipeline.accepted_value.map((v) => money(v.total, v.currency)).join(' + ') : '—'}
          icon={<FileText />}
          tone="amber"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ReportCard title={translate('Sales pipeline')} actions={<CsvButton onClick={exportPipeline} />}>
          <p className="mb-3 text-xs text-shop-muted">
            {translate('Leads created in this period, by where they are now.')}
          </p>
          <div className="space-y-2.5">
            {pipeline.funnel.map((f) => (
              <Bar
                key={f.stage}
                label={translate(STAGE_LABEL[f.stage])}
                count={f.count}
                max={funnelMax}
                note={f.rate == null || f.stage === 'new' ? undefined : `${f.rate}%`}
              />
            ))}
          </div>
          <p className="mt-3 text-xs text-shop-muted">{translate('Lost: {value0}', { value0: pipeline.lost })}</p>
        </ReportCard>

        <ReportCard title={translate('Where leads come from')}>
          {pipeline.by_source.length ? (
            <div className="space-y-2.5">
              {pipeline.by_source.map((s) => (
                <Bar key={s.source} label={translate(SOURCE_LABEL[s.source] || s.source)} count={s.count} max={sourceMax} />
              ))}
            </div>
          ) : (
            <p className="py-4 text-center text-sm text-shop-muted">{translate('No new leads in this period.')}</p>
          )}
          <div className="mt-4 border-t border-shop-border pt-4">
            <h3 className="mb-2.5 text-[13px] font-bold text-shop-ink">{translate('All open requests now')}</h3>
            <div className="flex flex-wrap gap-2">
              {pipeline.current_pipeline.map((p) => (
                <span
                  key={p.status}
                  className="inline-flex items-center gap-2 rounded-full border border-shop-border bg-[#f8fafb] py-1 pe-2.5 ps-1.5"
                >
                  <LifecycleBadge status={p.status} />
                  <strong className="text-[13px] tabular-nums" dir="ltr">{p.count}</strong>
                </span>
              ))}
            </div>
          </div>
        </ReportCard>
      </div>
    </div>
  )
}
