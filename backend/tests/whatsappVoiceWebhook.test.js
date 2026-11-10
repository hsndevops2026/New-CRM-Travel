import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractMessage, isGroupMessage, queueVoiceMessage } from '../routes/whatsapp.js';

const AUDIO = {
  url: 'https://mmg.whatsapp.net/v/t62/abc.enc',
  mimetype: 'audio/ogg; codecs=opus',
  seconds: 9,
  ptt: true,
  mediaKey: 'a2V5',
};

/** Shape follows Wasender's `messages.received` webhook (data.messages = one object). */
function webhook({ message, key = {}, messageBody = '' }) {
  return {
    event: 'messages.received',
    timestamp: 1_760_000_000,
    data: {
      messages: {
        key: {
          id: '3EB0C767D0E1B9C0A1',
          fromMe: false,
          remoteJid: '919876543210@s.whatsapp.net',
          cleanedSenderPn: '919876543210',
          ...key,
        },
        messageBody,
        message,
      },
    },
  };
}

describe('extractMessage — voice notes', () => {
  it('recognises a voice note and keeps its media object', () => {
    const parsed = extractMessage(webhook({ message: { audioMessage: AUDIO } }));
    assert.equal(parsed.id, '3EB0C767D0E1B9C0A1');
    assert.equal(parsed.from, '919876543210');
    assert.equal(parsed.text, '');
    assert.equal(parsed.audio.mimetype, 'audio/ogg; codecs=opus');
    assert.equal(parsed.audio.mediaKey, 'a2V5');
    assert.equal(parsed.fromMe, false);
  });

  it('recognises a voice note inside a disappearing-messages wrapper', () => {
    const parsed = extractMessage(
      webhook({ message: { ephemeralMessage: { message: { audioMessage: AUDIO } } } }),
    );
    assert.equal(parsed.audio.seconds, 9);
  });

  it('leaves text messages untouched (no audio)', () => {
    const parsed = extractMessage(
      webhook({ message: { conversation: 'hotel in Dubai' }, messageBody: 'hotel in Dubai' }),
    );
    assert.equal(parsed.audio, null);
    assert.equal(parsed.text, 'hotel in Dubai');
  });

  it('does not mistake an image for audio', () => {
    const parsed = extractMessage(webhook({ message: { imageMessage: { url: 'x' } } }));
    assert.equal(parsed.audio, null);
  });

  it('flags our own outgoing voice notes so they are skipped', () => {
    const parsed = extractMessage(
      webhook({ message: { audioMessage: AUDIO }, key: { fromMe: true } }),
    );
    assert.equal(parsed.fromMe, true);
  });
});

describe('isGroupMessage', () => {
  it('detects group events and group JIDs', () => {
    assert.equal(isGroupMessage('messages.group.received', { remoteJid: '' }), true);
    assert.equal(isGroupMessage('messages.received', { remoteJid: '1203630@g.us' }), true);
    assert.equal(isGroupMessage('messages.received', { remoteJid: '9198@s.whatsapp.net' }), false);
  });
});

describe('queueVoiceMessage', () => {
  const message = (overrides = {}) => ({
    id: '3EB0C767D0E1B9C0A1',
    from: '919876543210',
    remoteJid: '919876543210@s.whatsapp.net',
    audio: AUDIO,
    ...overrides,
  });

  function deps(overrides = {}) {
    const calls = { enqueued: [], notified: [] };
    return {
      calls,
      deps: {
        enqueue: async (payload) => {
          calls.enqueued.push(payload);
        },
        findStored: async () => null,
        notify: async (job, error) => {
          calls.notified.push({ job, error });
        },
        ...overrides,
      },
    };
  }

  it('queues a customer voice note with everything the worker needs to decrypt it', async () => {
    const { deps: d, calls } = deps();
    const outcome = await queueVoiceMessage({ event: 'messages.received', message: message() }, d);

    assert.equal(outcome, 'queued');
    assert.equal(calls.enqueued.length, 1);
    assert.equal(calls.enqueued[0].messageId, '3EB0C767D0E1B9C0A1');
    assert.equal(calls.enqueued[0].from, '919876543210');
    assert.equal(calls.enqueued[0].audio.mediaKey, 'a2V5');
  });

  it('ignores voice notes in groups — dealer replies must never become customer leads', async () => {
    const { deps: d, calls } = deps();
    const outcome = await queueVoiceMessage(
      { event: 'messages.group.received', message: message({ remoteJid: '1203630@g.us' }) },
      d,
    );
    assert.equal(outcome, 'ignored_group');
    assert.equal(calls.enqueued.length, 0);
  });

  it('skips a redelivered webhook for a message that was already stored', async () => {
    const { deps: d, calls } = deps({ findStored: async () => ({ id: 'row-1' }) });
    const outcome = await queueVoiceMessage({ event: 'messages.received', message: message() }, d);
    assert.equal(outcome, 'duplicate');
    assert.equal(calls.enqueued.length, 0);
  });

  it('skips a voice note with no message id (it cannot be decrypted or deduplicated)', async () => {
    const { deps: d, calls } = deps();
    const outcome = await queueVoiceMessage(
      { event: 'messages.received', message: message({ id: 'unknown' }) },
      d,
    );
    assert.equal(outcome, 'ignored_no_id');
    assert.equal(calls.enqueued.length, 0);
  });

  it('tells the customer instead of dropping the voice note when the queue is down', async () => {
    const { deps: d, calls } = deps({
      enqueue: async () => {
        throw new Error('ECONNREFUSED redis');
      },
    });
    const outcome = await queueVoiceMessage({ event: 'messages.received', message: message() }, d);

    assert.equal(outcome, 'enqueue_failed');
    assert.equal(calls.notified.length, 1);
    assert.equal(calls.notified[0].job.data.from, '919876543210');
    assert.match(calls.notified[0].error.message, /ECONNREFUSED/);
  });
});
