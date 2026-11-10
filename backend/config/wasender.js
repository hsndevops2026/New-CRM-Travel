import 'dotenv/config';

export const wasenderConfig = {
  apiKey: process.env.WASENDER_API_KEY || '',
  webhookSecret: process.env.WASENDER_WEBHOOK_SECRET || '',
  baseUrl: process.env.WASENDER_BASE_URL || 'https://www.wasenderapi.com/api',
};
