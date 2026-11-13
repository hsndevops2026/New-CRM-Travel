import Anthropic from '@anthropic-ai/sdk';
import { anthropicConfig } from '../config/anthropic.js';
import { logError } from './logger.js';
import { usableAddons } from './assistantAddons.js';
import { runAssistantTool, validateSuggestions } from './assistantTools.js';
import { requireAnthropic } from './assistantConnections.js';
import { generateImage, mediaAvailability, startVideo } from './assistantMedia.js';
import {
  CRM_TOOL_NAMES,
  SUGGESTIONS_TOOL,
  buildRequestConfig,
  extractOutputFileIds,
  normalizeSettings,
  parseImageToolInput,
  parseVideoToolInput,
  sanitizeFallbackTurn,
  stripThinking,
  titleFromText,
  toApiMessages,
} from './assistantRequest.js';
import {
  appendMessages,
  listMessages,
  maxMessageSeq,
  publicMedia,
  publicMessage,
  setConversationState,
} from './assistantStore.js';

/** Short status line shown while a block is being produced. */
function activityFor(block) {
  switch (block?.type) {
    case 'thinking':
    case 'redacted_thinking':
      return 'Thinking…';
    case 'server_tool_use':
      if (block.name === 'web_search') return 'Searching the web…';
      if (block.name === 'web_fetch') return 'Reading a page…';
      return 'Running code…';
    case 'mcp_tool_use':
      return `Using ${block.server_name || 'a connector'}…`;
    case 'tool_use':
      if (block.name === 'generate_image') return 'Preparing an image…';
      if (block.name === 'generate_video') return 'Preparing a video…';
      if (block.name === SUGGESTIONS_TOOL.name) return 'Preparing suggestions…';
      if (CRM_TOOL_NAMES.has(block.name)) return 'Looking it up in the CRM…';
      return 'Using a tool…';
    default:
      return null;
  }
}

/** Turn a provider failure into a message a user can act on. */
export function describeChatError(error) {
  if (error?.status && !(error instanceof Anthropic.APIError)) {
    return { status: error.status, message: error.message };
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return { status: 401, message: 'The Claude API key was rejected. Update it under Connections.' };
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return { status: 403, message: `The Claude API key is not allowed to do this: ${error.message}` };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { status: 429, message: 'Claude is rate limited right now. Wait a moment and try again.' };
  }
  if (error instanceof Anthropic.BadRequestError) {
    return { status: 400, message: `Claude rejected the request: ${error.message}` };
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return { status: 502, message: 'Could not reach Claude. Check the connection and try again.' };
  }
  if (error instanceof Anthropic.APIError) {
    return { status: 502, message: `Claude returned an error (${error.status ?? 'unknown'}). Try again.` };
  }
  return { status: 500, message: 'Something went wrong while generating the reply.' };
}

async function describeFiles(client, content) {
  const files = [];
  for (const fileId of extractOutputFileIds(content)) {
    try {
      const info = await client.files.retrieveMetadata(fileId);
      files.push({ file_id: fileId, filename: info.filename, mime_type: info.mime_type, size_bytes: info.size_bytes });
    } catch (error) {
      logError('assistant.chat.file_metadata', error, { file_id: fileId });
      files.push({ file_id: fileId, filename: 'file', mime_type: null, size_bytes: null });
    }
  }
  return files;
}

/** Read-only CRM lookups run as the signed-in user, so an agent only sees their own leads. */
async function runCrmTool(tool, admin) {
  const result = await runAssistantTool(tool.name, tool.input, admin);
  return {
    type: 'tool_result',
    tool_use_id: tool.id,
    ...(result?.error ? { is_error: true } : {}),
    content: JSON.stringify(result).slice(0, 20_000),
  };
}

/** Trip-planner cards: prices are taken from real packages only, never from the model. */
async function runSuggestionsTool(tool, admin) {
  const cards = await validateSuggestions(tool.input);
  let lead = null;
  if (tool.input?.lead_id) {
    // Same permission check as get_lead: an agent can only target their own leads.
    const found = await runAssistantTool('get_lead', { lead_id: tool.input.lead_id }, admin);
    if (found?.lead) {
      lead = { id: found.lead.id, customer_name: found.lead.customer_name, destination: found.lead.destination };
    }
  }
  return {
    cards,
    lead,
    result: {
      type: 'tool_result',
      tool_use_id: tool.id,
      content: JSON.stringify({ ok: true, cards: cards.length, lead: lead ? 'linked' : 'none' }),
    },
  };
}

/** Run the tools Claude asked for that execute on our side (CRM lookups, image and video). */
async function runClientTools({ toolUses, admin, conversationId, emit }) {
  const adminId = admin.id;
  const results = [];
  const media = [];
  const suggestions = [];
  let lead = null;
  for (const tool of toolUses) {
    const invalid = (label) =>
      results.push({
        type: 'tool_result',
        tool_use_id: tool.id,
        is_error: true,
        content: JSON.stringify({ INVALID_INPUT: label, received: JSON.stringify(tool.input ?? null) }),
      });

    if (tool.name === 'generate_image') {
      const input = parseImageToolInput(tool.input);
      if (!input) {
        invalid('prompt is required');
        continue;
      }
      emit({ type: 'activity', label: 'Generating an image…' });
      const row = await generateImage({ adminId, conversationId, ...input });
      media.push(row);
      emit({ type: 'media', media: publicMedia(row) });
      results.push(
        row.status === 'ready'
          ? { type: 'tool_result', tool_use_id: tool.id, content: 'The image was generated and is now shown to the user in the chat.' }
          : { type: 'tool_result', tool_use_id: tool.id, is_error: true, content: `Image generation failed: ${row.error}` },
      );
    } else if (tool.name === 'generate_video') {
      const input = parseVideoToolInput(tool.input);
      if (!input) {
        invalid('prompt is required');
        continue;
      }
      emit({ type: 'activity', label: 'Starting a video render…' });
      const row = await startVideo({ adminId, conversationId, ...input });
      media.push(row);
      emit({ type: 'media', media: publicMedia(row) });
      results.push(
        row.status === 'failed'
          ? { type: 'tool_result', tool_use_id: tool.id, is_error: true, content: `Video generation failed: ${row.error}` }
          : { type: 'tool_result', tool_use_id: tool.id, content: 'The video is rendering. It will appear in the chat by itself in a few minutes; do not start it again.' },
      );
    } else if (CRM_TOOL_NAMES.has(tool.name)) {
      results.push(await runCrmTool(tool, admin));
    } else if (tool.name === SUGGESTIONS_TOOL.name) {
      const out = await runSuggestionsTool(tool, admin);
      suggestions.push(...out.cards);
      lead = out.lead || lead;
      results.push(out.result);
    } else {
      results.push({ type: 'tool_result', tool_use_id: tool.id, is_error: true, content: `Unknown tool: ${tool.name}` });
    }
  }
  return { results, media, suggestions, lead };
}

/**
 * Run one user turn: store the message, call Claude (streaming), run any tools it asks
 * for, and store the replies.
 *
 * `emit` receives progress events for the browser:
 *   { type: 'row', row }        a stored message
 *   { type: 'delta', text }     text being written
 *   { type: 'activity', label } what Claude is doing right now
 *   { type: 'reset' }           discard the text streamed for the current step
 *   { type: 'media', media }    an image or video was created
 *
 * @returns {Promise<{ title: string }>}
 */
export async function runTurn({ admin, conversation, userContent, userText, emit, signal, connection }) {
  const adminId = admin.id;
  // `connection` lets tests supply a stand-in client; normally the user's key is looked up.
  const { client, fingerprint } = connection || (await requireAnthropic(adminId));
  const settings = normalizeSettings(conversation.settings || {});
  const [addons, media] = await Promise.all([usableAddons(adminId, fingerprint), mediaAvailability(adminId)]);

  let containerId = conversation.container_id || null;
  let { params, hash } = buildRequestConfig({ model: conversation.model, settings, addons, media, containerId });

  // Reasoning blocks are tied to the model, system prompt and tool set that produced
  // them. When any of those changed since the last turn, replay older turns without them.
  let thinkingCutoff = Number(conversation.thinking_cutoff || 0);
  const previousMax = await maxMessageSeq(conversation.id);
  if (conversation.config_hash && conversation.config_hash !== hash) thinkingCutoff = previousMax;

  const isFirstTurn = previousMax === 0;
  const title = isFirstTurn ? titleFromText(userText) : conversation.title;

  const [userRow] = await appendMessages(conversation.id, [{ role: 'user', content: userContent }]);
  await setConversationState(conversation.id, { config_hash: hash, thinking_cutoff: thinkingCutoff, title });
  emit({ type: 'row', row: publicMessage(userRow) });

  let messages = toApiMessages(await listMessages(conversation.id), { thinkingCutoff });
  let pending = []; // produced this turn, not stored yet
  let recovered = false;
  let jsonRetries = 0;
  // 'limit' means the loop ran out of steps while Claude was still calling tools.
  let outcome = 'limit';

  const save = async () => {
    if (!pending.length) return;
    const rows = await appendMessages(conversation.id, pending);
    pending = [];
    for (const row of rows) emit({ type: 'row', row: publicMessage(row) });
  };

  for (let step = 0; step < anthropicConfig.maxSteps; step += 1) {
    if (signal?.aborted) {
      outcome = 'aborted';
      break;
    }

    let message;
    try {
      const stream = client.beta.messages.stream({ ...params, messages }, { signal });
      stream.on('streamEvent', (event) => {
        if (event.type === 'content_block_start') {
          const label = activityFor(event.content_block);
          if (label) emit({ type: 'activity', label });
        } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          emit({ type: 'delta', text: event.delta.text });
        }
      });
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (error) {
      if (signal?.aborted || error instanceof Anthropic.APIUserAbortError) {
        outcome = 'aborted';
        break;
      }
      // One conservative retry for a rejected request: drop every reasoning block and
      // the code container (it may have expired). This is the documented recovery when
      // a replayed reasoning block no longer matches its conversation.
      if (error instanceof Anthropic.BadRequestError && !recovered && step === 0) {
        recovered = true;
        emit({ type: 'reset' });
        thinkingCutoff = await maxMessageSeq(conversation.id);
        containerId = null;
        ({ params, hash } = buildRequestConfig({ model: conversation.model, settings, addons, media, containerId }));
        await setConversationState(conversation.id, { thinking_cutoff: thinkingCutoff, container_id: null });
        messages = messages.map((entry) => ({ ...entry, content: stripThinking(entry.content) }));
        step -= 1;
        continue;
      }
      // A tool input that could not be parsed at all rejects the stream with a plain
      // error (not an API error). Ask again, a couple of times at most.
      if (!(error instanceof Anthropic.APIError) && !error?.status && jsonRetries < 2) {
        jsonRetries += 1;
        emit({ type: 'reset' });
        step -= 1;
        continue;
      }
      throw error;
    }

    if (message.container?.id && message.container.id !== containerId) {
      containerId = message.container.id;
      await setConversationState(conversation.id, { container_id: containerId });
      if (params.container) params = { ...params, container: { ...params.container, id: containerId } };
    }

    const content = sanitizeFallbackTurn(message.content);
    const meta = { model: message.model, stop_reason: message.stop_reason, usage: message.usage };
    const files = await describeFiles(client, content);
    if (files.length) meta.files = files;

    if (message.stop_reason === 'refusal') {
      // A declined reply may be cut off anywhere; keep none of it.
      emit({ type: 'reset' });
      pending.push({
        role: 'assistant',
        content: [{ type: 'text', text: 'Claude declined to answer this request.' }],
        meta: { ...meta, refusal: true, category: message.stop_details?.category || null },
      });
      outcome = 'done';
      break;
    }

    const toolUses = content.filter((block) => block.type === 'tool_use');

    if (message.stop_reason === 'max_tokens' && toolUses.length) {
      // The tool input was cut off, so it must not run — and a tool call with no result
      // cannot be stored. Keep whatever text there was.
      const text = content.filter((block) => block.type === 'text');
      pending.push({
        role: 'assistant',
        content: text.length ? text : [{ type: 'text', text: 'The reply was cut off before it finished.' }],
        meta: { ...meta, truncated: true },
      });
      outcome = 'done';
      break;
    }

    if (message.stop_reason === 'pause_turn') {
      // A long server-side tool run paused; send it back as-is to continue.
      pending.push({ role: 'assistant', content, meta });
      messages.push({ role: 'assistant', content });
      continue;
    }

    if (message.stop_reason === 'tool_use' && toolUses.length) {
      const { results, media: created, suggestions, lead } = await runClientTools({
        toolUses,
        admin,
        conversationId: conversation.id,
        emit,
      });
      if (created.length) meta.media = created.map((row) => row.id);
      // Stored with the message, so the cards come back when the chat is reopened.
      if (suggestions.length) {
        meta.suggestions = suggestions;
        meta.lead = lead;
      }
      pending.push({ role: 'assistant', content, meta });
      pending.push({ role: 'user', content: results });
      messages.push({ role: 'assistant', content });
      messages.push({ role: 'user', content: results });
      // Stored together, so a tool call never exists without its result.
      await save();
      continue;
    }

    if (content.length) {
      if (message.stop_reason === 'max_tokens') meta.truncated = true;
      pending.push({ role: 'assistant', content, meta });
    }
    outcome = 'done';
    break;
  }

  // An interrupted turn can leave a paused assistant message last; it is only valid if
  // followed by its continuation, so drop it rather than store a dead end.
  while (pending.length && pending[pending.length - 1].meta?.stop_reason === 'pause_turn') pending.pop();
  if (outcome === 'limit') {
    pending.push({
      role: 'assistant',
      content: [{ type: 'text', text: 'I stopped here because this request needed too many steps. Ask me to continue if you want me to carry on.' }],
      meta: { step_limit: true },
    });
  }
  await save();
  await setConversationState(conversation.id, {});
  return { title };
}
