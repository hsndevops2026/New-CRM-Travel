/**
 * Voice-note intake worker.
 *
 *   webhook → [voice-messages queue] → decrypt → download → transcribe → lead intake
 *
 * The transcript is fed through the SAME handler as a typed WhatsApp message
 * (handleIncomingLeadMessage), so a voice note behaves exactly like text: the LLM
 * extracts destination / dates / adults / children, asks a follow-up question for
 * anything missing, and creates the lead once the request is complete.
 *
 * Retry model — the job has two stages with different safety:
 *   A. decrypt + download + transcribe   side-effect free → safe to retry
 *   B. lead intake                       writes messages / leads → must not repeat
 * Stage A's result is saved on the job (`transcript`), so a retry skips straight to
 * B and never pays for transcription twice. Stage B is protected against double
 * writes: the inbound message insert is idempotent on the WhatsApp message id, and
 * a retry first checks whether the previous attempt already created a lead.
 */

import { Worker, UnrecoverableError } from 'bullmq';
import { redisConfig } from '../config/redis.js';
import { VOICE_QUEUE_NAME } from '../queues/voiceQueue.js';
import { handleIncomingLeadMessage, replyToUser } from '../controllers/whatsappLead.js';
import { decryptMedia, downloadMedia } from '../services/wasender.js';
import { transcribeAudio } from '../services/transcription.js';
import { findMessageByProviderId, saveMessage } from '../services/messages.js';
import { findLatestLeadByPhone, leadCreatedSince } from '../services/leads.js';
import { loadSimulatedAudio } from '../services/voiceSimulation.js';
import { toNumber } from '../utils/whatsappMedia.js';

let worker;

/* ---------------------------------------------------------------- *
 * Config (read per call so tests and ops can change env at runtime)
 * ---------------------------------------------------------------- */

function voiceConfig() {
  return {
    maxSeconds: Math.max(5, Number(process.env.VOICE_MAX_SECONDS || 180) || 180),
    maxBytes: Math.max(1024, Number(process.env.VOICE_MAX_BYTES || 20 * 1024 * 1024)),
    echo: String(process.env.VOICE_ECHO_TRANSCRIPT ?? 'true').toLowerCase() !== 'false',
  };
}

/* ---------------------------------------------------------------- *
 * Customer-facing copy. Bilingual because the customer's language is
 * unknown until something has been transcribed.
 * ---------------------------------------------------------------- */

const COPY = {
  too_long: {
    placeholder: '🎤 Voice message (too long to process)',
    reply: (max) =>
      `That voice message is too long for me to process. Please send one under ${Math.round(
        max / 60,
      )} minutes, or type your trip details.\n\nالرسالة الصوتية طويلة جداً. يرجى إرسال رسالة أقصر أو كتابة تفاصيل رحلتك.`,
  },
  unclear: {
    placeholder: '🎤 Voice message (no speech detected)',
    reply: () =>
      "I couldn't make out that voice message. Please try again, or type your destination, dates and number of travellers.\n\nلم أتمكن من فهم الرسالة الصوتية. يرجى المحاولة مرة أخرى أو كتابة الوجهة والتواريخ وعدد المسافرين.",
  },
  failed: {
    placeholder: '🎤 Voice message (could not be transcribed)',
    reply: () =>
      "Sorry, I couldn't process your voice message right now. Please type your trip details (destination, dates, adults and children) and I'll take it from there.\n\nعذراً، لم أتمكن من معالجة رسالتك الصوتية الآن. يرجى كتابة تفاصيل رحلتك (الوجهة والتواريخ وعدد البالغين والأطفال).",
  },
};

function cleanPhone(from) {
  return String(from || '')
    .replace(/@.*$/, '')
    .replace(/[^\d+]/g, '');
}

const defaultDeps = {
  decryptMedia,
  downloadMedia,
  transcribe: transcribeAudio,
  handleLead: handleIncomingLeadMessage,
  reply: replyToUser,
  findStoredMessage: findMessageByProviderId,
  saveMessage,
  findLatestLead: findLatestLeadByPhone,
  leadCreatedSince,
  loadSimulatedAudio,
};

/**
 * Records that a voice note arrived (so agents can see it in the inbox) and tells
 * the customer what to do instead. Used when a voice note cannot become a lead.
 */
async function recordAndReply({ job, kind, deps, replyArg }) {
  const phone = cleanPhone(job.data.from);
  // Test jobs from the CRM never message WhatsApp, only record the reply.
  const skipWhatsApp = job.data.source === 'simulate';
  const copy = COPY[kind];
  const lead = await deps.findLatestLead(phone).catch(() => null);

  const alreadyStored = await deps.findStoredMessage(job.data.messageId);
  if (!alreadyStored) {
    await deps.saveMessage({
      leadId: lead?.id || null,
      direction: 'inbound',
      channel: 'whatsapp',
      providerId: job.data.messageId,
      fromNumber: phone,
      body: copy.placeholder,
      status: 'received',
      raw: {
        kind: 'customer',
        media: 'audio',
        voice_status: kind,
        seconds: toNumber(job.data.audio?.seconds),
      },
    });
  }

  const text = copy.reply(replyArg);
  await deps.reply(phone, text, skipWhatsApp, { leadId: lead?.id || null });
  return text;
}

/**
 * Processes one voice job. Exported (with injectable `deps`) so every branch can be
 * tested without Redis, WhatsApp or OpenAI.
 */
export async function processVoiceJob(job, deps = {}) {
  const d = { ...defaultDeps, ...deps };
  const cfg = voiceConfig();
  const { messageId, from, audio } = job.data || {};

  if (!messageId || !from || !audio) {
    throw new UnrecoverableError('voice job is missing messageId, from or audio');
  }

  const phone = cleanPhone(from);
  const seconds = toNumber(audio.seconds);
  // A tester in Settings → Test WhatsApp: same pipeline, audio from Redis, no WhatsApp sends.
  const simulated = job.data.source === 'simulate';

  // Cost / abuse guard — checked from webhook metadata before anything is downloaded.
  if (seconds && seconds > cfg.maxSeconds) {
    console.log(`[voice] ${messageId}: ${seconds}s exceeds ${cfg.maxSeconds}s limit`);
    const reply = await recordAndReply({ job, kind: 'too_long', deps: d, replyArg: cfg.maxSeconds });
    return { skipped: 'too_long', reply };
  }

  // ── Stage A: audio → text (safe to retry; result is cached on the job) ──────
  let transcript = job.data.transcript;
  if (typeof transcript !== 'string') {
    try {
      let buffer;
      if (simulated) {
        buffer = await d.loadSimulatedAudio(job.data.audioKey);
        if (!buffer?.length) {
          throw Object.assign(new Error('Test audio expired — record it again'), { permanent: true });
        }
      } else {
        const publicUrl = await d.decryptMedia({ messageId, audioMessage: audio });
        ({ buffer } = await d.downloadMedia(publicUrl, { maxBytes: cfg.maxBytes }));
      }
      const result = await d.transcribe(buffer, { mimetype: audio.mimetype });
      transcript = result.text;
      console.log(
        `[voice] ${messageId}: transcribed ${buffer.length}B → ${transcript.length} chars (${result.model})`,
      );
    } catch (error) {
      if (error?.permanent && !(error instanceof UnrecoverableError)) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
    await job.updateData({ ...job.data, transcript });
  }

  if (!transcript.trim()) {
    const reply = await recordAndReply({ job, kind: 'unclear', deps: d });
    return { skipped: 'empty', reply, transcript };
  }

  // ── Stage B: lead intake (writes — must not run twice) ──────────────────────
  if (job.attemptsMade > 0 && (await d.leadCreatedSince(phone, job.data.receivedAt))) {
    console.log(`[voice] ${messageId}: a lead already exists from an earlier attempt — not retrying`);
    return { skipped: 'lead_exists' };
  }

  // Show the customer what was understood. Speech recognition mishears place names
  // and dates, and a silently-wrong lead is worse than one extra line.
  if (cfg.echo && !job.data.echoed) {
    const quoted = transcript.length > 600 ? `${transcript.slice(0, 600)}…` : transcript;
    await d.reply(phone, `🎤 “${quoted}”`, simulated, {});
    await job.updateData({ ...job.data, transcript, echoed: true });
  }

  const outcome = await d.handleLead({
    from: phone,
    text: transcript,
    providerMessageId: messageId,
    source: 'whatsapp',
    skipWhatsApp: simulated,
    messageMeta: {
      media: 'audio',
      voice: Boolean(audio.ptt),
      seconds,
      transcribed: true,
    },
  });

  // Real jobs keep a tiny return value. A test job returns what the tester came to see.
  return simulated
    ? { transcript, result: outcome || null }
    : { transcript_chars: transcript.length };
}

/**
 * Last resort once retries are exhausted: don't leave the customer in silence.
 */
export async function notifyFinalFailure(job, error, deps = {}) {
  const d = { ...defaultDeps, ...deps };
  if (!job?.data?.from || job.data.failureNotified) return false;
  try {
    await recordAndReply({ job, kind: 'failed', deps: d });
    // The webhook calls this with a plain object when it cannot even enqueue.
    if (typeof job.updateData === 'function') {
      await job.updateData({ ...job.data, failureNotified: true });
    }
    return true;
  } catch (notifyError) {
    console.error(`[voice] could not notify customer of failure: ${notifyError.message}`);
    return false;
  }
}

/**
 * @param {{ deps?: object, queueName?: string }} [options] — both exist for tests:
 *   `deps` swaps network/DB collaborators, `queueName` isolates from a live worker.
 */
export function startVoiceWorker({ deps = {}, queueName = VOICE_QUEUE_NAME } = {}) {
  if (worker) return worker;

  worker = new Worker(queueName, (job) => processVoiceJob(job, deps), {
    connection: redisConfig,
    // One at a time by default: two voice notes from the same customer both
    // read-modify-write the conversation, so running them in parallel can lose
    // fields. Raise only if per-customer ordering is handled elsewhere.
    concurrency: Math.max(1, Number(process.env.VOICE_WORKER_CONCURRENCY || 1) || 1),
  });

  worker.on('failed', async (job, error) => {
    const attempts = job?.opts?.attempts ?? 1;
    const isFinal =
      !job || error instanceof UnrecoverableError || job.attemptsMade >= attempts;
    console.error(
      `[voice] failed ${job?.data?.messageId} (attempt ${job?.attemptsMade}/${attempts}${
        isFinal ? ', final' : ''
      }): ${error.message}`,
    );
    if (job && isFinal) await notifyFinalFailure(job, error, deps);
  });

  worker.on('error', (error) => {
    console.error('[voice] worker error:', error.message);
  });

  console.log('BullMQ voice worker started');
  return worker;
}

export async function stopVoiceWorker() {
  if (!worker) return;
  await worker.close();
  worker = null;
}
