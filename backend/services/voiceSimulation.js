/**
 * "Test WhatsApp → voice" support for the CRM (Settings page).
 *
 * A tester records or attaches audio in the browser. It is processed by the SAME
 * `voice-messages` queue and worker as a real WhatsApp voice note, so everything
 * downstream is genuinely exercised: transcription, the LLM extraction, the
 * follow-up questions, lead creation. Only two things differ, both for safety:
 *
 *   1. The audio comes from a short-lived Redis key instead of Wasender's
 *      decrypt-media (there is no real WhatsApp message to decrypt).
 *   2. Nothing is ever sent to WhatsApp — the typed "Test WhatsApp" tool behaves
 *      the same way — so a tester cannot message a real customer's number.
 */

import crypto from 'node:crypto';
import Redis from 'ioredis';
import { redisConfig } from '../config/redis.js';
import { getVoiceQueue } from '../queues/voiceQueue.js';
import { audioExtension } from '../utils/whatsappMedia.js';

export const SIM_JOB_PREFIX = 'voice-sim-';
const AUDIO_KEY_PREFIX = 'voice-sim-audio:';
const AUDIO_TTL_SECONDS = 15 * 60;
export const MAX_TEST_AUDIO_BYTES = 10 * 1024 * 1024;

// BullMQ 6 does not expose its Redis connection, so the short-lived test audio uses
// its own. Created on first use: servers that never run a voice test open nothing.
let redisClient;
function getRedis() {
  if (!redisClient) redisClient = new Redis(redisConfig);
  return redisClient;
}

export async function closeSimulationRedis() {
  if (!redisClient) return;
  const client = redisClient;
  redisClient = null;
  await client.quit().catch(() => client.disconnect());
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/** Rejects uploads the worker could not use, before anything is stored or queued. */
export function validateSimulatedUpload({ buffer, contentType }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw httpError(400, 'No audio received');
  }
  if (buffer.length > MAX_TEST_AUDIO_BYTES) {
    throw httpError(413, 'Audio must be smaller than 10 MB');
  }
  if (!audioExtension(contentType)) {
    throw httpError(
      415,
      `Unsupported audio format "${contentType || 'unknown'}". Use ogg, webm, mp3, m4a/mp4 or wav.`,
    );
  }
}

/** Digits only, at least 6 — the same shape the real intake expects. */
export function normalizeTestPhone(value, fallback = '9990001111') {
  const digits = String(value || fallback).replace(/\D/g, '');
  if (digits.length < 6) throw httpError(400, 'Enter a valid test phone number');
  return digits;
}

export async function loadSimulatedAudio(key, { redis } = {}) {
  if (!key || !String(key).startsWith(AUDIO_KEY_PREFIX)) return null;
  return (redis || getRedis()).getBuffer(key); // null once the 15-minute TTL has passed
}

/**
 * Stores the audio and enqueues it. Resolves with the job id the UI should poll.
 */
export async function enqueueSimulatedVoice(
  { buffer, contentType, phone, seconds },
  { queue = getVoiceQueue(), redis } = {},
) {
  // Validate everything before touching Redis, so a rejected request stores nothing.
  validateSimulatedUpload({ buffer, contentType });
  const from = normalizeTestPhone(phone);

  const id = crypto.randomUUID();
  const audioKey = `${AUDIO_KEY_PREFIX}${id}`;
  await (redis || getRedis()).set(audioKey, buffer, 'EX', AUDIO_TTL_SECONDS);

  const parsedSeconds = Number(seconds);
  const job = await queue.add(
    'transcribe-and-intake',
    {
      messageId: `sim-${id}`,
      from,
      source: 'simulate',
      audioKey,
      audio: {
        mimetype: contentType,
        seconds: Number.isFinite(parsedSeconds) && parsedSeconds > 0 ? parsedSeconds : null,
        ptt: true,
      },
      receivedAt: Date.now(),
    },
    {
      jobId: `${SIM_JOB_PREFIX}${id}`,
      // A tester is waiting for the answer: report a failure at once instead of
      // retrying in the background for 10+ seconds.
      attempts: 1,
    },
  );
  return { jobId: job.id };
}

/**
 * Status of a simulated voice job, shaped for the UI — or null when there is no such
 * *simulated* job. Real customers' voice jobs live on the same queue, and their
 * transcripts must never be readable through this endpoint, so anything that was not
 * created by enqueueSimulatedVoice is treated as not found.
 */
export async function describeSimulatedJob(jobId, { queue = getVoiceQueue() } = {}) {
  if (!String(jobId || '').startsWith(SIM_JOB_PREFIX)) return null;
  const job = await queue.getJob(jobId);
  if (!job || job.data?.source !== 'simulate') return null;

  const state = await job.getState();
  if (state === 'completed') {
    return { status: 'done', outcome: job.returnvalue || {} };
  }
  if (state === 'failed') {
    return { status: 'failed', error: job.failedReason || 'Voice processing failed' };
  }
  if (state === 'active') {
    // The transcript is saved on the job as soon as it exists, so the UI can show it
    // while the lead extraction is still running.
    return { status: 'processing', transcript: job.data.transcript || null };
  }
  return { status: 'queued' };
}
