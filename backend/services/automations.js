/**
 * Things that happen on their own, from the minute sweep in server.js:
 *
 *  - Quote follow-up: one WhatsApp nudge when a sent quote has had no answer for N hours.
 *  - Lead waiting: a manager alert when a new lead has had no reply from staff for N minutes.
 *  - Trip messages: a week before, two days before, on departure day, and after the return
 *    (with a 1–5 rating question).
 *  - Rating replies: the customer's number is stored; a high score gets the Google review
 *    link, a low one alerts the managers.
 *
 * Customer messages only go out when the agency turns them on in Settings, and each one is
 * claimed in automation_events first, so it is sent at most once per lead even with
 * several workers.
 */

import { query } from '../config/database.js';
import { sendTextMessage } from './wasender.js';
import { saveMessage } from './messages.js';
import { customerLanguage } from './customerLanguage.js';
import { getAgencySettings } from './agencySettings.js';
import { leadRecipients, notify, safeNotify } from './notifications.js';
import { resolveFrontendBaseUrl, shareLink } from './quoteDelivery.js';

export const AGENCY_TIMEZONE = process.env.AGENCY_TIMEZONE || 'Asia/Jerusalem';

/** Customer messages are sent between these local hours only. */
const SEND_FROM_HOUR = 9;
const SEND_UNTIL_HOUR = 21;

// ── time helpers ─────────────────────────────────────────────────────────────

/** "2026-12-12" for `date` in the agency's time zone. */
export function localDay(date = new Date(), timeZone = AGENCY_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function localHour(date = new Date(), timeZone = AGENCY_TIMEZONE) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(date));
}

/** Whole days from `fromDay` to `toDay` (both "yyyy-mm-dd"). */
export function daysBetween(fromDay, toDay) {
  const a = Date.UTC(...String(fromDay).slice(0, 10).split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0)));
  const b = Date.UTC(...String(toDay).slice(0, 10).split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0)));
  return Math.round((b - a) / 86_400_000);
}

function dayString(value) {
  if (!value) return null;
  if (value instanceof Date) return localDay(value);
  return String(value).slice(0, 10);
}

/**
 * Which trip message is due for a booked lead today, if any. The windows are a few days
 * wide so a day the server was down doesn't skip a message; automation_events keeps each
 * one to a single send.
 */
export function tripMessageDue({ travelDate, returnDate, today }) {
  const start = dayString(travelDate);
  if (!start) return null;
  const until = daysBetween(today, start);
  if (until === 0) return 'departure';
  if (until >= 1 && until <= 2) return 'two_days';
  if (until >= 3 && until <= 7) return 'week';
  const end = dayString(returnDate);
  if (end) {
    const since = daysBetween(end, today);
    if (since >= 1 && since <= 3) return 'welcome_back';
  }
  return null;
}

// ── message texts ────────────────────────────────────────────────────────────

const TEXTS = {
  ar: {
    hi: (name) => (name ? `مرحباً ${name}،` : 'مرحباً،'),
    followup: ({ destination, link }) => [
      `أردنا التأكد من أن عرض السعر${destination ? ` لرحلة ${destination}` : ''} قد وصلك.`,
      'إذا كان لديك أي سؤال أو تريد تعديل شيء في العرض، اكتب لنا هنا.',
      link ? `رابط العرض: ${link}` : null,
    ],
    week: ({ destination, portal }) => [
      `باقٍ أسبوع على رحلتك${destination ? ` إلى ${destination}` : ''}.`,
      'تجد برنامج الرحلة ومستندات الحجز في حسابك:',
      portal,
      'تأكد من أن جوازات السفر سارية، وأخبرنا إذا احتجت أي شيء.',
    ],
    two_days: ({ destination }) => [
      `رحلتك${destination ? ` إلى ${destination}` : ''} بعد يومين.`,
      'لا تنسَ جوازات السفر والتذاكر، ويُفضّل الوصول إلى المطار قبل الإقلاع بثلاث ساعات.',
    ],
    departure: ({ emergency }) => [
      'نتمنى لك رحلة سعيدة! ✈️',
      emergency ? `للطوارئ أثناء السفر: ${emergency}` : 'إذا احتجت أي شيء أثناء السفر، اكتب لنا هنا.',
    ],
    welcome_back: () => [
      'حمداً لله على السلامة! نتمنى أن تكون رحلتك قد أعجبتك.',
      'كيف تقيّم رحلتك من 1 إلى 5؟ أرسل رقماً فقط (5 = ممتازة).',
    ],
    thanks_high: ({ review }) => [
      'شكراً جزيلاً على تقييمك! 🙏',
      review ? `يسعدنا كثيراً إذا شاركت رأيك على جوجل: ${review}` : null,
    ],
    thanks_low: () => [
      'شكراً على صراحتك، ونأسف أن الرحلة لم تكن كما توقعت.',
      'سيتواصل معك أحد من فريقنا قريباً.',
    ],
  },
  en: {
    hi: (name) => (name ? `Hi ${name},` : 'Hi,'),
    followup: ({ destination, link }) => [
      `We wanted to check that our quote${destination ? ` for ${destination}` : ''} reached you.`,
      'If you have any questions or would like something changed, just reply here.',
      link ? `Your quote: ${link}` : null,
    ],
    week: ({ destination, portal }) => [
      `Your trip${destination ? ` to ${destination}` : ''} is one week away.`,
      'Your itinerary and booking documents are in your account:',
      portal,
      'Please check that your passports are valid, and let us know if you need anything.',
    ],
    two_days: ({ destination }) => [
      `Your trip${destination ? ` to ${destination}` : ''} is in two days.`,
      "Don't forget your passports and tickets. We recommend arriving at the airport three hours before departure.",
    ],
    departure: ({ emergency }) => [
      'Have a wonderful trip! ✈️',
      emergency ? `For emergencies while travelling: ${emergency}` : 'If you need anything while travelling, message us here.',
    ],
    welcome_back: () => [
      'Welcome back! We hope you enjoyed your trip.',
      'How would you rate it from 1 to 5? Just reply with a number (5 = excellent).',
    ],
    thanks_high: ({ review }) => [
      'Thank you so much for your rating! 🙏',
      review ? `We'd be grateful if you shared it on Google: ${review}` : null,
    ],
    thanks_low: () => [
      "Thank you for being honest, and we're sorry the trip wasn't what you expected.",
      'Someone from our team will contact you shortly.',
    ],
  },
};

export function customerMessage(key, lang, vars = {}) {
  const t = TEXTS[lang === 'en' ? 'en' : 'ar'];
  const body = t[key](vars).filter(Boolean);
  const greet = key.startsWith('thanks_') ? [] : [t.hi(vars.name), ''];
  return [...greet, ...body].join('\n');
}

// ── shared plumbing ──────────────────────────────────────────────────────────

/** Records that `kind`/`ref` happened for this lead. False when it already had. */
export async function claimOnce(kind, leadId, ref = '', data = null) {
  const { rows } = await query(
    `INSERT INTO automation_events (kind, lead_id, ref, data) VALUES ($1, $2, $3, $4)
     ON CONFLICT (kind, lead_id, ref) DO NOTHING RETURNING id`,
    [kind, leadId, String(ref), data ? JSON.stringify(data) : null],
  );
  return rows.length > 0;
}

async function releaseClaim(kind, leadId, ref = '') {
  await query(`DELETE FROM automation_events WHERE kind = $1 AND lead_id = $2 AND ref = $3`, [kind, leadId, String(ref)]);
}

async function sendToCustomer(phone, text, { leadId, kind, send = sendTextMessage }) {
  await send(phone, text);
  await saveMessage({
    leadId,
    direction: 'outbound',
    channel: 'whatsapp',
    toNumber: phone,
    body: text,
    status: 'sent',
    raw: { kind: 'automation', automation: kind },
  });
}

async function managerIds() {
  const { rows } = await query(
    `SELECT id FROM admins WHERE role = 'admin' AND COALESCE(approval_status, 'approved') = 'approved'`,
  );
  return rows.map((r) => r.id);
}

const CUSTOMER_NAME = `NULLIF(TRIM(c.name), '')`;

// ── quote follow-up ──────────────────────────────────────────────────────────

/**
 * Sent quotes (latest version, not accepted, link still valid) whose customer has not
 * written since the quote went out `hours` ago.
 */
export async function runQuoteFollowups({ settings, now = new Date(), send } = {}) {
  if (!settings?.auto_quote_followup) return [];
  const hours = Number(settings.quote_followup_hours) || 48;
  const { rows } = await query(
    `SELECT DISTINCT ON (qv.id) qv.id AS version_id, qv.lead_id, l.phone, l.destination,
            ${CUSTOMER_NAME} AS name, st.token, d.sent_at
     FROM quote_versions qv
     JOIN leads l ON l.id = qv.lead_id
     LEFT JOIN contacts c ON c.phone = l.phone
     JOIN quote_deliveries d ON d.quote_version_id = qv.id AND d.status IN ('sent', 'delivered') AND d.channel = 'whatsapp'
     JOIN share_tokens st ON st.quote_version_id = qv.id AND st.revoked IS NOT TRUE AND st.expires_at > $1
     WHERE qv.status <> 'accepted'
       AND qv.approval_status IN ('not_required', 'approved')
       AND l.lifecycle_status = 'sent'
       AND d.sent_at <= $1::timestamptz - make_interval(hours => $2)
       AND d.sent_at >= $1::timestamptz - make_interval(hours => $2 + 72)
       AND NOT EXISTS (SELECT 1 FROM quote_versions newer
                       WHERE newer.quote_draft_id = qv.quote_draft_id AND newer.version_number > qv.version_number)
       AND NOT EXISTS (SELECT 1 FROM messages m
                       WHERE m.direction = 'inbound' AND m.from_number = l.phone AND m.created_at > d.sent_at)
     ORDER BY qv.id, d.sent_at DESC
     LIMIT 50`,
    [now, hours],
  );
  const sent = [];
  for (const row of rows) {
    if (!(await claimOnce('quote_followup', row.lead_id, row.version_id))) continue;
    try {
      const lang = await customerLanguage(row.phone);
      const text = customerMessage('followup', lang, { name: row.name, destination: row.destination, link: shareLink(row.token) });
      await sendToCustomer(row.phone, text, { leadId: row.lead_id, kind: 'quote_followup', send });
      sent.push(row.lead_id);
    } catch (error) {
      await releaseClaim('quote_followup', row.lead_id, row.version_id);
      console.error('[automations] quote follow-up failed:', error.message);
    }
  }
  return sent;
}

/** The customer opened the quote link for the first time: tell whoever owns the lead. */
export async function notifyQuoteViewed({ leadId, versionNumber, customer }) {
  if (!leadId) return;
  if (!(await claimOnce('quote_viewed', leadId, String(versionNumber ?? '')))) return;
  await notify({
    adminIds: await leadRecipients(leadId, { withAdmins: true }),
    kind: 'quote_viewed',
    leadId,
    collapse: false,
    data: { version_number: versionNumber, customer: customer || null },
  });
}

// ── leads waiting for staff ──────────────────────────────────────────────────

/** New leads (last 24 h) older than `minutes` with no staff reply yet: one alert each. */
export async function runLeadWaitAlerts({ settings, now = new Date() } = {}) {
  const minutes = Number(settings?.lead_wait_alert_minutes ?? 15);
  if (!minutes) return [];
  const { rows } = await query(
    `SELECT l.id, l.destination, l.source, ${CUSTOMER_NAME} AS name, l.created_at
     FROM leads l
     LEFT JOIN contacts c ON c.phone = l.phone
     WHERE l.created_at <= $1::timestamptz - make_interval(mins => $2)
       AND l.created_at >= $1::timestamptz - INTERVAL '24 hours'
       AND COALESCE(l.lifecycle_status, 'intake') NOT IN ('booked', 'lost', 'archived')
       AND NOT EXISTS (SELECT 1 FROM messages m
                       WHERE m.direction = 'outbound' AND m.to_number = l.phone
                         AND m.raw ? 'actor_id' AND m.created_at >= l.created_at)
     ORDER BY l.created_at
     LIMIT 50`,
    [now, minutes],
  );
  const alerted = [];
  for (const lead of rows) {
    if (!(await claimOnce('lead_waiting', lead.id))) continue;
    await safeNotify(async () => notify({
      adminIds: [...new Set([...(await managerIds()), ...(await leadRecipients(lead.id))])],
      kind: 'lead_waiting',
      leadId: lead.id,
      collapse: false,
      data: { customer: lead.name, destination: lead.destination, minutes, source: lead.source },
    }));
    alerted.push(lead.id);
  }
  return alerted;
}

// ── trip messages ────────────────────────────────────────────────────────────

export async function runTripMessages({ settings, now = new Date(), send } = {}) {
  if (!settings?.auto_trip_messages) return [];
  const hour = localHour(now);
  if (hour < SEND_FROM_HOUR || hour >= SEND_UNTIL_HOUR) return [];
  const today = localDay(now);
  const { rows } = await query(
    `SELECT l.id, l.phone, l.destination, l.travel_date::text AS travel_date, l.return_date::text AS return_date,
            ${CUSTOMER_NAME} AS name
     FROM leads l
     LEFT JOIN contacts c ON c.phone = l.phone
     WHERE l.lifecycle_status = 'booked' AND l.phone IS NOT NULL
       AND l.travel_date BETWEEN $1::date - INTERVAL '45 days' AND $1::date + INTERVAL '7 days'
     LIMIT 300`,
    [today],
  );
  const portal = `${resolveFrontendBaseUrl()}/portal`;
  const sent = [];
  for (const lead of rows) {
    const key = tripMessageDue({ travelDate: lead.travel_date, returnDate: lead.return_date, today });
    if (!key) continue;
    if (!(await claimOnce(`trip_${key}`, lead.id))) continue;
    try {
      const lang = await customerLanguage(lead.phone);
      const text = customerMessage(key, lang, {
        name: lead.name,
        destination: lead.destination,
        portal,
        emergency: settings.emergency_phone || settings.phone,
      });
      await sendToCustomer(lead.phone, text, { leadId: lead.id, kind: `trip_${key}`, send });
      if (key === 'welcome_back') {
        await query(
          `INSERT INTO trip_ratings (lead_id, phone) VALUES ($1, $2) ON CONFLICT (lead_id) DO NOTHING`,
          [lead.id, lead.phone],
        );
      }
      sent.push({ lead_id: lead.id, key });
    } catch (error) {
      await releaseClaim(`trip_${key}`, lead.id);
      console.error('[automations] trip message failed:', error.message);
    }
  }
  return sent;
}

// ── rating replies ───────────────────────────────────────────────────────────

/** "4", "٤", " 5 " → number; anything else → null. */
export function parseRating(text) {
  const value = String(text ?? '').trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  return /^[1-5]$/.test(value) ? Number(value) : null;
}

/**
 * Called for every customer WhatsApp message. Returns true when the message was the answer
 * to our rating question (the caller then stops: the bot shouldn't reply to "5").
 */
export async function handleRatingReply(phone, text, { send } = {}) {
  const rating = parseRating(text);
  if (!rating || !phone) return false;
  const { rows } = await query(
    `UPDATE trip_ratings SET rating = $2, rated_at = NOW()
     WHERE lead_id = (
       SELECT lead_id FROM trip_ratings
       WHERE phone = $1 AND rating IS NULL AND requested_at > NOW() - INTERVAL '7 days'
       ORDER BY requested_at DESC LIMIT 1
     )
     RETURNING lead_id`,
    [phone, rating],
  );
  const leadId = rows[0]?.lead_id;
  if (!leadId) return false;

  const settings = await getAgencySettings();
  const lang = await customerLanguage(phone);
  const high = rating >= 4;
  try {
    await sendToCustomer(
      phone,
      customerMessage(high ? 'thanks_high' : 'thanks_low', lang, { review: settings.google_review_url }),
      { leadId, kind: high ? 'rating_thanks' : 'rating_sorry', send },
    );
  } catch (error) {
    console.error('[automations] rating reply failed:', error.message);
  }
  if (!high) {
    const { rows: lead } = await query(
      `SELECT l.destination, ${CUSTOMER_NAME} AS name FROM leads l LEFT JOIN contacts c ON c.phone = l.phone WHERE l.id = $1`,
      [leadId],
    );
    await safeNotify(async () => notify({
      adminIds: [...new Set([...(await managerIds()), ...(await leadRecipients(leadId))])],
      kind: 'low_rating',
      leadId,
      collapse: false,
      data: { rating, customer: lead[0]?.name || null, destination: lead[0]?.destination || null },
    }));
  }
  return true;
}

/** The minute sweep. Each part fails on its own without stopping the others. */
export async function runAutomations({ now = new Date() } = {}) {
  const settings = await getAgencySettings();
  const results = await Promise.allSettled([
    runQuoteFollowups({ settings, now }),
    runLeadWaitAlerts({ settings, now }),
    runTripMessages({ settings, now }),
  ]);
  for (const r of results) if (r.status === 'rejected') console.error('[automations]', r.reason?.message);
  return results;
}
