import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlarmClock, CalendarClock, CircleCheck, Clock, ListChecks, Plus, Trash2, UserRound, Briefcase, type LucideIcon } from 'lucide-react'
import Button from '../components/ui/Button'
import NewTaskForm from '../components/tasks/NewTaskForm'
import EmptyState from '../components/ui/EmptyState'
import PageHeader from '../components/ui/PageHeader'
import SegmentedControl from '../components/ui/SegmentedControl'
import { useAuth } from '../context/AuthContext'
import { useConfirm } from '../hooks/useConfirm'
import { nameFromEmail } from '../lib/people'
import { locale, t as translate, useI18n } from '../lib/i18n'
import {
  TASK_GROUP_ORDER,
  deleteTask,
  fetchAssignees,
  fetchTasks,
  taskField,
  taskGroup,
  updateTask,
  type Assignee,
  type StaffTask,
  type TaskGroup,
} from '../lib/tasks'

const GROUP_TITLES: Record<TaskGroup, string> = {
  overdue: 'Overdue',
  today: 'Today',
  upcoming: 'Upcoming',
  no_date: 'No deadline',
  done: 'Done',
}

const GROUP_LOOK: Record<TaskGroup, { icon: LucideIcon; dot: string; text: string; chip: string }> = {
  overdue: { icon: AlarmClock, dot: 'bg-rose-500', text: 'text-rose-700', chip: 'bg-rose-50 text-rose-700 border-rose-200' },
  today: { icon: Clock, dot: 'bg-amber-500', text: 'text-amber-800', chip: 'bg-amber-50 text-amber-800 border-amber-200' },
  upcoming: { icon: CalendarClock, dot: 'bg-teal-500', text: 'text-teal-800', chip: 'bg-[#f8fafb] text-slate-700 border-shop-border' },
  no_date: { icon: ListChecks, dot: 'bg-slate-400', text: 'text-slate-600', chip: 'bg-[#f8fafb] text-slate-700 border-shop-border' },
  done: { icon: CircleCheck, dot: 'bg-emerald-500', text: 'text-emerald-800', chip: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
}

const field = taskField

function formatDue(value: string) {
  return new Date(value).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function TasksPage() {
  useI18n()
  const { admin } = useAuth()
  const isAdmin = admin?.role === 'admin'
  const { confirm, dialog } = useConfirm()
  const [tasks, setTasks] = useState<StaffTask[]>([])
  const [assignees, setAssignees] = useState<Assignee[]>([])
  const [showDone, setShowDone] = useState(false)
  const [filter, setFilter] = useState('')
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => fetchTasks({ status: showDone ? 'all' : 'open', assignee: filter || undefined })
    .then((next) => { setTasks(next); setError(null) })
    .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load tasks'))
    .finally(() => setLoading(false)), [showDone, filter])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (isAdmin) fetchAssignees().then(setAssignees).catch(() => {})
  }, [isAdmin])

  const groups = useMemo(() => {
    const now = new Date()
    const map = new Map<TaskGroup, StaffTask[]>()
    for (const task of tasks) {
      const g = taskGroup(task, now)
      map.set(g, [...(map.get(g) || []), task])
    }
    return TASK_GROUP_ORDER.filter((g) => map.has(g)).map((g) => [g, map.get(g)!] as const)
  }, [tasks])

  const toggle = async (task: StaffTask) => {
    setBusy(task.id)
    try {
      const updated = await updateTask(task.id, { status: task.status === 'done' ? 'open' : 'done' })
      // Stays on the list, crossed out, so it never looks deleted; it can be ticked back.
      // It leaves the list on the next load unless "Show done tasks" is on.
      setTasks((list) => list.map((t) => (t.id === task.id ? updated : t)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the task')
    } finally {
      setBusy(null)
    }
  }

  const remove = async (task: StaffTask) => {
    if (!(await confirm({ title: translate('Delete this task?'), description: task.title, confirmLabel: translate('Delete'), tone: 'danger' }))) return
    setBusy(task.id)
    try {
      await deleteTask(task.id)
      setTasks((list) => list.filter((t) => t.id !== task.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the task')
    } finally {
      setBusy(null)
    }
  }

  const openCount = tasks.filter((t) => t.status === 'open').length
  const counts = useMemo(() => Object.fromEntries(groups.map(([g, list]) => [g, list.length])) as Partial<Record<TaskGroup, number>>, [groups])

  return (
    <div className="mx-auto w-full max-w-[900px] p-4 pb-24 sm:p-6">
      {dialog}
      <PageHeader
        title="Tasks"
        subtitle={translate('{value0} open', { value0: openCount })}
        actions={!adding && <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setAdding(true)}>{translate('New task')}</Button>}
      />
      {adding && (
        <div className="mb-4"><NewTaskForm
          assignees={assignees}
          isAdmin={isAdmin}
          onCancel={() => setAdding(false)}
          onCreated={(task) => { setAdding(false); setTasks((list) => [task, ...list]) }}
        /></div>
      )}
      {!loading && tasks.length > 0 && (
        <ul className="mb-4 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-4">
          {(['overdue', 'today', 'upcoming', 'no_date'] as TaskGroup[]).map((g) => {
            const count = counts[g] || 0
            const look = GROUP_LOOK[g]
            const Icon = look.icon
            return (
              <li key={g}>
                <a
                  href={count ? `#tasks-${g}` : undefined}
                  className={`flex items-center gap-3 rounded-xl border bg-white px-3.5 py-3 shadow-[var(--shadow-card)] ${count ? 'border-shop-border hover:border-line-strong' : 'border-shop-border opacity-60'}`}
                >
                  <span aria-hidden="true" className={`grid size-9 shrink-0 place-items-center rounded-[10px] border ${look.chip}`}>
                    <Icon className="size-[18px]" strokeWidth={1.8} />
                  </span>
                  <span className="flex flex-col leading-tight">
                    <span className={`text-xl font-extrabold tabular-nums ${count && g === 'overdue' ? 'text-rose-700' : ''}`}>{count}</span>
                    <span className="text-xs font-semibold text-shop-muted">{translate(GROUP_TITLES[g])}</span>
                  </span>
                </a>
              </li>
            )
          })}
        </ul>
      )}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm">
        <SegmentedControl
          ariaLabel="Which tasks"
          value={showDone ? 'all' : 'open'}
          onChange={(id) => setShowDone(id === 'all')}
          items={[
            { id: 'open', label: 'Open' },
            { id: 'all', label: 'Include done' },
          ]}
        />
        {isAdmin && (
          <label className="flex items-center gap-2 text-shop-muted">
            <UserRound className="size-4" aria-hidden="true" />
            <select aria-label={translate('Employee')} value={filter} onChange={(e) => setFilter(e.target.value)} className={`${field} min-w-[200px]`}>
              <option value="">{translate('Everyone')}</option>
              {assignees.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
            </select>
          </label>
        )}
      </div>
      {error && <p className="mb-3 text-sm text-danger-fg">{translate(error)}</p>}
      {loading ? (
        <p className="text-sm text-shop-muted">{translate('Loading…')}</p>
      ) : !tasks.length ? (
        <section className="rounded-[10px] border border-shop-border bg-white">
          <EmptyState
            icon={<ListChecks />}
            title={translate('No tasks')}
            description={translate(isAdmin ? 'Give a task to someone on the team with a deadline.' : 'Tasks your manager gives you show up here.')}
            action={isAdmin ? (
              <Button variant="primary" icon={<Plus />} onClick={() => setAdding(true)}>
                {translate('New task')}
              </Button>
            ) : undefined}
          />
        </section>
      ) : (
        <div className="grid gap-4">
          {groups.map(([group, list]) => (
            <section key={group} id={`tasks-${group}`} className="scroll-mt-4 overflow-hidden rounded-xl border border-shop-border bg-white">
              <h2 className={`flex items-center gap-2 border-b border-shop-border bg-[#f8fafc] px-4 py-2.5 text-[13px] font-bold ${GROUP_LOOK[group].text}`}>
                <span aria-hidden="true" className={`size-2 rounded-full ${GROUP_LOOK[group].dot}`} />
                {translate(GROUP_TITLES[group])}
                <span className="rounded-full bg-white px-2 text-xs font-semibold text-shop-muted tabular-nums shadow-[var(--shadow-card)]">{list.length}</span>
              </h2>
              <ul className="divide-y divide-[#eef1f5]">
                {list.map((task) => {
                  const canDelete = isAdmin || (task.created_by === admin?.id && task.assigned_to === admin?.id)
                  const done = task.status === 'done'
                  return (
                    <li key={task.id} className="group flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-[#f7fafb]">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-[18px] shrink-0 rounded-full"
                        checked={done}
                        disabled={busy === task.id}
                        aria-label={translate(done ? 'Mark as not done' : 'Mark as done')}
                        onChange={() => void toggle(task)}
                      />
                      <div className="min-w-0 flex-1">
                        <p dir="auto" className={`text-[14px] font-semibold ${done ? 'text-shop-muted line-through' : 'text-shop-ink'}`}>{task.title}</p>
                        {task.notes && <p dir="auto" className="mt-0.5 whitespace-pre-line text-xs text-shop-muted">{task.notes}</p>}
                        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-shop-muted">
                          {task.due_at && (
                            <span className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 font-semibold tabular-nums ${GROUP_LOOK[group].chip}`}>
                              <Clock className="size-3" aria-hidden="true" />
                              {formatDue(task.due_at)}
                            </span>
                          )}
                          {isAdmin && (
                            <span className="inline-flex h-6 items-center gap-1 rounded-full border border-shop-border bg-white px-2" title={task.assigned_to_email}>
                              <UserRound className="size-3" aria-hidden="true" />
                              {translate('For {value0}', { value0: nameFromEmail(task.assigned_to_email) })}
                            </span>
                          )}
                          {task.created_by && task.created_by !== task.assigned_to && task.created_by_email && !isAdmin && (
                            <span>{translate('From {value0}', { value0: task.created_by_email })}</span>
                          )}
                          {task.lead_id && (
                            <Link to={`/leads/${task.lead_id}`} className="inline-flex h-6 items-center gap-1 rounded-full border border-teal-200 bg-tint px-2 font-semibold text-primary-800 hover:border-shop-accent">
                              <Briefcase className="size-3" aria-hidden="true" />
                              {[task.customer_name, task.lead_destination].filter(Boolean).join(' · ') || translate('Open lead')}
                            </Link>
                          )}
                          {done && task.done_by_email && <span>{translate('Done by {value0}', { value0: task.done_by_email })}</span>}
                        </p>
                      </div>
                      {canDelete && (
                        <button
                          type="button"
                          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-shop-muted transition-opacity hover:bg-danger-bg hover:text-danger-fg focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                          aria-label={translate('Delete {value0}', { value0: task.title })}
                          disabled={busy === task.id}
                          onClick={() => void remove(task)}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
