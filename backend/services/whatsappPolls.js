import { query } from '../config/database.js';

/**
 * WhatsApp polls the bot sends in place of buttons, and the votes that come back.
 *
 * Wasender's `poll.results` webhook reports a poll as its option texts, each with the ids
 * of the people who picked it. Each poll we send is stored with what every option stands
 * for (`options: [{ label, value }]`, e.g. a package item id), so a vote is turned back
 * into that id. Option text is only used to find the label in the stored poll.
 */

const OPEN_POLL_MAX_AGE_DAYS = 7;

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * The phone number behind a 1:1 chat id ("9198…@s.whatsapp.net"), or null for ids that
 * don't carry one: groups (@g.us) and WhatsApp's hidden ids (@lid).
 */
export function chatPhone(jid) {
  const value = String(jid || '').trim();
  if (!value || /@(g\.us|lid|broadcast|newsletter)\b/i.test(value)) return null;
  if (value.includes('@') && !/@(s\.whatsapp\.net|c\.us)\b/i.test(value)) return null;
  const number = digits(value.replace(/@.*$/, '').replace(/:\d+$/, ''));
  return number.length >= 8 ? number : null;
}

/**
 * The parts of a `poll.results` webhook we use.
 * @returns {{ messageId: string|null, chatJid: string|null, options: { name: string, voters: string[] }[] } | null}
 */
export function parsePollResults(payload) {
  const data = payload?.data;
  if (!data) return null;
  const key = data.key || {};
  const rows = data.pollResult || data.poll_result || data.pollResults || [];
  if (!Array.isArray(rows) || !rows.length) return null;
  return {
    messageId: key.id ? String(key.id) : null,
    chatJid: key.remoteJid ? String(key.remoteJid) : null,
    options: rows.map((row) => ({
      name: String(row?.name ?? '').trim(),
      voters: Array.isArray(row?.voters) ? row.voters.map(String) : [],
    })),
  };
}

/** Names of the options that have a vote. The polls are single-answer 1:1 chats, so normally one. */
export function votedOptionNames(result) {
  return (result?.options || []).filter((option) => option.voters.length > 0).map((option) => option.name);
}

/** Option text as compared: WhatsApp may hand it back with different spacing or Unicode form. */
function labelKey(text) {
  return String(text ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

function sameLabels(poll, names) {
  const labels = (poll.options || []).map((option) => labelKey(option.label)).sort();
  const wanted = names.map(labelKey).sort();
  return labels.length === wanted.length && labels.every((label, index) => label === wanted[index]);
}

/** The voter's phone: from the chat id, or else from a voter id that carries one. */
function votePhone(result) {
  const fromChat = chatPhone(result?.chatJid);
  if (fromChat) return fromChat;
  for (const option of result?.options || []) {
    for (const voter of option.voters) {
      const phone = chatPhone(voter);
      if (phone) return phone;
    }
  }
  return null;
}

/**
 * The open poll a vote belongs to: one whose options are exactly the voted poll's options,
 * preferring the provider message id, then the voter's phone number. Failing both (a
 * hidden @lid id), a poll is used only when it is the single open poll with these
 * options — otherwise the vote can't be placed and is left alone.
 *
 * @param {ReturnType<typeof parsePollResults>} result
 * @param {object[]} openPolls candidates, newest first
 */
export function pickPollForVote(result, openPolls) {
  const names = (result?.options || []).map((option) => option.name);
  const candidates = openPolls.filter((poll) => sameLabels(poll, names));
  if (!candidates.length) return null;

  if (result.messageId) {
    const byId = candidates.find((poll) => poll.provider_message_id && poll.provider_message_id === result.messageId);
    if (byId) return byId;
  }
  const phone = votePhone(result);
  if (phone) {
    // A known number must be the poll's own: never let one customer answer another's poll.
    return candidates.find((poll) => digits(poll.phone).endsWith(phone) || phone.endsWith(digits(poll.phone))) || null;
  }
  // A hidden @lid id: these exact options are enough when only one open poll has them.
  return candidates.length === 1 ? candidates[0] : null;
}

/** The stored option a vote picked, or null when it isn't exactly one known option. */
export function optionForVote(poll, result) {
  const names = votedOptionNames(result);
  if (names.length !== 1) return null;
  return (poll.options || []).find((option) => labelKey(option.label) === labelKey(names[0])) || null;
}

/**
 * The message id in a Wasender send response, kept so a vote can be matched to its poll
 * by id when the webhook reports the same one.
 */
export function providerMessageId(response) {
  const data = response?.data || {};
  const id = data.key?.id ?? data.msgId ?? data.messageId ?? data.id ?? null;
  return id == null ? null : String(id);
}

/**
 * Stores a poll about to be sent. Older open polls to the same number are closed: only
 * the latest question can be answered.
 */
export async function openPoll({ phone, conversationId = null, leadId = null, kind, question, options, context = {} }) {
  await query(
    `UPDATE whatsapp_polls SET status = 'replaced'
     WHERE status = 'open' AND regexp_replace(phone, '\\D', '', 'g') = $1`,
    [digits(phone)],
  );
  const result = await query(
    `INSERT INTO whatsapp_polls (phone, conversation_id, lead_id, kind, question, options, context)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [phone, conversationId, leadId, kind, question, JSON.stringify(options), JSON.stringify(context)],
  );
  return result.rows[0];
}

export async function setPollProviderMessageId(id, messageId) {
  if (!messageId) return;
  await query(`UPDATE whatsapp_polls SET provider_message_id = $2 WHERE id = $1`, [id, messageId]);
}

/** Closes a poll that never reached the customer (they got the text question instead). */
export async function closePoll(id, status = 'closed') {
  await query(`UPDATE whatsapp_polls SET status = $2 WHERE id = $1 AND status = 'open'`, [id, status]);
}

async function listOpenPolls() {
  const result = await query(
    `SELECT * FROM whatsapp_polls
     WHERE status = 'open' AND created_at > NOW() - ($1 || ' days')::interval
     ORDER BY created_at DESC
     LIMIT 500`,
    [String(OPEN_POLL_MAX_AGE_DAYS)],
  );
  return result.rows;
}

/**
 * Marks the poll answered, once. Wasender sends `poll.results` again on every change, so
 * only the first vote is acted on.
 */
export async function claimPollAnswer(id, value) {
  const result = await query(
    `UPDATE whatsapp_polls
     SET status = 'answered', answer_value = $2, answered_at = NOW()
     WHERE id = $1 AND status = 'open'
     RETURNING *`,
    [id, value],
  );
  return result.rows[0] || null;
}

/**
 * Handles a `poll.results` webhook: finds the poll, takes the picked option once, and hands
 * it to `onChoice`. Returns what happened, for logs and tests.
 *
 * @param {object} payload
 * @param {{ onChoice: (vote: { poll: object, option: { label: string, value: string } }) => Promise<unknown>,
 *           findOpen?: () => Promise<object[]>, claim?: typeof claimPollAnswer }} deps
 */
export async function handlePollResults(payload, { onChoice, findOpen = listOpenPolls, claim = claimPollAnswer }) {
  const result = parsePollResults(payload);
  if (!result) return 'not_a_poll';
  if (votedOptionNames(result).length !== 1) return 'no_single_vote';

  const poll = pickPollForVote(result, await findOpen());
  if (!poll) return 'no_open_poll';

  const option = optionForVote(poll, result);
  if (!option) return 'unknown_option';

  const claimed = await claim(poll.id, option.value);
  if (!claimed) return 'already_answered';

  await onChoice({ poll: claimed, option });
  return 'handled';
}
