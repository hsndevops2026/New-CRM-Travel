import { createHash, randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { pool, query } from '../config/database.js';
import { authConfig, refreshCookieOptions } from '../config/auth.js';

function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

function parseDurationMs(value, fallbackMs) {
  const raw = String(value || '').trim().toLowerCase();
  const match = raw.match(/^(\d+)(ms|s|m|h|d)?$/);
  if (!match) return fallbackMs;
  const amount = Number(match[1]);
  const unit = match[2] || 's';
  const multipliers = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return amount * (multipliers[unit] || 1000);
}

export function accessTokenTtlMs() {
  return parseDurationMs(authConfig.accessExpires, 15 * 60_000);
}

export function refreshTokenTtlMs() {
  return parseDurationMs(authConfig.refreshExpires, 7 * 86_400_000);
}

export function signAccessToken(admin) {
  return jwt.sign(
    {
      sub: admin.id,
      email: admin.email,
      type: 'access',
    },
    authConfig.accessSecret,
    { expiresIn: authConfig.accessExpires },
  );
}

export function verifyAccessToken(token) {
  const payload = jwt.verify(token, authConfig.accessSecret);
  if (payload?.type !== 'access') {
    const error = new Error('Invalid access token');
    error.status = 401;
    throw error;
  }
  return payload;
}

function signRefreshToken({ adminId, jti, familyId }) {
  return jwt.sign(
    {
      sub: adminId,
      jti,
      family: familyId,
      type: 'refresh',
    },
    authConfig.refreshSecret,
    { expiresIn: authConfig.refreshExpires },
  );
}

export function setRefreshCookie(res, token) {
  res.cookie(
    authConfig.refreshCookieName,
    token,
    refreshCookieOptions(refreshTokenTtlMs()),
  );
}

export function clearRefreshCookie(res) {
  res.clearCookie(authConfig.refreshCookieName, {
    ...refreshCookieOptions(0),
    maxAge: 0,
  });
}

export async function issueTokenPair(admin, { familyId } = {}) {
  const jti = randomUUID();
  const family = familyId || randomUUID();
  const refreshToken = signRefreshToken({
    adminId: admin.id,
    jti,
    familyId: family,
  });
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + refreshTokenTtlMs());

  await query(
    `INSERT INTO refresh_tokens (admin_id, token_hash, jti, family_id, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [admin.id, tokenHash, jti, family, expiresAt.toISOString()],
  );

  return {
    accessToken: signAccessToken(admin),
    refreshToken,
    familyId: family,
    expiresAt,
  };
}

async function revokeFamily(client, familyId) {
  await client.query(
    `UPDATE refresh_tokens
     SET revoked_at = NOW()
     WHERE family_id = $1 AND revoked_at IS NULL`,
    [familyId],
  );
}

/**
 * Rotate refresh token. Reuse of a revoked/rotated token revokes the whole family.
 */
export async function rotateRefreshToken(rawRefreshToken) {
  if (!rawRefreshToken) {
    const error = new Error('Refresh token required');
    error.status = 401;
    throw error;
  }

  let payload;
  try {
    payload = jwt.verify(rawRefreshToken, authConfig.refreshSecret);
  } catch {
    const error = new Error('Invalid or expired refresh token');
    error.status = 401;
    throw error;
  }

  if (payload?.type !== 'refresh' || !payload.sub || !payload.jti || !payload.family) {
    const error = new Error('Invalid refresh token');
    error.status = 401;
    throw error;
  }

  const tokenHash = hashToken(rawRefreshToken);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT * FROM refresh_tokens
       WHERE token_hash = $1
       LIMIT 1
       FOR UPDATE`,
      [tokenHash],
    );
    const row = existing.rows[0];

    if (!row) {
      await client.query('ROLLBACK');
      const error = new Error('Invalid refresh token');
      error.status = 401;
      throw error;
    }

    if (row.revoked_at) {
      if (row.replaced_by) {
        // Possible theft of a rotated token: revoke entire family
        await revokeFamily(client, row.family_id);
        await client.query('COMMIT');
        const error = new Error('Refresh token reuse detected');
        error.status = 401;
        throw error;
      }
      await client.query('COMMIT');
      const error = new Error('Refresh token revoked');
      error.status = 401;
      throw error;
    }

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await client.query(
        `UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`,
        [row.id],
      );
      await client.query('COMMIT');
      const error = new Error('Refresh token expired');
      error.status = 401;
      throw error;
    }

    const adminResult = await client.query(
      `SELECT id, email, role, approval_status, lead_credits, leads_used, created_at, contact_id FROM admins WHERE id = $1 LIMIT 1`,
      [row.admin_id],
    );
    const admin = adminResult.rows[0];
    if (!admin) {
      await revokeFamily(client, row.family_id);
      await client.query('COMMIT');
      const error = new Error('Admin not found');
      error.status = 401;
      throw error;
    }
    if (admin.approval_status !== 'approved') {
      await revokeFamily(client, row.family_id);
      await client.query('COMMIT');
      const error = new Error('Account access is not approved');
      error.status = 403;
      throw error;
    }

    const newJti = randomUUID();
    const newRefreshToken = signRefreshToken({
      adminId: admin.id,
      jti: newJti,
      familyId: row.family_id,
    });
    const newHash = hashToken(newRefreshToken);
    const expiresAt = new Date(Date.now() + refreshTokenTtlMs());

    const inserted = await client.query(
      `INSERT INTO refresh_tokens (admin_id, token_hash, jti, family_id, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [admin.id, newHash, newJti, row.family_id, expiresAt.toISOString()],
    );

    await client.query(
      `UPDATE refresh_tokens
       SET revoked_at = NOW(),
           replaced_by = $2
       WHERE id = $1`,
      [row.id, inserted.rows[0].id],
    );

    await client.query('COMMIT');

    return {
      admin,
      accessToken: signAccessToken(admin),
      refreshToken: newRefreshToken,
    };
  } catch (error) {
    // Only roll back if the transaction is still open
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore — already committed or no active transaction
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeRefreshToken(rawRefreshToken) {
  if (!rawRefreshToken) return;
  const tokenHash = hashToken(rawRefreshToken);
  await query(
    `UPDATE refresh_tokens
     SET revoked_at = NOW()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash],
  );
}

export async function cleanupExpiredRefreshTokens() {
  await query(
    `DELETE FROM refresh_tokens
     WHERE expires_at < NOW() - INTERVAL '30 days'`,
  );
}
