import { createHash } from 'node:crypto';

function derivedSecret(purpose, explicitSecret) {
  if (explicitSecret) return explicitSecret;
  if (process.env.SESSION_SECRET) {
    return createHash('sha256')
      .update(`${purpose}:${process.env.SESSION_SECRET}`)
      .digest('hex');
  }
  return `dev-${purpose}-secret-change-me`;
}

export const authConfig = {
  accessSecret: derivedSecret('access', process.env.JWT_ACCESS_SECRET),
  refreshSecret: derivedSecret('refresh', process.env.JWT_REFRESH_SECRET),
  accessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
  refreshExpires: process.env.JWT_REFRESH_EXPIRES || '7d',
  refreshCookieName: process.env.REFRESH_COOKIE_NAME || 'refresh_token',
  /**
   * Cookie path must be a prefix of the browser request path.
   * Default `/` so prefixed APIs work (e.g. https://api.example.com/travel/api/...).
   * Narrow with REFRESH_COOKIE_PATH=/travel/api/auth if desired.
   */
  refreshCookiePath: process.env.REFRESH_COOKIE_PATH || '/',
  /** false for local http; true for production HTTPS + cross-site Vercel */
  cookieSecure:
    String(process.env.COOKIE_SECURE || 'false').toLowerCase() === 'true',
  /**
   * SameSite=None required for Vercel frontend → separate HTTPS API host.
   * Local Vite proxy / same-origin Vercel rewrite: Lax is fine.
   */
  cookieSameSite: process.env.COOKIE_SAME_SITE || 'lax',
  passwordMinLength: Math.max(8, Number(process.env.PASSWORD_MIN_LENGTH) || 8),
};

export function refreshCookieOptions(maxAgeMs) {
  const sameSiteRaw = String(authConfig.cookieSameSite || 'lax').toLowerCase();
  const sameSite =
    sameSiteRaw === 'none' || sameSiteRaw === 'strict' || sameSiteRaw === 'lax'
      ? sameSiteRaw
      : 'lax';

  return {
    httpOnly: true,
    secure: authConfig.cookieSecure || sameSite === 'none',
    sameSite,
    path: authConfig.refreshCookiePath || '/',
    maxAge: maxAgeMs,
  };
}
