import crypto from 'crypto';
import {
  DEFAULT_ASSISTANT_MODEL,
  FALLBACK_CAPABLE_MODELS,
  ASSISTANT_MODELS,
  anthropicConfig,
} from '../config/anthropic.js';
import { assistantToolDefinitions, proposeSuggestionsDefinition } from './assistantTools.js';

/**
 * Pure helpers that turn Assistant state into a Messages API request.
 * Nothing here talks to the network or the database, so it is all unit-tested.
 */

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/** Skills Anthropic maintains; they need no upload. */
export const BUILTIN_SKILLS = Object.freeze([
  { id: 'pptx', name: 'PowerPoint', description: 'Create and edit presentations' },
  { id: 'xlsx', name: 'Excel', description: 'Create and analyse spreadsheets' },
  { id: 'docx', name: 'Word', description: 'Create and edit documents' },
  { id: 'pdf', name: 'PDF', description: 'Create, fill and read PDF files' },
]);

export const MAX_SKILLS_PER_REQUEST = 20;

// The system prompt is part of what a conversation's reasoning is tied to (see configHash),
// so keep it free of per-user text. It carries only the date: when the date changes the
// hash changes once, and older turns are then simply replayed without their reasoning.
const PROMPT_PARTS = [
  "You are the staff assistant of a travel agency's CRM. Agency staff use you to look up their leads, quotes, reminders and packages, to draft customer messages, itineraries, marketing copy and documents, to research destinations, and to create images and videos. You help staff, not customers.",
  'Answer in the language the user writes in. Staff often write Arabic; reply in clear, natural Arabic when they do.',
  'You cannot send messages, change CRM records, make bookings or take payments. When asked for a message to a customer, draft it for the employee to review and send.',
  'When the CRM tools (search_leads, get_lead, pipeline_summary, list_overdue_reminders, list_quotes_waiting_for_customer, search_packages) are available, use them for any question about the agency\'s own leads, customers, quotes, reminders or packages. Never invent CRM records. If something is not in the CRM, say it is not in the system. When you mention a lead, include the customer name and destination.',
  'Prices of the agency\'s packages and quotes may only come from the CRM tools. Never state, estimate or guess a package price, availability, booking or flight time that a tool did not return. General public information (visa rules, weather, sights) may come from your knowledge or web search; say the employee should confirm dates, opening hours and availability.',
  'If the user asks about CRM data and the CRM tools are not available, say that CRM data is switched off in the Tools menu.',
  'When the propose_suggestions tool is available and the employee wants ideas to offer a customer, first look up the lead (if one is mentioned) and the agency packages with search_packages, preferring agency packages when they fit. Return every suggestion through propose_suggestions, one card per idea, with lead_id when the ideas are for a specific lead. Mark source "system" only for things taken from a package or the lead, with its package_id; everything else is source "general" and has no price. After calling it, reply with one short sentence only.',
  'When the user asks for a picture or a video and the generate_image or generate_video tool is available, call it. Write a detailed, concrete prompt for the tool yourself instead of asking the user to write one. A generated image or video is shown to the user in the chat automatically, so do not paste links to it.',
  'Videos take a few minutes to render. After starting one, tell the user it is rendering and will appear in the chat; do not wait for it or call the tool again for the same request.',
  'If the user asks for an image or a video and those tools are not available, say that image and video generation is switched off in the Tools menu or has no OpenAI key, rather than describing the picture in words.',
  'Format replies in Markdown.',
];

export function systemPrompt(today = new Date().toISOString().slice(0, 10)) {
  return [...PROMPT_PARTS, `Today is ${today}.`].join('\n\n');
}

/** CRM lookups (read-only, scoped to the signed-in user) in Messages API tool form. */
export const CRM_TOOLS = Object.freeze(
  assistantToolDefinitions.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })),
);
export const CRM_TOOL_NAMES = new Set(CRM_TOOLS.map((tool) => tool.name));

export const SUGGESTIONS_TOOL = Object.freeze({
  name: proposeSuggestionsDefinition.name,
  description: proposeSuggestionsDefinition.description,
  input_schema: proposeSuggestionsDefinition.parameters,
});

export const IMAGE_TOOL = Object.freeze({
  name: 'generate_image',
  description:
    'Generate an image from a text prompt with an image model and show it to the user in the chat. Use it whenever the user asks for a picture, photo, illustration, poster or similar visual. The prompt should describe subject, setting, style, lighting and composition in detail.',
  eager_input_streaming: true,
  input_schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Detailed description of the image to create.' },
      aspect: {
        type: 'string',
        enum: ['square', 'landscape', 'portrait'],
        description: 'Shape of the image. Defaults to square.',
      },
    },
    required: ['prompt'],
  },
});

export const VIDEO_TOOL = Object.freeze({
  name: 'generate_video',
  description:
    'Start rendering a short video clip from a text prompt with a video model. Rendering takes a few minutes; the clip appears in the chat when it is ready. Use it when the user asks for a video or clip. The prompt should describe the scene, camera movement, style and mood in detail.',
  eager_input_streaming: true,
  input_schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Detailed description of the video to create.' },
      seconds: { type: 'integer', enum: [4, 8, 12], description: 'Clip length in seconds. Defaults to 4.' },
      orientation: {
        type: 'string',
        enum: ['landscape', 'portrait'],
        description: 'Landscape (16:9) or portrait (9:16). Defaults to landscape.',
      },
    },
    required: ['prompt'],
  },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAssistantModel(model) {
  return ASSISTANT_MODELS.some((entry) => entry.id === model);
}

export function normalizeModel(model) {
  return isAssistantModel(model) ? model : DEFAULT_ASSISTANT_MODEL;
}

/** Per-conversation tool switches, cleaned of anything the client should not be able to send. */
export function normalizeSettings(input = {}) {
  const builtin = new Set(BUILTIN_SKILLS.map((skill) => skill.id));
  const list = (value) => (Array.isArray(value) ? value : []);
  return {
    web_search: input.web_search !== false,
    image_gen: input.image_gen !== false,
    video_gen: input.video_gen !== false,
    crm_data: input.crm_data !== false,
    trip_planner: input.trip_planner === true,
    skills: [...new Set(list(input.skills).filter((id) => builtin.has(id)))],
    addons: [...new Set(list(input.addons).filter((id) => typeof id === 'string' && UUID.test(id)))],
  };
}

/** MCP server names must be unique within a request and stable for a given connector. */
export function mcpServerName(addon) {
  const slug = String(addon.name || 'connector')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'connector';
  return `${slug}-${String(addon.id).slice(0, 6)}`;
}

/**
 * Build everything about a request except `messages`.
 *
 * @param {object} input
 * @param {string} input.model
 * @param {object} input.settings      normalized settings
 * @param {Array}  input.addons        usable add-ons: { id, kind, name, config, token? }
 * @param {object} input.media         { image: boolean, video: boolean } — provider available
 * @param {string} [input.containerId] code-execution container to continue in
 * @returns {{ params: object, hash: string }}
 */
export function buildRequestConfig({ model, settings, addons = [], media = {}, containerId = null, today }) {
  const enabled = new Set(settings.addons);
  const customSkills = addons.filter((addon) => addon.kind === 'skill' && enabled.has(addon.id));
  const connectors = addons.filter((addon) => addon.kind === 'mcp' && enabled.has(addon.id));

  const skills = [
    ...settings.skills.map((id) => ({ type: 'anthropic', skill_id: id, version: 'latest' })),
    ...customSkills.map((addon) => ({ type: 'custom', skill_id: addon.config.skill_id, version: 'latest' })),
  ].slice(0, MAX_SKILLS_PER_REQUEST);
  const usesCode = skills.length > 0;

  const tools = [];
  if (settings.web_search) {
    // The newer web search runs its own code sandbox to filter results. Skills already
    // bring a sandbox, and two of them confuse the model, so use the plain version then.
    tools.push({ type: usesCode ? 'web_search_20250305' : 'web_search_20260209', name: 'web_search', max_uses: 5 });
  }
  if (usesCode) tools.push({ type: 'code_execution_20250825', name: 'code_execution' });
  for (const addon of connectors) {
    tools.push({ type: 'mcp_toolset', mcp_server_name: mcpServerName(addon) });
  }
  // Trip planner needs the CRM lookups too (it starts from the lead and the packages).
  if (settings.crm_data || settings.trip_planner) tools.push(...CRM_TOOLS);
  if (settings.trip_planner) tools.push(SUGGESTIONS_TOOL);
  if (settings.image_gen && media.image) tools.push(IMAGE_TOOL);
  if (settings.video_gen && media.video) tools.push(VIDEO_TOOL);

  const betas = [];
  const params = {
    model,
    max_tokens: anthropicConfig.maxTokens,
    system: systemPrompt(today),
    thinking: { type: 'adaptive', display: 'summarized' },
  };
  if (tools.length) params.tools = tools;

  if (connectors.length) {
    betas.push('mcp-client-2025-11-20');
    params.mcp_servers = connectors.map((addon) => ({
      type: 'url',
      name: mcpServerName(addon),
      url: addon.config.url,
      ...(addon.token ? { authorization_token: addon.token } : {}),
    }));
  }
  if (usesCode) {
    params.container = containerId ? { id: containerId, skills } : { skills };
  }
  if (anthropicConfig.refusalFallback && FALLBACK_CAPABLE_MODELS.includes(model)) {
    betas.push('server-side-fallback-2026-07-01');
    params.fallbacks = 'default';
  }
  if (betas.length) params.betas = betas;

  return { params, hash: configHash(params) };
}

/**
 * Fingerprint of the parts of a request that earlier reasoning is tied to: the model,
 * the system prompt and the set of tools. When it changes between turns, reasoning
 * blocks from before the change can no longer be replayed.
 */
export function configHash(params) {
  const tools = (params.tools || [])
    .map((tool) => JSON.stringify(tool))
    .sort();
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ model: params.model, system: params.system, tools }))
    .digest('hex')
    .slice(0, 32);
}

const THINKING_TYPES = new Set(['thinking', 'redacted_thinking']);

export function hasThinking(content) {
  return Array.isArray(content) && content.some((block) => THINKING_TYPES.has(block?.type));
}

export function stripThinking(content) {
  return Array.isArray(content) ? content.filter((block) => !THINKING_TYPES.has(block?.type)) : content;
}

/**
 * Stored rows → `messages`. Rows at or before `thinkingCutoff` are replayed without
 * their reasoning blocks (removing a leading run of them is allowed; editing anything
 * else is not, so every other block is passed back exactly as stored).
 */
export function toApiMessages(rows, { thinkingCutoff = 0 } = {}) {
  const messages = [];
  for (const row of rows) {
    const content = Number(row.seq) <= Number(thinkingCutoff) ? stripThinking(row.content) : row.content;
    if (Array.isArray(content) && content.length === 0) continue;
    messages.push({ role: row.role, content });
  }
  return messages;
}

/**
 * When a request was declined part-way and finished by a fallback model, the response
 * holds a `fallback` block. Blocks before the last one that belong to the declined
 * attempt must not be sent back; text and completed server-tool pairs may be.
 */
export function sanitizeFallbackTurn(content) {
  if (!Array.isArray(content)) return content;
  const boundary = content.map((block) => block?.type).lastIndexOf('fallback');
  if (boundary < 0) return content;
  const answered = new Set(
    content.filter((block) => block?.tool_use_id).map((block) => block.tool_use_id),
  );
  return content.filter((block, index) => {
    if (index >= boundary) return true;
    if (block.type === 'text' || block.type === 'fallback') return true;
    if (block.type === 'server_tool_use' || block.type === 'mcp_tool_use') return answered.has(block.id);
    if (String(block.type).endsWith('_tool_result')) return true;
    return false;
  });
}

/** File ids the code sandbox produced (documents made by skills). */
export function extractOutputFileIds(content) {
  const ids = new Set();
  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value.file_id === 'string') ids.add(value.file_id);
    Object.values(value).forEach(walk);
  };
  for (const block of Array.isArray(content) ? content : []) {
    if (String(block?.type || '').endsWith('_tool_result')) walk(block.content);
  }
  return [...ids];
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const TEXT_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv']);
export const MAX_ATTACHMENTS = 4;
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const MAX_ATTACHMENTS_TOTAL_BYTES = 6 * 1024 * 1024;
export const MAX_PROMPT_CHARS = 100_000;

/** A user's message → content blocks. Files go before the text, as the API recommends. */
export function buildUserContent({ text, attachments = [] }) {
  const prompt = String(text || '').trim();
  if (!prompt && attachments.length === 0) throw httpError(400, 'Write a message first');
  if (prompt.length > MAX_PROMPT_CHARS) throw httpError(400, 'That message is too long');
  if (!Array.isArray(attachments) || attachments.length > MAX_ATTACHMENTS) {
    throw httpError(400, `Attach at most ${MAX_ATTACHMENTS} files`);
  }

  const blocks = [];
  let total = 0;
  for (const file of attachments) {
    const name = String(file?.name || 'file').slice(0, 200);
    const type = String(file?.media_type || '').toLowerCase();
    const data = String(file?.data || '').replace(/\s+/g, '');
    if (!data || !/^[A-Za-z0-9+/]+=*$/.test(data)) throw httpError(400, `${name} could not be read`);
    const bytes = Math.floor((data.length * 3) / 4);
    total += bytes;
    if (bytes > MAX_ATTACHMENT_BYTES) throw httpError(400, `${name} is larger than 4 MB`);
    if (total > MAX_ATTACHMENTS_TOTAL_BYTES) throw httpError(400, 'Attachments are larger than 6 MB in total');

    if (IMAGE_TYPES.has(type)) {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: type, data } });
    } else if (type === 'application/pdf') {
      blocks.push({ type: 'document', title: name, source: { type: 'base64', media_type: type, data } });
    } else if (TEXT_TYPES.has(type)) {
      blocks.push({
        type: 'document',
        title: name,
        source: { type: 'text', media_type: 'text/plain', data: Buffer.from(data, 'base64').toString('utf8') },
      });
    } else {
      throw httpError(400, `${name}: only images, PDFs and text files can be attached`);
    }
  }
  if (prompt) blocks.push({ type: 'text', text: prompt });
  return blocks;
}

export function titleFromText(text) {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  if (!line) return 'New chat';
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
}

/** Tool inputs arrive unvalidated when streamed eagerly, so check them before use. */
export function parseImageToolInput(input) {
  const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt) return null;
  const aspect = ['square', 'landscape', 'portrait'].includes(input.aspect) ? input.aspect : 'square';
  return { prompt: prompt.slice(0, 4000), aspect };
}

export function parseVideoToolInput(input) {
  const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt) return null;
  const seconds = [4, 8, 12].includes(Number(input.seconds)) ? Number(input.seconds) : 4;
  const orientation = input.orientation === 'portrait' ? 'portrait' : 'landscape';
  return { prompt: prompt.slice(0, 4000), seconds, orientation };
}
