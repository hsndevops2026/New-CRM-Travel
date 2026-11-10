import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UnrecoverableError } from 'bullmq';
import {
  MAX_TEST_AUDIO_BYTES,
  describeSimulatedJob,
  enqueueSimulatedVoice,
  loadSimulatedAudio,
  normalizeTestPhone,
  validateSimulatedUpload,
} from '../services/voiceSimulation.js';
import { processVoiceJob, notifyFinalFailure } from '../workers/voiceWorker.js';

/* ---------------------------------------------------------------- *
 * A fake BullMQ queue + Redis, so these run without infrastructure.
 * ---------------------------------------------------------------- */

function fakeQueue(jobs = {}) {
  const store = new Map();
  const added = [];
  return {
    store,
    added,
    // Stand-in for the service's own ioredis connection (BullMQ 6 hides its own).
    redis: {
      set: async (key, value, mode, ttl) => store.set(key, { value, mode, ttl }),
      getBuffer: async (key) => store.get(key)?.value ?? null,
    },
    add: async (name, data, opts) => {
      added.push({ name, data, opts });
      return { id: opts.jobId };
    },
    getJob: async (id) => jobs[id] || null,
  };
}

const AUDIO = Buffer.from('fake-opus-bytes');

describe('validateSimulatedUpload', () => {
  it('accepts voice formats the transcription API can read', () => {
    for (const contentType of ['audio/webm;codecs=opus', 'audio/ogg; codecs=opus', 'audio/mp4', 'audio/mpeg', 'audio/wav']) {
      assert.doesNotThrow(() => validateSimulatedUpload({ buffer: AUDIO, contentType }), contentType);
    }
  });

  it('rejects empty, oversized and unsupported uploads with the right status', () => {
    const status = (args) => { try { validateSimulatedUpload(args); } catch (e) { return e.status; } return null; };
    assert.equal(status({ buffer: Buffer.alloc(0), contentType: 'audio/webm' }), 400);
    assert.equal(status({ buffer: undefined, contentType: 'audio/webm' }), 400);
    assert.equal(status({ buffer: Buffer.alloc(MAX_TEST_AUDIO_BYTES + 1), contentType: 'audio/webm' }), 413);
    assert.equal(status({ buffer: AUDIO, contentType: 'image/png' }), 415);
    assert.equal(status({ buffer: AUDIO, contentType: 'audio/amr' }), 415);
    assert.equal(status({ buffer: AUDIO, contentType: undefined }), 415);
  });
});

describe('normalizeTestPhone', () => {
  it('keeps digits and defaults to the standard test number', () => {
    assert.equal(normalizeTestPhone('+971 50 123 4567'), '971501234567');
    assert.equal(normalizeTestPhone(undefined), '9990001111');
    assert.equal(normalizeTestPhone(''), '9990001111');
  });

  it('rejects something that is not a phone number', () => {
    assert.throws(() => normalizeTestPhone('abc'), (e) => e.status === 400);
    assert.throws(() => normalizeTestPhone('123'), (e) => e.status === 400);
  });
});

describe('enqueueSimulatedVoice', () => {
  it('stores the audio with an expiry and queues a job flagged as a simulation', async () => {
    const queue = fakeQueue();
    const { jobId } = await enqueueSimulatedVoice(
      { buffer: AUDIO, contentType: 'audio/webm;codecs=opus', phone: '9990001111', seconds: '7.5' },
      { queue, redis: queue.redis },
    );

    assert.match(jobId, /^voice-sim-/);
    const [{ data, opts }] = queue.added;
    assert.equal(data.source, 'simulate');
    assert.equal(data.from, '9990001111');
    assert.equal(data.audio.seconds, 7.5);
    assert.equal(data.audio.mimetype, 'audio/webm;codecs=opus');
    assert.match(data.messageId, /^sim-/);
    assert.equal(opts.jobId, jobId);

    // The bytes live in Redis (not in the job), and expire on their own.
    const stored = queue.store.get(data.audioKey);
    assert.deepEqual(stored.value, AUDIO);
    assert.equal(stored.mode, 'EX');
    assert.ok(stored.ttl > 0 && stored.ttl <= 3600);
    assert.equal(JSON.stringify(data).includes('fake-opus-bytes'), false);
  });

  it('does not retry in the background: a tester wants the failure now', async () => {
    const queue = fakeQueue();
    await enqueueSimulatedVoice({ buffer: AUDIO, contentType: 'audio/ogg' }, { queue, redis: queue.redis });
    assert.equal(queue.added[0].opts.attempts, 1);
  });

  it('queues nothing when the upload is invalid', async () => {
    const queue = fakeQueue();
    await assert.rejects(() => enqueueSimulatedVoice({ buffer: AUDIO, contentType: 'text/plain' }, { queue, redis: queue.redis }));
    assert.equal(queue.added.length, 0);
    assert.equal(queue.store.size, 0);
  });

  it('stores nothing when the phone number is invalid', async () => {
    // Regression: the audio used to be written to Redis before the phone was checked.
    const queue = fakeQueue();
    await assert.rejects(
      () => enqueueSimulatedVoice({ buffer: AUDIO, contentType: 'audio/ogg', phone: 'abc' }, { queue, redis: queue.redis }),
      (e) => e.status === 400,
    );
    assert.equal(queue.store.size, 0);
    assert.equal(queue.added.length, 0);
  });

  it('gives every test its own job, so two testers never collide', async () => {
    const queue = fakeQueue();
    const a = await enqueueSimulatedVoice({ buffer: AUDIO, contentType: 'audio/ogg' }, { queue, redis: queue.redis });
    const b = await enqueueSimulatedVoice({ buffer: AUDIO, contentType: 'audio/ogg' }, { queue, redis: queue.redis });
    assert.notEqual(a.jobId, b.jobId);
  });
});

describe('describeSimulatedJob', () => {
  const sim = (state, extra = {}) => ({
    data: { source: 'simulate', ...extra.data },
    getState: async () => state,
    returnvalue: extra.returnvalue,
    failedReason: extra.failedReason,
  });

  it('maps queue states to what the UI shows', async () => {
    const queue = fakeQueue({
      'voice-sim-a': sim('waiting'),
      'voice-sim-b': sim('delayed'),
      'voice-sim-c': sim('active', { data: { transcript: 'hotel in Dubai' } }),
      'voice-sim-d': sim('completed', { returnvalue: { transcript: 'x', result: { reply: 'ok' } } }),
      'voice-sim-e': sim('failed', { failedReason: 'Unsupported audio format' }),
    });
    assert.deepEqual(await describeSimulatedJob('voice-sim-a', { queue }), { status: 'queued' });
    assert.deepEqual(await describeSimulatedJob('voice-sim-b', { queue }), { status: 'queued' });
    assert.deepEqual(await describeSimulatedJob('voice-sim-c', { queue }), { status: 'processing', transcript: 'hotel in Dubai' });
    assert.deepEqual(await describeSimulatedJob('voice-sim-d', { queue }), { status: 'done', outcome: { transcript: 'x', result: { reply: 'ok' } } });
    assert.deepEqual(await describeSimulatedJob('voice-sim-e', { queue }), { status: 'failed', error: 'Unsupported audio format' });
  });

  it('does not expose a real customer’s voice job, even through the sim id prefix', async () => {
    const queue = fakeQueue({
      // A real WhatsApp job whose id happens to start with the prefix.
      'voice-sim-REAL': { data: { source: undefined, transcript: 'private customer words' }, getState: async () => 'completed', returnvalue: { transcript: 'private' } },
      'voice-3EB0ABC': sim('completed'),
    });
    assert.equal(await describeSimulatedJob('voice-sim-REAL', { queue }), null);
    // …and an ordinary WhatsApp job id is not even looked up.
    assert.equal(await describeSimulatedJob('voice-3EB0ABC', { queue }), null);
  });

  it('returns null for an unknown or expired test', async () => {
    assert.equal(await describeSimulatedJob('voice-sim-nope', { queue: fakeQueue() }), null);
    assert.equal(await describeSimulatedJob(undefined, { queue: fakeQueue() }), null);
  });
});

describe('loadSimulatedAudio', () => {
  it('reads only the keys this feature wrote', async () => {
    const queue = fakeQueue();
    queue.store.set('voice-sim-audio:abc', { value: AUDIO });
    queue.store.set('bull:flight-quotes:secret', { value: Buffer.from('not yours') });
    assert.deepEqual(await loadSimulatedAudio('voice-sim-audio:abc', { redis: queue.redis }), AUDIO);
    assert.equal(await loadSimulatedAudio('bull:flight-quotes:secret', { redis: queue.redis }), null);
    assert.equal(await loadSimulatedAudio(undefined, { redis: queue.redis }), null);
  });

  it('returns null once the audio has expired', async () => {
    assert.equal(await loadSimulatedAudio('voice-sim-audio:gone', { redis: fakeQueue().redis }), null);
  });
});

/* ---------------------------------------------------------------- *
 * The worker's simulated branch
 * ---------------------------------------------------------------- */

function simJob(overrides = {}) {
  const job = {
    attemptsMade: 0,
    data: {
      messageId: 'sim-1', from: '9990001111', source: 'simulate', audioKey: 'voice-sim-audio:1',
      audio: { mimetype: 'audio/webm;codecs=opus', seconds: 6, ptt: true },
      receivedAt: Date.now(),
      ...overrides,
    },
    async updateData(next) { job.data = next; },
  };
  return job;
}

function simDeps(overrides = {}) {
  const calls = { decrypt: 0, download: 0, loaded: [], transcribe: [], handle: [], reply: [], saved: [] };
  const deps = {
    decryptMedia: async () => { calls.decrypt += 1; return 'x'; },
    downloadMedia: async () => { calls.download += 1; return { buffer: Buffer.from('x') }; },
    loadSimulatedAudio: async (key) => { calls.loaded.push(key); return AUDIO; },
    transcribe: async (buffer, opts) => {
      calls.transcribe.push({ buffer, opts });
      return { text: 'I need a hotel in Dubai for two adults', model: 'm' };
    },
    handleLead: async (args) => { calls.handle.push(args); return { reply: 'Which dates?', complete: false, lead: null }; },
    reply: async (phone, text, skip) => { calls.reply.push({ phone, text, skip }); },
    findStoredMessage: async () => null,
    saveMessage: async (row) => { calls.saved.push(row); },
    findLatestLead: async () => null,
    leadCreatedSince: async () => false,
    ...overrides,
  };
  return { deps, calls };
}

describe('processVoiceJob — simulated (CRM test) jobs', () => {
  it('reads the audio from Redis and never touches Wasender', async () => {
    const { deps, calls } = simDeps();
    await processVoiceJob(simJob(), deps);

    assert.deepEqual(calls.loaded, ['voice-sim-audio:1']);
    assert.equal(calls.decrypt, 0);
    assert.equal(calls.download, 0);
    assert.equal(calls.transcribe[0].opts.mimetype, 'audio/webm;codecs=opus');
    assert.deepEqual(calls.transcribe[0].buffer, AUDIO);
  });

  it('never sends anything to WhatsApp — not the echo, not the bot reply', async () => {
    const { deps, calls } = simDeps();
    await processVoiceJob(simJob(), deps);

    assert.ok(calls.reply.length > 0, 'the echo is still recorded');
    assert.ok(calls.reply.every((r) => r.skip === true), 'every reply is suppressed');
    assert.equal(calls.handle[0].skipWhatsApp, true);
  });

  it('returns the transcript and the full intake result for the UI', async () => {
    const { deps } = simDeps();
    const out = await processVoiceJob(simJob(), deps);
    assert.equal(out.transcript, 'I need a hotel in Dubai for two adults');
    assert.equal(out.result.reply, 'Which dates?');
  });

  it('runs the same lead intake as a real voice note', async () => {
    const { deps, calls } = simDeps();
    await processVoiceJob(simJob(), deps);
    assert.equal(calls.handle[0].text, 'I need a hotel in Dubai for two adults');
    assert.equal(calls.handle[0].source, 'whatsapp');
    assert.equal(calls.handle[0].messageMeta.transcribed, true);
    assert.equal(calls.handle[0].providerMessageId, 'sim-1');
  });

  it('fails permanently when the test audio has expired', async () => {
    const { deps, calls } = simDeps({ loadSimulatedAudio: async () => null });
    await assert.rejects(() => processVoiceJob(simJob(), deps), UnrecoverableError);
    assert.equal(calls.transcribe.length, 0);
  });

  it('returns the customer-facing reply for silence, without sending it', async () => {
    const { deps, calls } = simDeps({ transcribe: async () => ({ text: '  ', model: 'm' }) });
    const out = await processVoiceJob(simJob(), deps);
    assert.equal(out.skipped, 'empty');
    assert.match(out.reply, /couldn't make out/i);
    assert.equal(calls.handle.length, 0);
    assert.ok(calls.reply.every((r) => r.skip === true));
  });

  it('returns the reply for an over-long recording', async () => {
    const { deps, calls } = simDeps();
    const out = await processVoiceJob(simJob({ audio: { mimetype: 'audio/webm', seconds: 900 } }), deps);
    assert.equal(out.skipped, 'too_long');
    assert.match(out.reply, /too long/i);
    assert.equal(calls.loaded.length, 0);
  });

  it('suppresses the “please type instead” failure notice too', async () => {
    const { deps, calls } = simDeps();
    await notifyFinalFailure(simJob(), new Error('boom'), deps);
    assert.equal(calls.reply.length, 1);
    assert.equal(calls.reply[0].skip, true);
  });
});

describe('processVoiceJob — real jobs are unchanged', () => {
  it('still sends WhatsApp replies and still decrypts through Wasender', async () => {
    const { deps, calls } = simDeps();
    const job = simJob({ source: undefined, audioKey: undefined });
    const out = await processVoiceJob(job, deps);

    assert.equal(calls.decrypt, 1);
    assert.equal(calls.download, 1);
    assert.equal(calls.loaded.length, 0);
    assert.ok(calls.reply.every((r) => r.skip === false));
    assert.equal(calls.handle[0].skipWhatsApp, false);
    // The compact return value: no transcript or lead payload kept on real jobs.
    assert.deepEqual(Object.keys(out), ['transcript_chars']);
  });
});
