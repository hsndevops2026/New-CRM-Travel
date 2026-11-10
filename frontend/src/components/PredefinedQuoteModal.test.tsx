import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PredefinedQuoteModal from './PredefinedQuoteModal'
import type { PredefinedQuote, PredefinedQuoteInput } from '../lib/predefinedQuotes'

const hotel = { item_type: 'hotel' as const, hotel_name: 'Atlantis', city: 'Dubai', country: 'UAE', price: 900 }

const base: PredefinedQuoteInput = { title: 'Dubai getaway', destination: 'Dubai', items: [hotel] }

const onSubmitInput = vi.fn<(input: PredefinedQuoteInput) => Promise<PredefinedQuote>>()
const onSaved = vi.fn()

function renderModal(initial: PredefinedQuoteInput = base) {
  return render(
    <PredefinedQuoteModal open initialQuote={initial} draftKey="t" submitLabel="Save package" onSubmitInput={onSubmitInput} onClose={() => {}} onSaved={onSaved} />,
  )
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Save package' }))
const mode = (name: string) => screen.getByRole('radio', { name })
const month = (name: string) => within(screen.getByRole('group', { name: 'Months available' })).getByRole('button', { name })

beforeEach(() => {
  vi.clearAllMocks()
  onSubmitInput.mockImplementation(async (input) => ({ id: 'q', ...input }) as unknown as PredefinedQuote)
})

describe('PredefinedQuoteModal — when can this be offered?', () => {
  it('starts on fixed dates, showing the date fields', () => {
    renderModal()
    expect(mode('Fixed dates').getAttribute('aria-checked')).toBe('true')
    expect(mode('Period (months)').getAttribute('aria-checked')).toBe('false')
    expect(screen.getByLabelText('Travel date')).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Months available' })).toBeNull()
  })

  it('saves fixed dates exactly as typed, with no months', async () => {
    renderModal({ ...base, items: [{ ...hotel, check_in: '2026-10-10', check_out: '2026-10-20' }] })
    fireEvent.change(screen.getByLabelText('Travel date'), { target: { value: '2026-10-10' } })
    fireEvent.change(screen.getByLabelText('Return date'), { target: { value: '2026-10-20' } })
    submit()
    await waitFor(() => expect(onSubmitInput).toHaveBeenCalled())
    expect(onSubmitInput.mock.calls[0][0]).toMatchObject({ availability_mode: 'fixed', available_months: [], travel_date: '2026-10-10', return_date: '2026-10-20' })
  })

  it('switches to months: twelve month buttons replace the dates', () => {
    renderModal()
    fireEvent.click(mode('Period (months)'))
    expect(screen.queryByLabelText('Travel date')).toBeNull()
    const group = screen.getByRole('group', { name: 'Months available' })
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])
    expect(screen.getByText(/10–19 October matches October/)).toBeTruthy()
  })

  it('saves the chosen months in calendar order, with no dates', async () => {
    renderModal({ ...base, travel_date: '2026-10-10', return_date: '2026-10-20' })
    fireEvent.click(mode('Period (months)'))
    fireEvent.click(month('Oct'))
    fireEvent.click(month('Jan'))
    fireEvent.click(month('Feb'))
    expect(month('Oct').getAttribute('aria-pressed')).toBe('true')
    expect(month('Mar').getAttribute('aria-pressed')).toBe('false')
    submit()
    await waitFor(() => expect(onSubmitInput).toHaveBeenCalled())
    const payload = onSubmitInput.mock.calls[0][0]
    expect(payload.availability_mode).toBe('period')
    expect(payload.available_months).toEqual([1, 2, 10])
    expect(payload.travel_date).toBe('')
    expect(payload.return_date).toBe('')
  })

  it('lets a month be turned off again', async () => {
    renderModal()
    fireEvent.click(mode('Period (months)'))
    fireEvent.click(month('Jan'))
    fireEvent.click(month('Feb'))
    fireEvent.click(month('Jan'))
    submit()
    await waitFor(() => expect(onSubmitInput).toHaveBeenCalled())
    expect(onSubmitInput.mock.calls[0][0].available_months).toEqual([2])
  })

  it('will not save a period package with no month chosen, and says why', async () => {
    renderModal()
    fireEvent.click(mode('Period (months)'))
    submit()
    expect((await screen.findByRole('alert')).textContent).toContain('Choose at least one month')
    expect(onSubmitInput).not.toHaveBeenCalled()
  })

  it('does not insist on hotel dates for a period package — the stay is a number of nights', async () => {
    renderModal()
    fireEvent.click(mode('Period (months)'))
    expect(screen.queryByLabelText('Check-in')).toBeNull()
    fireEvent.change(screen.getByLabelText('Nights'), { target: { value: '7' } })
    fireEvent.click(month('Oct'))
    submit()
    await waitFor(() => expect(onSubmitInput).toHaveBeenCalled())
    expect(onSubmitInput.mock.calls[0][0].items[0]).toMatchObject({ hotel_name: 'Atlantis', nights: 7 })
  })

  it('still insists on hotel dates for fixed dates', () => {
    renderModal()
    // The check-in field is required, so the browser itself stops the save.
    expect((screen.getByLabelText('Check-in') as HTMLInputElement).required).toBe(true)
    submit()
    expect(onSubmitInput).not.toHaveBeenCalled()
  })

  it('opens an existing period package with its months already chosen', () => {
    renderModal({ ...base, availability_mode: 'period', available_months: [3, 4] })
    expect(mode('Period (months)').getAttribute('aria-checked')).toBe('true')
    expect(month('Mar').getAttribute('aria-pressed')).toBe('true')
    expect(month('Apr').getAttribute('aria-pressed')).toBe('true')
    expect(month('May').getAttribute('aria-pressed')).toBe('false')
  })

  it('drops the months when switched back to fixed dates', async () => {
    renderModal({ ...base, items: [{ ...hotel, check_in: '2026-10-10', check_out: '2026-10-20' }] })
    fireEvent.click(mode('Period (months)'))
    fireEvent.click(month('Oct'))
    fireEvent.click(mode('Fixed dates'))
    submit()
    await waitFor(() => expect(onSubmitInput).toHaveBeenCalled())
    expect(onSubmitInput.mock.calls[0][0]).toMatchObject({ availability_mode: 'fixed', available_months: [] })
  })
})
