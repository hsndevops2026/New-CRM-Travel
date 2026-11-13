import { describe, expect, it } from 'vitest'
import {
  isHiddenMessage,
  messageParts,
  readNdjson,
  type AssistantMessage,
  type StreamEvent,
} from './assistant'

function streamOf(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk))
      controller.close()
    },
  })
}

const message = (over: Partial<AssistantMessage>): AssistantMessage => ({
  seq: 1, role: 'assistant', content: [], meta: {}, created_at: '2026-01-01T00:00:00Z', ...over,
})

describe('readNdjson', () => {
  it('reassembles events split across chunks, including inside a multi-byte character', async () => {
    const bytes = new TextEncoder().encode(
      '{"type":"delta","text":"Zürich ✈"}\n{"type":"activity","label":"Thinking…"}\n\n{"type":"reset"}',
    )
    // Cut inside "ü" (2 bytes) and inside the second line.
    const cut = bytes.indexOf(0xc3) + 1
    const events: StreamEvent[] = []
    await readNdjson(streamOf([bytes.slice(0, cut), bytes.slice(cut, 60), bytes.slice(60)]), (event) => events.push(event))
    expect(events).toEqual([
      { type: 'delta', text: 'Zürich ✈' },
      { type: 'activity', label: 'Thinking…' },
      { type: 'reset' },
    ])
  })

  it('skips a broken line and carries on', async () => {
    const events: StreamEvent[] = []
    await readNdjson(streamOf([new TextEncoder().encode('not json\n{"type":"reset"}\n')]), (event) => events.push(event))
    expect(events).toEqual([{ type: 'reset' }])
  })
})

describe('messageParts', () => {
  it('shows text, reasoning summaries, tool steps and search sources in order', () => {
    const parts = messageParts(
      message({
        content: [
          { type: 'thinking', thinking: 'Checking flights first.', signature: 's' },
          { type: 'thinking', thinking: '', signature: 's2' },
          { type: 'server_tool_use', id: 'a', name: 'web_search', input: { query: 'thailand visa india' } },
          {
            type: 'web_search_tool_result',
            tool_use_id: 'a',
            content: [
              { type: 'web_search_result', title: 'Thai e-visa', url: 'https://example.com/visa' },
              { type: 'web_search_result', title: 'Bad link', url: 'javascript:alert(1)' },
            ],
          },
          { type: 'mcp_tool_use', id: 'b', name: 'search_pages', server_name: 'notion-abc123', input: {} },
          { type: 'tool_use', id: 'c', name: 'generate_image', input: { prompt: 'a beach' } },
          { type: 'text', text: 'Here you go.' },
          { type: 'some_future_block' },
        ],
      }),
    )
    expect(parts).toEqual([
      { kind: 'thinking', text: 'Checking flights first.' },
      { kind: 'step', label: 'Searched the web', detail: 'thailand visa india' },
      { kind: 'sources', items: [{ title: 'Thai e-visa', url: 'https://example.com/visa' }] },
      { kind: 'step', label: 'Used notion-abc123', detail: 'search_pages' },
      { kind: 'step', label: 'Generated an image', detail: 'a beach' },
      { kind: 'text', text: 'Here you go.' },
    ])
  })

  it('shows a user’s attachments and hides the note recorded for Image mode', () => {
    const user = messageParts(
      message({
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
          { type: 'document', title: 'rates.pdf', source: { type: 'base64', media_type: 'application/pdf', data: 'AAAA' } },
          { type: 'text', text: 'Summarise these' },
        ],
      }),
    )
    expect(user).toEqual([
      { kind: 'image', src: 'data:image/png;base64,AAAA' },
      { kind: 'document', name: 'rates.pdf' },
      { kind: 'text', text: 'Summarise these' },
    ])
    const direct = message({ meta: { direct: true, media: ['m1'] }, content: [{ type: 'text', text: '(An image was generated…)' }] })
    expect(messageParts(direct)).toEqual([])
  })
})

describe('isHiddenMessage', () => {
  it('hides tool results but not what the user typed', () => {
    expect(isHiddenMessage(message({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] }))).toBe(true)
    expect(isHiddenMessage(message({ role: 'user', content: [{ type: 'text', text: 'hi' }] }))).toBe(false)
    expect(isHiddenMessage(message({ role: 'assistant', content: [] }))).toBe(false)
  })
})
