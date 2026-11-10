import { Queue } from 'bullmq';
import { redisConfig } from '../config/redis.js';
import { voiceJobId } from '../utils/whatsappMedia.js';

export const VOICE_QUEUE_NAME = 'voice-messages';

let voiceQueue;

/**
 * Builds a voice queue with the production job options. Exposed so tests can use a
 * private queue name — a shared Redis may have a live worker consuming the real one.
 */
export function createVoiceQueue(name = VOICE_QUEUE_NAME) {
  return new Queue(name, {
    connection: redisConfig,
    defaultJobOptions: {
      // Transient failures (OpenAI/Wasender 5xx, rate limits). The decrypted media
      // link is re-requested on every attempt, so the 1-hour expiry never bites.
      attempts: 3,
      backoff: { type: 'exponential', delay: 4000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  });
}

export function getVoiceQueue() {
  if (!voiceQueue) voiceQueue = createVoiceQueue();
  return voiceQueue;
}

/**
 * Enqueue one inbound voice note for transcription + lead intake.
 *
 * The job id is derived from the WhatsApp message id, so a webhook redelivery
 * while the job is queued or recently finished is ignored by BullMQ rather than
 * processed twice.
 *
 * `audio` is the raw `audioMessage` object from the webhook (it holds the encrypted
 * CDN url and the mediaKey Wasender needs to decrypt it). The decrypted link itself
 * is never stored — it is requested fresh by the worker on each attempt.
 */
export async function enqueueVoiceMessage(
  { messageId, from, remoteJid = null, audio },
  { queue = getVoiceQueue() } = {},
) {
  return queue.add(
    'transcribe-and-intake',
    { messageId, from, remoteJid, audio, receivedAt: Date.now() },
    { jobId: voiceJobId(messageId) },
  );
}
