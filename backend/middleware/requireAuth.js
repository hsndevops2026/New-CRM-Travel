import { verifyAccessToken } from '../services/authTokens.js';
import { findAdminById, publicAdmin } from '../services/admins.js';

/**
 * Require a valid Bearer access token.
 * Attaches `req.admin` with { id, email, created_at }.
 */
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired access token' });
    }

    const admin = await findAdminById(payload.sub);
    if (!admin) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (admin.approval_status !== 'approved') {
      return res.status(401).json({ error: 'Account access is not approved' });
    }

    req.admin = publicAdmin(admin);
    return next();
  } catch (error) {
    console.error('requireAuth failed:', error.message);
    return res.status(500).json({ error: 'Authentication failed' });
  }
}
