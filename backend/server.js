import 'dotenv/config';
import express from 'express';
import { createApp } from './createApp.js';
import { pingDb } from './config/database.js';
import { runMigrations } from './db/migrate.js';
import { startQuoteWorker, stopQuoteWorker } from './workers/quoteWorker.js';
import { getQuoteQueue } from './queues/quoteQueue.js';
import { startHotelQuoteWorker, stopHotelQuoteWorker } from './workers/hotelQuoteWorker.js';
import { getHotelQuoteQueue } from './queues/hotelQuoteQueue.js';
import { startVoiceWorker, stopVoiceWorker } from './workers/voiceWorker.js';
import { getVoiceQueue } from './queues/voiceQueue.js';
import { closeSimulationRedis } from './services/voiceSimulation.js';
import { expireStaleConversations } from './services/leads.js';
import { ensureBootstrapAdmin } from './services/admins.js';

const app = createApp();
const PORT = process.env.PORT || 3000;
const APP_MODE = String(process.env.APP_MODE || 'all').toLowerCase(); // all | api | worker

const root = express();
root.use(app);

async function start() {
  try {
    await pingDb();
    await runMigrations();
    const bootstrap = await ensureBootstrapAdmin();
    if (bootstrap?.created) {
      console.log('Bootstrap admin account created');
    }
    console.log('Connected to Postgres');
  } catch (error) {
    const detail = error?.message || error?.code || String(error);
    console.error('Postgres connection failed:', detail || '(no details)');
    console.error(
      'Start Docker Desktop, then from backend/: npm run db:up',
    );
    process.exit(1);
  }

  const shouldRunApi = APP_MODE === 'all' || APP_MODE === 'api';
  const shouldRunWorkers = APP_MODE === 'all' || APP_MODE === 'worker';

  if (shouldRunWorkers) {
    try {
      getQuoteQueue();
      startQuoteWorker();
      getHotelQuoteQueue();
      startHotelQuoteWorker();
      getVoiceQueue();
      startVoiceWorker();
      console.log(`Workers started (mode=${APP_MODE})`);
    } catch (error) {
      console.error('BullMQ/Redis failed:', error.message);
      console.error('Start Redis with: docker compose up -d redis');
      process.exit(1);
    }
  }

  let server = null;
  if (shouldRunApi) {
    server = root.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT} (mode=${APP_MODE})`);
      console.log(`WhatsApp webhook: POST http://localhost:${PORT}/webhook/whatsapp`);
    });

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Stop the other process or run: docker stop travel-backend`);
      } else {
        console.error('HTTP server error:', error);
      }
      process.exit(1);
    });
  }

  let idleSweep = null;
  if (shouldRunApi) {
    const idleSweepMs = Math.max(
      15_000,
      Number(process.env.CONVERSATION_IDLE_SWEEP_MS || 60_000) || 60_000,
    );
    idleSweep = setInterval(() => {
      void expireStaleConversations()
        .then((rows) => {
          if (rows.length) {
            console.log(`[conversations] expired ${rows.length} idle session(s)`);
          }
        })
        .catch((error) => {
          console.error('[conversations] idle sweep failed:', error.message);
        });
    }, idleSweepMs);
    if (typeof idleSweep.unref === 'function') idleSweep.unref();
  }

  const shutdown = async (signal) => {
    console.log(`${signal} received, shutting down…`);
    if (idleSweep) clearInterval(idleSweep);
    try {
      if (shouldRunWorkers) {
        await stopQuoteWorker();
        const queue = getQuoteQueue();
        await queue.close();
        await stopHotelQuoteWorker();
        const hotelQueue = getHotelQuoteQueue();
        await hotelQueue.close();
        await stopVoiceWorker();
        await getVoiceQueue().close();
        await closeSimulationRedis();
      }
    } catch (error) {
      console.error('Queue shutdown error:', error.message);
    }
    if (server) {
      server.close(() => process.exit(0));
    } else {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

start();

export { app };
