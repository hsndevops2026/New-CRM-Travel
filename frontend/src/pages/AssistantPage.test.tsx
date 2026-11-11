import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import AssistantPage from './AssistantPage'

const api = vi.hoisted(() => ({ ask: vi.fn() }))
vi.mock('../lib/assistant', async (orig) => ({ ...(await orig<typeof import('../lib/assistant')>()), askAssistant: api.ask }))
const trip = vi.hoisted(() => ({ add: vi.fn() }))
vi.mock('../lib/tripPlan', () => ({ addTripPlanItems: trip.add }))
vi.mock('../lib/leads', () => ({ fetchLeads: vi.fn().mockResolvedValue([]) }))

describe('AssistantPage', () => {
  beforeEach(() => {
    api.ask.mockReset()
    try { sessionStorage.clear() } catch { /* ignore */ }
  })

  it('sends the question with the history and shows the reply', async () => {
    api.ask.mockResolvedValue({ reply: 'عندك عرضين بانتظار الرد', tools_used: ['list_quotes_waiting_for_customer'] })
    render(<MemoryRouter><AssistantPage /></MemoryRouter>)
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: 'شو العروض اللي ما انردّ عليها؟' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('عندك عرضين بانتظار الرد')).toBeTruthy())
    expect(api.ask).toHaveBeenCalledWith([{ role: 'user', content: 'شو العروض اللي ما انردّ عليها؟' }], 'data')
  })

  it('shows the error when the assistant fails', async () => {
    api.ask.mockRejectedValue(new Error('The assistant is not configured (OPENAI_API_KEY is missing)'))
    render(<MemoryRouter><AssistantPage /></MemoryRouter>)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: /send|إرسال/i }))
    await waitFor(() => expect(screen.getByText(/not configured|OPENAI_API_KEY/)).toBeTruthy())
  })

  it('sends planner mode and shows pickable cards marked by source', async () => {
    api.ask.mockResolvedValue({
      reply: 'جهزت اقتراحين',
      tools_used: ['propose_suggestions'],
      lead: { id: 'lead-1', customer_name: 'Rana', destination: 'Istanbul' },
      suggestions: [
        { title: 'Istanbul family', details: 'Package', kind: 'package', source: 'system', package_id: 'p1', price: 1890, currency: 'USD' },
        { title: 'Bosphorus cruise', details: 'Calm sea', kind: 'activity', source: 'general', package_id: null, price: null, currency: null },
      ],
    })
    render(<MemoryRouter><AssistantPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /trip planner|مخطط الرحلات/i }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'اقترح نشاطات' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('Bosphorus cruise')).toBeTruthy())
    expect(api.ask).toHaveBeenLastCalledWith([{ role: 'user', content: 'اقترح نشاطات' }], 'planner')
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(screen.getByText(/1,890 USD/)).toBeTruthy()
    const addButton = screen.getByRole('button', { name: /Rana/ }) as HTMLButtonElement
    expect(addButton.disabled).toBe(true)
    fireEvent.click(screen.getAllByRole('checkbox')[1])
    expect(addButton.disabled).toBe(false)
    trip.add.mockResolvedValue([])
    fireEvent.click(addButton)
    await waitFor(() => expect(trip.add).toHaveBeenCalledWith('lead-1', [
      { title: 'Bosphorus cruise', details: 'Calm sea', kind: 'activity', source: 'general', package_id: null },
    ]))
    expect(await screen.findByRole('link', { name: /open the trip program|افتح برنامج الرحلة/i })).toBeTruthy()
  })
})
