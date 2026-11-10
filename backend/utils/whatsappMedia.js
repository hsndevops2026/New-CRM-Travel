/**
 * Helpers for WhatsApp voice / audio messages delivered by Wasender webhooks.
 *
 * Per Wasender's docs the media object lives at `data.messages.message.audioMessage`
 * (alongside `imageMessage`, `videoMessage`, …). WhatsApp can also wrap the real
 * message (disappearing chats, view-once), so those wrappers are unwrapped first.
 */

const MESSAGE_WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'documentWithCaptionMessage',
];

/** Peels ephemeral / view-once wrappers off a WhatsApp message object. */
export function unwrapMessage(message) {
  let current = message;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const wrapper = MESSAGE_WRAPPERS.find((key) => current[key]?.message);
    if (!wrapper) break;
    current = current[wrapper].message;
  }
  return current || null;
}

/**
 * Returns the raw `audioMessage` object from a webhook message, or null.
 * Covers both voice notes (ptt: true) and forwarded/attached audio files.
 */
export function extractAudioMessage(msg) {
  const audio = unwrapMessage(msg?.message)?.audioMessage;
  return audio && typeof audio === 'object' ? audio : null;
}

/** WhatsApp libraries emit numbers as number | numeric string | protobuf Long. */
export function toNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') {
    const low = Number(value.low);
    return Number.isFinite(low) ? low : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const MIME_TO_EXTENSION = {
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'application/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
};

/** `audio/ogg; codecs=opus` → `audio/ogg` */
export function baseMimeType(mimetype) {
  return String(mimetype || '').split(';')[0].trim().toLowerCase();
}

/**
 * File extension the transcription API accepts for a mimetype, or null when the
 * format is unsupported (e.g. raw AAC / AMR, which would need transcoding).
 * WhatsApp voice notes are `audio/ogg; codecs=opus` on every platform.
 */
export function audioExtension(mimetype) {
  return MIME_TO_EXTENSION[baseMimeType(mimetype)] || null;
}

/**
 * BullMQ job id for a voice message. Keyed on the WhatsApp message id so a webhook
 * redelivery cannot enqueue the same voice note twice. BullMQ rejects ':' in ids.
 */
export function voiceJobId(messageId) {
  return `voice-${String(messageId).replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

/** Strips secrets (the media decryption key) before job data leaves the backend. */
export function redactMediaKeys(data) {
  if (!data || typeof data !== 'object') return data;
  if (!data.audio || typeof data.audio !== 'object') return data;
  const { mediaKey: _mediaKey, ...audio } = data.audio;
  return { ...data, audio };
}
