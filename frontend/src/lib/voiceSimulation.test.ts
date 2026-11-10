import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  audioContentType,
  fetchSimulatedVoice,
  simulateVoiceMessage,
  startSimulatedVoice,
} from './leads'

afterEach(() => vi.unstubAllGlobals())

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('audioContentType', () => {
  it('trusts a real audio type from the browser', () => {
    expect(audioContentType(new Blob(['x'], { type: 'audio/webm;codecs=opus' }))).toBe('audio/webm;codecs=opus')
  })

  it('falls back to the extension when the browser leaves the type empty', () => {
    const noType = new Blob(['x'])
    expect(audioContentType(noType, 'Voice 1.m4a')).toBe('audio/mp4')
    expect(audioContentType(noType, 'note.OGG')).toBe('audio/ogg')
    expect(audioContentType(noType, 'note.opus')).toBe('audio/ogg')
    expect(audioContentType(noType, 'clip.mp3')).toBe('audio/mpeg')
    expect(audioContentType(noType, 'clip.wav')).toBe('audio/wav')
  })

  it('does not call a non-audio file audio', () => {
    expect(audioContentType(new Blob(['x'], { type: 'image/png' }), 'x.png')).toBe('image/png')
  })
})

describe('startSimulatedVoice', () => {
  it('posts the raw audio with its type, phone and length', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ job_id: 'voice-sim-1', status: 'queued' }, 202))
    vi.stubGlobal('fetch', fetchMock)
    const blob = new Blob(['audio'], { type: 'audio/webm;codecs=opus' })

    const jobId = await startSimulatedVoice(blob, { phone: '9990001111', seconds: 7.46 })

    expect(jobId).toBe('voice-sim-1')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('/api/leads/simulate-voice')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(blob)
    const headers = new Headers(init.headers)
    expect(headers.get('Content-Type')).toBe('audio/webm;codecs=opus')
    expect(headers.get('X-Phone')).toBe('9990001111')
    expect(headers.get('X-Audio-Seconds')).toBe('7.5')
  })

  it('surfaces the server’s reason when the upload is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'Unsupported audio format "image/png".' }, 415)))
    await expect(startSimulatedVoice(new Blob(['x'], { type: 'audio/ogg' }))).rejects.toThrow(/Unsupported audio format/)
  })
})

describe('simulateVoiceMessage', () => {
  const outcome = { transcript: 'hotel in Dubai', result: { reply: 'Which dates?', complete: false } }

  it('polls through queued and processing until the worker is done', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ job_id: 'voice-sim-2', status: 'queued' }, 202))
      .mockResolvedValueOnce(json({ status: 'queued' }))
      .mockResolvedValueOnce(json({ status: 'processing', transcript: 'hotel in Dubai' }))
      .mockResolvedValueOnce(json({ status: 'done', outcome }))
    vi.stubGlobal('fetch', fetchMock)
    const seen: string[] = []

    const result = await simulateVoiceMessage(new Blob(['x'], { type: 'audio/ogg' }), {
      intervalMs: 1,
      onStatus: (s) => seen.push(s.status),
    })

    expect(result).toEqual(outcome)
    expect(seen).toEqual(['queued', 'processing', 'done'])
    expect(String(fetchMock.mock.calls[1][0])).toBe('/api/leads/simulate-voice/voice-sim-2')
  })

  it('throws the worker’s error when the job fails', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ job_id: 'voice-sim-3' }, 202))
      .mockResolvedValueOnce(json({ status: 'failed', error: 'Unsupported audio format: audio/amr' })))
    await expect(
      simulateVoiceMessage(new Blob(['x'], { type: 'audio/ogg' }), { intervalMs: 1 }),
    ).rejects.toThrow('Unsupported audio format: audio/amr')
  })

  it('gives up with a helpful message instead of polling forever', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ job_id: 'voice-sim-4' }, 202))
      .mockResolvedValue(json({ status: 'queued' })))
    await expect(
      simulateVoiceMessage(new Blob(['x'], { type: 'audio/ogg' }), { intervalMs: 1, timeoutMs: 20 }),
    ).rejects.toThrow(/worker is running/)
  })

  it('stops when the test expired on the server', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ job_id: 'voice-sim-5' }, 202))
      .mockResolvedValueOnce(json({ error: 'Voice test not found (it may have expired)' }, 404)))
    await expect(
      simulateVoiceMessage(new Blob(['x'], { type: 'audio/ogg' }), { intervalMs: 1 }),
    ).rejects.toThrow(/not found/)
  })
})

describe('fetchSimulatedVoice', () => {
  it('encodes the job id in the URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ status: 'queued' }))
    vi.stubGlobal('fetch', fetchMock)
    await fetchSimulatedVoice('voice-sim-a/b')
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/leads/simulate-voice/voice-sim-a%2Fb')
  })
})
