import { apiFetch } from './api'

export type AssistantMessage = { role: 'user' | 'assistant'; content: string }

export async function askAssistant(messages: AssistantMessage[]): Promise<{ reply: string; tools_used: string[] }> {
  const res = await apiFetch('/api/assistant/chat', {
    method: 'POST',
    body: JSON.stringify({ messages }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'The assistant could not answer right now')
  return data
}
