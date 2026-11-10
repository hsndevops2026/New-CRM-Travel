import { getQuoteQueue, QUOTE_QUEUE_NAME } from '../queues/quoteQueue.js';
import { getHotelQuoteQueue, HOTEL_QUOTE_QUEUE_NAME } from '../queues/hotelQuoteQueue.js';
import { getVoiceQueue, VOICE_QUEUE_NAME } from '../queues/voiceQueue.js';
import { redactMediaKeys } from '../utils/whatsappMedia.js';

const QUEUE_MAP = {
  [QUOTE_QUEUE_NAME]: () => getQuoteQueue(),
  [HOTEL_QUOTE_QUEUE_NAME]: () => getHotelQuoteQueue(),
  [VOICE_QUEUE_NAME]: () => getVoiceQueue(),
};

function httpErr(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function serializeJob(job) {
  return {
    id: job.id,
    name: job.name,
    queue: job.queueName,
    lead_id: job.data?.leadId || null,
    attempts_made: job.attemptsMade,
    failed_reason: job.failedReason || null,
    timestamp: job.timestamp ? new Date(job.timestamp).toISOString() : null,
    finished_on: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    // Voice jobs carry the WhatsApp media decryption key — never expose it.
    data: redactMediaKeys(job.data) || {},
  };
}

export function listKnownQueues() {
  return Object.keys(QUEUE_MAP);
}

export async function listFailedQueueJobs({ queueName, limit = 50 } = {}) {
  const getQueue = queueName ? QUEUE_MAP[queueName] : null;
  if (queueName && !getQueue) throw httpErr(400, `Unknown queue: ${queueName}`);

  const queues = queueName
    ? [{ name: queueName, queue: getQueue() }]
    : Object.entries(QUEUE_MAP).map(([name, factory]) => ({ name, queue: factory() }));

  const results = [];
  for (const { name, queue } of queues) {
    const failed = await queue.getJobs(['failed'], 0, Math.max(0, limit - 1));
    for (const job of failed) {
      results.push({ ...serializeJob(job), queue: name });
    }
  }

  results.sort((a, b) => {
    const ta = a.finished_on ? Date.parse(a.finished_on) : 0;
    const tb = b.finished_on ? Date.parse(b.finished_on) : 0;
    return tb - ta;
  });

  return results.slice(0, limit);
}

export async function retryFailedJob(queueName, jobId) {
  const getQueue = QUEUE_MAP[queueName];
  if (!getQueue) throw httpErr(400, `Unknown queue: ${queueName}`);

  const queue = getQueue();
  const job = await queue.getJob(jobId);
  if (!job) throw httpErr(404, 'Job not found');

  const state = await job.getState();
  if (state !== 'failed') {
    throw httpErr(409, `Job is not failed (current state: ${state})`);
  }

  await job.retry();
  return { retried: true, job: serializeJob(job) };
}

export async function getQueueCounts() {
  const counts = {};
  for (const [name, factory] of Object.entries(QUEUE_MAP)) {
    const queue = factory();
    counts[name] = await queue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
    );
  }
  return counts;
}
