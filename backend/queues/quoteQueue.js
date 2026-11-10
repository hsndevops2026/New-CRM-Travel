import { Queue } from 'bullmq';
import { redisConfig } from '../config/redis.js';

export const QUOTE_QUEUE_NAME = 'flight-quotes';

let quoteQueue;

export function getQuoteQueue() {
  if (!quoteQueue) {
    quoteQueue = new Queue(QUOTE_QUEUE_NAME, {
      connection: redisConfig,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }
  return quoteQueue;
}

/**
 * Enqueue a flight-quote fetch for a lead.
 * Job id is stable per lead so duplicate enqueues replace/reuse cleanly.
 */
export async function enqueueFlightQuoteJob(leadId) {
  const queue = getQuoteQueue();
  const job = await queue.add(
    'fetch-quotes',
    { leadId },
    {
      jobId: `lead-${leadId}`,
    },
  );
  return job;
}
