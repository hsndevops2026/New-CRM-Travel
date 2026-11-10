import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TestWhatsAppModal from './TestWhatsAppModal'
import * as leads from '../lib/leads'

vi.mock('../lib/leads', async () => {
  const actual = await vi.importActual<typeof leads>('../lib/leads')
  return { ...actual, simulateVoiceMessage: vi.fn(), simulateWhatsAppMessage: vi.fn() }
})

const simulateVoice = vi.mocked(leads.simulateVoiceMessage)

/** jsdom has no audio decoding or object URLs. */
class FakeAudio {
  preload = ''
  onloadedmetadata: (() => void) | null = null
  duration = 6.4
  set src(_value: string) {
    queueMicrotask(() => this.onloadedmetadata?.())
  }
}

class FakeMediaRecorder {
  static isTypeSupported = (type: string) => type === 'audio/webm;codecs=opus'
  state: 'inactive' | 'recording' = 'inactive'
  mimeType = 'audio/webm;codecs=opus'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  start() { this.state = 'recording' }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['voice-bytes'], { type: this.mimeType }) })
    this.onstop?.()
  }
}

const lead = { id: 'lead-12345678', booking_type: 'hotel', destination: 'Dubai' } as leads.Lead

/** A full SimulateWhatsAppResult with sensible defaults, so tests state only what matters. */
const intake = (overrides: Partial<leads.SimulateWhatsAppResult> = {}): leads.SimulateWhatsAppResult => ({
  phone: '9990001111',
  complete: false,
  missing: [],
  collected: {},
  reply: '',
  lead: null,
  ...overrides,
})

function setup() {
  const onLeadCreated = vi.fn()
  render(<TestWhatsAppModal open onClose={() => {}} onLeadCreated={onLeadCreated} />)
  return { onLeadCreated }
}

function attach(name = 'note.ogg', type = 'audio/ogg') {
  const file = new File(['audio-bytes'], name, { type })
  fireEvent.change(screen.getByTestId('voice-file-input'), { target: { files: [file] } })
  return file
}

beforeEach(() => {
  // jsdom implements neither of these; the dialog scrolls its chat and plays audio.
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('Audio', FakeAudio)
  URL.createObjectURL = vi.fn(() => 'blob:fake')
  URL.revokeObjectURL = vi.fn()
  simulateVoice.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

describe('Test WhatsApp — voice notes', () => {
  it('previews an attached file before anything is sent', async () => {
    setup()
    attach('Dubai trip.m4a', 'audio/mp4')

    expect(await screen.findByText(/Dubai trip\.m4a/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send voice note' })).toBeTruthy()
    expect(simulateVoice).not.toHaveBeenCalled()
  })

  it('sends the voice note with the test phone and shows what was heard and the reply', async () => {
    simulateVoice.mockResolvedValue({
      transcript: 'Hi, I would like to book a hotel in Dubai.',
      result: intake({ missing: ['travel_date'], reply: 'What are your dates?' }),
    })
    setup()
    const file = attach()

    fireEvent.click(await screen.findByRole('button', { name: 'Send voice note' }))

    expect(await screen.findByText('🎤 “Hi, I would like to book a hotel in Dubai.”')).toBeTruthy()
    expect(screen.getByText('What are your dates?')).toBeTruthy()
    expect(screen.getByText(/Still need: travel_date/)).toBeTruthy()
    const [blob, options] = simulateVoice.mock.calls[0]
    expect(blob).toBe(file)
    expect(options?.phone).toBe('9990001111')
  })

  it('reports a created lead to the page, like a typed message does', async () => {
    simulateVoice.mockResolvedValue({
      transcript: 'hotel in Dubai, 10 to 15 December, two adults',
      result: intake({ complete: true, reply: 'Our agent will contact you soon.', lead }),
    })
    const { onLeadCreated } = setup()
    attach()

    fireEvent.click(await screen.findByRole('button', { name: 'Send voice note' }))

    await waitFor(() => expect(onLeadCreated).toHaveBeenCalledWith(lead))
    expect(screen.getByText(/Lead created \(lead-123/)).toBeTruthy()
  })

  it('shows the customer-facing reply when there was nothing to process (silence)', async () => {
    simulateVoice.mockResolvedValue({
      transcript: '',
      skipped: 'empty',
      reply: "I couldn't make out that voice message.",
    })
    const { onLeadCreated } = setup()
    attach()

    fireEvent.click(await screen.findByRole('button', { name: 'Send voice note' }))

    expect(await screen.findByText(/couldn't make out that voice message/)).toBeTruthy()
    expect(onLeadCreated).not.toHaveBeenCalled()
  })

  it('shows the error and marks the voice note failed when processing fails', async () => {
    simulateVoice.mockRejectedValue(new Error('Unsupported audio format: audio/amr'))
    setup()
    attach()

    fireEvent.click(await screen.findByRole('button', { name: 'Send voice note' }))

    expect(await screen.findByText('Unsupported audio format: audio/amr')).toBeTruthy()
    expect(screen.getByText(/Voice note.*failed/)).toBeTruthy()
  })

  it('shows the transcript as soon as the worker has it, before the lead step finishes', async () => {
    let finish: (v: leads.SimulateVoiceOutcome) => void = () => {}
    simulateVoice.mockImplementation((_blob, options) => {
      options?.onStatus?.({ status: 'processing', transcript: 'a hotel in Dubai' })
      return new Promise((resolve) => { finish = resolve })
    })
    setup()
    attach()

    fireEvent.click(await screen.findByRole('button', { name: 'Send voice note' }))
    expect(await screen.findByText('🎤 “a hotel in Dubai”')).toBeTruthy()

    await act(async () => { finish({ transcript: 'a hotel in Dubai', result: null, skipped: 'empty', reply: 'x' }) })
  })

  it('rejects a file that is not audio', async () => {
    setup()
    attach('photo.png', 'image/png')
    expect(await screen.findByText(/Choose an audio file/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send voice note' })).toBeNull()
  })

  it('lets the tester discard a clip instead of sending it', async () => {
    setup()
    attach()
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }))
    expect(screen.queryByRole('button', { name: 'Send voice note' })).toBeNull()
    expect(simulateVoice).not.toHaveBeenCalled()
  })
})

describe('Test WhatsApp — recording from the microphone', () => {
  const stopTrack = vi.fn()

  beforeEach(() => {
    stopTrack.mockClear()
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) },
    })
  })

  it('records, stops, releases the microphone and offers a preview to send', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /Record voice note/ }))

    const stop = await screen.findByRole('button', { name: /Stop/ })
    fireEvent.click(stop)

    expect(await screen.findByRole('button', { name: 'Send voice note' })).toBeTruthy()
    expect(screen.getByText(/Recording/)).toBeTruthy()
    expect(stopTrack).toHaveBeenCalled() // the mic is not left open
  })

  it('sends a recording through the voice test', async () => {
    simulateVoice.mockResolvedValue({
      transcript: 'two adults',
      result: intake({ reply: 'ok' }),
    })
    setup()
    fireEvent.click(screen.getByRole('button', { name: /Record voice note/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Stop/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Send voice note' }))

    await waitFor(() => expect(simulateVoice).toHaveBeenCalledTimes(1))
    const [blob] = simulateVoice.mock.calls[0]
    expect((blob as Blob).type).toBe('audio/webm;codecs=opus')
    expect((blob as Blob).size).toBeGreaterThan(0)
  })

  it('explains a blocked microphone and points to the file option', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) },
    })
    setup()
    fireEvent.click(screen.getByRole('button', { name: /Record voice note/ }))
    expect(await screen.findByText(/Microphone access was blocked/)).toBeTruthy()
  })

  it('says so when the browser cannot record at all', async () => {
    vi.stubGlobal('MediaRecorder', undefined)
    setup()
    fireEvent.click(screen.getByRole('button', { name: /Record voice note/ }))
    expect(await screen.findByText(/Recording is not supported in this browser/)).toBeTruthy()
  })
})
