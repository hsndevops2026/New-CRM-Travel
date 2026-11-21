import { Router } from 'express';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import {
  handleSessionMessage,
  handleWebChatMessage,
  normalizeWebPhone,
  resendWebChatCode,
  startWebChatSession,
  verifyWebChatCode,
  webChatUpdates,
} from '../services/webchat.js';
import { isOriginAllowed, publicWebchatConfig, resolveChat } from '../services/webchatSettings.js';

/**
 * Public website chat endpoints, mounted before the global CORS and auth
 * middleware. Which sites may use the chat is set in CRM Settings → Website chat
 * (WEBCHAT_ALLOWED_ORIGINS is the fallback while that list is empty; empty
 * everywhere allows any site). The backend's own address is always allowed,
 * for the built-in test page.
 */

export function selfOrigin(req) {
  return `${req.protocol}://${req.get('host')}`;
}

const lang = (value) => (value === 'en' ? 'en' : 'ar');

/**
 * The chat key from the script tag. It travels in the address of every call
 * (not the body), so it is also there for the browser's CORS preflight.
 */
const chatKey = (req) => (typeof req.query.key === 'string' && req.query.key ? req.query.key.slice(0, 80) : null);

/** Is this browser's site allowed for this chat? An unknown key is allowed nowhere. */
async function siteAllowed(req, env) {
  try {
    const { effective } = await resolveChat(chatKey(req));
    return isOriginAllowed(req.get('origin'), effective, { selfOrigin: selfOrigin(req), env }) ? 'yes' : 'no';
  } catch (error) {
    if (error.code === 'unknown_key') return 'unknown_key';
    throw error;
  }
}

export function createWebchatRouter(env = process.env) {
  const router = Router();

  router.use(cors((req, callback) => {
    siteAllowed(req, env)
      .then((allowed) => {
        const origin = req.get('origin');
        callback(null, { origin: allowed === 'yes' ? origin || false : false, credentials: false, methods: ['GET', 'POST', 'OPTIONS'] });
      })
      .catch((error) => callback(error));
  }));
  router.use(express.json({ limit: '16kb' }));

  // A browser on a site that is not on the list gets no CORS header (so it cannot
  // read anything), and its request is not acted on either.
  const siteCheck = async (req, res, next) => {
    try {
      const allowed = await siteAllowed(req, env);
      if (allowed === 'unknown_key') {
        return res.status(404).json({ error: 'This chat code is not valid any more. Ask for the new code.', code: 'unknown_key' });
      }
      if (allowed !== 'yes') return res.status(403).json({ error: 'This website is not allowed to use the chat' });
      next();
    } catch (error) {
      next(error);
    }
  };

  const limiter = (limit, keyGenerator) => rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    message: { error: 'Too many messages, please wait a minute' },
  });
  const perIp = limiter(Number(env.WEBCHAT_RATE_LIMIT_PER_MINUTE) || 20);
  const perPhone = limiter(12, (req) => `webchat-phone:${normalizeWebPhone(req.body?.phone) || 'invalid'}`);
  // Starting chats (and so sending WhatsApp codes) is limited harder than chatting.
  const startsPerIp = limiter(6);
  const startsPerPhone = limiter(3, (req) => `webchat-start:${normalizeWebPhone(req.body?.phone) || 'invalid'}`);
  const perToken = limiter(12, (req) => `webchat-token:${String(req.body?.token || '').slice(0, 64) || 'none'}`);
  const updatesPerIp = limiter(40);

  const send = (fn, status = 200) => async (req, res) => {
    try {
      res.status(status).json(await fn(req));
    } catch (error) {
      if (!error.status || error.status >= 500 && error.status !== 503) console.error('[webchat]', error.message);
      res.status(error.status || 500).json({
        error: error.status && (error.status < 500 || error.status === 503) ? error.message : 'Sorry, the chat is not available right now',
        ...(error.code ? { code: error.code } : {}),
      });
    }
  };

  router.get('/config', siteCheck, async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'public, max-age=60');
      res.json(await publicWebchatConfig(chatKey(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post('/session', siteCheck, startsPerIp, startsPerPhone, send((req) => startWebChatSession({
    name: req.body?.name,
    phone: req.body?.phone,
    origin: req.get('origin') || null,
    attribution: {
      page_url: req.body?.page_url,
      page_title: req.body?.page_title,
      referrer: req.body?.referrer,
      utm: req.body?.utm && typeof req.body.utm === 'object' ? req.body.utm : {},
    },
    language: lang(req.body?.language),
    key: chatKey(req),
  }), 201));

  router.post('/verify', siteCheck, perIp, perToken, send((req) => verifyWebChatCode({ token: req.body?.token, code: req.body?.code })));

  router.post('/resend', siteCheck, startsPerIp, send((req) => resendWebChatCode({ token: req.body?.token, language: lang(req.body?.language) })));

  router.post('/message', siteCheck, perIp, perPhone, perToken, send((req) => (
    req.body?.token
      ? handleSessionMessage({ token: req.body.token, text: req.body?.text, language: lang(req.body?.language) })
      : handleWebChatMessage({ name: req.body?.name, phone: req.body?.phone, text: req.body?.text })
  )));

  router.post('/updates', siteCheck, updatesPerIp, send((req) => webChatUpdates({ token: req.body?.token, after: req.body?.after })));

  return router;
}

/** A plain page with the widget on it, so staff can try the chat before adding it to a site. */
export function webchatTestPage(req, res) {
  const language = lang(req.query.lang);
  const key = /^wc_[A-Za-z0-9_-]{20,64}$/.test(String(req.query.key || '')) ? String(req.query.key) : '';
  const rtl = language === 'ar';
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:");
  res.type('html').send(`<!doctype html>
<html lang="${language}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${rtl ? 'تجربة محادثة الموقع' : 'Website chat test'}</title>
<script src="webchat.js" data-lang="${language}"${key ? ` data-key="${key}"` : ''}></script>
<style>body{margin:0;font-family:system-ui,sans-serif;background:#f3f4f6;color:#111827}main{max-width:640px;margin:0 auto;padding:48px 20px}h1{font-size:22px}p{line-height:1.6;color:#4b5563}</style>
</head>
<body>
<main>
<h1>${rtl ? 'صفحة تجربة محادثة الموقع' : 'Website chat test page'}</h1>
<p>${rtl
    ? 'هذه صفحة تجربة. الفقاعة في الزاوية هي نفس المحادثة التي تظهر على موقعك. أي طلب تكمله هنا يصبح عميلاً محتملاً حقيقياً في النظام.'
    : 'This is a test page. The bubble in the corner is the same chat your website shows. A request you complete here becomes a real lead in the CRM.'}</p>
</main>
</body>
</html>`);
}
