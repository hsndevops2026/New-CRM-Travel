export const redisConfig = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
  // Logical database (0-15). Lets dev / test runs share a Redis server with a live
  // worker without consuming each other's queues.
  db: Number(process.env.REDIS_DB || 0),
  maxRetriesPerRequest: null,
};
