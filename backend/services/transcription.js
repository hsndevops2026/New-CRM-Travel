/**
 * Speech-to-text for WhatsApp voice notes (OpenAI audio transcription).
 *
 * No `language` is forced — customers speak Arabic, English, or a mix, and the
 * model detects it. No vocabulary `prompt` is passed either: Whisper-family models
 * are known to echo the prompt back on silent / near-silent audio, which would turn
 * an empty voice note into a plausible-looking fake booking request.
 *
 * Errors carry `.permanent` so the queue knows whether a retry can help:
 *   - bad audio / unsupported format / bad credentials → permanent
 *   - rate limits, 5xx, timeouts, network → retryable
 */

import OpenAI, { toFile } from 'openai';
import { openaiConfig } from '../config/openai.js';
import { audioExtension, baseMimeType } from '../utils/whatsappMedia.js';

const transcribeTimeoutMs = Math.max(
  5000,
  Number(process.env.OPENAI_TRANSCRIBE_TIMEOUT_MS || 60000),
);

const defaultClient = openaiConfig.apiKey
  ? new OpenAI({ apiKey: openaiConfig.apiKey, timeout: transcribeTimeoutMs, maxRetries: 0 })
  : null;

export function isTranscriptionConfigured() {
  return Boolean(defaultClient);
}

function permanent(message, cause) {
  const err = new Error(message);
  err.permanent = true;
  err.cause = cause;
  return err;
}

/**
 * @param {Buffer} buffer
 * @param {{ mimetype?: string, client?: object, model?: string }} [options]
 * @returns {Promise<{ text: string, model: string }>}
 */
export async function transcribeAudio(buffer, options = {}) {
  // An explicit `client: null` means "no client configured" (used by tests); only an
  // omitted option falls back to the real one.
  const client = 'client' in options ? options.client : defaultClient;
  const model = options.model || openaiConfig.transcribeModel;

  if (!client) {
    throw permanent('OPENAI_API_KEY is not configured — cannot transcribe voice messages');
  }

  const extension = audioExtension(options.mimetype);
  if (!extension) {
    throw permanent(`Unsupported audio format: ${options.mimetype || 'unknown'}`);
  }

  const file = await toFile(buffer, `voice.${extension}`, {
    type: baseMimeType(options.mimetype),
  });

  try {
    const result = await client.audio.transcriptions.create({
      file,
      model,
      response_format: 'json',
    });
    return { text: String(result?.text || '').trim(), model };
  } catch (error) {
    const status = Number(error?.status);
    // 400/413/415/422: the audio itself is the problem. 401/403: bad key. Neither
    // changes on retry. 408/429/5xx/timeouts/network are transient.
    if ([400, 401, 403, 404, 413, 415, 422].includes(status)) {
      throw permanent(`Transcription rejected (${status}): ${error.message}`, error);
    }
    throw error;
  }
}
