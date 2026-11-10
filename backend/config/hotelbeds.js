import { createHash } from 'crypto';

export const hotelbedsConfig = {
  apiKey: process.env.HOTELBEDS_API_KEY || '',
  secret: process.env.HOTELBEDS_SECRET || '',
  baseUrl:
    process.env.HOTELBEDS_BASE_URL ||
    'https://api.test.hotelbeds.com',
};

/**
 * Generates the X-Signature header value required by Hotelbeds APIs.
 * Signature = SHA256(apiKey + secret + timestampInSeconds)
 */
export function hotelbedsSignature() {
  const ts = Math.floor(Date.now() / 1000).toString();
  return createHash('sha256')
    .update(hotelbedsConfig.apiKey + hotelbedsConfig.secret + ts)
    .digest('hex');
}

export function hotelbedsHeaders() {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Api-key': hotelbedsConfig.apiKey,
    'X-Signature': hotelbedsSignature(),
  };
}
