/**
 * Startup checks for production. The server refuses to start when a setting that
 * protects logins or the WhatsApp webhook is missing, instead of quietly falling
 * back to a development default.
 */
export function isProduction(env = process.env) {
  return String(env.NODE_ENV || '').toLowerCase() === 'production';
}

export function productionConfigProblems(env = process.env) {
  if (!isProduction(env)) return [];
  const problems = [];
  const hasSession = Boolean(String(env.SESSION_SECRET || '').trim());
  for (const name of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    if (!String(env[name] || '').trim() && !hasSession) {
      problems.push(`${name} (or SESSION_SECRET) must be set in production`);
    }
  }
  if (
    String(env.JWT_ACCESS_SECRET || '').trim() &&
    env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET
  ) {
    problems.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
  }
  if (String(env.WASENDER_API_KEY || '').trim() && !String(env.WASENDER_WEBHOOK_SECRET || '').trim()) {
    problems.push('WASENDER_WEBHOOK_SECRET must be set when WhatsApp is enabled in production');
  }
  return problems;
}
