/**
 * Shared SerpApi HTTP client.
 *
 * Every SerpApi engine is a GET against the same base URL, differing only by
 * the `engine` param, so all four integrations (Google Flights, Google Flights
 * Autocomplete, Google Hotels Autocomplete, Google Images) go through here.
 *
 * Mirrors the error taxonomy of rapidClient.js so route handlers can keep
 * using `error.status` / `error.details` without special-casing the provider.
 */

import { serpApiConfig } from '../config/serpapi.js';

const serpTimeoutMs = Math.max(3000, Number(process.env.SERPAPI_TIMEOUT_MS || 20000));

function requireKey() {
  if (!String(serpApiConfig.key || '').trim()) {
    const error = new Error(
      'SERPAPI_KEY is not configured. Add it to backend/.env (get one at https://serpapi.com/manage-api-key).',
    );
    error.status = 500;
    throw error;
  }
}

function serpError(message, engine, details) {
  const text =
    typeof message === 'string'
      ? message
      : message
        ? JSON.stringify(message)
        : `SerpApi ${engine} error`;

  const isRateLimit = /run out of searches|rate limit|too many requests|429/i.test(text);
  const isAuth = /invalid api key|missing api key|unauthorized/i.test(text);

  const error = new Error(
    isRateLimit
      ? 'SerpApi search quota reached. Top up the plan or wait for the quota to reset.'
      : isAuth
        ? 'SerpApi rejected the API key. Check SERPAPI_KEY in backend/.env.'
        : text,
  );
  error.status = isRateLimit ? 429 : isAuth ? 500 : 502;
  error.details = details;
  return error;
}

/**
 * Calls a SerpApi engine and returns the parsed JSON body.
 *
 * @param {string} engine  SerpApi engine name, e.g. 'google_flights'
 * @param {object} params  Engine params; empty/null values are dropped
 * @param {object} options `{ hl, gl }` locale overrides
 */
export async function serpGet(engine, params = {}, options = {}) {
  requireKey();

  const url = new URL(serpApiConfig.baseUrl);
  url.searchParams.set('engine', engine);
  url.searchParams.set('api_key', serpApiConfig.key);
  url.searchParams.set('hl', options.hl || serpApiConfig.hl);
  url.searchParams.set('gl', options.gl || serpApiConfig.gl);

  for (const [param, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(param, String(value));
  }

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(serpTimeoutMs),
      headers: { Accept: 'application/json' },
    });
  } catch (cause) {
    const timedOut = cause?.name === 'TimeoutError' || cause?.name === 'AbortError';
    throw serpError(
      timedOut
        ? `SerpApi ${engine} timed out after ${serpTimeoutMs}ms.`
        : `SerpApi ${engine} request failed: ${cause?.message || cause}`,
      engine,
      null,
    );
  }

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  // SerpApi reports engine-level problems in `error` with HTTP 200 in some cases.
  if (!response.ok) {
    throw serpError(data?.error || `SerpApi ${engine} error (${response.status})`, engine, data);
  }
  if (data?.error) {
    throw serpError(data.error, engine, data);
  }

  return data;
}

/** Never let the SerpApi key leak into logs or API error payloads. */
export function redactSerpUrl(value) {
  return String(value || '').replace(/(api_key=)[^&]+/gi, '$1***');
}
