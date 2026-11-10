import { useEffect, useState } from 'react'
import Button from './ui/Button'
import StatusBadge from './ui/StatusBadge'
import {
  fetchFailedDeliveries,
  fetchFailedJobs,
  fetchQueueStats,
  retryFailedDelivery,
  retryFailedJob,
  type FailedDelivery,
  type FailedQueueJob,
  type QueueCounts,
} from '../lib/ops'

export default function OpsPanel() {
  const [counts, setCounts] = useState<QueueCounts>({})
  const [failedJobs, setFailedJobs] = useState<FailedQueueJob[]>([])
  const [failedDeliveries, setFailedDeliveries] = useState<FailedDelivery[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [acting, setActing] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [stats, jobs, deliveries] = await Promise.all([
        fetchQueueStats(),
        fetchFailedJobs(30),
        fetchFailedDeliveries(30),
      ])
      setCounts(stats.counts)
      setFailedJobs(jobs)
      setFailedDeliveries(deliveries)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ops data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchQueueStats(), fetchFailedJobs(30), fetchFailedDeliveries(30)])
      .then(([stats, jobs, deliveries]) => {
        if (cancelled) return
        setCounts(stats.counts)
        setFailedJobs(jobs)
        setFailedDeliveries(deliveries)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load ops data')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const retryJob = async (job: FailedQueueJob) => {
    setActing(`job:${job.id}`)
    try {
      await retryFailedJob(job.queue, job.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed')
    } finally {
      setActing(null)
    }
  }

  const retryDelivery = async (delivery: FailedDelivery) => {
    setActing(`delivery:${delivery.id}`)
    try {
      await retryFailedDelivery(delivery.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed')
    } finally {
      setActing(null)
    }
  }

  return (
    <section id="ops" aria-labelledby="s-ops" className="scroll-mt-4 rounded-[10px] border border-shop-border bg-white p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="s-ops" className="text-base font-bold">Operational tools</h2>
          <p className="text-xs text-shop-muted">Failed queue jobs and quote deliveries</p>
        </div>
        <Button size="sm" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-shop-muted">Loading ops data…</p>
      ) : (
        <>
          <div className="mb-4 grid gap-2 sm:grid-cols-2">
            {Object.entries(counts).map(([queue, c]) => (
              <div key={queue} className="rounded-lg bg-shop-bg px-3 py-2 text-sm">
                <div className="font-medium">{queue}</div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-shop-muted">
                  <span>waiting: {c.waiting}</span>
                  <span>active: {c.active}</span>
                  <span className={c.failed > 0 ? 'font-semibold text-red-700' : ''}>
                    failed: {c.failed}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-shop-muted">
            Failed queue jobs ({failedJobs.length})
          </h3>
          {failedJobs.length === 0 ? (
            <p className="mb-4 text-sm text-shop-muted">No failed jobs.</p>
          ) : (
            <div className="mb-4 space-y-2">
              {failedJobs.map((job) => (
                <div
                  key={`${job.queue}:${job.id}`}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-shop-border px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{job.queue}</span>
                      <StatusBadge label={`attempts ${job.attempts_made}`} tone="warning" />
                    </div>
                    <div className="text-xs text-shop-muted">
                      job {job.id}
                      {job.lead_id ? ` · lead ${job.lead_id}` : ''}
                    </div>
                    {job.failed_reason && (
                      <div className="mt-1 truncate text-xs text-red-600">{job.failed_reason}</div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    disabled={acting === `job:${job.id}`}
                    onClick={() => void retryJob(job)}
                  >
                    {acting === `job:${job.id}` ? 'Retrying…' : 'Retry'}
                  </Button>
                </div>
              ))}
            </div>
          )}

          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-shop-muted">
            Failed deliveries ({failedDeliveries.length})
          </h3>
          {failedDeliveries.length === 0 ? (
            <p className="text-sm text-shop-muted">No failed deliveries.</p>
          ) : (
            <div className="space-y-2">
              {failedDeliveries.map((d) => (
                <div
                  key={d.id}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-shop-border px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="capitalize">{d.channel}</span>
                      <span className="font-mono text-xs">{d.recipient}</span>
                    </div>
                    {d.error_message && (
                      <div className="mt-1 truncate text-xs text-red-600">{d.error_message}</div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    disabled={acting === `delivery:${d.id}`}
                    onClick={() => void retryDelivery(d)}
                  >
                    {acting === `delivery:${d.id}` ? 'Retrying…' : 'Retry'}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
