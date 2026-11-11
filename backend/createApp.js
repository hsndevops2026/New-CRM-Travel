import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import Redis from 'ioredis';
import { rateLimit } from 'express-rate-limit';
import whatsappRoutes from './routes/whatsapp.js';
import authRoutes from './routes/auth.js';
import leadsRoutes from './routes/leads.js';
import flightsRoutes from './routes/flights.js';
import hotelsRoutes from './routes/hotels.js';
import marketRoutes from './routes/market.js';
import contactsRoutes from './routes/contacts.js';
import remindersRoutes from './routes/reminders.js';
import dealersRoutes from './routes/dealers.js';
import dealerRequestsRoutes from './routes/dealerRequests.js';
import quoteDraftsRoutes from './routes/quoteDrafts.js';
import { quoteVersionsAuthRoutes, quoteVersionsPublicRoutes } from './routes/quoteVersions.js';
import foundationRoutes from './routes/foundation.js';
import predefinedQuotesRoutes from './routes/predefinedQuotes.js';
import uploadsRoutes from './routes/uploads.js';
import imagesRoutes from './routes/images.js';
import navCountsRoutes from './routes/navCounts.js';
import { requireAuth } from './middleware/requireAuth.js';
import { agentLeadAccess } from './middleware/agentLeadAccess.js';
import permissionsRoutes from './routes/permissions.js';
import { pingDb } from './config/database.js';
import { redisConfig } from './config/redis.js';
import opsRoutes from './routes/ops.js';
import inboxRoutes from './routes/inbox.js';
import assistantRoutes from './routes/assistant.js';
import tripPlanRoutes from './routes/tripPlan.js';
import { classifyError, logError } from './services/logger.js';
import agencySettingsRoutes from './routes/agencySettings.js';
import portalRoutes from './routes/portal.js';
import bookingDocumentsRoutes from './routes/bookingDocuments.js';
import { requireRole } from './middleware/requireRole.js';

export function createApp() {
  const app = express();
  const rateLimitOptions = {
    windowMs: 60_000,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many requests. Try again shortly.' },
  };
  const quoteLimiter = rateLimit({ ...rateLimitOptions, limit: 120 });
  const webhookLimiter = rateLimit({ ...rateLimitOptions, limit: 6000 });
  const userLimiter = rateLimit({
    ...rateLimitOptions,
    limit: 600,
    keyGenerator: (req) => req.admin.id,
  });
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });
  const apiMode = String(process.env.APP_MODE || 'all').toLowerCase();

  const corsOrigins = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin: corsOrigins.length ? corsOrigins : true,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());

  // Request correlation + structured access logs
  app.use((req, res, next) => {
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();
    req.requestId = String(requestId);
    res.setHeader('x-request-id', req.requestId);
    const startMs = Date.now();

    res.on('finish', () => {
      const elapsedMs = Date.now() - startMs;
      console.log(
        JSON.stringify({
          level: 'info',
          kind: 'http',
          request_id: req.requestId,
          method: req.method,
          path: req.originalUrl || req.url,
          status: res.statusCode,
          duration_ms: elapsedMs,
          admin_id: req.admin?.id || null,
          admin_role: req.admin?.role || null,
        }),
      );
    });
    next();
  });

  app.use((req, _res, next) => {
    if (req.url.includes('//')) {
      req.url = req.url.replace(/\/{2,}/g, '/');
    }
    next();
  });

  app.get('/', (_req, res) => {
    res.json({
      status: 'ok',
      agency: process.env.AGENCY_SLUG || 'horizon',
      message: 'Travel backend is running',
      webhook: '/webhook/whatsapp',
      auth: '/api/auth',
      leads: '/api/leads',
      flights: '/api/flights/quotes',
      flightAirports: '/api/flights/airports',
      hotels: '/api/hotels/quotes',
      hotelSuggest: '/api/hotels/destinations/suggest',
      images: '/api/images/search',
      predefinedQuotes: '/api/predefined-quotes',
      uploads: '/api/uploads/cloudinary-sign',
      dealers: '/api/dealers',
      audit: '/api/audit',
      ops: '/api/ops',
      queue: 'bullmq:flight-quotes,hotel-quotes,voice-messages',
      mode: apiMode,
    });
  });

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, status: 'healthy', mode: apiMode, agency: process.env.AGENCY_SLUG || 'horizon' });
  });

  app.get('/readyz', async (_req, res) => {
    const report = {
      ok: true,
      checks: {
        postgres: false,
        redis: false,
        wasender_configured: Boolean(process.env.WASENDER_API_KEY),
        openai_configured: Boolean(process.env.OPENAI_API_KEY),
      },
    };
    try {
      await pingDb();
      report.checks.postgres = true;
    } catch {
      report.ok = false;
    }

    let redis = null;
    try {
      redis = new Redis(redisConfig);
      const pong = await redis.ping();
      report.checks.redis = pong === 'PONG';
      if (!report.checks.redis) report.ok = false;
    } catch {
      report.ok = false;
    } finally {
      if (redis) {
        try {
          redis.disconnect();
        } catch {
          // ignore
        }
      }
    }

    return res.status(report.ok ? 200 : 503).json(report);
  });

  app.use('/webhook/whatsapp', webhookLimiter);
  app.use('/webhook', whatsappRoutes);
  app.use('/api/auth', authRoutes);
  // Public share routes must be registered before any app.use('/api', requireAuth, …)
  // mounts, otherwise requireAuth intercepts /api/q/:token with 401.
  app.use('/api/q', quoteLimiter);
  app.use('/api', quoteVersionsPublicRoutes);
  // Customer portal — before staff agentLeadAccess (which rejects role=customer).
  app.use('/api/portal', requireAuth, requireRole('customer'), userLimiter, portalRoutes);
  app.use('/api', requireAuth, userLimiter, agentLeadAccess);
  app.use('/api/permissions', permissionsRoutes);
  app.use('/api', requireAuth, assistantRoutes);
  app.use('/api', requireAuth, tripPlanRoutes);
  app.use('/api', requireAuth, leadsRoutes);
  app.use('/api', requireAuth, flightsRoutes);
  app.use('/api', requireAuth, hotelsRoutes);
  app.use('/api', requireAuth, marketRoutes);
  app.use('/api', requireAuth, contactsRoutes);
  app.use('/api', requireAuth, remindersRoutes);
  app.use('/api', requireAuth, dealersRoutes);
  app.use('/api', requireAuth, dealerRequestsRoutes);
  app.use('/api', requireAuth, quoteDraftsRoutes);
  app.use('/api', requireAuth, quoteVersionsAuthRoutes);
  app.use('/api', requireAuth, inboxRoutes);
  app.use('/api', requireAuth, foundationRoutes);
  app.use('/api', requireAuth, bookingDocumentsRoutes);
  app.use('/api', requireAuth, agencySettingsRoutes);
  app.use('/api/ops', requireAuth, opsRoutes);
  app.use('/api', requireAuth, predefinedQuotesRoutes);
  app.use('/api', requireAuth, uploadsRoutes);
  app.use('/api', requireAuth, imagesRoutes);
  app.use('/api', requireAuth, navCountsRoutes);

  // Global error handler — structured taxonomy logging
  app.use((err, req, res, _next) => {
    logError('http.unhandled', err, {
      request_id: req.requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      error_kind: classifyError(err),
    });
    const status = Number(err.status || err.statusCode) || 500;
    res.status(status).json({
      error: err.message || 'Internal server error',
      request_id: req.requestId,
    });
  });

  return app;
}
