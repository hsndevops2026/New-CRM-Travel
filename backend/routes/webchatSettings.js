import { Router } from 'express';
import { requireRole } from '../middleware/requireRole.js';
import { logAuditEvent } from '../services/audit.js';
import {
  envOrigins,
  findWidgetById,
  getOrCreateWidget,
  getWebchatSettings,
  listWidgets,
  rotateWidgetKey,
  updateWebchatSettings,
  updateWidget,
  widgetLeadCount,
} from '../services/webchatSettings.js';
import { selfOrigin } from './webchat.js';

const isLocal = (url) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url);

/**
 * Where websites load the widget from, including any path the backend is served
 * under (e.g. https://api.agency.com/travel behind nginx):
 * WEBCHAT_PUBLIC_URL, else BACKEND_URL / API_URL (already set for WhatsApp PDF links),
 * else this request's own address plus the X-Forwarded-Prefix a proxy may send.
 * A localhost address is only used while the CRM itself is opened on localhost.
 */
export function widgetBaseUrl(req, env = process.env) {
  const self = selfOrigin(req);
  const candidates = [env.WEBCHAT_PUBLIC_URL, env.BACKEND_URL, env.API_URL]
    .map((v) => String(v || '').trim().replace(/\/+$/, ''))
    .filter((v) => /^https?:\/\//i.test(v));
  const usable = candidates.find((v) => !isLocal(v) || isLocal(self));
  if (usable) return usable;
  const prefix = String(req.get('x-forwarded-prefix') || '').trim().replace(/\/+$/, '');
  return /^\/[\w\-./]*$/.test(prefix) ? `${self}${prefix}` : self;
}

/** The pieces of a user's chat the page shows: settings, script address and test page. */
function widgetView(req, widget, settings) {
  if (!widget) return null;
  const base = widgetBaseUrl(req);
  return {
    ...widget,
    test_page_url: `${base}/webchat-test?lang=${widget.language || settings.language}&key=${encodeURIComponent(widget.public_key)}`,
  };
}

async function payload(req) {
  const settings = await getWebchatSettings({ fresh: true });
  const base = widgetBaseUrl(req);
  const isAdmin = req.admin?.role === 'admin';
  const mine = await getOrCreateWidget(req.admin.id);
  return {
    // Agency defaults and phone rules. Everyone sees them (they explain the empty fields); only admins change them.
    settings,
    env_origins: envOrigins(),
    script_url: `${base}/webchat.js`,
    test_page_url: `${base}/webchat-test?lang=${settings.language}`,
    my_widget: { ...widgetView(req, mine, settings), lead_count: await widgetLeadCount(mine.id) },
    widgets: isAdmin ? (await listWidgets()).map((w) => widgetView(req, w, settings)) : undefined,
  };
}

function fail(res, error, fallback) {
  if (!error.status) console.error('[webchat-settings]', error.message);
  res.status(error.status || 500).json({ error: error.status ? error.message : fallback });
}

const audit = (req, action, before, after) => void logAuditEvent({
  entityType: 'webchat',
  action,
  actorId: req.admin?.id,
  actorRole: req.admin?.role,
  before,
  after,
});

const router = Router();

router.get('/webchat-settings', async (req, res) => {
  try {
    res.json(await payload(req));
  } catch (error) {
    fail(res, error, 'Failed to load the chat settings');
  }
});

/** Agency defaults: admins only. */
router.patch('/webchat-settings', requireRole('admin'), async (req, res) => {
  try {
    const before = await getWebchatSettings({ fresh: true });
    const after = await updateWebchatSettings(req.body || {});
    audit(req, 'agency_settings_updated', before, after);
    res.json(await payload(req));
  } catch (error) {
    fail(res, error, 'Failed to save the chat settings');
  }
});

/** A user's own chat. */
router.patch('/webchat-widget', async (req, res) => {
  try {
    const before = await getOrCreateWidget(req.admin.id);
    const after = await updateWidget(before.id, req.body || {});
    audit(req, 'widget_updated', before, after);
    res.json(await payload(req));
  } catch (error) {
    fail(res, error, 'Failed to save your chat');
  }
});

router.post('/webchat-widget/rotate-key', async (req, res) => {
  try {
    const before = await getOrCreateWidget(req.admin.id);
    await rotateWidgetKey(before.id);
    audit(req, 'widget_key_rotated', { id: before.id }, { id: before.id });
    res.json(await payload(req));
  } catch (error) {
    fail(res, error, 'Failed to make a new code');
  }
});

/** Admins: switch any user's chat on or off. */
router.patch('/webchat-widgets/:id', requireRole('admin'), async (req, res) => {
  try {
    const before = await findWidgetById(req.params.id);
    if (!before) return res.status(404).json({ error: 'Chat not found' });
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be true or false' });
    const after = await updateWidget(before.id, { enabled: req.body.enabled });
    audit(req, 'widget_updated', before, after);
    res.json(await payload(req));
  } catch (error) {
    fail(res, error, 'Failed to update the chat');
  }
});

/** Admins: give any user's chat a new code (the old code stops working). */
router.post('/webchat-widgets/:id/rotate-key', requireRole('admin'), async (req, res) => {
  try {
    const before = await findWidgetById(req.params.id);
    if (!before) return res.status(404).json({ error: 'Chat not found' });
    await rotateWidgetKey(before.id);
    audit(req, 'widget_key_rotated', { id: before.id }, { id: before.id });
    res.json(await payload(req));
  } catch (error) {
    fail(res, error, 'Failed to make a new code');
  }
});

export default router;
