import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { isProduction } from '../config/productionGuard.js';
import { wasenderConfig } from '../config/wasender.js';
import { handleIncomingLeadMessage } from '../controllers/whatsappLead.js';
import { handleIncomingDealerReply } from '../services/dealerRequests.js';
import { isDealerReplyMessage } from '../utils/dealerReply.js';
import { findMessageByProviderId, saveMessage } from '../services/messages.js';
import { rememberGroupsFromWebhook, rememberWhatsAppGroup } from '../services/whatsappGroups.js';
import { enqueueVoiceMessage } from '../queues/voiceQueue.js';
import { notifyFinalFailure } from '../workers/voiceWorker.js';
import { extractAudioMessage, toNumber } from '../utils/whatsappMedia.js';
import { handlePollResults } from '../services/whatsappPolls.js';

const router = Router();

export function verifyWebhookSignature(req, { secret = wasenderConfig.webhookSecret, production = isProduction() } = {}) {
  // Without a secret the webhook is only open on a developer machine.
  if (!secret) return !production;

  const signature = String(req.headers['x-webhook-signature'] || '');
  if (!signature) return false;
  const given = Buffer.from(signature);
  const expected = Buffer.from(String(secret));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function extractMessage(payload) {
  const messageData = payload?.data?.messages;
  if (!messageData) return null;

  const msg = Array.isArray(messageData) ? messageData[0] : messageData;
  if (!msg) return null;

  const key = msg.key || {};
  const from =
    key.cleanedParticipantPn ||
    key.cleanedSenderPn ||
    key.senderPn ||
    key.remoteJid ||
    'unknown';

  const text =
    msg.messageBody ||
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.ephemeralMessage?.message?.extendedTextMessage?.text ||
    msg.message?.ephemeralMessage?.message?.conversation ||
    '';

  return {
    id: key.id || 'unknown',
    from,
    text,
    // Voice note / audio file. Never trust its encrypted `url` — Wasender decrypts it.
    audio: extractAudioMessage(msg),
    fromMe: Boolean(key.fromMe),
    remoteJid: key.remoteJid,
  };
}

export function isGroupMessage(event, message) {
  return (
    event === 'messages.group.received' ||
    event === 'messages-group.received' ||
    (message.remoteJid || '').includes('@g.us')
  );
}

/**
 * Hands a voice note to the voice queue. The webhook has already acknowledged
 * Wasender, and decrypting + transcribing can take seconds, so none of it runs here.
 */
export function queueVoiceMessage(
  { event, message },
  {
    enqueue = enqueueVoiceMessage,
    findStored = findMessageByProviderId,
    notify = notifyFinalFailure,
  } = {},
) {
  // Groups are dealer RFQ threads — a dealer's voice note must never become a
  // customer lead (and would cost a transcription for nothing).
  if (isGroupMessage(event, message)) {
    console.log('[webhook] group voice note ignored:', message.id);
    return Promise.resolve('ignored_group');
  }
  if (!message.id || message.id === 'unknown') {
    console.warn('[webhook] voice note has no message id — cannot decrypt or dedupe, skipping');
    return Promise.resolve('ignored_no_id');
  }

  return (async () => {
    try {
      if (await findStored(message.id)) {
        console.log('[webhook] duplicate voice message skipped:', message.id);
        return 'duplicate';
      }
      await enqueue({
        messageId: message.id,
        from: message.from,
        remoteJid: message.remoteJid || null,
        audio: message.audio,
      });
      console.log(
        `[webhook] voice note queued: ${message.id} (${toNumber(message.audio.seconds) ?? '?'}s, ${
          message.audio.mimetype || 'unknown type'
        })`,
      );
      return 'queued';
    } catch (error) {
      // Queue unavailable (Redis down). Don't let the voice note vanish silently.
      console.error('[webhook] failed to queue voice note:', error.message);
      await notify(
        { data: { messageId: message.id, from: message.from, audio: message.audio } },
        error,
      );
      return 'enqueue_failed';
    }
  })();
}

/**
 * A customer voted on one of the bot's polls. The vote is mapped to what the option stands
 * for (a package item id, or yes / no) and continues the conversation like a typed reply.
 */
export function processPollVote(payload, { handle = handlePollResults, continueChat = handleIncomingLeadMessage } = {}) {
  return handle(payload, {
    onChoice: ({ poll, option }) =>
      continueChat({
        from: poll.phone,
        text: option.label,
        providerMessageId: `poll-vote:${poll.id}`,
        messageMeta: { poll_vote: { poll_id: poll.id, question: poll.question } },
        choice: { kind: poll.kind, value: option.value, conversationId: poll.conversation_id },
      }),
  });
}

async function processInboundWhatsAppMessage({ event, message, payload }) {
  const text = message.text.trim();
  const inGroup = isGroupMessage(event, message);

  // Dealer RFQ replies must never fall through to customer lead intake.
  if (inGroup || isDealerReplyMessage(text)) {
    if (inGroup) {
      await rememberWhatsAppGroup({
        jid: message.remoteJid,
        source: 'message',
      });
      await saveMessage({
        direction: 'inbound',
        channel: 'whatsapp',
        providerId: message.id !== 'unknown' ? message.id : null,
        fromNumber: message.from,
        toNumber: message.remoteJid || '',
        body: text,
        status: 'received',
        raw: {
          kind: 'group',
          group_jid: message.remoteJid || '',
          sender: message.from,
        },
      });
    }
    await handleIncomingDealerReply({
      from: message.from,
      groupId: message.remoteJid || '',
      text,
      messageId: message.id,
      raw: payload,
    });
    return;
  }

  await handleIncomingLeadMessage({
    from: message.from,
    text,
    providerMessageId: message.id,
  });
}

/** POST /webhook/whatsapp — Wasender inbound events (public; signature required in production) */
router.post('/whatsapp', (req, res) => {
  if (!verifyWebhookSignature(req)) {
    console.warn('Webhook rejected: invalid or missing X-Webhook-Signature');
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  // Acknowledge quickly so Wasender does not retry
  res.status(200).json({ received: true });

  const payload = req.body;
  const event = payload?.event;

  console.log('\n========== WhatsApp Webhook ==========');
  console.log('Event:', event);
  console.log('Timestamp:', payload?.timestamp);

  const isMessageEvent =
    event === 'messages.received' ||
    event === 'messages.upsert' ||
    event === 'messages.personal.received' ||
    event === 'messages.group.received' ||
    event === 'messages-group.received';

  if (event === 'poll.results') {
    // Logged in full while polls are new: it's the only record of what Wasender sent.
    console.log('Poll payload:', JSON.stringify(payload?.data ?? payload));
    void processPollVote(payload)
      .then((outcome) => console.log('[webhook] poll vote:', outcome))
      .catch((error) => console.error('Poll vote processing error:', error));
    console.log('======================================\n');
    return;
  }

  if (event === 'groups.upsert') {
    void rememberGroupsFromWebhook(payload).catch((error) => {
      console.error('Failed to remember WhatsApp groups:', error.message);
    });
    console.log('======================================\n');
    return;
  }

  if (!isMessageEvent) {
    console.log('Payload:', JSON.stringify(payload, null, 2));
    console.log('======================================\n');
    return;
  }

  const message = extractMessage(payload);

  if (!message || message.fromMe) {
    console.log(message?.fromMe ? 'Outgoing message skipped' : 'No inbound message data');
    console.log('======================================\n');
    return;
  }

  console.log('From:', message.from);
  console.log(
    'Message:',
    message.text || (message.audio ? '(voice message)' : '(no text / media message)'),
  );
  console.log('Message ID:', message.id);
  console.log('======================================\n');

  if (message.audio && !message.text?.trim()) {
    void queueVoiceMessage({ event, message });
    return;
  }

  if (!message.text?.trim()) return;

  void (async () => {
    try {
      if (message.id && message.id !== 'unknown') {
        const existing = await findMessageByProviderId(message.id);
        if (existing) {
          console.log('[webhook] duplicate message skipped:', message.id);
          return;
        }
      }
      await processInboundWhatsAppMessage({ event, message, payload });
    } catch (err) {
      console.error('Webhook message processing error:', err);
    }
  })();
});

export default router;
