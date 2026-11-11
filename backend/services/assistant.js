import OpenAI from 'openai';
import { openaiConfig } from '../config/openai.js';
import {
  assistantToolDefinitions,
  proposeSuggestionsDefinition,
  runAssistantTool,
  validateSuggestions,
} from './assistantTools.js';

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

export const ASSISTANT_MODES = ['data', 'planner'];

export function normalizeMode(mode) {
  return mode === 'planner' ? 'planner' : 'data';
}

export function systemPrompt(user, now = new Date(), mode = 'data') {
  const common = [
    'You are the internal assistant of a travel agency CRM. You help staff, not customers.',
    `Today is ${now.toISOString().slice(0, 10)}. The user is ${user?.email || 'a staff member'} with role ${user?.role || 'agent'}.`,
    'Answer in the language the user writes in. Staff usually write Arabic; reply in clear, natural Arabic when they do.',
    'You cannot send messages, change records, make bookings or take payments. When asked for a message to a customer, draft it for the employee to review and send.',
    'Prices may ONLY come from the tools (packages, leads, quotes). Never state, estimate or guess a price, availability, booking or flight time that a tool did not return.',
    'When you mention a lead, include the customer name and destination. Keep answers short and practical.',
  ];
  if (mode === 'planner') {
    return [
      ...common,
      'TRIP PLANNER MODE is on: the employee asked for ideas to offer a customer.',
      'You may use general travel knowledge to suggest activities, places to visit and trip ideas that fit the weather, season, budget, interests, ages and number of travellers.',
      'First look up the lead (if one is mentioned) and the agency packages with search_packages. Prefer the agency packages when they fit.',
      'Return every suggestion through the propose_suggestions tool, one card per idea. Mark source "system" only for things taken from a package or the lead, and give the package_id. Everything else is source "general".',
      'Do not put prices in general suggestions. Do not promise exact dates, opening hours or availability; say the employee should confirm them.',
      'After calling propose_suggestions, reply with one short sentence only.',
    ].join('\n');
  }
  return [
    ...common,
    'DATA MODE: answer ONLY from what the tools return from this CRM database.',
    'Do NOT suggest destinations, trips, activities, hotels, dates or prices from your own knowledge, and do not answer general travel questions.',
    'If the answer is not in the CRM, say it is not in the system. If the employee wants ideas or a trip plan, tell them to turn on Trip planner mode.',
  ].join('\n');
}

export function cleanHistory(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
}

async function callTool(name, args, user, collect) {
  if (name === proposeSuggestionsDefinition.name) {
    if (!collect) return { error: 'Suggestions are only available in Trip planner mode' };
    const cards = await validateSuggestions(args);
    collect.push(...cards);
    return { ok: true, cards: cards.length };
  }
  return runAssistantTool(name, args, user);
}

async function openaiTurn({ cfg, system, history, user, client, toolDefs, collect }) {
  const openai = client || (cfg.openaiKey ? new OpenAI({ apiKey: cfg.openaiKey }) : null);
  if (!openai) {
    const error = new Error('The assistant is not configured (OPENAI_API_KEY is missing)');
    error.status = 503;
    throw error;
  }
  const tools = toolDefs.map((t) => ({
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
      const result = await callTool(call.function.name, args, user, collect);
      used.push(call.function.name);
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 20_000) });
    }
  }
  return { reply: 'I could not finish looking that up. Please ask a more specific question.', tools_used: used };
}

async function anthropicTurn({ cfg, system, history, user, fetchImpl = fetch, toolDefs, collect }) {
  if (!cfg.anthropicKey) {
    const error = new Error('The assistant is not configured (ANTHROPIC_API_KEY is missing)');
    error.status = 503;
    throw error;
  }
  const tools = toolDefs.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
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
      const result = await callTool(call.name, call.input, user, collect);
      used.push(call.name);
      results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result).slice(0, 20_000) });
    }
    messages.push({ role: 'user', content: results });
  }
  return { reply: 'I could not finish looking that up. Please ask a more specific question.', tools_used: used };
}

export async function askAssistant({ messages, mode, user, env = process.env, openaiClient, fetchImpl, now } = {}) {
  const history = cleanHistory(messages);
  if (!history.length || history[history.length - 1].role !== 'user') {
    const error = new Error('Send a question as the last message');
    error.status = 400;
    throw error;
  }
  const activeMode = normalizeMode(mode);
  const cfg = assistantConfig(env);
  const system = systemPrompt(user, now, activeMode);
  const toolDefs = activeMode === 'planner'
    ? [...assistantToolDefinitions, proposeSuggestionsDefinition]
    : assistantToolDefinitions;
  const collect = activeMode === 'planner' ? [] : null;
  const args = { cfg, system, history, user, toolDefs, collect };
  const result = cfg.provider === 'anthropic'
    ? await anthropicTurn({ ...args, fetchImpl })
    : await openaiTurn({ ...args, client: openaiClient });
  return { ...result, mode: activeMode, suggestions: collect || [], provider: cfg.provider };
}
