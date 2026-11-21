import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import PageHeader from '../../components/ui/PageHeader'
import SegmentedControl from '../../components/ui/SegmentedControl'
import { useAuth } from '../../context/AuthContext'
import { REPORT_SECTIONS, reportSectionFromPath } from '../../lib/reportSections'
import { t as translate, useI18n } from '../../lib/i18n'
import type { Preset } from '../../lib/reports'
import { ReportRangeProvider, useReportRange } from './ReportRangeContext'

function RangeToolbar() {
  useI18n()
  const { preset, setPreset, customFrom, setCustomFrom, customTo, setCustomTo, range } = useReportRange()
  const presets = [
    { id: 'today', label: translate('Today') },
    { id: '7d', label: translate('7 days') },
    { id: '30d', label: translate('30 days') },
    { id: 'month', label: translate('This month') },
    { id: 'custom', label: translate('Custom') },
  ]
  const dateField = 'h-9 rounded-lg border border-line-strong bg-white px-2.5 text-sm tabular-nums max-sm:h-11'

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-3 rounded-xl border border-shop-border bg-white p-3 shadow-[var(--shadow-card)] sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-4">
        <SegmentedControl
          items={presets}
          value={preset}
          onChange={(id) => setPreset(id as Preset)}
          ariaLabel={translate('Date range')}
        />
        {preset === 'custom' && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              aria-label={translate('From')}
              className={dateField}
            />
            <span className="text-shop-muted">{translate('to')}</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              aria-label={translate('To')}
              className={dateField}
            />
          </div>
        )}
      </div>
      {preset === 'custom' && !range ? (
        <p className="rounded-lg border border-dashed border-shop-border bg-white px-4 py-3 text-sm text-shop-muted">
          {translate('Choose a start and end date.')}
        </p>
      ) : null}
    </div>
  )
}

function ReportsShell() {
  useI18n()
  const { admin } = useAuth()
  const location = useLocation()
  const section = reportSectionFromPath(location.pathname)

  if (admin?.role !== 'admin') return <Navigate to="/leads/hotel" replace />

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col p-4 pb-24 sm:p-6">
      <PageHeader
        title={translate('Reports')}
        subtitle={translate('Sales, team performance and what needs attention.')}
      />

      <div className="flex flex-wrap items-start gap-6">
        <nav
          aria-label={translate('Reports sections')}
          className="flex flex-[0_1_220px] flex-col gap-0.5 max-xl:w-full max-xl:flex-none max-xl:flex-row max-xl:overflow-x-auto max-xl:pb-1 xl:sticky xl:top-4 xl:rounded-xl xl:border xl:border-shop-border xl:bg-white xl:p-2 xl:shadow-[var(--shadow-card)]"
        >
          {REPORT_SECTIONS.map((item) => {
            const Icon = item.icon
            const on = section.id === item.id
            return (
              <Link
                key={item.id}
                to={item.to}
                aria-current={on ? 'page' : undefined}
                className={`flex h-9 shrink-0 items-center gap-2.5 rounded-lg px-3 text-sm font-semibold whitespace-nowrap transition-colors max-sm:h-11 max-xl:border max-xl:bg-white ${
                  on
                    ? 'bg-tint text-primary-800 max-xl:border-shop-accent max-xl:bg-tint'
                    : 'text-neutral-fg hover:bg-shop-bg max-xl:border-shop-border'
                }`}
              >
                <Icon className={`size-4 shrink-0 ${on ? 'text-shop-accent' : 'text-shop-muted'}`} strokeWidth={1.8} aria-hidden="true" />
                {translate(item.label)}
              </Link>
            )
          })}
        </nav>

        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
          <div className="rounded-xl border border-shop-border bg-white px-4 py-3.5 shadow-[var(--shadow-card)]">
            <h1 className="text-lg font-extrabold tracking-[-0.02em] text-shop-ink">{translate(section.label)}</h1>
            <p className="mt-0.5 text-sm text-shop-muted">{translate(section.description)}</p>
          </div>

          {section.usesRange ? <RangeToolbar /> : null}
          <Outlet />
        </div>
      </div>
    </div>
  )
}

export default function ReportsLayout() {
  return (
    <ReportRangeProvider>
      <ReportsShell />
    </ReportRangeProvider>
  )
}
