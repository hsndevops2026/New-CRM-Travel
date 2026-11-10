import { query } from '../config/database.js';
import { listDealerSavedGroups } from './dealers.js';
import { getWhatsAppSessionInfo, listWhatsAppGroups, normalizeGroupJid } from './wasender.js';

export async function rememberWhatsAppGroup({ jid, name = null, imgUrl = null, source = 'unknown' } = {}) {
  const normalized = normalizeGroupJid(jid);
  if (!normalized) return null;
  const label = String(name || '').trim() || normalized;
  await query(
    `INSERT INTO whatsapp_groups (jid, name, img_url, source, last_seen_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (jid) DO UPDATE
       SET name = CASE
             WHEN EXCLUDED.name IS NOT NULL AND EXCLUDED.name <> EXCLUDED.jid THEN EXCLUDED.name
             ELSE whatsapp_groups.name
           END,
           img_url = COALESCE(EXCLUDED.img_url, whatsapp_groups.img_url),
           source = COALESCE(EXCLUDED.source, whatsapp_groups.source),
           last_seen_at = NOW()`,
    [normalized, label, imgUrl || null, source],
  );
  return { jid: normalized, name: label, imgUrl: imgUrl || null, source };
}

export async function rememberGroupsFromWebhook(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  for (const row of rows) {
    await rememberWhatsAppGroup({
      jid: row?.jid || row?.id,
      name: row?.subject || row?.name,
      source: 'webhook',
    });
  }
}

export async function listRememberedWhatsAppGroups() {
  const result = await query(
    `SELECT jid, name, img_url AS "imgUrl", source
     FROM whatsapp_groups
     ORDER BY last_seen_at DESC`,
  );
  return result.rows;
}

export async function listKnownWhatsAppGroups({ force = false, includeSessionInfo = true } = {}) {
  const [session, remembered, saved, info] = await Promise.all([
    listWhatsAppGroups({ force }).catch(() => []),
    listRememberedWhatsAppGroups().catch(() => []),
    listDealerSavedGroups().catch(() => []),
    includeSessionInfo ? getWhatsAppSessionInfo().catch(() => null) : Promise.resolve(null),
  ]);

  const byJid = new Map();
  for (const group of saved) byJid.set(group.jid, { ...group, source: group.source || 'dealer' });
  for (const group of remembered) byJid.set(group.jid, { ...group, source: group.source || 'remembered' });
  for (const group of session) byJid.set(group.jid, { ...group, source: 'session' });

  return {
    groups: [...byJid.values()],
    session_count: session.length,
    session_status: info?.status || null,
    session_name: info?.name || null,
  };
}
