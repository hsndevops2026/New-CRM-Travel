import { Router } from 'express';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { handleWebChatMessage, normalizeWebPhone } from '../services/webchat.js';

/**
 * Public website chat endpoint, mounted before the global CORS and auth
 * middleware. Origins come from WEBCHAT_ALLOWED_ORIGINS (comma separated);
 * empty allows any site, which is fine for testing but should be set in
 * production to the landing page and booking site domains.
 */

export function webchatOrigins(env = process.env) {
  return String(env.WEBCHAT_ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

export function createWebchatRouter(env = process.env) {
  const router = Router();
  const origins = webchatOrigins(env);
  router.use(cors({ origin: origins.length ? origins : true, credentials: false, methods: ['POST', 'OPTIONS'] }));
  router.use(express.json({ limit: '16kb' }));

  const perIp = rateLimit({
    windowMs: 60_000,
    limit: Number(env.WEBCHAT_RATE_LIMIT_PER_MINUTE) || 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many messages, please wait a minute' },
  });
  const perPhone = rateLimit({
    windowMs: 60_000,
    limit: 12,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `webchat-phone:${normalizeWebPhone(req.body?.phone) || 'invalid'}`,
    message: { error: 'Too many messages, please wait a minute' },
  });

  router.post('/message', perIp, perPhone, async (req, res) => {
    try {
      const result = await handleWebChatMessage({
        name: req.body?.name,
        phone: req.body?.phone,
        text: req.body?.text,
      });
      res.json(result);
    } catch (error) {
      if (!error.status || error.status >= 500) console.error('[webchat]', error.message);
      res.status(error.status || 500).json({
        error: error.status && error.status < 500 ? error.message : 'Sorry, the chat is not available right now',
      });
    }
  });

  return router;
}
