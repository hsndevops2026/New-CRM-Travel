import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TripPlanPanel from './TripPlanPanel'

const api = vi.hoisted(() => ({
  fetch: vi.fn(),
  preview: vi.fn(),
  send: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  add: vi.fn(),
}))
vi.mock('../../lib/tripPlan', () => ({
  fetchTripPlan: api.fetch,
  previewTripPlan: api.preview,
  sendTripPlan: api.send,
  updateTripPlanItem: api.update,
  deleteTripPlanItem: api.remove,
  addTripPlanItems: api.add,
}))

const items = [
  { id: 'i2', lead_id: 'L', day_number: 2, position: 1, title: 'Bosphorus cruise', details: 'Evening', kind: 'activity', source: 'general', package_id: null, price: null, currency: null },
  { id: 'i1', lead_id: 'L', day_number: 1, position: 0, title: 'Family package', details: '', kind: 'package', source: 'system', package_id: 'p', price: 1890, currency: 'USD' },
]

function renderPanel() {
  return render(<MemoryRouter><TripPlanPanel leadId="L" /></MemoryRouter>)
}

describe('TripPlanPanel', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset())
    api.fetch.mockResolvedValue({ lead: { id: 'L', destination: 'Istanbul', customer_name: 'Rana' }, items })
  })

  it('groups items by day with the package price only on system items', async () => {
    renderPanel()
    expect(await screen.findByText('Bosphorus cruise')).toBeTruthy()
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(['Day 1', 'Day 2'])
    expect(screen.getByText('1,890 USD')).toBeTruthy()
  })

  it('lets the employee edit the message and sends it only after confirming', async () => {
    api.preview.mockResolvedValue('Hi Rana, here is your program')
    api.send.mockResolvedValue({ message: {} })
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: /prepare message/i }))
    const box = await screen.findByRole('textbox', { name: /message to the customer/i })
    fireEvent.change(box, { target: { value: 'Hi Rana, edited program' } })
    fireEvent.click(screen.getByRole('button', { name: /send to rana on whatsapp/i }))
    expect(api.send).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /^send$/i }))
    await waitFor(() => expect(api.send).toHaveBeenCalledWith('L', 'Hi Rana, edited program'))
  })

  it('edits an item', async () => {
    api.update.mockResolvedValue(items)
    renderPanel()
    await screen.findByText('Bosphorus cruise')
    fireEvent.click(screen.getAllByRole('button', { name: /edit/i })[1])
    const title = screen.getByRole('textbox', { name: /title/i })
    fireEvent.change(title, { target: { value: 'Sunset cruise' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(api.update).toHaveBeenCalledWith('L', 'i2', { title: 'Sunset cruise', details: 'Evening', day_number: 2 }))
  })
})
