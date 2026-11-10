import { Router } from 'express';
import { listThreads, getThreadMessages, parseThreadId } from '../services/inbox.js';
import { sendCustomerMessage, sendDealerMessage, sendGroupMessage } from '../services/chatSend.js';
import { allocateLeads } from '../services/permissions.js';
import { getAiHandover, pauseAi, resumeAi } from '../services/aiHandover.js';
import { getLeadById } from '../services/leads.js';

async function customerPhoneForThread(threadId) {
  const parsed = parseThreadId(threadId);
  if (!parsed || parsed.kind !== 'customer') return null;
  if (parsed.byPhone) return parsed.id;
  const lead = await getLeadById(parsed.id);
  return lead?.phone || null;
}

const router = Router();

router.get('/inbox/threads', async (req, res) => {
  try {
    const kind = req.query.kind || 'all';
    const limit = Number(req.query.limit) || 100;
    if (req.admin.role === 'agent') await allocateLeads(req.admin.id);
    const { threads } = await listThreads({ kind, limit, userId: req.admin.role === 'agent' ? req.admin.id : null });
    res.json({ count: threads.length, threads });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to list threads' });
  }
});

router.get('/inbox/threads/:threadId/messages', async (req, res) => {
  try {
    const before = req.query.before || null;
    const limit = Number(req.query.limit) || 50;
    const data = await getThreadMessages(req.params.threadId, { before, limit });
    if (!data.thread) return res.status(404).json({ error: 'Thread not found' });
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to load messages' });
  }
});

router.get('/inbox/threads/:threadId/ai', async (req, res) => {
  try {
    const phone = await customerPhoneForThread(req.params.threadId);
    if (!phone) return res.status(404).json({ error: 'Customer conversation not found' });
    res.json({ handover: await getAiHandover(phone) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to load AI status' });
  }
});

router.post('/inbox/threads/:threadId/ai', async (req, res) => {
  try {
    const phone = await customerPhoneForThread(req.params.threadId);
    if (!phone) return res.status(404).json({ error: 'Customer conversation not found' });
    if (typeof req.body?.paused !== 'boolean') return res.status(400).json({ error: 'paused must be true or false' });
    const actor = { actorId: req.admin?.id, actorRole: req.admin?.role, reason: 'manual' };
    if (req.body.paused) await pauseAi(phone, actor);
    else await resumeAi(phone, actor);
    res.json({ handover: await getAiHandover(phone) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to update AI status' });
  }
});

router.post('/inbox/threads/:threadId/send', async (req, res) => {
  try {
    const parsed = parseThreadId(req.params.threadId);
    if (!parsed) return res.status(400).json({ error: 'Invalid thread id' });

    const body = req.body?.body;
    if (parsed.kind === 'customer') {
      const result = await sendCustomerMessage({
        leadId: parsed.byPhone ? null : parsed.id,
        phone: parsed.byPhone ? parsed.id : null,
        body,
        actorId: req.admin?.id,
      });
      return res.status(201).json(result);
    }

    if (parsed.kind === 'group') {
      const result = await sendGroupMessage({
        groupJid: parsed.id,
        body,
        actorId: req.admin?.id,
      });
      return res.status(201).json(result);
    }

    const result = await sendDealerMessage({
      dealerRequestId: parsed.id,
      body,
      actorId: req.admin?.id,
    });
    return res.status(201).json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to send message' });
  }
});

export default router;
