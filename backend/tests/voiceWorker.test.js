import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UnrecoverableError } from 'bullmq';
import { processVoiceJob, notifyFinalFailure } from '../workers/voiceWorker.js';

const AUDIO = {
  url: 'https://mmg.whatsapp.net/encrypted',
  mimetype: 'audio/ogg; codecs=opus',
  mediaKey: 'secret-key',
  seconds: 12,
  ptt: true,
};

function makeJob(overrides = {}) {
  const job = {
    attemptsMade: 0,
    data: {
      messageId: '3EB0ABC123',
      from: '919876543210',
      audio: { ...AUDIO },
      receivedAt: Date.now() - 2000,
      ...overrides.data,
    },
    async updateData(next) {
      job.data = next;
    },
  };
  if (overrides.attemptsMade != null) job.attemptsMade = overrides.attemptsMade;
  return job;
}

/** Records every side effect so tests can assert what did (and did not) happen. */
function makeDeps(overrides = {}) {
  const calls = {
    decrypt: [],
    download: [],
    transcribe: [],
    handleLead: [],
    reply: [],
    saved: [],
    leadChecks: [],
  };
  const deps = {
    decryptMedia: async (args) => {
      calls.decrypt.push(args);
      return 'https://www.wasenderapi.com/api/decrypted-media/3EB0ABC123';
    },
    downloadMedia: async (url, opts) => {
      calls.download.push({ url, opts });
      return { buffer: Buffer.from('fake-ogg-bytes') };
    },
    transcribe: async (buffer, opts) => {
      calls.transcribe.push({ buffer, opts });
      return {
        text: 'I need a hotel in Dubai from 10 November to 15 November for two adults',
        model: 'test-model',
      };
    },
    handleLead: async (args) => {
      calls.handleLead.push(args);
      return { complete: true };
    },
    reply: async (phone, text, skip, opts) => {
      calls.reply.push({ phone, text, skip, opts });
    },
    findStoredMessage: async () => null,
    saveMessage: async (row) => {
      calls.saved.push(row);
      return row;
    },
    findLatestLead: async () => null,
    leadCreatedSince: async (...args) => {
      calls.leadChecks.push(args);
      return false;
    },
    ...overrides,
  };
  return { deps, calls };
}

describe('processVoiceJob — happy path', () => {
  it('decrypts, downloads, transcribes, then runs the transcript through lead intake', async () => {
    const job = makeJob();
    const { deps, calls } = makeDeps();

    const result = await processVoiceJob(job, deps);

    assert.equal(calls.decrypt.length, 1);
    assert.equal(calls.decrypt[0].messageId, '3EB0ABC123');
    // The original media object (with its mediaKey) is what Wasender needs.
    assert.equal(calls.decrypt[0].audioMessage.mediaKey, 'secret-key');
    assert.equal(calls.download[0].url, 'https://www.wasenderapi.com/api/decrypted-media/3EB0ABC123');
    assert.equal(calls.transcribe[0].opts.mimetype, 'audio/ogg; codecs=opus');

    assert.equal(calls.handleLead.length, 1);
    const handed = calls.handleLead[0];
    assert.match(handed.text, /hotel in Dubai/);
    assert.equal(handed.from, '919876543210');
    assert.equal(handed.source, 'whatsapp');
    // The WhatsApp message id is what makes the inbound insert idempotent on retry.
    assert.equal(handed.providerMessageId, '3EB0ABC123');
    assert.deepEqual(handed.messageMeta, {
      media: 'audio',
      voice: true,
      seconds: 12,
      transcribed: true,
    });
    assert.ok(result.transcript_chars > 0);
  });

  it('echoes what was heard before processing so mis-heard dates are visible', async () => {
    const job = makeJob();
    const { deps, calls } = makeDeps();

    await processVoiceJob(job, deps);

    assert.equal(calls.reply.length, 1);
    assert.match(calls.reply[0].text, /^🎤 “I need a hotel in Dubai/);
    assert.equal(calls.reply[0].phone, '919876543210');
  });

  it('can run without the echo', async () => {
    process.env.VOICE_ECHO_TRANSCRIPT = 'false';
    try {
      const job = makeJob();
      const { deps, calls } = makeDeps();
      await processVoiceJob(job, deps);
      assert.equal(calls.reply.length, 0);
      assert.equal(calls.handleLead.length, 1);
    } finally {
      delete process.env.VOICE_ECHO_TRANSCRIPT;
    }
  });
});

describe('processVoiceJob — retry safety', () => {
  it('does not pay for transcription twice: a retry reuses the saved transcript', async () => {
    const job = makeJob({
      attemptsMade: 1,
      data: { transcript: 'Dubai hotel, two adults', echoed: true },
    });
    const { deps, calls } = makeDeps();

    await processVoiceJob(job, deps);

    assert.equal(calls.decrypt.length, 0);
    assert.equal(calls.download.length, 0);
    assert.equal(calls.transcribe.length, 0);
    assert.equal(calls.handleLead.length, 1);
    assert.equal(calls.handleLead[0].text, 'Dubai hotel, two adults');
  });

  it('does not echo the transcript a second time on retry', async () => {
    const job = makeJob({
      attemptsMade: 1,
      data: { transcript: 'Dubai hotel', echoed: true },
    });
    const { deps, calls } = makeDeps();
    await processVoiceJob(job, deps);
    assert.equal(calls.reply.length, 0);
  });

  it('saves the transcript on the job as soon as it exists', async () => {
    const job = makeJob();
    const { deps } = makeDeps();
    await processVoiceJob(job, deps);
    assert.match(job.data.transcript, /hotel in Dubai/);
    assert.equal(job.data.echoed, true);
  });

  it('does not create a second lead when an earlier attempt already created one', async () => {
    // Attempt 1 inserted the lead, then failed on a later step. The retry must stop.
    const job = makeJob({
      attemptsMade: 1,
      data: { transcript: 'Dubai hotel, two adults', echoed: true },
    });
    const { deps, calls } = makeDeps({ leadCreatedSince: async () => true });

    const result = await processVoiceJob(job, deps);

    assert.equal(result.skipped, 'lead_exists');
    assert.equal(calls.handleLead.length, 0);
  });

  it('only consults the lead check on retries, not on the first attempt', async () => {
    const job = makeJob({ attemptsMade: 0 });
    const { deps, calls } = makeDeps();
    await processVoiceJob(job, deps);
    assert.equal(calls.leadChecks.length, 0);
  });

  it('checks for an existing lead from this job’s start time, scoped to the phone', async () => {
    const job = makeJob({ attemptsMade: 1, data: { transcript: 'hi', echoed: true } });
    const { deps, calls } = makeDeps();
    await processVoiceJob(job, deps);
    assert.equal(calls.leadChecks[0][0], '919876543210');
    assert.equal(calls.leadChecks[0][1], job.data.receivedAt);
  });
});

describe('processVoiceJob — failures', () => {
  it('rethrows a transient error unchanged so BullMQ retries it', async () => {
    const transient = Object.assign(new Error('503 upstream'), { status: 503 });
    const job = makeJob();
    const { deps } = makeDeps({
      transcribe: async () => {
        throw transient;
      },
    });

    await assert.rejects(
      () => processVoiceJob(job, deps),
      (error) => error === transient && !(error instanceof UnrecoverableError),
    );
  });

  it('turns a permanent error into UnrecoverableError so it is not retried', async () => {
    const job = makeJob();
    const { deps } = makeDeps({
      transcribe: async () => {
        throw Object.assign(new Error('Unsupported audio format'), { permanent: true });
      },
    });

    await assert.rejects(() => processVoiceJob(job, deps), UnrecoverableError);
  });

  it('treats a Wasender 4xx on decrypt as permanent', async () => {
    const job = makeJob();
    const { deps, calls } = makeDeps({
      decryptMedia: async () => {
        throw Object.assign(new Error('Message not found'), { status: 404, permanent: true });
      },
    });

    await assert.rejects(() => processVoiceJob(job, deps), UnrecoverableError);
    assert.equal(calls.transcribe.length, 0);
  });

  it('rejects a malformed job without touching any service', async () => {
    const job = makeJob({ data: { audio: null } });
    job.data.audio = null;
    const { deps, calls } = makeDeps();

    await assert.rejects(() => processVoiceJob(job, deps), UnrecoverableError);
    assert.equal(calls.decrypt.length, 0);
  });
});

describe('processVoiceJob — voice notes that cannot become a lead', () => {
  it('declines an over-long voice note before downloading anything', async () => {
    const job = makeJob({ data: { audio: { ...AUDIO, seconds: 600 } } });
    const { deps, calls } = makeDeps();

    const result = await processVoiceJob(job, deps);

    assert.equal(result.skipped, 'too_long');
    assert.equal(calls.decrypt.length, 0);
    assert.equal(calls.transcribe.length, 0);
    assert.equal(calls.handleLead.length, 0);
    assert.match(calls.reply[0].text, /too long/i);
    // …and the voice note is still recorded so agents can see it arrived.
    assert.equal(calls.saved.length, 1);
    assert.match(calls.saved[0].body, /too long/);
    assert.equal(calls.saved[0].providerId, '3EB0ABC123');
    assert.equal(calls.saved[0].raw.media, 'audio');
  });

  it('answers silence with a prompt instead of inventing a lead', async () => {
    const job = makeJob();
    const { deps, calls } = makeDeps({
      transcribe: async () => ({ text: '   ', model: 'test-model' }),
    });

    const result = await processVoiceJob(job, deps);

    assert.equal(result.skipped, 'empty');
    assert.equal(calls.handleLead.length, 0);
    assert.match(calls.reply[0].text, /couldn't make out/i);
    assert.match(calls.saved[0].body, /no speech/);
  });

  it('replies in English and Arabic because the language is not yet known', async () => {
    const job = makeJob({ data: { audio: { ...AUDIO, seconds: 600 } } });
    const { deps, calls } = makeDeps();
    await processVoiceJob(job, deps);
    assert.match(calls.reply[0].text, /[A-Za-z]/);
    assert.match(calls.reply[0].text, /[؀-ۿ]/);
  });

  it('does not store the placeholder twice if the message is already recorded', async () => {
    const job = makeJob({ data: { audio: { ...AUDIO, seconds: 600 } } });
    const { deps, calls } = makeDeps({ findStoredMessage: async () => ({ id: 'row-1' }) });
    await processVoiceJob(job, deps);
    assert.equal(calls.saved.length, 0);
    assert.equal(calls.reply.length, 1);
  });

  it('links the placeholder to the customer’s latest lead', async () => {
    const job = makeJob({ data: { audio: { ...AUDIO, seconds: 600 } } });
    const { deps, calls } = makeDeps({ findLatestLead: async () => ({ id: 'lead-9' }) });
    await processVoiceJob(job, deps);
    assert.equal(calls.saved[0].leadId, 'lead-9');
    assert.equal(calls.reply[0].opts.leadId, 'lead-9');
  });
});

describe('notifyFinalFailure', () => {
  it('tells the customer to type instead, once', async () => {
    const job = makeJob();
    const { deps, calls } = makeDeps();

    assert.equal(await notifyFinalFailure(job, new Error('boom'), deps), true);
    assert.match(calls.reply[0].text, /type your trip details/i);
    assert.match(calls.saved[0].body, /could not be transcribed/);
    assert.equal(job.data.failureNotified, true);

    // A manual retry that fails again must not message the customer twice.
    assert.equal(await notifyFinalFailure(job, new Error('boom'), deps), false);
    assert.equal(calls.reply.length, 1);
  });

  it('works with a plain object when the webhook cannot even enqueue', async () => {
    const { deps, calls } = makeDeps();
    const plain = { data: { messageId: 'M1', from: '971500000000', audio: AUDIO } };
    assert.equal(await notifyFinalFailure(plain, new Error('redis down'), deps), true);
    assert.equal(calls.reply.length, 1);
  });

  it('never throws if the notification itself fails', async () => {
    const job = makeJob();
    const { deps } = makeDeps({
      reply: async () => {
        throw new Error('whatsapp down');
      },
    });
    assert.equal(await notifyFinalFailure(job, new Error('boom'), deps), false);
  });
});

describe('voice limits from env', () => {
  let saved;
  beforeEach(() => {
    saved = process.env.VOICE_MAX_SECONDS;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.VOICE_MAX_SECONDS;
    else process.env.VOICE_MAX_SECONDS = saved;
  });

  it('honours VOICE_MAX_SECONDS', async () => {
    process.env.VOICE_MAX_SECONDS = '30';
    const job = makeJob({ data: { audio: { ...AUDIO, seconds: 45 } } });
    const { deps, calls } = makeDeps();
    const result = await processVoiceJob(job, deps);
    assert.equal(result.skipped, 'too_long');
    assert.equal(calls.transcribe.length, 0);
  });

  it('accepts a note exactly at the limit', async () => {
    process.env.VOICE_MAX_SECONDS = '30';
    const job = makeJob({ data: { audio: { ...AUDIO, seconds: 30 } } });
    const { deps, calls } = makeDeps();
    await processVoiceJob(job, deps);
    assert.equal(calls.transcribe.length, 1);
  });
});
