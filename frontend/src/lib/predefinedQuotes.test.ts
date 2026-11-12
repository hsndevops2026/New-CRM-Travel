import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  brochureContentType,
  deriveQuoteType,
  displayTotal,
  emptyReturnFlightItem,
  hasReturnFlight,
  hotelLocationLabel,
  importBatchLabel,
  isBrochureFile,
  isImportableAttachment,
  itemsForQuoteType,
  quoteTypeLabel,
  uploadPredefinedQuoteBrochure,
} from './predefinedQuotes'

afterEach(() => vi.unstubAllGlobals())

describe('predefined quote helpers', () => {
  it('labels mixed hotel + flight quotes as Flight + Hotel', () => {
    expect(deriveQuoteType([{ item_type: 'hotel' }])).toBe('hotel')
    expect(deriveQuoteType([{ item_type: 'flight' }])).toBe('flight')
    expect(deriveQuoteType([{ item_type: 'hotel' }, { item_type: 'flight' }])).toBe('package')
    expect(quoteTypeLabel('package')).toBe('Flight + Hotel')
    expect(quoteTypeLabel('hotel')).toBe('Hotel')
    expect(quoteTypeLabel('flight')).toBe('Flight')
  })

  it('seeds items for each quote type and mirrors outbound for return', () => {
    expect(itemsForQuoteType('hotel')).toEqual([
      expect.objectContaining({ item_type: 'hotel', city: '', country: '' }),
    ])
    expect(itemsForQuoteType('flight')).toEqual([
      expect.objectContaining({ item_type: 'flight', direction: 'outbound' }),
    ])
    expect(itemsForQuoteType('package').map((item) => item.item_type)).toEqual(['hotel', 'flight'])

    const outbound = {
      item_type: 'flight' as const,
      departure_airport: 'DXB',
      arrival_airport: 'JFK',
      departure_city: 'Dubai',
      arrival_city: 'New York',
    }
    const ret = emptyReturnFlightItem(outbound)
    expect(ret.direction).toBe('return')
    expect(ret.departure_airport).toBe('JFK')
    expect(ret.arrival_airport).toBe('DXB')
    expect(hasReturnFlight([outbound, ret])).toBe(true)
    expect(hotelLocationLabel({ city: 'New York', country: 'United States' })).toBe(
      'New York, United States',
    )
  })

  it('prefers an explicit total over the item sum', () => {
    expect(
      displayTotal({
        total_price: 1500,
        items: [{ item_type: 'hotel', price: 400 }],
      }),
    ).toBe(1500)
    expect(
      displayTotal({
        total_price: null,
        items: [
          { item_type: 'hotel', price: 400 },
          { item_type: 'flight', price: 250 },
        ],
      }),
    ).toBe(650)
  })

  it('accepts PDF and common image brochure types', () => {
    expect(isBrochureFile(new File(['x'], 'a.pdf', { type: 'application/pdf' }))).toBe(true)
    expect(isBrochureFile(new File(['x'], 'rate.png', { type: 'image/png' }))).toBe(true)
    expect(isBrochureFile(new File(['x'], 'flyer.jpg', { type: '' }))).toBe(true)
    expect(isBrochureFile(new File(['x'], 'notes.docx', { type: '' }))).toBe(false)
    expect(brochureContentType(new File(['x'], 'scan.JPEG', { type: '' }))).toBe('image/jpeg')
  })

  it('accepts Excel, CSV and text rate sheets, and the same from email attachments', () => {
    const xlsxType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    expect(isBrochureFile(new File(['x'], 'Hilton Jan.xlsx', { type: xlsxType }))).toBe(true)
    expect(isBrochureFile(new File(['x'], 'rates.csv', { type: '' }))).toBe(true)
    expect(brochureContentType(new File(['x'], 'rates.XLSX', { type: '' }))).toBe(xlsxType)
    expect(isBrochureFile(new File(['x'], 'old.xls', { type: 'application/vnd.ms-excel' }))).toBe(false)
    expect(isImportableAttachment('Hilton.pdf')).toBe(true)
    expect(isImportableAttachment('scan', 'image/jpeg')).toBe(true)
    expect(isImportableAttachment('prices.xlsx')).toBe(true)
    expect(isImportableAttachment('contract.docx')).toBe(false)
  })

  it('uploads a brochure as authenticated PDF or image bytes', async () => {
    const importRecord = {
      id: 'import-1',
      file_name: 'Dubai brochure.pdf',
      file_hash: 'hash',
      file_size: 4,
      status: 'needs_review',
      warnings: [],
      created_at: '2026-10-15T00:00:00Z',
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      import: importRecord,
      duplicate: false,
    }), { status: 201 })))
    const file = new File(['%PDF-test'], 'Dubai brochure.pdf', { type: 'application/pdf' })

    const result = await uploadPredefinedQuoteBrochure(file)

    expect(result.importRecord.id).toBe('import-1')
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toBe('/api/predefined-quotes/imports/upload')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/pdf')
    expect(new Headers(init?.headers).get('X-File-Name')).toBe('Dubai%20brochure.pdf')
    expect(init?.body).toBe(file)
  })

  it('uploads an image rate sheet with the image content type', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      import: {
        id: 'import-2',
        file_name: 'taba-rates.png',
        file_hash: 'hash2',
        file_size: 8,
        status: 'needs_review',
        warnings: ['Source was an image; verify OCR fields carefully before approval.'],
        created_at: '2026-10-15T00:00:00Z',
      },
      duplicate: false,
    }), { status: 201 })))
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'taba-rates.png', {
      type: 'image/png',
    })

    await uploadPredefinedQuoteBrochure(file)

    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe('/api/predefined-quotes/imports/upload')
    expect(new Headers(init?.headers).get('Content-Type')).toBe('image/png')
  })
})

describe('multi-package brochure imports', () => {
  const record = (n: number) => ({
    id: `import-${n}`,
    file_name: 'ratesheet.pdf',
    file_hash: 'h',
    file_size: 10,
    status: 'needs_review',
    warnings: [],
    batch_index: n,
    batch_total: 3,
    source_pages: String(n + 2),
    created_at: '2026-10-18T00:00:00Z',
  })

  it('returns every package the brochure produced, not just the first', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      import: record(0),
      imports: [record(0), record(1), record(2)],
      duplicate: false,
    }), { status: 201, headers: { 'Content-Type': 'application/json' } })))

    const result = await uploadPredefinedQuoteBrochure(
      new File(['%PDF-'], 'ratesheet.pdf', { type: 'application/pdf' }),
    )

    expect(result.importRecords.map((r) => r.id)).toEqual(['import-0', 'import-1', 'import-2'])
    expect(result.importRecord.id).toBe('import-0')
  })

  it('still works against an older server that only sends one `import`', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      import: record(0),
      duplicate: false,
    }), { status: 201, headers: { 'Content-Type': 'application/json' } })))

    const result = await uploadPredefinedQuoteBrochure(
      new File(['%PDF-'], 'ratesheet.pdf', { type: 'application/pdf' }),
    )

    expect(result.importRecords).toHaveLength(1)
  })

  it('labels each package with its position and pages', () => {
    expect(importBatchLabel({ batch_index: 2, batch_total: 11, source_pages: '4' }))
      .toBe('Package 3 of 11 · page 4')
    expect(importBatchLabel({ batch_index: 0, batch_total: 3, source_pages: '3-4' }))
      .toBe('Package 1 of 3 · pages 3-4')
    expect(importBatchLabel({ batch_index: 1, batch_total: 3, source_pages: '3, 9' }))
      .toBe('Package 2 of 3 · pages 3, 9')
  })

  it('shows no batch label for a single or legacy import', () => {
    expect(importBatchLabel({ batch_index: 0, batch_total: 1, source_pages: null })).toBe('')
    expect(importBatchLabel({ batch_index: null, batch_total: null, source_pages: null })).toBe('')
    expect(importBatchLabel({})).toBe('')
  })
})

describe('availability labels', () => {
  it('lists months in calendar order, short or full, ignoring junk and repeats', async () => {
    const { monthsLabel } = await import('./predefinedQuotes')
    expect(monthsLabel([10, 1, 2, 2, 13, 0])).toBe('Jan, Feb, Oct')
    expect(monthsLabel([10, 1], true)).toBe('January, October')
    expect(monthsLabel([])).toBe('')
    expect(monthsLabel(undefined)).toBe('')
  })

  it('says when a package can be offered: its months, or its exact dates', async () => {
    const { availabilityLabel } = await import('./predefinedQuotes')
    expect(availabilityLabel({ availability_mode: 'period', available_months: [1, 10] })).toBe('January, October')
    expect(availabilityLabel({ availability_mode: 'fixed', travel_date: '2026-10-10', return_date: '2026-10-20' })).toMatch(/Oct.*2026.*→.*Oct.*2026/)
    expect(availabilityLabel({})).toBe('')
  })

  it('shows a period package’s months in its summary line instead of a date', async () => {
    const { quoteSummary } = await import('./predefinedQuotes')
    const summary = quoteSummary({ destination: 'Dubai', availability_mode: 'period', available_months: [1, 2, 10], items: [{ item_type: 'hotel' }] } as never)
    expect(summary).toBe('Dubai · Jan, Feb, Oct · 1 hotel')
  })
})
