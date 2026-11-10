import { Router } from 'express';
import { requireRole } from '../middleware/requireRole.js';
import {
  getQueueCounts,
  listFailedQueueJobs,
  listKnownQueues,
  retryFailedJob,
} from '../services/queueOps.js';
import { listFailedDeliveries, retryDelivery } from '../services/quoteDelivery.js';
import { listUnmatchedMessages } from '../services/dealerRequests.js';
import { logAuditEvent } from '../services/audit.js';
import { logError } from '../services/logger.js';

const router = Router();

// All ops routes are admin-only
router.use(requireRole('admin'));

router.get('/queues', async (_req, res) => {
  try {
    const queues = listKnownQueues();
    const counts = await getQueueCounts();
    res.json({ queues, counts });
  } catch (error) {
    logError('ops.queues.list_failed', error, { request_id: _req.requestId });
    res.status(error.status || 500).json({ error: error.message || 'Failed to load queue stats' });
  }
});

router.get('/queues/failed', async (req, res) => {
  try {
    const jobs = await listFailedQueueJobs({
      queueName: req.query.queue,
      limit: Number(req.query.limit) || 50,
    });
    res.json({ count: jobs.length, jobs });
  } catch (error) {
    logError('ops.queues.failed_list', error, { request_id: req.requestId });
    res.status(error.status || 500).json({ error: error.message || 'Failed to list failed jobs' });
  }
});

router.post('/queues/:queueName/jobs/:jobId/retry', async (req, res) => {
  try {
    const result = await retryFailedJob(req.params.queueName, req.params.jobId);
    void logAuditEvent({
      entityType: 'queue_job',
      entityId: req.params.jobId,
      action: 'job_retried',
      actorId: req.admin?.id,
      actorRole: req.admin?.role,
      after: { queue: req.params.queueName },
    });
    res.json(result);
  } catch (error) {
    logError('ops.queues.retry_failed', error, {
      request_id: req.requestId,
      queue: req.params.queueName,
      job_id: req.params.jobId,
    });
    res.status(error.status || 500).json({ error: error.message || 'Failed to retry job' });
  }
});

router.get('/deliveries/failed', async (req, res) => {
  try {
    const deliveries = await listFailedDeliveries(Number(req.query.limit) || 50);
    res.json({ count: deliveries.length, deliveries });
  } catch (error) {
    logError('ops.deliveries.failed_list', error, { request_id: req.requestId });
    res.status(error.status || 500).json({ error: error.message || 'Failed to list deliveries' });
  }
});

router.post('/deliveries/:id/retry', async (req, res) => {
  try {
    const result = await retryDelivery(req.params.id);
    void logAuditEvent({
      entityType: 'quote_delivery',
      entityId: req.params.id,
      action: 'delivery_retried',
      actorId: req.admin?.id,
      actorRole: req.admin?.role,
    });
    res.json(result);
  } catch (error) {
    logError('ops.deliveries.retry_failed', error, {
      request_id: req.requestId,
      delivery_id: req.params.id,
    });
    res.status(error.status || 500).json({ error: error.message || 'Failed to retry delivery' });
  }
});

router.get('/dealer-unmatched', async (req, res) => {
  try {
    const messages = await listUnmatchedMessages({
      limit: Number(req.query.limit) || 50,
      resolved: req.query.resolved === 'true',
    });
    res.json({ count: messages.length, messages });
  } catch (error) {
    logError('ops.dealer.unmatched_list', error, { request_id: req.requestId });
    res.status(500).json({ error: 'Failed to list unmatched dealer messages' });
  }
});

export default router;
