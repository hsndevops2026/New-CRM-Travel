import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ImportPredefinedQuoteModal from './ImportPredefinedQuoteModal'
import * as api from '../lib/predefinedQuotes'

vi.mock('../lib/predefinedQuotes', async () => {
  const actual = await vi.importActual<typeof api>('../lib/predefinedQuotes')
  return {
    ...actual,
    fetchPredefinedQuoteImports: vi.fn(),
    uploadPredefinedQuoteBrochure: vi.fn(),
    approvePredefinedQuoteImport: vi.fn(),
    rejectPredefinedQuoteImport: vi.fn(),
  }
})

const fetchImports = vi.mocked(api.fetchPredefinedQuoteImports)
const approve = vi.mocked(api.approvePredefinedQuoteImport)
const reject = vi.mocked(api.rejectPredefinedQuoteImport)

type Item = api.PredefinedQuoteItem
const hotelOffer = (hotel: string, room: string, over: Partial<Item> = {}): Item => ({
  item_type: 'hotel', hotel_name: hotel, room_name: room, board_name: 'HB', check_in: '2026-07-01', check_out: '2026-09-15', nights: 76, price: 120, ...over,
})

function record(index: number, title: string, over: Partial<api.PredefinedQuoteImport> = {}, payload: Partial<api.PredefinedQuoteInput> = {}): api.PredefinedQuoteImport {
  return {
    id: `import-${index}`, file_name: 'ratesheet.pdf', file_hash: 'h', file_size: 2048, status: 'needs_review', warnings: [],
    batch_id: 'batch-1', batch_index: index, batch_total: 3, source_pages: String(index + 2), created_at: '2026-10-18T00:00:00Z',
    extracted_payload: { title, destination: 'Taba', currency: 'USD', total_price: 1000 + index, items: [hotelOffer(title, 'Standard')], ...payload },
    ...over,
  }
}

const A = record(0, 'Mövenpick Taba', {}, { items: [hotelOffer('Mövenpick Taba', 'Standard'), hotelOffer('Mövenpick Taba', 'Sea view', { price: 150, board_name: 'FB' })] })
const B = record(1, 'Maxx Royal Kemer')
const C = record(2, 'Titanic Beach Lara')
const existingQuotes = [{ id: 'quote-9', title: 'Existing Taba package' }] as unknown as api.PredefinedQuote[]

function renderModal(open = true) {
  const onReview = vi.fn<(record: api.PredefinedQuoteImport, target: string | null) => void>()
  const onApproved = vi.fn<(quote: api.PredefinedQuote) => void>()
  const ui = (isOpen: boolean) => (
    <ImportPredefinedQuoteModal open={isOpen} quotes={existingQuotes} onClose={() => {}} onReview={onReview} onApproved={onApproved} />
  )
  const view = render(ui(open))
  return { ...view, onReview, onApproved, setOpen: (isOpen: boolean) => view.rerender(ui(isOpen)) }
}

const savedQuote = (title: string) => ({ id: `saved-${title}`, title }) as unknown as api.PredefinedQuote

beforeEach(() => {
  vi.clearAllMocks()
  fetchImports.mockReset()
})

describe('import carousel — what is shown', () => {
  it('shows one package at a time, with its page, its extracted details and every offer', async () => {
    fetchImports.mockResolvedValue([A, B, C])
    renderModal()
    const card = await screen.findByRole('article', { name: 'Package 1 of 3' })
    expect(within(card).getByRole('heading', { name: 'Mövenpick Taba' })).toBeTruthy()
    expect(within(card).getByText('Page 2')).toBeTruthy()
    expect(within(card).getByText(/Taba · 1 hotel · 2 offers/)).toBeTruthy()
    // One hotel, two offers: both appear as their own row.
    const rows = within(card).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('Standard · HB')
    expect(rows[1].textContent).toContain('Sea view · FB')
    expect(rows[1].textContent).toContain('1 Jul → 15 Sep · 76 nights')
    expect(screen.queryByText('Maxx Royal Kemer')).toBeNull()
  })

  it('shows the position and a chip for each package, labelled by page', async () => {
    fetchImports.mockResolvedValue([A, B, C])
    renderModal()
    await screen.findByRole('article')
    expect(screen.getByText('1 of 3')).toBeTruthy()
    const chips = within(screen.getByRole('list', { name: 'Packages' })).getAllByRole('button')
    expect(chips.map((c) => c.textContent)).toEqual(['p.2', 'p.3', 'p.4'])
    expect(chips[0].getAttribute('aria-current')).toBe('true')
  })

  it('lists extraction warnings on the slide they belong to', async () => {
    fetchImports.mockResolvedValue([A, record(1, 'Maxx Royal Kemer', { warnings: ['Price on this page is a "from" price'] })])
    renderModal()
    await screen.findByRole('article')
    expect(screen.queryByText(/"from" price/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Next package' }))
    expect(screen.getByText(/"from" price/)).toBeTruthy()
  })

  it('says so when nothing is waiting', async () => {
    fetchImports.mockResolvedValue([])
    renderModal()
    expect(await screen.findByText('No brochures are waiting for review')).toBeTruthy()
    expect(screen.queryByRole('article')).toBeNull()
  })
})

describe('import carousel — moving around', () => {
  it('goes forward and back with the arrows, wrapping at the ends', async () => {
    fetchImports.mockResolvedValue([A, B, C])
    renderModal()
    await screen.findByRole('article')
    fireEvent.click(screen.getByRole('button', { name: 'Next package' }))
    expect(screen.getByRole('heading', { name: 'Maxx Royal Kemer' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Previous package' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous package' }))
    expect(screen.getByRole('heading', { name: 'Titanic Beach Lara' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next package' }))
    expect(screen.getByRole('heading', { name: 'Mövenpick Taba' })).toBeTruthy()
  })

  it('responds to the left and right arrow keys', async () => {
    fetchImports.mockResolvedValue([A, B, C])
    renderModal()
    await screen.findByRole('article')
    const group = screen.getByRole('group', { name: 'Packages waiting for review' })
    fireEvent.keyDown(group, { key: 'ArrowRight' })
    expect(screen.getByRole('heading', { name: 'Maxx Royal Kemer' })).toBeTruthy()
    fireEvent.keyDown(group, { key: 'ArrowLeft' })
    expect(screen.getByRole('heading', { name: 'Mövenpick Taba' })).toBeTruthy()
  })

  it('leaves the arrow keys to a dropdown that is open', async () => {
    fetchImports.mockResolvedValue([A, B])
    renderModal()
    await screen.findByRole('article')
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowRight' })
    expect(screen.getByRole('heading', { name: 'Mövenpick Taba' })).toBeTruthy()
  })

  it('jumps straight to a page from its chip', async () => {
    fetchImports.mockResolvedValue([A, B, C])
    renderModal()
    await screen.findByRole('article')
    fireEvent.click(screen.getByRole('button', { name: 'Package 3, page 4' }))
    expect(screen.getByRole('heading', { name: 'Titanic Beach Lara' })).toBeTruthy()
    expect(screen.getByText('3 of 3')).toBeTruthy()
  })

  it('has nowhere to go with a single package', async () => {
    fetchImports.mockResolvedValue([A])
    renderModal()
    await screen.findByRole('article')
    expect((screen.getByRole('button', { name: 'Next package' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('import carousel — approving', () => {
  it('approves the package on screen exactly as extracted, adds it to the library, and moves on', async () => {
    fetchImports.mockResolvedValue([A, B, C])
    approve.mockResolvedValue({ import: A, quote: savedQuote('Mövenpick Taba') })
    const { onApproved } = renderModal()
    await screen.findByRole('article')
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(approve).toHaveBeenCalledWith('import-0', A.extracted_payload, null))
    expect(onApproved).toHaveBeenCalledWith(expect.objectContaining({ title: 'Mövenpick Taba' }))
    expect(await screen.findByRole('heading', { name: 'Maxx Royal Kemer' })).toBeTruthy()
    expect(screen.getByText('1 of 2')).toBeTruthy()
    expect(screen.getByText(/Approved “Mövenpick Taba”/)).toBeTruthy()
  })

  it('steps back to the last package when the last one is approved', async () => {
    fetchImports.mockResolvedValue([A, B])
    approve.mockResolvedValue({ import: B, quote: savedQuote('Maxx Royal Kemer') })
    renderModal()
    await screen.findByRole('article')
    fireEvent.click(screen.getByRole('button', { name: 'Next package' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('heading', { name: 'Mövenpick Taba' })).toBeTruthy()
  })

  it('shows the empty state after the last package', async () => {
    fetchImports.mockResolvedValue([A])
    approve.mockResolvedValue({ import: A, quote: savedQuote('Mövenpick Taba') })
    renderModal()
    await screen.findByRole('article')
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(await screen.findByText('No brochures are waiting for review')).toBeTruthy()
  })

  it('can update an existing package instead, and the choice stays with that package only', async () => {
    fetchImports.mockResolvedValue([A, B])
    approve.mockResolvedValue({ import: A, quote: savedQuote('Mövenpick Taba') })
    renderModal()
    await screen.findByRole('article')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'quote-9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next package' }))
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Previous package' }))
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('quote-9')
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(approve).toHaveBeenCalledWith('import-0', A.extracted_payload, 'quote-9'))
  })

  it('refuses to approve a package that is missing its basics, and says what to fix', async () => {
    fetchImports.mockResolvedValue([record(0, '', {}, { items: [] })])
    renderModal()
    await screen.findByRole('article')
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toMatch(/Title is missing; No hotel or flight offers were found/)
    expect(screen.getByText('No offers were found on this page.')).toBeTruthy()
    // The chip warns too, so it can be spotted without opening every page.
    expect(screen.getByRole('button', { name: /needs attention/ })).toBeTruthy()
  })

  it('keeps the package and shows the server’s reason when approval fails', async () => {
    fetchImports.mockResolvedValue([A, B])
    approve.mockRejectedValue(new Error('Only imports waiting for review can be approved'))
    renderModal()
    await screen.findByRole('article')
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Only imports waiting for review')
    expect(screen.getByRole('heading', { name: 'Mövenpick Taba' })).toBeTruthy()
    expect(screen.getByText('1 of 2')).toBeTruthy()
  })

  it('blocks every control while an approval is in flight', async () => {
    fetchImports.mockResolvedValue([A, B])
    let done: (v: { import: api.PredefinedQuoteImport; quote: api.PredefinedQuote }) => void = () => {}
    approve.mockReturnValue(new Promise((resolve) => { done = resolve }))
    renderModal()
    await screen.findByRole('article')
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Next package' }) as HTMLButtonElement).disabled).toBe(true))
    expect((screen.getByRole('button', { name: 'Reject' }) as HTMLButtonElement).disabled).toBe(true)
    done({ import: A, quote: savedQuote('x') })
    await screen.findByRole('heading', { name: 'Maxx Royal Kemer' })
  })
})

describe('import carousel — editing and rejecting', () => {
  it('opens the editor for the package on screen, with its update target', async () => {
    fetchImports.mockResolvedValue([A, B])
    const { onReview } = renderModal()
    await screen.findByRole('article')
    fireEvent.click(screen.getByRole('button', { name: 'Next package' }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'quote-9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }))
    expect(onReview).toHaveBeenCalledWith(expect.objectContaining({ id: 'import-1' }), 'quote-9')
  })

  it('asks before rejecting, and does nothing on cancel', async () => {
    fetchImports.mockResolvedValue([A, B])
    renderModal()
    await screen.findByRole('article')
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reject “Mövenpick Taba”?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Reject/ })).toBeNull())
    expect(reject).not.toHaveBeenCalled()
  })

  it('rejects just that package once confirmed, and shows the next', async () => {
    fetchImports.mockResolvedValue([A, B])
    reject.mockResolvedValue({ ...A, status: 'rejected' })
    renderModal()
    await screen.findByRole('article')
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: /Reject/ })).getByRole('button', { name: 'Reject package' }))
    await waitFor(() => expect(reject).toHaveBeenCalledWith('import-0'))
    expect(await screen.findByRole('heading', { name: 'Maxx Royal Kemer' })).toBeTruthy()
  })
})

describe('import carousel — rejecting everything', () => {
  it('offers reject all only when more than one package is waiting', async () => {
    fetchImports.mockResolvedValue([A])
    const { unmount } = renderModal()
    await screen.findByRole('article')
    expect(screen.queryByRole('button', { name: /Reject all/ })).toBeNull()

    unmount()
    fetchImports.mockResolvedValue([A, B, C])
    renderModal()
    expect(await screen.findByRole('button', { name: 'Reject all 3' })).toBeTruthy()
  })

  it('rejects every waiting package after confirmation', async () => {
    fetchImports.mockResolvedValue([A, B, C])
    reject.mockImplementation(async (id) => ({ ...A, id, status: 'rejected' }))
    renderModal()

    fireEvent.click(await screen.findByRole('button', { name: 'Reject all 3' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reject all 3 packages?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject all 3' }))

    await waitFor(() => expect(reject).toHaveBeenCalledTimes(3))
    expect(reject.mock.calls.map((call) => call[0])).toEqual(['import-0', 'import-1', 'import-2'])
    expect(await screen.findByText('Rejected 3 packages.')).toBeTruthy()
    expect(screen.getByText('No brochures are waiting for review')).toBeTruthy()
  })

  it('keeps failures in the carousel so they can be retried', async () => {
    fetchImports.mockResolvedValue([A, B, C])
    reject.mockImplementation(async (id) => {
      if (id === 'import-1') throw new Error('Server unavailable')
      return { ...A, id, status: 'rejected' }
    })
    renderModal()

    fireEvent.click(await screen.findByRole('button', { name: 'Reject all 3' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: /Reject all 3/ })).getByRole('button', { name: 'Reject all 3' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/1 could not be rejected.*Maxx Royal Kemer: Server unavailable/)
    expect(screen.getByText('Rejected 2 packages.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Maxx Royal Kemer' })).toBeTruthy()
    expect(screen.getByText('1 of 1')).toBeTruthy()
  })
})

describe('import carousel — approving everything', () => {
  it('is offered only when there is more than one package to approve', async () => {
    fetchImports.mockResolvedValue([A])
    const { unmount } = renderModal()
    await screen.findByRole('article')
    expect(screen.queryByRole('button', { name: /Approve all/ })).toBeNull()
    unmount()
    fetchImports.mockResolvedValue([A, B, C])
    renderModal()
    expect(await screen.findByRole('button', { name: 'Approve all 3' })).toBeTruthy()
  })

  it('approves the complete ones, skips the incomplete, and leaves the skipped on screen', async () => {
    const broken = record(1, '', {}, { items: [] })
    fetchImports.mockResolvedValue([A, broken, C])
    approve.mockImplementation(async (id) => ({ import: A, quote: savedQuote(id) }))
    const { onApproved } = renderModal()
    fireEvent.click(await screen.findByRole('button', { name: 'Approve all 2' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Approve 2 packages?' })).getByRole('button', { name: 'Approve 2' }))
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(2))
    expect(approve.mock.calls.map((c) => c[0])).toEqual(['import-0', 'import-2'])
    expect(onApproved).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('Approved 2 packages.')).toBeTruthy()
    expect(screen.getByText('1 of 1')).toBeTruthy()
    expect(screen.getByText('Untitled package')).toBeTruthy()
  })

  it('reports the ones that failed and keeps them to retry', async () => {
    fetchImports.mockResolvedValue([A, B, C])
    approve.mockImplementation(async (id) => {
      if (id === 'import-1') throw new Error('Duplicate title')
      return { import: A, quote: savedQuote(id) }
    })
    renderModal()
    fireEvent.click(await screen.findByRole('button', { name: 'Approve all 3' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Approve 3 packages?' })).getByRole('button', { name: 'Approve 3' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/1 could not be approved.*Maxx Royal Kemer: Duplicate title/)
    expect(screen.getByText('Approved 2 packages.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Maxx Royal Kemer' })).toBeTruthy()
  })

  it('does nothing if the confirmation is declined', async () => {
    fetchImports.mockResolvedValue([A, B])
    renderModal()
    fireEvent.click(await screen.findByRole('button', { name: 'Approve all 2' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: /Approve 2/ })).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Approve 2/ })).toBeNull())
    expect(approve).not.toHaveBeenCalled()
  })
})

describe('import carousel — staying in step with the server', () => {
  it('does not offer a package that was approved elsewhere when the dialog reopens', async () => {
    // Reported bug: "Only imports waiting for review can be approved".
    fetchImports.mockResolvedValueOnce([A, B, C])
    const { setOpen } = renderModal()
    await screen.findByRole('heading', { name: 'Mövenpick Taba' })
    fetchImports.mockResolvedValueOnce([B, C])
    setOpen(false)
    setOpen(true)
    await waitFor(() => expect(fetchImports).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('heading', { name: 'Maxx Royal Kemer' })).toBeTruthy()
    expect(screen.queryByText('Mövenpick Taba')).toBeNull()
  })

  it('lands on the neighbour, not back at the start, when the package on screen disappears', async () => {
    fetchImports.mockResolvedValueOnce([A, B, C])
    const { setOpen } = renderModal()
    await screen.findByRole('article')
    fireEvent.click(screen.getByRole('button', { name: 'Next package' }))
    expect(screen.getByRole('heading', { name: 'Maxx Royal Kemer' })).toBeTruthy()
    // Package 2 gets approved somewhere else while this dialog is closed.
    fetchImports.mockResolvedValueOnce([A, C])
    setOpen(false)
    setOpen(true)
    expect(await screen.findByRole('heading', { name: 'Titanic Beach Lara' })).toBeTruthy()
    expect(screen.getByText('2 of 2')).toBeTruthy()
  })

  it('cannot approve while the refreshed list is still loading after a reopen', async () => {
    fetchImports.mockResolvedValueOnce([A, B, C])
    const { setOpen } = renderModal()
    await screen.findByRole('article')
    let deliver: (list: api.PredefinedQuoteImport[]) => void = () => {}
    fetchImports.mockReturnValueOnce(new Promise((resolve) => { deliver = resolve }))
    setOpen(false)
    setOpen(true)
    const button = (await screen.findByRole('button', { name: 'Approve' })) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(approve).not.toHaveBeenCalled()
    deliver([B, C])
    await waitFor(() => expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.getByRole('heading', { name: 'Maxx Royal Kemer' })).toBeTruthy()
  })

  it('shows the empty state once the whole batch is done', async () => {
    fetchImports.mockResolvedValueOnce([C])
    const { setOpen } = renderModal()
    await screen.findByRole('article')
    fetchImports.mockResolvedValueOnce([])
    setOpen(false)
    setOpen(true)
    expect(await screen.findByText('No brochures are waiting for review')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  })

  it('opens on the packages from a brochure just uploaded', async () => {
    fetchImports.mockResolvedValueOnce([])
    vi.mocked(api.uploadPredefinedQuoteBrochure).mockResolvedValue({ importRecords: [B, C], duplicate: false } as never)
    renderModal()
    await screen.findByText('No brochures are waiting for review')
    fetchImports.mockResolvedValueOnce([B, C])
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'rates.pdf', { type: 'application/pdf' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Upload and extract' }))
    expect(await screen.findByRole('heading', { name: 'Maxx Royal Kemer' })).toBeTruthy()
    expect(screen.getByText(/Found 2 packages in this brochure/)).toBeTruthy()
  })
})

describe('import carousel — uploading a file that was already imported', () => {
  const upload = vi.mocked(api.uploadPredefinedQuoteBrochure)
  const choose = () => {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'rates.pdf', { type: 'application/pdf' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Upload and extract' }))
  }
  const dialog = () => screen.findByRole('dialog', { name: 'This file was already imported' })

  beforeEach(() => upload.mockReset())

  it('asks whether to read it again, saying what already exists', async () => {
    fetchImports.mockResolvedValue([A, B])
    upload.mockResolvedValue({ importRecord: A, importRecords: [A, B, { ...C, status: 'approved' }], duplicate: true, replaced: 0 })
    renderModal()
    await screen.findByRole('article')
    choose()
    const ask = await dialog()
    expect(ask.textContent).toContain('3 packages (2 waiting for review, 1 already approved)')
    expect(ask.textContent).toMatch(/replaced by the new result/)
    expect(ask.textContent).toMatch(/Approved packages stay/)
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('reads it again when the answer is yes, and says what was replaced', async () => {
    fetchImports.mockResolvedValue([A, B])
    upload
      .mockResolvedValueOnce({ importRecord: A, importRecords: [A, B], duplicate: true, replaced: 0 })
      .mockResolvedValueOnce({ importRecord: B, importRecords: [B, C], duplicate: false, replaced: 2 })
    renderModal()
    await screen.findByRole('article')
    choose()
    fireEvent.click(within(await dialog()).getByRole('button', { name: 'Read it again' }))
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2))
    expect(upload.mock.calls[1][1]).toEqual({ reextract: true })
    expect(upload.mock.calls[0][1]).toBeUndefined()
    expect(await screen.findByText(/Read again: 2 packages found, replacing the 2 that were waiting/)).toBeTruthy()
  })

  it('does not read it again when the answer is no, and keeps the earlier packages on screen', async () => {
    fetchImports.mockResolvedValue([A, B])
    upload.mockResolvedValue({ importRecord: A, importRecords: [A, B], duplicate: true, replaced: 0 })
    renderModal()
    await screen.findByRole('article')
    choose()
    fireEvent.click(within(await dialog()).getByRole('button', { name: 'Keep what I have' }))
    expect(await screen.findByText(/Kept the 2 packages from the earlier read — 2 still waiting for review/)).toBeTruthy()
    expect(upload).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { name: 'Mövenpick Taba' })).toBeTruthy()
  })

  it('says everything was already reviewed when none is waiting, and offers no replacement of them', async () => {
    fetchImports.mockResolvedValue([])
    const done = { ...A, status: 'approved' as const }
    upload.mockResolvedValue({ importRecord: done, importRecords: [done], duplicate: true, replaced: 0 })
    renderModal()
    await screen.findByText('No brochures are waiting for review')
    choose()
    const ask = await dialog()
    expect(ask.textContent).toContain('1 package (1 already approved)')
    expect(ask.textContent).not.toMatch(/replaced by the new result/)
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep what I have' }))
    expect(await screen.findByText(/Everything from this file has already been reviewed/)).toBeTruthy()
  })

  it('does not ask at all for a file it has not seen', async () => {
    fetchImports.mockResolvedValueOnce([]).mockResolvedValue([B, C])
    upload.mockResolvedValue({ importRecord: B, importRecords: [B, C], duplicate: false, replaced: 0 })
    renderModal()
    await screen.findByText('No brochures are waiting for review')
    choose()
    expect(await screen.findByText(/Found 2 packages in this brochure/)).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'This file was already imported' })).toBeNull()
  })

  it('shows the server’s message if the second read fails', async () => {
    fetchImports.mockResolvedValue([A])
    upload
      .mockResolvedValueOnce({ importRecord: A, importRecords: [A], duplicate: true, replaced: 0 })
      .mockRejectedValueOnce(new Error('This brochure is still being read.'))
    renderModal()
    await screen.findByRole('article')
    choose()
    fireEvent.click(within(await dialog()).getByRole('button', { name: 'Read it again' }))
    expect((await screen.findAllByRole('alert')).some((a) => /still being read/.test(a.textContent || ''))).toBe(true)
  })
})
