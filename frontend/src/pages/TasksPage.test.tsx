import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import TasksPage from './TasksPage'
import LeadTasksButton from '../components/tasks/LeadTasksButton'
import { setLanguage } from '../lib/i18n'
import type { StaffTask } from '../lib/tasks'

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ admin: { id: 'a1', email: 'agent@test', role: 'agent' } }) }))

const api = vi.hoisted(() => ({ fetchTasks: vi.fn(), updateTask: vi.fn(), deleteTask: vi.fn(), fetchAssignees: vi.fn() }))
vi.mock('../lib/tasks', async (orig) => ({
  ...(await orig<typeof import('../lib/tasks')>()),
  fetchTasks: api.fetchTasks,
  updateTask: api.updateTask,
  deleteTask: api.deleteTask,
  fetchAssignees: api.fetchAssignees,
}))

const task: StaffTask = {
  id: 't1', title: 'Call Rana about the visa', notes: null, assigned_to: 'a1', assigned_to_email: 'agent@test',
  created_by: null, created_by_email: null, lead_id: null, contact_id: null, customer_name: null, lead_destination: null,
  due_at: null, status: 'open', done_at: null, done_by_email: null, created_at: '2026-11-20T10:00:00Z',
}

describe('ticking a task', () => {
  beforeAll(() => setLanguage('en'))
  beforeEach(() => {
    vi.clearAllMocks()
    api.fetchTasks.mockResolvedValue([task])
    api.fetchAssignees.mockResolvedValue([])
    api.updateTask.mockImplementation(async (_id: string, input: { status: 'open' | 'done' }) => ({ ...task, status: input.status }))
  })

  it('on the Tasks page keeps the task, crossed out, and can be unticked; it is never deleted', async () => {
    render(<MemoryRouter><TasksPage /></MemoryRouter>)
    const box = await screen.findByRole('checkbox', { name: 'Mark as done' })
    fireEvent.click(box)

    const undo = await screen.findByRole('checkbox', { name: 'Mark as not done' })
    expect((undo as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText('Call Rana about the visa').className).toContain('line-through')
    expect(api.updateTask).toHaveBeenCalledWith('t1', { status: 'done' })
    expect(api.deleteTask).not.toHaveBeenCalled()

    fireEvent.click(undo)
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Mark as done' }) as HTMLInputElement).checked).toBe(false))
    expect(api.updateTask).toHaveBeenLastCalledWith('t1', { status: 'open' })
  })

  it('in a lead\'s Tasks menu keeps the task, crossed out, and can be unticked', async () => {
    render(<MemoryRouter><LeadTasksButton leadId="l1" contactId={null} /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Tasks (1)' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mark as done' }))

    const undo = await screen.findByRole('checkbox', { name: 'Mark as not done' })
    expect((undo as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText('Call Rana about the visa').className).toContain('line-through')
    expect(screen.getByRole('button', { name: 'Tasks' })).toBeTruthy()

    fireEvent.click(undo)
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Mark as done' }) as HTMLInputElement).checked).toBe(false))
  })
})
