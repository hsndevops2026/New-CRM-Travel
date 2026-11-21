import crypto from 'node:crypto';
import { query } from '../config/database.js';
import { getAgencySettings } from './agencySettings.js';

/**
 * Website chat settings, edited by an admin in CRM Settings. One row (id = 1).
 * The allowed sites used to come only from WEBCHAT_ALLOWED_ORIGINS; that variable
 * is still honoured while the list in the CRM is empty.
 */

const CACHE_MS = 15_000;
let cache = null;

function httpError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

export const WEBCHAT_DEFAULTS = Object.freeze({
  enabled: true,
  language: 'ar',
  title: null,
  greeting: null,
  color: null,
  side: null,
  allowed_origins: [],
  verify_phone: false,
  show_staff_replies: true,
});

/** "https://Agency.com/page" → "https://agency.com". Returns null for anything that is not a site address. */
export function normalizeOrigin(value) {
  let text = String(value || '').trim();
  if (!text) return null;
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (!/^(localhost|\[[0-9a-f:.]+\]|[a-z0-9-]+(\.[a-z0-9-]+)+)$/i.test(url.hostname)) return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

export function envOrigins(env = process.env) {
  return String(env.WEBCHAT_ALLOWED_ORIGINS || '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);
}

function optionalText(value, max, field) {
  if (value == null) return null;
  const text = String(value).replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim();
  if (text.length > max) throw httpError(400, `${field} is too long (max ${max} characters)`);
  return text || null;
}

/** forWidget: one user's chat, where an empty language means "the agency default" and phone rules are agency-wide. */
export function normalizeWebchatSettings(input = {}, { forWidget = false } = {}) {
  const out = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
  for (const key of forWidget ? ['enabled'] : ['enabled', 'verify_phone', 'show_staff_replies']) {
    if (has(key)) {
      if (typeof input[key] !== 'boolean') throw httpError(400, `${key} must be true or false`);
      out[key] = input[key];
    }
  }
  if (has('language')) {
    if (forWidget && (input.language == null || input.language === '')) out.language = null;
    else if (!['ar', 'en'].includes(input.language)) throw httpError(400, 'language must be ar or en');
    else out.language = input.language;
  }
  if (has('side')) {
    if (input.side != null && input.side !== '' && !['left', 'right'].includes(input.side)) throw httpError(400, 'side must be left or right');
    out.side = input.side || null;
  }
  if (has('color')) {
    if (input.color != null && input.color !== '' && !/^#[0-9A-Fa-f]{6}$/.test(String(input.color))) {
      throw httpError(400, 'color must look like #0f766e');
    }
    out.color = input.color ? String(input.color).toLowerCase() : null;
  }
  if (has('title')) out.title = optionalText(input.title, 60, 'Title');
  if (has('greeting')) out.greeting = optionalText(input.greeting, 400, 'Greeting');
  if (has('allowed_origins')) {
    if (!Array.isArray(input.allowed_origins)) throw httpError(400, 'allowed_origins must be a list');
    if (input.allowed_origins.length > 50) throw httpError(400, 'Add at most 50 websites');
    const list = [];
    for (const raw of input.allowed_origins) {
      if (!String(raw || '').trim()) continue;
      const origin = normalizeOrigin(raw);
      if (!origin) throw httpError(400, `"${String(raw).slice(0, 80)}" is not a website address`);
      if (!list.includes(origin)) list.push(origin);
    }
    out.allowed_origins = list;
  }
  return out;
}

function fromRow(row) {
  if (!row) return { ...WEBCHAT_DEFAULTS };
  return {
    enabled: row.enabled,
    language: row.language,
    title: row.title,
    greeting: row.greeting,
    color: row.color,
    side: row.side,
    allowed_origins: row.allowed_origins || [],
    verify_phone: row.verify_phone,
    show_staff_replies: row.show_staff_replies,
    updated_at: row.updated_at,
  };
}

export async function getWebchatSettings({ fresh = false } = {}) {
  if (!fresh && cache && cache.at > Date.now() - CACHE_MS) return cache.value;
  const { rows } = await query(`SELECT * FROM webchat_settings WHERE id = 1`);
  const value = fromRow(rows[0]);
  cache = { at: Date.now(), value };
  return value;
}

export function clearWebchatSettingsCache() {
  cache = null;
}

export async function updateWebchatSettings(input) {
  const patch = normalizeWebchatSettings(input);
  const keys = Object.keys(patch);
  if (keys.length) {
    const sets = keys.map((key, i) => `${key} = $${i + 1}`);
    await query(`INSERT INTO webchat_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
    await query(
      `UPDATE webchat_settings SET ${sets.join(', ')}, updated_at = NOW() WHERE id = 1`,
      keys.map((key) => patch[key]),
    );
  }
  clearWebchatSettingsCache();
  clearWidgetCache();
  return getWebchatSettings({ fresh: true });
}

/**
 * The sites allowed to use the chat: the CRM list, else the env variable.
 * An empty result means "any site" (kept for existing installs; the Settings page warns about it).
 */
export function effectiveOrigins(settings, env = process.env) {
  return settings.allowed_origins?.length ? settings.allowed_origins : envOrigins(env);
}

/**
 * The backend's own origin is always allowed, so the built-in test page works.
 * A request without an Origin header (curl, server to server) is not a browser on another site.
 */
export function isOriginAllowed(origin, settings, { selfOrigin = null, env = process.env } = {}) {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (selfOrigin && normalized === normalizeOrigin(selfOrigin)) return true;
  const allowed = effectiveOrigins(settings, env);
  return allowed.length === 0 || allowed.includes(normalized);
}

// ── One chat per user ─────────────────────────────────────────────────────────

const KEY_PATTERN = /^wc_[A-Za-z0-9_-]{20,64}$/;
const widgetCache = new Map();

export function newPublicKey() {
  return `wc_${crypto.randomBytes(18).toString('base64url')}`;
}

export function isPublicKey(value) {
  return KEY_PATTERN.test(String(value || ''));
}

const WIDGET_COLUMNS = `w.*, a.email AS owner_email, a.role AS owner_role,
  COALESCE(a.approval_status, 'approved') AS owner_status`;
const WIDGET_FROM = `FROM webchat_widgets w JOIN admins a ON a.id = w.owner_id`;

function widgetFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    owner_id: row.owner_id,
    owner_email: row.owner_email,
    owner_role: row.owner_role,
    owner_active: row.owner_status === 'approved',
    public_key: row.public_key,
    enabled: row.enabled,
    language: row.language,
    title: row.title,
    greeting: row.greeting,
    color: row.color,
    side: row.side,
    allowed_origins: row.allowed_origins || [],
    last_used_at: row.last_used_at,
    key_rotated_at: row.key_rotated_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function clearWidgetCache() {
  widgetCache.clear();
}

/** The chat a script tag's key belongs to, or null. Cached briefly: every widget call looks it up. */
export async function findWidgetByKey(key) {
  if (!isPublicKey(key)) return null;
  const hit = widgetCache.get(key);
  if (hit && hit.at > Date.now() - CACHE_MS) return hit.value;
  const { rows } = await query(`SELECT ${WIDGET_COLUMNS} ${WIDGET_FROM} WHERE w.public_key = $1`, [key]);
  const value = widgetFromRow(rows[0]);
  widgetCache.set(key, { at: Date.now(), value });
  return value;
}

export async function findWidgetById(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
  const { rows } = await query(`SELECT ${WIDGET_COLUMNS} ${WIDGET_FROM} WHERE w.id = $1`, [id]);
  return widgetFromRow(rows[0]);
}

/** Every user has a chat; it is created the first time they open the page. */
export async function getOrCreateWidget(ownerId) {
  await query(
    `INSERT INTO webchat_widgets (owner_id, public_key) VALUES ($1, $2) ON CONFLICT (owner_id) DO NOTHING`,
    [ownerId, newPublicKey()],
  );
  const { rows } = await query(`SELECT ${WIDGET_COLUMNS} ${WIDGET_FROM} WHERE w.owner_id = $1`, [ownerId]);
  return widgetFromRow(rows[0]);
}

export async function updateWidget(widgetId, input) {
  const patch = normalizeWebchatSettings(input, { forWidget: true });
  const keys = Object.keys(patch);
  if (keys.length) {
    await query(
      `UPDATE webchat_widgets SET ${keys.map((key, i) => `${key} = $${i + 2}`).join(', ')}, updated_at = NOW() WHERE id = $1`,
      [widgetId, ...keys.map((key) => patch[key])],
    );
  }
  clearWidgetCache();
  return findWidgetById(widgetId);
}

/** A new key stops the old script code at once; the chat's settings stay. */
export async function rotateWidgetKey(widgetId) {
  await query(
    `UPDATE webchat_widgets SET public_key = $2, key_rotated_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [widgetId, newPublicKey()],
  );
  clearWidgetCache();
  return findWidgetById(widgetId);
}

/** For admins: every user's chat, with how many website leads it brought in. */
export async function listWidgets() {
  const { rows } = await query(
    `SELECT ${WIDGET_COLUMNS},
       (SELECT COUNT(DISTINCT s.lead_id) FROM webchat_sessions s
        WHERE s.widget_id = w.id AND s.lead_id IS NOT NULL)::int AS lead_count
     ${WIDGET_FROM}
     ORDER BY a.email ASC`,
  );
  return rows.map((row) => ({ ...widgetFromRow(row), lead_count: row.lead_count }));
}

/** How many leads a chat has brought in (each chat counted once). */
export async function widgetLeadCount(widgetId) {
  const { rows } = await query(
    `SELECT COUNT(DISTINCT lead_id)::int AS n FROM webchat_sessions WHERE widget_id = $1 AND lead_id IS NOT NULL`,
    [widgetId],
  );
  return rows[0]?.n ?? 0;
}

export async function touchWidget(widgetId) {
  await query(
    `UPDATE webchat_widgets SET last_used_at = NOW()
     WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL '5 minutes')`,
    [widgetId],
  ).catch(() => {});
}

/**
 * What a script tag gets: the agency settings, with its owner's choices on top.
 * No key: the shared agency chat (older code). Unknown key: an error, and the widget shows nothing.
 * The agency switch turns every chat off; a user's switch only theirs.
 */
export async function resolveChat(key) {
  const settings = await getWebchatSettings();
  if (!key) return { settings, widget: null, effective: { ...settings } };
  const widget = await findWidgetByKey(key);
  if (!widget) throw httpError(404, 'This chat code is not valid any more. Ask for the new code.', 'unknown_key');
  return {
    settings,
    widget,
    effective: {
      ...settings,
      enabled: settings.enabled && widget.enabled && widget.owner_active,
      language: widget.language || settings.language,
      title: widget.title || settings.title,
      greeting: widget.greeting || settings.greeting,
      color: widget.color || settings.color,
      side: widget.side || settings.side,
      allowed_origins: widget.allowed_origins.length ? widget.allowed_origins : settings.allowed_origins,
    },
  };
}

/** What the widget needs to draw itself. Never includes the allowed-site list. */
export async function publicWebchatConfig(key = null) {
  const [{ effective }, agency] = await Promise.all([resolveChat(key), getAgencySettings().catch(() => null)]);
  return {
    enabled: effective.enabled,
    language: effective.language,
    title: effective.title,
    greeting: effective.greeting,
    color: effective.color || agency?.primary_color || '#0f766e',
    side: effective.side,
    agency_name: agency?.agency_name || null,
    verify_phone: effective.verify_phone,
    // Staff replies are only shown in a chat whose phone number was confirmed (see webchat.js).
    show_staff_replies: effective.verify_phone && effective.show_staff_replies,
  };
}
