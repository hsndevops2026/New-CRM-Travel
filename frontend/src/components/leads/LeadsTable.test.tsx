import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import LeadsTable from './LeadsTable'
import type { Lead } from '../../lib/leads'

const lead: Lead = {
  id: '11111111-1111-1111-1111-111111111111',
  phone: '919800000001',
  booking_type: 'hotel',
  origin: null,
  destination: 'Dubai',
  travel_date: '2026-10-01',
  return_date: '2026-10-07',
  nights: 6,
  adults_count: 2,
  children_count: 0,
  children_ages: [],
  budget: null,
  hotel_name: null,
  notes: null,
  summary: null,
  contact_name: 'Asha',
  lifecycle_status: 'sourcing',
  created_at: '2026-08-01T10:00:00.000Z',
}

describe('LeadsTable', () => {
  it('opens a lead when the row is clicked', () => {
    const onOpen = vi.fn()
    render(
      <LeadsTable
        leads={[lead]}
        selected={new Set()}
        onToggleOne={vi.fn()}
        onOpen={onOpen}
        onChat={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('Asha'))
    expect(onOpen).toHaveBeenCalledWith(lead.id)
  })
})
