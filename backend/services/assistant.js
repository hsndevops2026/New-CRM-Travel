import OpenAI from 'openai';
import { openaiConfig } from '../config/openai.js';
import { assistantToolDefinitions, runAssistantTool } from './assistantTools.js';

/**
 * Staff assistant: answers questions about the CRM using read-only tools.
 * Provider is OpenAI by default; set ASSISTANT_PROVIDER=anthropic and
 * ANTHROPIC_API_KEY to run it on Claude instead.
 */

const MAX_TOOL_ROUNDS = 6;
const MAX_HISTORY = 20;
const MAX_MESSAGE_CHARS = 4000;

export function assistantConfig(env = process.env) {
  const provider = String(env.ASSISTANT_PROVIDER || 'openai').toLowerCase() === 'anthropic' ? 'anthropic' : 'openai';
  return {
    provider,
    openaiModel: env.ASSISTANT_OPENAI_MODEL || openaiConfig.model,
    anthropicModel: env.ASSISTANT_ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    anthropicKey: env.ANTHROPIC_API_KEY || '',
    openaiKey: openaiConfig.apiKey,
  };
}

export function systemPrompt(user, now = new Date()) {
  return [
    'You are the internal assistant of a travel agency CRM. You help staff, not customers.',
    `Today is ${now.toISOString().slice(0, 10)}. The user is ${user?.email || 'a staff member'} with role ${user?.role || 'agent'}.`,
    'Answer in the language the user writes in. Staff usually write Arabic; reply in clear, natural Arabic when they do.',
    'Use the tools to look up leads, quotes, reminders and messages. Never invent customers, prices, availability, bookings or dates: if the tools do not return it, say you could not find it.',
    'You cannot send messages, change records, make bookings or take payments. When asked, draft the text for the employee to review and send themselves.',
    'When you mention a lead, include the customer name and destination. Keep answers short and practical.',
  ].join('\n');
}

export function cleanHistory(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
}

async function openaiTurn({ cfg, system, history, user, client }) {
  const openai = client || (cfg.openaiKey ? new OpenAI({ apiKey: cfg.openaiKey }) : null);
  if (!openai) {
    const error = new Error('The assistant is not configured (OPENAI_API_KEY is missing)');
    error.status = 503;
    throw error;
  }
  const tools = assistantToolDefinitions.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
  const messages = [{ role: 'system', content: system }, ...history];
  const used = [];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const res = await openai.chat.completions.create({ model: cfg.openaiModel, messages, tools, temperature: 0.2 });
    const msg = res.choices?.[0]?.message;
    if (!msg) break;
    if (!msg.tool_calls?.length) return { reply: msg.content || '', tools_used: used };
    messages.push(msg);
    for (const call of msg.tool_calls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = {}; }
      const result = await runAssistantTool(call.function.name, args, user);
      used.push(call.function.name);
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 20_000) });
    }
  }
  return { reply: 'I could not finish looking that up. Please ask a more specific question.', tools_used: used };
}

async function anthropicTurn({ cfg, system, history, user, fetchImpl = fetch }) {
  if (!cfg.anthropicKey) {
    const error = new Error('The assistant is not configured (ANTHROPIC_API_KEY is missing)');
    error.status = 503;
    throw error;
  }
  const tools = assistantToolDefinitions.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const messages = history.map((m) => ({ role: m.role, content: m.content }));
  const used = [];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: cfg.anthropicModel, max_tokens: 1500, system, tools, messages }),
    });
    const data = await res.json();
    if (!res.ok) {
      const error = new Error(data?.error?.message || 'Claude request failed');
      error.status = 502;
      throw error;
    }
    const blocks = Array.isArray(data.content) ? data.content : [];
    const calls = blocks.filter((b) => b.type === 'tool_use');
    if (!calls.length) {
      return { reply: blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim(), tools_used: used };
    }
    messages.push({ role: 'assistant', content: blocks });
    const results = [];
    for (const call of calls) {
      const result = await runAssistantTool(call.name, call.input, user);
      used.push(call.name);
      results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result).slice(0, 20_000) });
    }
    messages.push({ role: 'user', content: results });
  }
  return { reply: 'I could not finish looking that up. Please ask a more specific question.', tools_used: used };
}

export async function askAssistant({ messages, user, env = process.env, openaiClient, fetchImpl, now } = {}) {
  const history = cleanHistory(messages);
  if (!history.length || history[history.length - 1].role !== 'user') {
    const error = new Error('Send a question as the last message');
    error.status = 400;
    throw error;
  }
  const cfg = assistantConfig(env);
  const system = systemPrompt(user, now);
  const result = cfg.provider === 'anthropic'
    ? await anthropicTurn({ cfg, system, history, user, fetchImpl })
    : await openaiTurn({ cfg, system, history, user, client: openaiClient });
  return { ...result, provider: cfg.provider };
}
