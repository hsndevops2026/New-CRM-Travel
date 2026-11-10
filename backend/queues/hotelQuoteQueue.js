import { Queue } from 'bullmq';
import { redisConfig } from '../config/redis.js';

export const HOTEL_QUOTE_QUEUE_NAME = 'hotel-quotes';

let hotelQuoteQueue;

export function getHotelQuoteQueue() {
  if (!hotelQuoteQueue) {
    hotelQuoteQueue = new Queue(HOTEL_QUOTE_QUEUE_NAME, {
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
  return hotelQuoteQueue;
}

/**
 * Enqueue a hotel-quote fetch for a lead.
 * Stable job id per lead prevents duplicate enqueues.
 */
export async function enqueueHotelQuoteJob(leadId) {
  const queue = getHotelQuoteQueue();
  const job = await queue.add(
    'fetch-hotel-quotes',
    { leadId },
    { jobId: `hotel-lead-${leadId}` },
  );
  return job;
}
