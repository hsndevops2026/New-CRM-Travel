import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLanguage } from '../lib/i18n'
import type { Conversation, AssistantState, StreamEvent } from '../lib/assistant'
import AssistantPage from './AssistantPage'

const api = vi.hoisted(() => ({
  fetchAssistantState: vi.fn(),
  fetchConversations: vi.fn(),
  fetchConversation: vi.fn(),
  createConversation: vi.fn(),
  sendMessage: vi.fn(),
  generateMedia: vi.fn(),
  deleteConversation: vi.fn(),
}))

vi.mock('../lib/tripPlan', () => ({ addTripPlanItems: vi.fn() }))
vi.mock('../lib/leads', () => ({ fetchLeads: vi.fn().mockResolvedValue([]) }))

vi.mock('../lib/assistant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/assistant')>()),
  ...api,
}))

const info = (active: 'agency' | null) => ({ active, user: null, agency: active ? { hint: '…1234', updated_at: '' } : null, env: false })

const state = (over: Partial<AssistantState> = {}): AssistantState => ({
  connections: { anthropic: info('agency'), openai: info('agency') },
  can_manage_agency: false,
  models: [
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Best all-round' },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Fastest' },
  ],
  default_model: 'claude-opus-5-5',
  media: { image: true, video: true },
  builtin_skills: [{ id: 'pptx', name: 'PowerPoint', description: 'Create presentations' }],
  addons: [],
  ...over,
})

const conversation: Conversation = {
  id: 'c1', title: 'Plan a trip', model: 'claude-opus-5-5',
  settings: { web_search: true, image_gen: true, video_gen: true, crm_data: true, trip_planner: false, skills: [], addons: [] },
  created_at: '', updated_at: '',
}

function renderPage(path = '/assistant') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/assistant" element={<AssistantPage />} />
        <Route path="/assistant/:conversationId" element={<AssistantPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AssistantPage', () => {
  // These tests read the English labels; the app itself starts in Arabic.
  beforeAll(() => setLanguage('en'))

  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset())
    localStorage.clear()
    api.fetchConversations.mockResolvedValue([])
  })

  it('asks for an API key, and says a subscription will not work, when Claude is not connected', async () => {
    api.fetchAssistantState.mockResolvedValue(state({ connections: { anthropic: info(null), openai: info(null) }, media: { image: false, video: false } }))
    renderPage()
    expect(await screen.findByText('Connect Claude to start')).toBeTruthy()
    expect(screen.getByText(/claude\.ai subscription cannot be used here/)).toBeTruthy()
    expect((screen.getByLabelText('Message') as HTMLTextAreaElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Add an API key' }))
    expect(await screen.findByRole('dialog', { name: 'Connections' })).toBeTruthy()
    // An agent may add a personal key but not change the agency one.
    expect(screen.getAllByText('Only an admin can change the agency key.').length).toBe(2)
  })

  it('creates a chat on the first message, streams the reply, and clears the box once it is stored', async () => {
    api.fetchAssistantState.mockResolvedValue(state())
    api.createConversation.mockResolvedValue(conversation)
    let finish: () => void = () => {}
    api.sendMessage.mockImplementation(async (_id: string, _body: unknown, onEvent: (event: StreamEvent) => void) => {
      onEvent({ type: 'row', row: { seq: 1, role: 'user', content: [{ type: 'text', text: 'Plan a trip' }], meta: {}, created_at: '' } })
      onEvent({ type: 'activity', label: 'Searching the web…' })
      onEvent({ type: 'delta', text: 'Here is a **plan**' })
      await new Promise<void>((resolve) => { finish = resolve })
      onEvent({ type: 'row', row: { seq: 2, role: 'assistant', content: [{ type: 'text', text: 'Here is a **plan** for Goa.' }], meta: {}, created_at: '' } })
      onEvent({ type: 'done', conversation })
    })

    renderPage()
    const input = (await screen.findByLabelText('Message')) as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'Plan a trip' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    // While streaming: the partial reply shows and the send button becomes Stop.
    expect(await screen.findByText('plan')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop generating' })).toBeTruthy()
    expect(input.value).toBe('')
    expect(api.createConversation).toHaveBeenCalledWith('claude-opus-5-5', expect.objectContaining({ web_search: true }))
    expect(api.sendMessage.mock.calls[0][0]).toBe('c1')
    expect(api.sendMessage.mock.calls[0][1]).toMatchObject({ text: 'Plan a trip', model: 'claude-opus-5-5' })
    // Navigating to the new chat must not reload it over the reply being streamed.
    expect(api.fetchConversation).not.toHaveBeenCalled()

    finish()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeTruthy())
    expect(screen.getByText(/for Goa/)).toBeTruthy()
    expect(screen.getAllByText('Plan a trip').length).toBeGreaterThan(0)
  })

  it('keeps what was typed when the message could not be sent', async () => {
    api.fetchAssistantState.mockResolvedValue(state())
    api.createConversation.mockResolvedValue(conversation)
    api.sendMessage.mockRejectedValue(new Error('You are sending messages too quickly. Wait a moment.'))
    renderPage()
    const input = (await screen.findByLabelText('Message')) as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'Hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByText('You are sending messages too quickly. Wait a moment.')).toBeTruthy()
    expect(input.value).toBe('Hello')
  })

  it('sends an Image mode request straight to generation and shows the result', async () => {
    api.fetchAssistantState.mockResolvedValue(state())
    api.fetchConversations.mockResolvedValue([conversation])
    api.fetchConversation.mockResolvedValue({ conversation, messages: [], media: [] })
    api.generateMedia.mockResolvedValue({
      conversation,
      media: { id: 'm1', kind: 'image', prompt: 'A beach in Bali', status: 'ready', url: 'https://cdn.example/x.png', mime: 'image/png', error: null, created_at: '' },
      messages: [
        { seq: 1, role: 'user', content: [{ type: 'text', text: 'A beach in Bali' }], meta: { mode: 'image' }, created_at: '' },
        { seq: 2, role: 'assistant', content: [{ type: 'text', text: '(An image was generated…)' }], meta: { direct: true, media: ['m1'] }, created_at: '' },
      ],
    })
    renderPage('/assistant/c1')
    fireEvent.click(await screen.findByRole('tab', { name: 'Image' }))
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'A beach in Bali' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))

    const image = (await screen.findByRole('img', { name: 'A beach in Bali' })) as HTMLImageElement
    expect(image.src).toBe('https://cdn.example/x.png')
    expect(api.generateMedia).toHaveBeenCalledWith('c1', { kind: 'image', aspect: 'landscape', prompt: 'A beach in Bali' })
    expect(api.sendMessage).not.toHaveBeenCalled()
    expect(screen.getByText('Image request')).toBeTruthy()
    expect(screen.queryByText('(An image was generated…)')).toBeNull()
  })

  it('lists the tools Claude may use and lets them be switched off', async () => {
    api.fetchAssistantState.mockResolvedValue(
      state({
        media: { image: false, video: false },
        addons: [{ id: 'a1', kind: 'mcp', name: 'Notion', scope: 'user', description: null, url: 'https://mcp.example/mcp', has_token: true, available: true, created_at: '' }],
      }),
    )
    api.createConversation.mockResolvedValue(conversation)
    api.sendMessage.mockResolvedValue(undefined)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Tools/ }))
    const dialog = screen.getByRole('dialog', { name: 'Tools Claude can use' })
    expect(dialog).toBeTruthy()
    // No OpenAI key: the media tools cannot be switched on.
    expect((screen.getByLabelText(/Image generation/) as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(screen.getByLabelText(/Web search/))
    fireEvent.click(screen.getByLabelText(/PowerPoint/))
    fireEvent.click(screen.getByLabelText(/Notion/))

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Make a deck' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalled())
    expect(api.sendMessage.mock.calls[0][1].settings).toMatchObject({ web_search: false, skills: ['pptx'], addons: ['a1'] })
  })

  it('has CRM data on by default and lets Trip planner be switched on', async () => {
    api.fetchAssistantState.mockResolvedValue(state())
    api.createConversation.mockResolvedValue(conversation)
    api.sendMessage.mockResolvedValue(undefined)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Tools/ }))
    expect((screen.getByLabelText(/CRM data/) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByLabelText(/Trip planner/))
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Ideas for Rana' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalled())
    expect(api.sendMessage.mock.calls[0][1].settings).toMatchObject({ crm_data: true, trip_planner: true })
  })

  it('shows CRM lookups as steps and Trip planner ideas as pickable cards when a chat is opened', async () => {
    api.fetchAssistantState.mockResolvedValue(state())
    api.fetchConversations.mockResolvedValue([conversation])
    api.fetchConversation.mockResolvedValue({
      conversation,
      media: [],
      messages: [
        { seq: 1, role: 'user', content: [{ type: 'text', text: 'Ideas for Rana in Istanbul' }], meta: {}, created_at: '' },
        {
          seq: 2,
          role: 'assistant',
          content: [{ type: 'tool_use', id: 't1', name: 'search_packages', input: { destination: 'Istanbul' } }],
          meta: {},
          created_at: '',
        },
        { seq: 3, role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{}' }], meta: {}, created_at: '' },
        {
          seq: 4,
          role: 'assistant',
          content: [{ type: 'tool_use', id: 't2', name: 'propose_suggestions', input: {} }],
          meta: {
            suggestions: [
              { title: 'Istanbul family package', details: 'Fits the budget', kind: 'package', source: 'system', package_id: 'p1', price: 1890, currency: 'USD' },
              { title: 'Bosphorus cruise', details: 'Good in mild weather', kind: 'activity', source: 'general', package_id: null, price: null, currency: null },
            ],
            lead: { id: 'lead-1', customer_name: 'Rana', destination: 'Istanbul' },
          },
          created_at: '',
        },
      ],
    })
    renderPage('/assistant/c1')
    expect(await screen.findByText('Searched packages')).toBeTruthy()
    expect(screen.getByText('Istanbul family package')).toBeTruthy()
    expect(screen.getByText('Bosphorus cruise')).toBeTruthy()
    // Tool results are plumbing and never shown as a message.
    expect(screen.queryByText('{}')).toBeNull()
  })
})
