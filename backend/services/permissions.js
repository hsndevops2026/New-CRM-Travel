import { pool, query } from '../config/database.js';

export async function listUsers() {
  const result = await query(`
    SELECT id, email, role, approval_status, lead_credits, leads_used, created_at
    FROM admins WHERE role = 'agent' ORDER BY created_at DESC
  `);
  return result.rows;
}

export async function setUserApproval(id, status) {
  if (!['approved', 'revoked'].includes(status)) {
    const error = new Error('Status must be approved or revoked');
    error.status = 400;
    throw error;
  }
  const result = await query(
    `UPDATE admins SET approval_status = $2 WHERE id = $1 AND role = 'agent'
     RETURNING id, email, role, approval_status, lead_credits, leads_used, created_at`,
    [id, status],
  );
  if (status === 'revoked' && result.rows[0]) {
    await query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE admin_id = $1 AND revoked_at IS NULL`, [id]);
  }
  return result.rows[0] || null;
}

export async function addUserCredits(id, amount) {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 10000) {
    const error = new Error('Credits must be a whole number from 1 to 10000');
    error.status = 400;
    throw error;
  }
  const result = await query(
    `UPDATE admins SET lead_credits = lead_credits + $2
     WHERE id = $1 AND role = 'agent'
     RETURNING id, email, role, approval_status, lead_credits, leads_used, created_at`,
    [id, amount],
  );
  return result.rows[0] || null;
}

// Lock the user row so concurrent requests cannot allocate more than the credit limit.
export async function allocateLeads(userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const account = await client.query(
      `SELECT lead_credits, leads_used FROM admins WHERE id = $1 AND role = 'agent' FOR UPDATE`,
      [userId],
    );
    if (!account.rows[0]) throw new Error('User not found');
    const remaining = Math.max(0, account.rows[0].lead_credits - account.rows[0].leads_used);
    if (remaining > 0) {
      const inserted = await client.query(
        `INSERT INTO user_leads (user_id, lead_id)
         SELECT $1, l.id FROM leads l
         WHERE NOT EXISTS (SELECT 1 FROM user_leads ul WHERE ul.lead_id = l.id)
         ORDER BY l.created_at DESC, l.id DESC LIMIT $2
         ON CONFLICT DO NOTHING RETURNING lead_id`,
        [userId, remaining],
      );
      await client.query(`UPDATE admins SET leads_used = leads_used + $2 WHERE id = $1`, [userId, inserted.rowCount]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function hasLeadAccess(userId, leadId) {
  const result = await query(`SELECT 1 FROM user_leads WHERE user_id = $1 AND lead_id = $2`, [userId, leadId]);
  return result.rowCount > 0;
}

export async function reserveLeadCredit(userId) {
  const result = await query(
    `UPDATE admins SET leads_used = leads_used + 1
     WHERE id = $1 AND role = 'agent' AND approval_status = 'approved'
       AND leads_used < lead_credits RETURNING id`,
    [userId],
  );
  if (!result.rowCount) {
    const error = new Error('No lead credits remaining. Ask an admin for more credits.');
    error.status = 403;
    throw error;
  }
}

export async function createCreditedLead(userId, create) {
  await reserveLeadCredit(userId);
  let created;
  try {
    created = await create();
    await query(`INSERT INTO user_leads (user_id, lead_id) VALUES ($1, $2)`, [userId, created.lead.id]);
    return created;
  } catch (error) {
    if (created?.lead?.id) await query(`DELETE FROM leads WHERE id = $1`, [created.lead.id]);
    await query(`UPDATE admins SET leads_used = leads_used - 1 WHERE id = $1`, [userId]);
    throw error;
  }
}

export async function leadIdForResource(table, id) {
  const sql = {
    dealer_request: `SELECT lead_id FROM dealer_requests WHERE id = $1`,
    dealer_response: `SELECT dreq.lead_id FROM dealer_responses dr JOIN dealer_requests dreq ON dreq.id = dr.dealer_request_id WHERE dr.id = $1`,
    quote_version: `SELECT lead_id FROM quote_versions WHERE id = $1`,
    quote_delivery: `SELECT qv.lead_id FROM quote_deliveries qd JOIN quote_versions qv ON qv.id = qd.quote_version_id WHERE qd.id = $1`,
  }[table];
  if (!sql) throw new Error('Unknown lead resource');
  const result = await query(sql, [id]);
  return result.rows[0]?.lead_id || null;
}
