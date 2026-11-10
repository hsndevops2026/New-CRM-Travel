import { Worker } from 'bullmq';
import { redisConfig } from '../config/redis.js';
import { QUOTE_QUEUE_NAME } from '../queues/quoteQueue.js';
import { getLeadById, setLeadQuoteStatus } from '../services/leads.js';
import { searchFlightQuotesWithFallback } from '../services/flightSearch.js';
import { replaceLeadQuotes } from '../services/quotes.js';
import { enqueueHotelQuoteJob } from '../queues/hotelQuoteQueue.js';

let worker;

export function startQuoteWorker() {
  if (worker) return worker;

  worker = new Worker(
    QUOTE_QUEUE_NAME,
    async (job) => {
      const leadId = job.data?.leadId;
      if (!leadId) throw new Error('leadId is required');

      console.log(`[quotes] processing lead ${leadId} (attempt ${job.attemptsMade + 1})`);
      await setLeadQuoteStatus(leadId, 'processing');

      const lead = await getLeadById(leadId);
      if (!lead) throw new Error(`Lead not found: ${leadId}`);
      if (lead.booking_type !== 'flight' && lead.booking_type !== 'package') {
        await setLeadQuoteStatus(leadId, null);
        return { skipped: true, reason: 'not_flight' };
      }

      const result = await searchFlightQuotesWithFallback({
        origin: lead.origin,
        destination: lead.destination,
        travel_date: lead.travel_date,
        return_date: lead.return_date,
        adults_count: lead.adults_count,
        children_count: lead.children_count,
        children_ages: lead.children_ages,
        currency_code: 'USD',
        sort: 'BEST',
        cabinClass: 'ECONOMY',
        limit: 8,
      });

      await replaceLeadQuotes(leadId, result);

      if (lead.booking_type === 'package') {
        await setLeadQuoteStatus(leadId, 'processing', null, {
          phase: 'hotels',
          flights_completed: true,
          from: result.from,
          to: result.to,
          flight_provider: result.provider,
        });
        await enqueueHotelQuoteJob(leadId);
        console.log(`[quotes] package lead ${leadId}: flights done, enqueued hotels`);
        return { count: result.count, next: 'hotels' };
      }

      await setLeadQuoteStatus(leadId, 'completed', null, {
        from: result.from,
        to: result.to,
        search: result.search,
        flight_provider: result.provider,
      });

      console.log(
        `[quotes] completed lead ${leadId}: ${result.count} quotes via ${result.provider}`,
      );
      return { count: result.count };
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
    console.error(`[quotes] failed lead ${leadId}:`, error.message);

    if (leadId && isFinal) {
      try {
        await setLeadQuoteStatus(leadId, 'error', error.message);
      } catch (statusError) {
        console.error('[quotes] failed to persist error status:', statusError.message);
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
    console.error('[quotes] worker error:', error.message);
  });

  console.log('BullMQ quote worker started');
  return worker;
}

export async function stopQuoteWorker() {
  if (!worker) return;
  await worker.close();
  worker = null;
}
