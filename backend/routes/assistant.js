import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { askAssistant } from '../services/assistant.js';

// Each question can cost several model calls, so keep a tighter per-user limit.
const assistantLimiter = rateLimit({
  windowMs: 60_000,
  limit: Number(process.env.ASSISTANT_RATE_LIMIT_PER_MINUTE) || 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `assistant:${req.admin?.id || 'anonymous'}`,
  message: { error: 'Too many questions, please wait a minute' },
});

const router = Router();

/** POST /api/assistant/chat { messages: [{role, content}] } — staff assistant, read-only. */
router.post('/assistant/chat', assistantLimiter, async (req, res) => {
  try {
    const result = await askAssistant({ messages: req.body?.messages, user: req.admin });
    res.json(result);
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('[assistant]', error.message);
    res.status(error.status || 500).json({ error: error.status && (error.status < 500 || error.status === 503) ? error.message : 'The assistant could not answer right now' });
  }
});

export default router;
