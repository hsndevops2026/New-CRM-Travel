import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReportsLayout from './reports/ReportsLayout'
import PipelineReportPage from './reports/PipelineReportPage'
import TeamReportPage from './reports/TeamReportPage'
import AttentionReportPage from './reports/AttentionReportPage'
import { customRange, presetRange, toCsv } from '../lib/reports'

const auth = vi.hoisted(() => ({ value: { admin: { id: 'a1', email: 'boss@test', role: 'admin' } } as { admin: { id: string; email: string; role: string } } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth.value }))

const api = vi.hoisted(() => ({ pipeline: vi.fn(), employees: vi.fn(), overdue: vi.fn() }))
vi.mock('../lib/reports', async (orig) => ({
  ...(await orig<typeof import('../lib/reports')>()),
  fetchPipelineReport: api.pipeline,
  fetchEmployeeReport: api.employees,
  fetchOverdueReport: api.overdue,
}))

function renderReports(path = '/reports/pipeline') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reports" element={<ReportsLayout />}>
          <Route index element={<Navigate to="pipeline" replace />} />
          <Route path="pipeline" element={<PipelineReportPage />} />
          <Route path="team" element={<TeamReportPage />} />
          <Route path="attention" element={<AttentionReportPage />} />
        </Route>
        <Route path="/leads/hotel" element={<p>leads page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Reports sections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.value = { admin: { id: 'a1', email: 'boss@test', role: 'admin' } }
    api.pipeline.mockResolvedValue({
      range: { from: '', to: '' },
      new_leads: 4,
      funnel: [
        { stage: 'new', count: 4, rate: 100 },
        { stage: 'sent', count: 3, rate: 75 },
        { stage: 'accepted', count: 2, rate: 50 },
        { stage: 'booked', count: 1, rate: 25 },
      ],
      lost: 0,
      by_source: [{ source: 'whatsapp', count: 3 }, { source: 'web', count: 1 }],
      current_pipeline: [{ status: 'intake', count: 5 }],
      quotes_sent: 3,
      quotes_accepted: 2,
      accepted_value: [{ currency: 'USD', total: 3500, count: 2 }],
    })
    api.employees.mockResolvedValue({
      employees: [{ id: 'e1', email: 'agent@test', role: 'agent', leads_assigned: 2, open_leads: 1, quotes_sent: 2, quotes_accepted: 2,
        accepted_value: 3500, customer_replies: 5, avg_first_reply_minutes: 90, first_reply_samples: 2 }],
    })
    api.overdue.mockResolvedValue({
      generated_at: '', thresholds: { reply_hours: 2, quote_days: 2, stale_days: 3 },
      overdue_reminders: [],
      unanswered_customers: [{ lead_id: '11111111-1111-1111-1111-111111111111', customer_name: 'Rana', phone: '972500000000',
        destination: 'Istanbul', waiting_since: '2026-11-01T10:00:00Z', last_message: 'any news?', assigned_to: 'agent@test' }],
      quotes_without_reply: [],
      stalled_requests: [],
    })
  })

  it('shows pipeline totals and funnel on the pipeline section', async () => {
    renderReports('/reports/pipeline')
    expect(await screen.findByText('3,500 USD')).toBeTruthy()
    expect(screen.getByText('75%')).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Reports sections' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Pipeline' }).getAttribute('aria-current')).toBe('page')
  })

  it('shows team performance on the team section', async () => {
    renderReports('/reports/team')
    const team = await screen.findByRole('heading', { name: 'Team performance' })
    const card = team.closest('section') as HTMLElement
    expect(within(card).getByText('agent@test')).toBeTruthy()
    expect(within(card).getByText('1.5 h')).toBeTruthy()
  })

  it('shows who is waiting on the attention section', async () => {
    renderReports('/reports/attention')
    expect((await screen.findByRole('link', { name: 'Rana' })).getAttribute('href')).toBe('/leads/11111111-1111-1111-1111-111111111111')
    expect(screen.getByText('any news?')).toBeTruthy()
  })

  it('sends agents away', async () => {
    auth.value = { admin: { id: 'a2', email: 'agent@test', role: 'agent' } }
    renderReports('/reports/pipeline')
    await waitFor(() => expect(screen.getByText('leads page')).toBeTruthy())
    expect(api.pipeline).not.toHaveBeenCalled()
  })
})

describe('report helpers', () => {
  it('builds ranges', () => {
    const now = new Date('2026-11-12T10:00:00Z')
    expect(presetRange('7d', now)).toEqual({ from: '2026-11-05T10:00:00.000Z', to: '2026-11-12T10:00:00.000Z' })
    const custom = customRange('2026-11-01', '2026-11-01')
    expect(custom && new Date(custom.to).getTime() - new Date(custom.from).getTime()).toBe(86_400_000)
    expect(customRange('2026-11-05', '2026-11-01')).toBeNull()
  })

  it('writes CSV that Excel opens with Arabic', () => {
    const csv = toCsv(['الاسم', 'note'], [['رنا', 'a, "b"']])
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('رنا,"a, ""b"""')
  })
})
