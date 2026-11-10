import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  audioExtension,
  baseMimeType,
  extractAudioMessage,
  redactMediaKeys,
  toNumber,
  unwrapMessage,
  voiceJobId,
} from '../utils/whatsappMedia.js';
import { transcribeAudio } from '../services/transcription.js';

const voiceNote = {
  url: 'https://mmg.whatsapp.net/v/t62.7117-24/abc.enc',
  mimetype: 'audio/ogg; codecs=opus',
  seconds: 14,
  ptt: true,
  mediaKey: 'bWVkaWEta2V5',
};

describe('extractAudioMessage', () => {
  it('finds a voice note at data.messages.message.audioMessage', () => {
    const audio = extractAudioMessage({ key: { id: 'A1' }, message: { audioMessage: voiceNote } });
    assert.equal(audio.ptt, true);
    assert.equal(audio.mimetype, 'audio/ogg; codecs=opus');
  });

  it('finds audio inside a disappearing-messages (ephemeral) wrapper', () => {
    const audio = extractAudioMessage({
      message: { ephemeralMessage: { message: { audioMessage: voiceNote } } },
    });
    assert.equal(audio.seconds, 14);
  });

  it('finds audio inside a view-once wrapper', () => {
    const audio = extractAudioMessage({
      message: { viewOnceMessageV2: { message: { audioMessage: voiceNote } } },
    });
    assert.equal(audio.url, voiceNote.url);
  });

  it('returns null for text, images and malformed messages', () => {
    assert.equal(extractAudioMessage({ message: { conversation: 'hello' } }), null);
    assert.equal(extractAudioMessage({ message: { imageMessage: { url: 'x' } } }), null);
    assert.equal(extractAudioMessage({ message: { audioMessage: 'not-an-object' } }), null);
    assert.equal(extractAudioMessage({}), null);
    assert.equal(extractAudioMessage(null), null);
  });
});

describe('unwrapMessage', () => {
  it('stops unwrapping at a bounded depth instead of looping forever', () => {
    const cyclic = {};
    cyclic.ephemeralMessage = { message: cyclic };
    assert.doesNotThrow(() => unwrapMessage(cyclic));
  });
});

describe('audioExtension', () => {
  it('maps WhatsApp’s voice-note mimetype (with codec parameter) to ogg', () => {
    assert.equal(baseMimeType('audio/ogg; codecs=opus'), 'audio/ogg');
    assert.equal(audioExtension('audio/ogg; codecs=opus'), 'ogg');
  });

  it('maps common audio-file types', () => {
    assert.equal(audioExtension('audio/mpeg'), 'mp3');
    assert.equal(audioExtension('audio/mp4'), 'm4a');
    assert.equal(audioExtension('AUDIO/X-M4A'), 'm4a');
    assert.equal(audioExtension('audio/wav'), 'wav');
  });

  it('returns null for formats the transcription API cannot read', () => {
    assert.equal(audioExtension('audio/amr'), null);
    assert.equal(audioExtension('audio/aac'), null);
    assert.equal(audioExtension(undefined), null);
  });
});

describe('toNumber', () => {
  it('handles numbers, numeric strings and protobuf Long objects', () => {
    assert.equal(toNumber(14), 14);
    assert.equal(toNumber('14'), 14);
    assert.equal(toNumber({ low: 14, high: 0, unsigned: false }), 14);
    assert.equal(toNumber(null), null);
    assert.equal(toNumber(''), null);
    assert.equal(toNumber('abc'), null);
  });
});

describe('voiceJobId', () => {
  it('is stable per message so a webhook redelivery cannot enqueue twice', () => {
    assert.equal(voiceJobId('3EB0ABC123'), voiceJobId('3EB0ABC123'));
  });

  it('never contains a colon, which BullMQ rejects in custom job ids', () => {
    assert.ok(!voiceJobId('ab:cd/ef.gh').includes(':'));
    assert.equal(voiceJobId('ab:cd/ef.gh'), 'voice-ab_cd_ef_gh');
  });
});

describe('redactMediaKeys', () => {
  it('removes the decryption key but keeps everything else', () => {
    const redacted = redactMediaKeys({ messageId: 'M1', audio: { ...voiceNote } });
    assert.equal(redacted.audio.mediaKey, undefined);
    assert.equal(redacted.audio.mimetype, 'audio/ogg; codecs=opus');
    assert.equal(redacted.messageId, 'M1');
  });

  it('does not mutate the original job data', () => {
    const original = { audio: { ...voiceNote } };
    redactMediaKeys(original);
    assert.equal(original.audio.mediaKey, 'bWVkaWEta2V5');
  });

  it('passes through data that has no audio', () => {
    assert.deepEqual(redactMediaKeys({ leadId: 'L1' }), { leadId: 'L1' });
    assert.equal(redactMediaKeys(null), null);
  });
});

describe('transcribeAudio', () => {
  const clientReturning = (text) => ({
    audio: { transcriptions: { create: async () => ({ text }) } },
  });
  const clientFailing = (status) => ({
    audio: {
      transcriptions: {
        create: async () => {
          throw Object.assign(new Error(`HTTP ${status}`), { status });
        },
      },
    },
  });
  const opts = (client) => ({ client, mimetype: 'audio/ogg; codecs=opus' });

  it('returns the trimmed transcript and the model used', async () => {
    const result = await transcribeAudio(Buffer.from('x'), {
      ...opts(clientReturning('  Dubai hotel  ')),
      model: 'm1',
    });
    assert.deepEqual(result, { text: 'Dubai hotel', model: 'm1' });
  });

  it('returns an empty string for silence', async () => {
    const result = await transcribeAudio(Buffer.from('x'), opts(clientReturning('')));
    assert.equal(result.text, '');
  });

  it('is a permanent failure when no OpenAI key is configured', async () => {
    await assert.rejects(
      () => transcribeAudio(Buffer.from('x'), { mimetype: 'audio/ogg', client: null }),
      (error) => error.permanent === true && /OPENAI_API_KEY/.test(error.message),
    );
  });

  it('is a permanent failure for an unsupported format, without calling the API', async () => {
    let called = false;
    const client = {
      audio: {
        transcriptions: {
          create: async () => {
            called = true;
            return { text: 'x' };
          },
        },
      },
    };
    await assert.rejects(
      () => transcribeAudio(Buffer.from('x'), { client, mimetype: 'audio/amr' }),
      (error) => error.permanent === true && /Unsupported audio format/.test(error.message),
    );
    assert.equal(called, false);
  });

  it('treats a 400 (bad audio) and 401 (bad key) as permanent', async () => {
    for (const status of [400, 401]) {
      await assert.rejects(
        () => transcribeAudio(Buffer.from('x'), opts(clientFailing(status))),
        (error) => error.permanent === true,
        `status ${status}`,
      );
    }
  });

  it('leaves rate limits and server errors retryable', async () => {
    for (const status of [429, 500, 503]) {
      await assert.rejects(
        () => transcribeAudio(Buffer.from('x'), opts(clientFailing(status))),
        (error) => error.permanent !== true,
        `status ${status}`,
      );
    }
  });
});
