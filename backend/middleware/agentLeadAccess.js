import { hasLeadAccess, leadIdForResource } from '../services/permissions.js';
import { parseThreadId } from '../services/inbox.js';

const LEAD_PATH = /^\/leads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

const RESOURCE_PATH = /^\/(dealer-responses|quote-versions|quote-deliveries)\/([0-9a-f-]{36})(?:\/|$)/i;

// Scope lead-bearing resources while allowing agents to use the rest of the CRM.
export async function agentLeadAccess(req, res, next) {
  if (req.admin?.role === 'admin') return next();
  if (req.admin?.role !== 'agent') return res.status(403).json({ error: 'Insufficient permissions' });
  const apiPath = new URL(req.originalUrl, 'http://localhost').pathname.replace(/^\/api/, '');
  if (apiPath.startsWith('/permissions') || apiPath.startsWith('/ops')) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  try {
    const leadPath = apiPath.match(LEAD_PATH);
    let leadId = leadPath?.[1] || null;
    if (apiPath === '/leads/simulate-whatsapp') return res.status(403).json({ error: 'Insufficient permissions' });
    if (apiPath === '/leads/delete-bulk') {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
      if (!ids.length || !(await Promise.all(ids.map((id) => hasLeadAccess(req.admin.id, id)))).every(Boolean)) {
        return res.status(403).json({ error: 'This lead is not assigned to your account' });
      }
    }
    if (apiPath.startsWith('/inbox/threads/') && (apiPath.endsWith('/messages') || apiPath.endsWith('/send') || apiPath.endsWith('/ai'))) {
      const encoded = apiPath.slice('/inbox/threads/'.length).replace(/\/(messages|send|ai)$/, '');
      const parsed = parseThreadId(decodeURIComponent(encoded));
      if (parsed?.kind === 'customer') {
        if (parsed.byPhone) return res.status(403).json({ error: 'This conversation is not assigned to your account' });
        leadId = parsed.id;
      } else if (parsed?.kind === 'dealer') {
        leadId = await leadIdForResource('dealer_request', parsed.id);
      }
    }
    if (apiPath === '/dealer-requests' && req.method === 'POST') leadId = req.body?.lead_id;
    if ((apiPath === '/dealer-requests' || apiPath === '/dealer-responses') && req.query?.lead_id) leadId = req.query.lead_id;
    if (apiPath === '/dealer-responses' && req.query?.dealer_request_id) {
      leadId = await leadIdForResource('dealer_request', req.query.dealer_request_id);
    }
    const resource = apiPath.match(RESOURCE_PATH);
    if (resource) {
      const type = { 'dealer-responses': 'dealer_response', 'quote-versions': 'quote_version', 'quote-deliveries': 'quote_delivery' }[resource[1]];
      leadId = await leadIdForResource(type, resource[2]);
    }
    if (leadId && !await hasLeadAccess(req.admin.id, leadId)) {
      return res.status(403).json({ error: 'This lead is not assigned to your account' });
    }
    return next();
  } catch (error) { return next(error); }
}
