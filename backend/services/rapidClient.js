import { rapidApiConfig } from '../config/rapidapi.js';
const rapidTimeoutMs = Math.max(3000, Number(process.env.RAPIDAPI_TIMEOUT_MS || 15000));

function requireKey(key, envName = 'RAPIDAPI_KEY') {
  if (!key) {
    const error = new Error(
      `${envName} is not configured. Add it to backend/.env (same key as RapidAPI MCP).`,
    );
    error.status = 500;
    throw error;
  }
}

function rapidError(message, product, details) {
  const text =
    typeof message === 'string'
      ? message
      : message
        ? JSON.stringify(message)
        : `${product} API error`;
  const error = new Error(
    /too many requests|rate limit/i.test(text)
      ? `${product} rate limit reached. Wait a moment and try again.`
      : /not subscribed/i.test(text)
        ? `RapidAPI key is not subscribed to ${product}. Subscribe on RapidAPI Hub, then retry.`
        : text,
  );
  error.status = /too many requests|rate limit/i.test(text) ? 429 : 502;
  error.details = details;
  return error;
}

export async function rapidGet(path, params = {}, options = {}) {
  const product = options.product || 'Booking.com';
  const host = options.host || rapidApiConfig.host;
  const baseUrl = options.baseUrl || rapidApiConfig.baseUrl;
  const key = options.key || rapidApiConfig.key;
  requireKey(key, options.envName || 'RAPIDAPI_KEY');

  const url = new URL(`${baseUrl}${path}`);
  for (const [param, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(param, String(value));
  }

  const response = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(rapidTimeoutMs),
    headers: {
      'x-rapidapi-key': key,
      'x-rapidapi-host': host,
    },
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  const apiMessage = data?.message || data?.error;
  if (!response.ok) {
    throw rapidError(apiMessage || `${product} API error (${response.status})`, product, data);
  }

  if (typeof apiMessage === 'string' && /not subscribed|too many requests|rate limit/i.test(apiMessage)) {
    throw rapidError(apiMessage, product, data);
  }

  if (data?.status === false) {
    throw rapidError(apiMessage || `${product} returned no results`, product, data);
  }

  return data;
}
