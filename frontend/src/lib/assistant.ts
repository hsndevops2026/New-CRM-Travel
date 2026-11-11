import { apiFetch } from './api'

export type AssistantMode = 'data' | 'planner'

export type AssistantSuggestion = {
  title: string
  details: string
  kind: 'activity' | 'trip_idea' | 'package'
  source: 'system' | 'general'
  package_id: string | null
  price: number | null
  currency: string | null
}

export type AssistantMessage = {
  role: 'user' | 'assistant'
  content: string
  suggestions?: AssistantSuggestion[]
}

export async function askAssistant(
  messages: AssistantMessage[],
  mode: AssistantMode = 'data',
): Promise<{ reply: string; tools_used: string[]; suggestions: AssistantSuggestion[]; mode: AssistantMode }> {
  const res = await apiFetch('/api/assistant/chat', {
    method: 'POST',
    body: JSON.stringify({ messages: messages.map(({ role, content }) => ({ role, content })), mode }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'The assistant could not answer right now')
  return { suggestions: [], ...data }
}

/** Text the employee copies for the customer: only the cards they ticked. */
export function suggestionsToText(cards: AssistantSuggestion[]): string {
  return cards
    .map((c, i) => {
      const price = c.price != null && c.currency ? ` (${c.price.toLocaleString('en-US')} ${c.currency})` : ''
      return `${i + 1}. ${c.title}${price}\n${c.details}`
    })
    .join('\n\n')
}
