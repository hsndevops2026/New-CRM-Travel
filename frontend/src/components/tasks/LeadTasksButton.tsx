import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ListChecks, Plus } from 'lucide-react'
import Button from '../ui/Button'
import NewTaskForm from './NewTaskForm'
import { useAuth } from '../../context/AuthContext'
import { locale, t as translate, useI18n } from '../../lib/i18n'
import { fetchAssignees, fetchTasks, updateTask, type Assignee, type StaffTask } from '../../lib/tasks'

/** Header button on a lead: its open tasks, tick them off, or add one tied to this lead. */
export default function LeadTasksButton({ leadId, contactId }: { leadId: string; contactId?: string | null }) {
  useI18n()
  const { admin } = useAuth()
  const isAdmin = admin?.role === 'admin'
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [tasks, setTasks] = useState<StaffTask[]>([])
  const [assignees, setAssignees] = useState<Assignee[]>([])
  const box = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchTasks({ leadId, status: 'open' }).then((list) => { if (!cancelled) setTasks(list) }).catch(() => {})
    return () => { cancelled = true }
  }, [leadId])

  useEffect(() => {
    if (open && isAdmin && !assignees.length) fetchAssignees().then(setAssignees).catch(() => {})
  }, [open, isAdmin, assignees.length])

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

  const finish = (task: StaffTask) => {
    updateTask(task.id, { status: 'done' })
      .then(() => setTasks((list) => list.filter((t) => t.id !== task.id)))
      .catch(() => {})
  }

  return (
    <div ref={box} className="relative">
      <Button
        variant="secondary"
        icon={<ListChecks className="size-4" />}
        aria-expanded={open}
        onClick={() => { setOpen((v) => !v); setAdding(false) }}
      >
        {tasks.length ? translate('Tasks ({value0})', { value0: tasks.length }) : translate('Tasks')}
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label={translate('Tasks for this lead')}
          className="absolute end-0 top-12 z-50 w-[min(400px,calc(100vw-24px))] overflow-hidden rounded-xl border border-shop-border bg-white shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-shop-border px-3 py-2">
            <strong className="text-sm text-shop-ink">{translate('Tasks for this lead')}</strong>
            <Link to="/tasks" className="text-xs font-semibold text-shop-accent hover:underline">{translate('All tasks')}</Link>
          </div>
          {adding ? (
            <div className="p-2">
              <NewTaskForm
                assignees={assignees}
                isAdmin={isAdmin}
                leadId={leadId}
                contactId={contactId}
                onCancel={() => setAdding(false)}
                onCreated={(task) => { setAdding(false); setTasks((list) => [...list, task]) }}
              />
            </div>
          ) : (
            <>
              {tasks.length === 0 ? (
                <p className="p-3 text-sm text-shop-muted">{translate('No open tasks for this lead.')}</p>
              ) : (
                <ul className="max-h-[320px] divide-y divide-shop-border overflow-y-auto">
                  {tasks.map((task) => (
                    <li key={task.id} className="flex items-start gap-2 px-3 py-2.5">
                      <input
                        type="checkbox"
                        className="mt-1 size-4 shrink-0"
                        aria-label={translate('Mark as done')}
                        onChange={() => finish(task)}
                      />
                      <div className="min-w-0 flex-1">
                        <p dir="auto" className="text-sm font-semibold text-shop-ink">{task.title}</p>
                        <p className="text-xs text-shop-muted">
                          {[
                            task.due_at && new Date(task.due_at).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
                            isAdmin && task.assigned_to_email,
                          ].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="border-t border-shop-border p-2">
                <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setAdding(true)}>{translate('Add task')}</Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
