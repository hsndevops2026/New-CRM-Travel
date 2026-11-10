import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authConfig } from '../config/auth.js';
import {
  createAdmin,
  publicAdmin,
  verifyAdminCredentials,
} from '../services/admins.js';
import {
  clearRefreshCookie,
  issueTokenPair,
  revokeRefreshToken,
  rotateRefreshToken,
  setRefreshCookie,
} from '../services/authTokens.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts. Try again later.' },
});

function sendAuthSuccess(res, admin, accessToken, refreshToken) {
  if (refreshToken) {
    setRefreshCookie(res, refreshToken);
  }
  res.json({
    admin: publicAdmin(admin),
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: authConfig.accessExpires,
  });
}

router.post('/signup', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const admin = await createAdmin({ email, password });
    return res.status(201).json({ admin: publicAdmin(admin), message: 'Account created. Wait for admin approval before signing in.' });
  } catch (error) {
    console.error('Signup failed:', error.message);
    return res.status(error.status || 500).json({
      error: error.message || 'Failed to create account',
    });
  }
});

router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const admin = await verifyAdminCredentials(email, password);
    if (!admin) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (admin.approval_status !== 'approved') {
      return res.status(403).json({ error: admin.approval_status === 'revoked' ? 'Your account access has been revoked.' : 'Your account is waiting for admin approval.' });
    }

    const tokens = await issueTokenPair(admin);
    return sendAuthSuccess(res, admin, tokens.accessToken, tokens.refreshToken);
  } catch (error) {
    console.error('Login failed:', error.message);
    return res.status(error.status || 500).json({
      error: error.message || 'Failed to login',
    });
  }
});

router.post('/refresh', authLimiter, async (req, res) => {
  try {
    const raw =
      req.cookies?.[authConfig.refreshCookieName] ||
      req.body?.refresh_token ||
      null;

    const rotated = await rotateRefreshToken(raw);
    return sendAuthSuccess(
      res,
      rotated.admin,
      rotated.accessToken,
      rotated.refreshToken,
    );
  } catch (error) {
    clearRefreshCookie(res);
    console.error('Refresh failed:', error.message);
    return res.status(error.status || 401).json({
      error: error.message || 'Failed to refresh session',
    });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const raw = req.cookies?.[authConfig.refreshCookieName] || null;
    await revokeRefreshToken(raw);
    clearRefreshCookie(res);
    return res.json({ ok: true });
  } catch (error) {
    clearRefreshCookie(res);
    console.error('Logout failed:', error.message);
    return res.status(500).json({ error: 'Failed to logout' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ admin: req.admin });
});

export default router;
