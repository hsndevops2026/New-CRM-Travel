import { Router } from 'express';
import { getContactById } from '../services/contacts.js';
import { resolveFrontendBaseUrl } from '../services/quoteDelivery.js';
import {
  addressQuery,
  connectAccount,
  consumeState,
  createAuthUrl,
  defaultAccount,
  disconnectAccount,
  getAttachment,
  getMessage,
  getOwnedAccount,
  googleConfig,
  listAccounts,
  listMessages,
  sendMessage,
  setDefaultAccount,
} from '../services/gmail.js';

function fail(res, error, fallback) {
  if (error.code === 'reauth_required') return res.status(409).json({ error: 'reauth_required' });
  if (!error.status || error.status >= 500 && error.status !== 503) console.error('[email]', error.message);
  return res.status(error.status || 500).json({
    error: error.status && (error.status < 500 || error.status === 503) ? error.message : fallback,
  });
}

async function account(req, res, id) {
  const found = await getOwnedAccount(req.admin?.id, id);
  if (!found) res.status(404).json({ error: 'Account not found' });
  return found;
}

/** Google redirects the browser here; no Bearer token, so it is mounted before requireAuth. */
export const emailCallbackRouter = Router();
emailCallbackRouter.get('/email/oauth/callback', async (req, res) => {
  const back = (query) => res.redirect(`${resolveFrontendBaseUrl()}/email?${query}`);
  if (req.query.error) return back('error=access_denied');
  const adminId = await consumeState(req.query.state).catch(() => null);
  if (!adminId || !req.query.code) return back('error=invalid_state');
  try {
    await connectAccount({ code: String(req.query.code), adminId });
    return back('connected=1');
  } catch (error) {
    console.error('[email] Gmail connect failed:', error.message);
    return back('error=connect_failed');
  }
});

const router = Router();

router.get('/email/status', (_req, res) => {
  res.json({ configured: googleConfig().configured });
});

router.post('/email/connect', async (req, res) => {
  try { res.json({ url: await createAuthUrl(req.admin.id) }); } catch (error) { fail(res, error, 'Could not start Gmail connection'); }
});

router.get('/email/accounts', async (req, res) => {
  try { res.json({ accounts: await listAccounts(req.admin.id) }); } catch (error) { fail(res, error, 'Failed to load accounts'); }
});

router.patch('/email/accounts/:accountId/default', async (req, res) => {
  try {
    if (!(await setDefaultAccount(req.admin.id, req.params.accountId))) return res.status(404).json({ error: 'Account not found' });
    res.json({ ok: true });
  } catch (error) { fail(res, error, 'Failed to update account'); }
});

router.delete('/email/accounts/:accountId', async (req, res) => {
  try {
    if (!(await disconnectAccount(req.admin.id, req.params.accountId))) return res.status(404).json({ error: 'Account not found' });
    res.status(204).send();
  } catch (error) { fail(res, error, 'Failed to disconnect account'); }
});

router.get('/email/messages', async (req, res) => {
  try {
    const acc = await account(req, res, req.query.accountId);
    if (!acc) return;
    res.json(await listMessages(acc, { pageToken: req.query.pageToken, q: addressQuery(req.query.search) }));
  } catch (error) { fail(res, error, 'Failed to load messages'); }
});

router.post('/email/messages/send', async (req, res) => {
  try {
    const acc = await account(req, res, req.body?.accountId);
    if (!acc) return;
    res.status(201).json(await sendMessage(acc, { to: req.body?.to, subject: req.body?.subject, body: req.body?.body }));
  } catch (error) { fail(res, error, 'Failed to send the email'); }
});

router.get('/email/messages/:id', async (req, res) => {
  try {
    const acc = await account(req, res, req.query.accountId);
    if (!acc) return;
    res.json(await getMessage(acc, req.params.id));
  } catch (error) { fail(res, error, 'Failed to load the message'); }
});

router.get('/email/messages/:id/attachments/:attachmentId', async (req, res) => {
  try {
    const acc = await account(req, res, req.query.accountId);
    if (!acc) return;
    const data = await getAttachment(acc, req.params.id, req.params.attachmentId);
    const name = String(req.query.filename || 'attachment').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(data);
  } catch (error) { fail(res, error, 'Failed to download the attachment'); }
});

/** Emails with a contact, from the employee's default Gmail account. */
router.get('/contacts/:id/emails', async (req, res) => {
  try {
    const contact = await getContactById(req.params.id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    const acc = await defaultAccount(req.admin.id);
    if (!acc) return res.json({ connected: false, messages: [], nextPageToken: null });
    if (!contact.email) return res.json({ connected: true, account: { id: acc.id, email: acc.email }, messages: [], nextPageToken: null, no_email: true });
    const result = await listMessages(acc, { pageToken: req.query.pageToken, q: addressQuery(contact.email) });
    res.json({ connected: true, account: { id: acc.id, email: acc.email }, ...result });
  } catch (error) { fail(res, error, 'Failed to load emails'); }
});

export default router;
