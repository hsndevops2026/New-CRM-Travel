import { apiJson } from './api'

export type StaffTask = {
  id: string
  title: string
  notes: string | null
  assigned_to: string
  assigned_to_email: string
  created_by: string | null
  created_by_email: string | null
  lead_id: string | null
  contact_id: string | null
  customer_name: string | null
  lead_destination: string | null
  due_at: string | null
  status: 'open' | 'done'
  done_at: string | null
  done_by_email: string | null
  created_at: string
}

export type Assignee = { id: string; email: string; role: string }

export type TaskInput = {
  title?: string
  notes?: string | null
  assigned_to?: string
  due_at?: string | null
  lead_id?: string | null
  contact_id?: string | null
  status?: 'open' | 'done'
}

export async function fetchTasks(params: { status?: 'open' | 'done' | 'all'; assignee?: string; leadId?: string } = {}) {
  const q = new URLSearchParams()
  if (params.status) q.set('status', params.status)
  if (params.assignee) q.set('assignee', params.assignee)
  if (params.leadId) q.set('lead_id', params.leadId)
  const data = await apiJson<{ tasks: StaffTask[] }>(`/api/tasks${q.size ? `?${q}` : ''}`)
  return data.tasks
}

export async function fetchAssignees() {
  return (await apiJson<{ assignees: Assignee[] }>('/api/tasks/assignees')).assignees
}

export async function createTask(input: TaskInput) {
  return (await apiJson<{ task: StaffTask }>('/api/tasks', { method: 'POST', body: JSON.stringify(input) })).task
}

export async function updateTask(id: string, input: TaskInput) {
  return (await apiJson<{ task: StaffTask }>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(input) })).task
}

export async function deleteTask(id: string) {
  await apiJson(`/api/tasks/${id}`, { method: 'DELETE' })
}

export type TaskGroup = 'overdue' | 'today' | 'upcoming' | 'no_date' | 'done'

/** Which list a task belongs in, relative to `now`. */
export function taskGroup(task: Pick<StaffTask, 'status' | 'due_at'>, now = new Date()): TaskGroup {
  if (task.status === 'done') return 'done'
  if (!task.due_at) return 'no_date'
  const due = new Date(task.due_at)
  if (due.getTime() < now.getTime()) return 'overdue'
  const endOfDay = new Date(now)
  endOfDay.setHours(23, 59, 59, 999)
  return due.getTime() <= endOfDay.getTime() ? 'today' : 'upcoming'
}

export const TASK_GROUP_ORDER: TaskGroup[] = ['overdue', 'today', 'upcoming', 'no_date', 'done']

/** `<input type="datetime-local">` value → ISO, and back. */
export function localInputToIso(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function isoToLocalInput(value: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
