import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_ASSISTANT_MODEL, ASSISTANT_MODELS } from '../config/anthropic.js';
import { logError } from '../services/logger.js';
import { logAuditEvent } from '../services/audit.js';
import { addConnector, installBundle, publicAddon, removeAddon } from '../services/assistantAddons.js';
import { describeChatError, runTurn } from '../services/assistantChat.js';
import {
  describeConnections,
  removeKey,
  requireAnthropic,
  resolveKey,
  saveKey,
} from '../services/assistantConnections.js';
import { generateImage, mediaAvailability, refreshMedia, startVideo } from '../services/assistantMedia.js';
import {
  BUILTIN_SKILLS,
  buildUserContent,
  parseImageToolInput,
  parseVideoToolInput,
  titleFromText,
} from '../services/assistantRequest.js';
import {
  appendMessages,
  createConversation,
  deleteConversation,
  getConversation,
  getMediaAsset,
  listAddons,
  listConversationMedia,
  listConversations,
  listMessages,
  maxMessageSeq,
  publicConversation,
  publicMedia,
  publicMessage,
  setConversationState,
  updateConversation,
} from '../services/assistantStore.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requireUuid(value) {
  if (!UUID.test(String(value || ''))) throw httpError(404, 'Not found');
  return value;
}

// ── Public: generated files stored in the database ────────────────────────────────────
// Reached by <img>/<video> tags, which cannot send a login token, so the link itself
// carries a long random token.
export const assistantPublicRoutes = Router();

assistantPublicRoutes.get('/assistant/assets/:id/:token', async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id) || !/^[0-9a-f]{48}$/.test(req.params.token)) {
      return res.status(404).json({ error: 'Not found' });
    }
    const asset = await getMediaAsset(req.params.id, req.params.token);
    if (!asset) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Content-Type', asset.mime || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(asset.data);
  } catch (error) {
    return next(error);
  }
});

// ── Authenticated ─────────────────────────────────────────────────────────────────────
const router = Router();

// Model calls cost money on the connected key, so cap how fast one user can make them.
const perUser = (limit, message) =>
  rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.admin?.id || 'anonymous'),
    message: { error: message },
  });
const chatLimiter = perUser(Number(process.env.ASSISTANT_RATE_LIMIT_PER_MINUTE) || 20, 'You are sending messages too quickly. Wait a moment.');
const mediaLimiter = perUser(6, 'You are generating media too quickly. Wait a moment.');

async function assistantState(admin) {
  const [connections, media, addonRows, claude] = await Promise.all([
    describeConnections(admin.id),
    mediaAvailability(admin.id),
    listAddons(admin.id),
    resolveKey(admin.id, 'anthropic').catch(() => null),
  ]);
  return {
    connections,
    can_manage_agency: admin.role === 'admin',
    models: ASSISTANT_MODELS,
    default_model: DEFAULT_ASSISTANT_MODEL,
    media,
    builtin_skills: BUILTIN_SKILLS,
    addons: addonRows.map((row) => publicAddon(row, claude?.fingerprint || null)),
  };
}

router.get('/state', async (req, res, next) => {
  try {
    res.json(await assistantState(req.admin));
  } catch (error) {
    next(error);
  }
});

router.put('/connections/:provider', async (req, res, next) => {
  try {
    const scope = req.body?.scope === 'agency' ? 'agency' : 'user';
    if (scope === 'agency' && req.admin.role !== 'admin') {
      throw httpError(403, 'Only an admin can set the agency key');
    }
    await saveKey({ provider: req.params.provider, scope, adminId: req.admin.id, apiKey: req.body?.api_key });
    void logAuditEvent({
      entityType: 'ai_connection',
      action: 'key_saved',
      actorId: req.admin.id,
      actorRole: req.admin.role,
      after: { provider: req.params.provider, scope },
    });
    res.json(await assistantState(req.admin));
  } catch (error) {
    next(error);
  }
});

router.delete('/connections/:provider', async (req, res, next) => {
  try {
    const scope = req.query.scope === 'agency' ? 'agency' : 'user';
    if (scope === 'agency' && req.admin.role !== 'admin') {
      throw httpError(403, 'Only an admin can remove the agency key');
    }
    await removeKey({ provider: req.params.provider, scope, adminId: req.admin.id });
    void logAuditEvent({
      entityType: 'ai_connection',
      action: 'key_removed',
      actorId: req.admin.id,
      actorRole: req.admin.role,
      after: { provider: req.params.provider, scope },
    });
    res.json(await assistantState(req.admin));
  } catch (error) {
    next(error);
  }
});

// ── Conversations ─────────────────────────────────────────────────────────────────────

router.get('/conversations', async (req, res, next) => {
  try {
    const rows = await listConversations(req.admin.id);
    res.json({ conversations: rows.map(publicConversation) });
  } catch (error) {
    next(error);
  }
});

router.post('/conversations', async (req, res, next) => {
  try {
    const row = await createConversation(req.admin.id, req.body || {});
    res.status(201).json({ conversation: publicConversation(row) });
  } catch (error) {
    next(error);
  }
});

router.get('/conversations/:id', async (req, res, next) => {
  try {
    const conversation = await getConversation(req.admin.id, requireUuid(req.params.id));
    const [messages, media] = await Promise.all([
      listMessages(conversation.id),
      listConversationMedia(conversation.id),
    ]);
    res.json({
      conversation: publicConversation(conversation),
      messages: messages.map(publicMessage),
      media: media.map(publicMedia),
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/conversations/:id', async (req, res, next) => {
  try {
    const row = await updateConversation(req.admin.id, requireUuid(req.params.id), req.body || {});
    res.json({ conversation: publicConversation(row) });
  } catch (error) {
    next(error);
  }
});

router.delete('/conversations/:id', async (req, res, next) => {
  try {
    await deleteConversation(req.admin.id, requireUuid(req.params.id));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// One reply at a time per conversation: a second request would interleave messages.
const replying = new Set();

/**
 * Send a message and stream the reply as newline-delimited JSON events
 * (see runTurn for the event types; the stream ends with "done" or "error").
 */
router.post('/conversations/:id/messages', chatLimiter, async (req, res, next) => {
  let conversation;
  let userContent;
  const text = String(req.body?.text || '');
  try {
    conversation = await getConversation(req.admin.id, requireUuid(req.params.id));
    if (req.body?.model || req.body?.settings) {
      conversation = await updateConversation(req.admin.id, conversation.id, {
        model: req.body.model,
        settings: req.body.settings,
      });
    }
    userContent = buildUserContent({ text, attachments: req.body?.attachments || [] });
    await requireAnthropic(req.admin.id);
    if (replying.has(conversation.id)) throw httpError(409, 'Claude is still replying in this chat');
  } catch (error) {
    return next(error);
  }

  replying.add(conversation.id);
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  res.status(200).set({
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  const emit = (event) => {
    if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`);
  };

  try {
    await runTurn({
      admin: req.admin,
      conversation,
      userContent,
      userText: text,
      emit,
      signal: controller.signal,
    });
    const fresh = await getConversation(req.admin.id, conversation.id);
    emit({ type: 'done', conversation: publicConversation(fresh) });
  } catch (error) {
    const described = describeChatError(error);
    if (described.status >= 500 || error instanceof Anthropic.APIError) {
      logError('assistant.chat', error, { request_id: req.requestId, conversation_id: conversation.id });
    }
    emit({ type: 'error', message: described.message });
  } finally {
    replying.delete(conversation.id);
    if (!res.writableEnded) res.end();
  }
  return undefined;
});

/** Image / Video mode: generate directly from the user's prompt, without asking Claude. */
router.post('/conversations/:id/generate', mediaLimiter, async (req, res, next) => {
  try {
    const conversation = await getConversation(req.admin.id, requireUuid(req.params.id));
    const kind = req.body?.kind === 'video' ? 'video' : 'image';
    const input = kind === 'video' ? parseVideoToolInput(req.body) : parseImageToolInput(req.body);
    if (!input) throw httpError(400, 'Describe what to generate');
    if (replying.has(conversation.id)) throw httpError(409, 'Claude is still replying in this chat');

    const isFirst = (await maxMessageSeq(conversation.id)) === 0;
    const media =
      kind === 'video'
        ? await startVideo({ adminId: req.admin.id, conversationId: conversation.id, ...input })
        : await generateImage({ adminId: req.admin.id, conversationId: conversation.id, ...input });

    // Recorded as an ordinary exchange so Claude knows about it in later turns.
    const note =
      media.status === 'failed'
        ? `(Generating the ${kind} failed: ${media.error})`
        : kind === 'video'
          ? '(A video is being rendered from the prompt above and will be shown to the user.)'
          : '(An image was generated from the prompt above and shown to the user.)';
    const rows = await appendMessages(conversation.id, [
      { role: 'user', content: [{ type: 'text', text: input.prompt }], meta: { mode: kind } },
      { role: 'assistant', content: [{ type: 'text', text: note }], meta: { direct: true, media: [media.id] } },
    ]);
    await setConversationState(conversation.id, isFirst ? { title: titleFromText(input.prompt) } : {});
    const fresh = await getConversation(req.admin.id, conversation.id);
    res.status(201).json({
      conversation: publicConversation(fresh),
      messages: rows.map(publicMessage),
      media: publicMedia(media),
    });
  } catch (error) {
    next(error);
  }
});

/** Poll a generated item; a rendering video is checked against the provider here. */
router.get('/media/:id', async (req, res, next) => {
  try {
    const media = await refreshMedia(req.admin.id, requireUuid(req.params.id));
    res.json({ media: publicMedia(media) });
  } catch (error) {
    next(error);
  }
});

/** Download a document Claude created with a skill (PowerPoint, Excel, …). */
router.get('/conversations/:id/files/:fileId', async (req, res, next) => {
  try {
    const conversation = await getConversation(req.admin.id, requireUuid(req.params.id));
    const fileId = String(req.params.fileId || '');
    // Only files this conversation produced may be fetched through it.
    const known = (await listMessages(conversation.id))
      .flatMap((row) => (Array.isArray(row.meta?.files) ? row.meta.files : []))
      .find((file) => file.file_id === fileId);
    if (!known) throw httpError(404, 'File not found');

    const { client } = await requireAnthropic(req.admin.id);
    let download;
    try {
      download = await client.files.download(fileId);
    } catch (error) {
      if (error instanceof Anthropic.NotFoundError) {
        throw httpError(404, 'This file is no longer available. Ask Claude to create it again.');
      }
      if (error instanceof Anthropic.APIError) throw httpError(502, 'The file could not be downloaded right now');
      throw error;
    }
    const name = String(known.filename || 'file').replace(/[\r\n"\\/]+/g, '_').slice(0, 150) || 'file';
    const asciiName = name.replace(/[^\x20-\x7E]/g, '_');
    res.setHeader('Content-Type', known.mime_type || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(Buffer.from(await download.arrayBuffer()));
  } catch (error) {
    next(error);
  }
});

// ── Add-ons ───────────────────────────────────────────────────────────────────────────

router.post('/addons/connector', async (req, res, next) => {
  try {
    await addConnector({
      adminId: req.admin.id,
      role: req.admin.role,
      scope: req.body?.scope === 'agency' ? 'agency' : 'user',
      name: req.body?.name,
      url: req.body?.url,
      token: req.body?.token,
    });
    res.status(201).json(await assistantState(req.admin));
  } catch (error) {
    next(error);
  }
});

/** Upload a .zip holding a skill or a whole plugin (sent as base64 in JSON). */
router.post('/addons/bundle', async (req, res, next) => {
  try {
    const result = await installBundle({
      adminId: req.admin.id,
      role: req.admin.role,
      scope: req.body?.scope === 'agency' ? 'agency' : 'user',
      base64: req.body?.file,
    });
    res.status(201).json({ ...(await assistantState(req.admin)), installed: result.installed, skipped: result.skipped });
  } catch (error) {
    next(error);
  }
});

router.delete('/addons/:id', async (req, res, next) => {
  try {
    await removeAddon({ adminId: req.admin.id, role: req.admin.role, id: requireUuid(req.params.id) });
    res.json(await assistantState(req.admin));
  } catch (error) {
    next(error);
  }
});

export default router;
