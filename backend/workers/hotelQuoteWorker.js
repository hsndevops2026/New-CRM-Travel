import { Worker } from 'bullmq';
import { redisConfig } from '../config/redis.js';
import { HOTEL_QUOTE_QUEUE_NAME } from '../queues/hotelQuoteQueue.js';
import { getLeadById, setLeadQuoteStatus } from '../services/leads.js';
import { fetchAndStoreHotelQuotesForLead } from '../services/bookingHotels.js';

let worker;

export function startHotelQuoteWorker() {
  if (worker) return worker;

  worker = new Worker(
    HOTEL_QUOTE_QUEUE_NAME,
    async (job) => {
      const leadId = job.data?.leadId;
      if (!leadId) throw new Error('leadId is required');

      console.log(`[hotel-quotes] processing lead ${leadId} (attempt ${job.attemptsMade + 1})`);
      await setLeadQuoteStatus(leadId, 'processing');

      const lead = await getLeadById(leadId);
      if (!lead) throw new Error(`Lead not found: ${leadId}`);
      if (lead.booking_type !== 'hotel' && lead.booking_type !== 'package') {
        await setLeadQuoteStatus(leadId, null);
        return { skipped: true, reason: 'not_hotel' };
      }

      const result = await fetchAndStoreHotelQuotesForLead(lead, {
        currency_code: 'USD',
        rooms: 1,
        limit: 8,
      });

      const counts = {
        hotelbeds: result.sources.hotelbeds.count,
        booking: result.sources.booking.count,
        airbnb: result.sources.airbnb.count,
      };

      if (result.outcome.status === 'error') {
        await setLeadQuoteStatus(leadId, 'error', result.outcome.error);
        throw new Error(result.outcome.error);
      }

      await setLeadQuoteStatus(leadId, 'completed');
      console.log(
        `[hotel-quotes] completed lead ${leadId}: hotelbeds=${counts.hotelbeds} booking=${counts.booking} airbnb=${counts.airbnb}`,
      );
      return { count: counts.hotelbeds + counts.booking + counts.airbnb, sources: counts };
    },
    {
      connection: redisConfig,
      concurrency: 1,
    },
  );

  worker.on('failed', async (job, error) => {
    const leadId = job?.data?.leadId;
    const attempts = job?.opts?.attempts ?? 1;
    const isFinal = !job || job.attemptsMade >= attempts;
    console.error(`[hotel-quotes] failed lead ${leadId}:`, error.message);

    if (leadId && isFinal) {
      try {
        await setLeadQuoteStatus(leadId, 'error', error.message);
      } catch (statusError) {
        console.error('[hotel-quotes] failed to persist error status:', statusError.message);
      }
    } else if (leadId) {
      try {
        await setLeadQuoteStatus(leadId, 'processing', error.message);
      } catch {
        // ignore interim status write failures
      }
    }
  });

  worker.on('error', (error) => {
    console.error('[hotel-quotes] worker error:', error.message);
  });

  console.log('BullMQ hotel quote worker started');
  return worker;
}

export async function stopHotelQuoteWorker() {
  if (!worker) return;
  await worker.close();
  worker = null;
}
