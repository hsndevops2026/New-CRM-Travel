import { wasenderConfig } from '../config/wasender.js';
const wasenderTimeoutMs = Math.max(3000, Number(process.env.WASENDER_TIMEOUT_MS || 15000));

const GROUPS_CACHE_MS = 60_000;
let groupsCache = { expiresAt: 0, groups: null };

export function isGroupJid(value) {
  return /@g\.us\b/i.test(String(value || ''));
}

export function normalizeGroupJid(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const withSuffix = raw.match(/([0-9]+(?:-[0-9]+)?@g\.us)\b/i);
  if (withSuffix) return withSuffix[1];
  const digits = raw.replace(/[^\d-]/g, '');
  // Newer groups: 120363…  Older groups: ownerNumber-timestamp
  if (/^120363\d{8,}$/.test(digits) || /^\d{6,}-\d{6,}$/.test(digits)) {
    return `${digits}@g.us`;
  }
  return null;
}

/**
 * Normalize phone for Wasender "to" field (E.164 with leading +).
 * Group JIDs (…@g.us) are returned unchanged so group sends keep working.
 * Set DEFAULT_PHONE_COUNTRY_CODE (e.g. 91) for local numbers without a country prefix.
 */
export function formatRecipient(phone) {
  const groupJid = normalizeGroupJid(phone);
  if (groupJid) return groupJid;
  if (!phone) return phone;

  const cleaned = String(phone)
    .replace(/@.*$/, '')
    .replace(/[^\d+]/g, '');

  const hadPlus = cleaned.startsWith('+');
  const digits = hadPlus ? cleaned.slice(1).replace(/\D/g, '') : cleaned.replace(/\D/g, '');
  if (!digits) {
    throw new Error('Phone number is required');
  }

  const defaultCountry = String(process.env.DEFAULT_PHONE_COUNTRY_CODE || '').replace(/\D/g, '');

  // Explicit international number — do not prepend default country.
  if (hadPlus || digits.length >= 11) {
    return `+${digits}`;
  }

  if (defaultCountry) {
    return `+${defaultCountry}${digits}`;
  }

  throw new Error(
    `Phone number "${phone}" is missing a country code. Use full international format (e.g. +919876543210) or set DEFAULT_PHONE_COUNTRY_CODE in backend/.env.`,
  );
}

function recipientError(status, data) {
  const message = data?.message || `Wasender send failed (${status})`;
  const err = new Error(message);
  err.status = status === 422 ? 400 : status >= 400 && status < 500 ? status : 502;
  err.provider = 'wasender';
  return err;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeGroupsPayload(payload) {
  const data = payload?.data;
  const items = Array.isArray(data) ? data : data?.items;
  if (!Array.isArray(items)) return [];
  return items
    .map((group) => {
      const jid = normalizeGroupJid(group?.jid || group?.id || group?.groupJid || group?.group_id);
      if (!jid) return null;
      return {
        jid,
        name: String(group?.name || group?.subject || '').trim() || jid,
        imgUrl: group?.imgUrl || group?.img_url || null,
      };
    })
    .filter(Boolean);
}

export async function listWhatsAppGroups({ force = false } = {}) {
  if (!wasenderConfig.apiKey) return [];

  const now = Date.now();
  if (!force && groupsCache.groups && now < groupsCache.expiresAt) {
    return groupsCache.groups;
  }

  const collected = [];

  const plainUrl = new URL(`${wasenderConfig.baseUrl}/groups`);
  const plainResponse = await fetch(plainUrl, {
    signal: AbortSignal.timeout(wasenderTimeoutMs),
    headers: { Authorization: `Bearer ${wasenderConfig.apiKey}` },
  });
  const plainData = await plainResponse.json().catch(() => ({}));
  if (!plainResponse.ok) {
    throw recipientError(plainResponse.status, plainData);
  }
  if (Array.isArray(plainData?.data)) {
    collected.push(...plainData.data);
  } else if (Array.isArray(plainData?.data?.items)) {
    collected.push(...plainData.data.items);
  }

  if (!collected.length) {
    for (let page = 1; page <= 10; page += 1) {
      const url = new URL(`${wasenderConfig.baseUrl}/groups`);
      url.searchParams.set('paginated', 'true');
      url.searchParams.set('limit', '100');
      url.searchParams.set('page', String(page));

      const response = await fetch(url, {
        signal: AbortSignal.timeout(wasenderTimeoutMs),
        headers: { Authorization: `Bearer ${wasenderConfig.apiKey}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw recipientError(response.status, data);
      }

      const items = Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.data?.items)
          ? data.data.items
          : [];
      collected.push(...items);

      const pagination = data?.data?.pagination || {};
      const hasMore = Boolean(pagination.hasMore ?? pagination.has_more ?? pagination.has_next);
      if (Array.isArray(data?.data) || !hasMore || items.length < 100) break;
    }
  }

  const groups = normalizeGroupsPayload({ data: collected });
  groupsCache = groups.length
    ? { expiresAt: now + GROUPS_CACHE_MS, groups }
    : { expiresAt: 0, groups: null };
  return groups;
}

export async function getWhatsAppSessionInfo() {
  if (!wasenderConfig.apiKey) return null;
  const headers = { Authorization: `Bearer ${wasenderConfig.apiKey}` };
  const timeout = AbortSignal.timeout(wasenderTimeoutMs);
  const [statusRes, userRes] = await Promise.all([
    fetch(`${wasenderConfig.baseUrl}/status`, { headers, signal: timeout }),
    fetch(`${wasenderConfig.baseUrl}/user`, { headers, signal: timeout }),
  ]);
  const statusData = await statusRes.json().catch(() => ({}));
  const userData = await userRes.json().catch(() => ({}));
  return {
    status: statusData.status || statusData.data?.status || null,
    name: userData.data?.name || null,
    id: userData.data?.id || null,
  };
}

export async function sendTextMessage(to, text, { retries = 3 } = {}) {
  if (!wasenderConfig.apiKey) {
    throw new Error('WASENDER_API_KEY is not configured');
  }

  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const response = await fetch(`${wasenderConfig.baseUrl}/send-message`, {
      method: 'POST',
      signal: AbortSignal.timeout(wasenderTimeoutMs),
      headers: {
        Authorization: `Bearer ${wasenderConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: formatRecipient(to),
        text,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (response.ok) {
      return data;
    }

    lastError = recipientError(response.status, data);
    console.error('Wasender send failed:', response.status, data);

    // Account protection: wait and retry
    if (response.status === 429) {
      const waitSec = Number(data?.retry_after || 5);
      console.log(`Rate limited. Waiting ${waitSec}s then retrying (${attempt}/${retries})...`);
      await sleep(waitSec * 1000 + 500);
      continue;
    }

    throw lastError;
  }

  throw lastError;
}

/**
 * Sends a WhatsApp poll (Wasender has no buttons). Votes come back on the `poll.results`
 * webhook as option text plus voters, so callers keep their own option → id mapping.
 * @param {string} to
 * @param {{ question: string, options: string[], multiSelect?: boolean }} poll 2–12 options
 */
export async function sendPollMessage(to, { question, options, multiSelect = false }, { retries = 3 } = {}) {
  if (!wasenderConfig.apiKey) {
    throw new Error('WASENDER_API_KEY is not configured');
  }
  if (!question || !Array.isArray(options) || options.length < 2 || options.length > 12) {
    throw new Error('A poll needs a question and 2 to 12 options');
  }

  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const response = await fetch(`${wasenderConfig.baseUrl}/send-message`, {
      method: 'POST',
      signal: AbortSignal.timeout(wasenderTimeoutMs),
      headers: {
        Authorization: `Bearer ${wasenderConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: formatRecipient(to),
        poll: { question, options, multiSelect },
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (response.ok) {
      return data;
    }

    lastError = recipientError(response.status, data);
    console.error('Wasender poll send failed:', response.status, data);

    if (response.status === 429) {
      const waitSec = Number(data?.retry_after || 5);
      await sleep(waitSec * 1000 + 500);
      continue;
    }

    throw lastError;
  }

  throw lastError;
}

/**
 * Send a document (PDF, etc.) via publicly accessible URL.
 */
export async function sendDocumentMessage(to, { text, documentUrl, fileName }, { retries = 3 } = {}) {
  if (!wasenderConfig.apiKey) {
    throw new Error('WASENDER_API_KEY is not configured');
  }
  if (!documentUrl) {
    throw new Error('documentUrl is required');
  }

  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const response = await fetch(`${wasenderConfig.baseUrl}/send-message`, {
      method: 'POST',
      signal: AbortSignal.timeout(wasenderTimeoutMs),
      headers: {
        Authorization: `Bearer ${wasenderConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: formatRecipient(to),
        text: text || undefined,
        documentUrl,
        fileName: fileName || undefined,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (response.ok) {
      return data;
    }

    lastError = recipientError(response.status, data);
    console.error('Wasender document send failed:', response.status, data);

    if (response.status === 429) {
      const waitSec = Number(data?.retry_after || 5);
      await sleep(waitSec * 1000 + 500);
      continue;
    }

    throw lastError;
  }

  throw lastError;
}

/* ------------------------------------------------------------------ *
 * Incoming media (voice notes)
 * ------------------------------------------------------------------ */

const mediaDownloadTimeoutMs = Math.max(
  3000,
  Number(process.env.VOICE_DOWNLOAD_TIMEOUT_MS || 30000),
);

/**
 * Builds a media error that says whether retrying can help. A 4xx from Wasender
 * (bad/expired media, unsupported type) will fail identically every time, so it is
 * flagged `permanent`; 408/429/5xx and network failures are left retryable.
 */
function mediaError(message, status, details = null) {
  const err = new Error(message);
  err.status = status;
  err.provider = 'wasender';
  err.details = details;
  err.permanent = status >= 400 && status < 500 && status !== 408 && status !== 429;
  return err;
}

/**
 * Asks Wasender to decrypt an incoming WhatsApp media file and returns a temporary
 * public URL (valid for one hour — never store it; fetch a fresh one per attempt).
 *
 * The webhook only carries the *encrypted* CDN url plus a mediaKey, so the file
 * cannot be downloaded directly. POST /decrypt-media takes the message id and the
 * original media object and does the decryption server-side.
 */
export async function decryptMedia({ messageId, audioMessage }) {
  if (!wasenderConfig.apiKey) {
    const err = new Error('WASENDER_API_KEY is not configured');
    err.permanent = true;
    throw err;
  }
  if (!messageId || !audioMessage) {
    const err = new Error('messageId and audioMessage are required to decrypt media');
    err.permanent = true;
    throw err;
  }

  const response = await fetch(`${wasenderConfig.baseUrl}/decrypt-media`, {
    method: 'POST',
    signal: AbortSignal.timeout(wasenderTimeoutMs),
    headers: {
      Authorization: `Bearer ${wasenderConfig.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: { messages: { key: { id: messageId }, message: { audioMessage } } },
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw mediaError(
      data?.message || `Wasender decrypt-media failed (${response.status})`,
      response.status,
      data,
    );
  }
  if (!data?.publicUrl) {
    throw mediaError('Wasender decrypt-media returned no publicUrl', 502, data);
  }
  return data.publicUrl;
}

/**
 * Downloads a decrypted media file into memory, refusing anything over `maxBytes`.
 * Only ever called with the URL Wasender returned — never with a URL taken from
 * the (untrusted) webhook payload.
 */
export async function downloadMedia(url, { maxBytes = 20 * 1024 * 1024 } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw mediaError('Invalid media URL', 502);
  }
  if (parsed.protocol !== 'https:') {
    throw mediaError('Refusing to download media over a non-HTTPS URL', 502);
  }

  const response = await fetch(parsed, { signal: AbortSignal.timeout(mediaDownloadTimeoutMs) });
  if (!response.ok) {
    throw mediaError(`Media download failed (${response.status})`, response.status);
  }

  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw mediaError(`Media is too large (${declared} bytes)`, 413);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) {
    throw mediaError(`Media is too large (${buffer.length} bytes)`, 413);
  }
  if (!buffer.length) {
    throw mediaError('Downloaded media was empty', 502);
  }

  return { buffer, contentType: response.headers.get('content-type') || null };
}
