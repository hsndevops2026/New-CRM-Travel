import { useState } from 'react'
import Button from '../ui/Button'
import { t as translate } from '../../lib/i18n'
import { createTask, localInputToIso, taskField, type Assignee, type StaffTask } from '../../lib/tasks'

const field = taskField

export default function NewTaskForm({ assignees, isAdmin, onCreated, onCancel, leadId, contactId }: {
  assignees: Assignee[]
  isAdmin: boolean
  onCreated: (task: StaffTask) => void
  onCancel: () => void
  leadId?: string
  contactId?: string | null
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
        lead_id: leadId || null,
        contact_id: contactId || null,
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the task')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-[10px] border border-shop-border bg-white p-4">
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

