import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PredefinedQuotesPanel from './PredefinedQuotesPanel'
import * as api from '../lib/predefinedQuotes'

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ admin: { id: 'me', role: 'admin' } }) }))
vi.mock('../lib/predefinedQuotes', async () => {
  const actual = await vi.importActual<typeof api>('../lib/predefinedQuotes')
  return {
    ...actual,
    fetchPredefinedQuotes: vi.fn(),
    deletePredefinedQuote: vi.fn(),
  }
})

const fetchQuotes = vi.mocked(api.fetchPredefinedQuotes)
const deleteQuote = vi.mocked(api.deletePredefinedQuote)

const quotes: api.PredefinedQuote[] = [
  {
    id: 'quote-1',
    title: 'Istanbul Escape',
    quote_type: 'package',
    destination: 'Istanbul',
    currency: 'USD',
    total_price: 2298,
    adults_count: 2,
    children_count: 1,
    created_at: '2026-10-20T10:00:00Z',
    items: [],
  },
  {
    id: 'quote-2',
    title: 'Dubai Hotel',
    quote_type: 'hotel',
    destination: 'Dubai',
    currency: 'USD',
    total_price: 980,
    adults_count: 2,
    children_count: 0,
    created_at: '2026-10-21T10:00:00Z',
    items: [],
  },
]

function renderPanel() {
  return render(
    <PredefinedQuotesPanel
      query=""
      editorOpen={false}
      importOpen={false}
      onEditorOpenChange={() => {}}
      onImportOpenChange={() => {}}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchQuotes.mockResolvedValue(quotes)
  deleteQuote.mockResolvedValue(undefined)
})

describe('quote template selection', () => {
  it('selects visible templates and deletes them after confirmation', async () => {
    renderPanel()
    await screen.findAllByText('Istanbul Escape')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all visible templates' }))
    expect(screen.getByText('2 templates selected')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 templates' }))

    await waitFor(() => {
      expect(deleteQuote).toHaveBeenCalledTimes(2)
      expect(deleteQuote).toHaveBeenCalledWith('quote-1')
      expect(deleteQuote).toHaveBeenCalledWith('quote-2')
    })
    expect(await screen.findByText('No templates yet')).toBeTruthy()
    expect(screen.queryByText('2 templates selected')).toBeNull()
  })

  it('can select and clear one template without deleting it', async () => {
    renderPanel()
    await screen.findAllByText('Istanbul Escape')

    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Select Istanbul Escape' })[0])
    expect(screen.getByText('1 template selected')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(screen.queryByText('1 template selected')).toBeNull()
    expect(deleteQuote).not.toHaveBeenCalled()
  })
})
