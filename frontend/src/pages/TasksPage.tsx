import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ListChecks, Plus, Trash2 } from 'lucide-react'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import PageHeader from '../components/ui/PageHeader'
import { useAuth } from '../context/AuthContext'
import { useConfirm } from '../hooks/useConfirm'
import { locale, t as translate, useI18n } from '../lib/i18n'
import {
  TASK_GROUP_ORDER,
  createTask,
  deleteTask,
  fetchAssignees,
  fetchTasks,
  localInputToIso,
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

const field = 'h-10 rounded-lg border border-shop-border bg-white px-3 text-sm outline-none focus:border-primary-500'

function formatDue(value: string) {
  return new Date(value).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function NewTaskForm({ assignees, isAdmin, onCreated, onCancel }: {
  assignees: Assignee[]
  isAdmin: boolean
  onCreated: (task: StaffTask) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [assignee, setAssignee] = useState('')
  const [due, setDue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    setError(null)
    try {
      onCreated(await createTask({
        title,
        notes: notes || null,
        assigned_to: assignee || undefined,
        due_at: localInputToIso(due),
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the task')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="mb-4 grid gap-3 rounded-[10px] border border-shop-border bg-white p-4">
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={translate('What needs doing?')} className={field} dir="auto" />
      <div className="grid gap-3 sm:grid-cols-2">
        {isAdmin && (
          <label className="grid gap-1 text-xs font-semibold text-shop-muted">
            {translate('Assign to')}
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={field}>
              <option value="">{translate('Me')}</option>
              {assignees.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
            </select>
          </label>
        )}
        <label className="grid gap-1 text-xs font-semibold text-shop-muted">
          {translate('Deadline')}
          <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className={field} />
        </label>
      </div>
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder={translate('Notes (optional)')} className="rounded-lg border border-shop-border px-3 py-2 text-sm outline-none focus:border-primary-500" dir="auto" />
      {error && <p className="text-sm text-danger-fg">{translate(error)}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" loading={saving} disabled={!title.trim()}>{translate('Save task')}</Button>
        <Button type="button" size="sm" onClick={onCancel}>{translate('Cancel')}</Button>
      </div>
    </form>
  )
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
      setTasks((list) => (showDone ? list.map((t) => (t.id === task.id ? updated : t)) : list.filter((t) => t.id !== task.id || updated.status === 'open')))
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

  return (
    <div className="mx-auto w-full max-w-[900px] p-4 pb-24 sm:p-6">
      {dialog}
      <PageHeader
        title="Tasks"
        subtitle={translate('{value0} open', { value0: openCount })}
        actions={!adding && <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setAdding(true)}>{translate('New task')}</Button>}
      />
      {adding && (
        <NewTaskForm
          assignees={assignees}
          isAdmin={isAdmin}
          onCancel={() => setAdding(false)}
          onCreated={(task) => { setAdding(false); setTasks((list) => [task, ...list]) }}
        />
      )}
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        {isAdmin && (
          <select aria-label={translate('Employee')} value={filter} onChange={(e) => setFilter(e.target.value)} className={field}>
            <option value="">{translate('Everyone')}</option>
            {assignees.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
          </select>
        )}
        <label className="inline-flex items-center gap-2 text-shop-muted">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          {translate('Show done tasks')}
        </label>
      </div>
      {error && <p className="mb-3 text-sm text-danger-fg">{translate(error)}</p>}
      {loading ? (
        <p className="text-sm text-shop-muted">{translate('Loading…')}</p>
      ) : !tasks.length ? (
        <section className="rounded-[10px] border border-shop-border bg-white">
          <EmptyState icon={<ListChecks />} title={translate('No tasks')} description={translate(isAdmin ? 'Give a task to someone on the team with a deadline.' : 'Tasks your manager gives you show up here.')} />
        </section>
      ) : (
        <div className="grid gap-4">
          {groups.map(([group, list]) => (
            <section key={group} className="overflow-hidden rounded-[10px] border border-shop-border bg-white">
              <h2 className={`border-b border-shop-border px-3.5 py-2 text-xs font-bold ${group === 'overdue' ? 'text-danger-fg' : 'text-shop-muted'}`}>
                {translate(GROUP_TITLES[group])} · {list.length}
              </h2>
              <ul className="divide-y divide-neutral-bg">
                {list.map((task) => {
                  const canDelete = isAdmin || (task.created_by === admin?.id && task.assigned_to === admin?.id)
                  const done = task.status === 'done'
                  return (
                    <li key={task.id} className="flex items-start gap-3 px-3.5 py-3">
                      <input
                        type="checkbox"
                        className="mt-1 size-4 shrink-0"
                        checked={done}
                        disabled={busy === task.id}
                        aria-label={translate(done ? 'Mark as not done' : 'Mark as done')}
                        onChange={() => void toggle(task)}
                      />
                      <div className="min-w-0 flex-1">
                        <p dir="auto" className={`text-sm font-semibold ${done ? 'text-shop-muted line-through' : 'text-shop-ink'}`}>{task.title}</p>
                        {task.notes && <p dir="auto" className="mt-0.5 whitespace-pre-line text-xs text-shop-muted">{task.notes}</p>}
                        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-shop-muted">
                          {task.due_at && <span className={group === 'overdue' ? 'font-semibold text-danger-fg' : ''}>{formatDue(task.due_at)}</span>}
                          {isAdmin && <span>{translate('For {value0}', { value0: task.assigned_to_email })}</span>}
                          {task.created_by && task.created_by !== task.assigned_to && task.created_by_email && !isAdmin && (
                            <span>{translate('From {value0}', { value0: task.created_by_email })}</span>
                          )}
                          {task.lead_id && (
                            <Link to={`/leads/${task.lead_id}`} className="font-semibold text-shop-accent hover:underline">
                              {[task.customer_name, task.lead_destination].filter(Boolean).join(' · ') || translate('Open lead')}
                            </Link>
                          )}
                          {done && task.done_by_email && <span>{translate('Done by {value0}', { value0: task.done_by_email })}</span>}
                        </p>
                      </div>
                      {canDelete && (
                        <button
                          type="button"
                          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-danger-fg hover:bg-danger-bg"
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
