import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { createApp } from '../createApp.js';
import { pool, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import { createAdmin } from '../services/admins.js';
import { signAccessToken } from '../services/authTokens.js';
import { runTurn } from '../services/assistantChat.js';
import {
  createConversation,
  getConversation,
  listMessages,
  updateConversation,
} from '../services/assistantStore.js';

const text = (value) => ({ type: 'text', text: value });
const thinking = (signature) => ({ type: 'thinking', thinking: '', signature });
const reply = (content, stop_reason = 'end_turn', extra = {}) => ({
  message: { model: 'claude-haiku-5-5', content, stop_reason, usage: { input_tokens: 1, output_tokens: 1 }, ...extra },
});

/** Stand-in for the Anthropic client: plays back scripted replies and records each request. */
function fakeConnection(script) {
  const calls = [];
  const client = {
    beta: {
      messages: {
        stream(params) {
          calls.push(structuredClone(params));
          const step = script.shift();
          const handlers = [];
          return {
            on(event, handler) {
              if (event === 'streamEvent') handlers.push(handler);
              return this;
            },
            async finalMessage() {
              if (!step) throw new Error('the fake client ran out of scripted replies');
              if (step instanceof Error) throw step;
              for (const event of step.events || []) handlers.forEach((handler) => handler(event));
              return step.message;
            },
          };
        },
      },
    },
    files: {
      async retrieveMetadata(id) {
        return { filename: `${id}.pptx`, mime_type: 'application/vnd.ms-powerpoint', size_bytes: 2048 };
      },
    },
  };
  return { connection: { client, fingerprint: 'test-fingerprint' }, calls };
}

describe('assistant chat', () => {
  let server;
  let baseUrl;
  let owner;
  let other;
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  before(async () => {
    await runMigrations();
    owner = await createAdmin({ email: `pg-owner-${suffix}@example.com`, password: 'password123', role: 'agent', approvalStatus: 'approved' });
    other = await createAdmin({ email: `pg-other-${suffix}@example.com`, password: 'password123', role: 'agent', approvalStatus: 'approved' });
    server = createServer(createApp());
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    // Conversations, messages, media and add-ons go with the users (ON DELETE CASCADE).
    await query('DELETE FROM admins WHERE id = ANY($1::uuid[])', [[owner.id, other.id]]);
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });

  async function turn(conversation, userText, script) {
    const events = [];
    const fake = fakeConnection(script);
    const fresh = await getConversation(owner.id, conversation.id);
    await runTurn({
      admin: owner,
      conversation: fresh,
      userContent: [text(userText)],
      userText,
      emit: (event) => events.push(event),
      connection: fake.connection,
    });
    return { events, calls: fake.calls, rows: await listMessages(conversation.id) };
  }

  const api = (path, { user = owner, method = 'GET', body } = {}) =>
    fetch(`${baseUrl}/api/assistant${path}`, {
      method,
      headers: { Authorization: `Bearer ${signAccessToken(user)}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });

  it('stores the question and the answer, streams the text, and titles the chat', async () => {
    const conversation = await createConversation(owner.id, { model: 'claude-haiku-5-5' });
    const { events, calls, rows } = await turn(conversation, 'Plan a weekend in Goa', [
      {
        events: [
          { type: 'content_block_start', content_block: { type: 'thinking' } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Sure' } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: ' thing.' } },
        ],
        ...reply([thinking('sig-1'), text('Sure thing.')]),
      },
    ]);

    assert.deepEqual(rows.map((row) => row.role), ['user', 'assistant']);
    assert.deepEqual(rows[1].content, [thinking('sig-1'), text('Sure thing.')]);
    assert.equal(rows[1].meta.stop_reason, 'end_turn');
    assert.deepEqual(events.map((event) => event.type), ['row', 'activity', 'delta', 'delta', 'row']);
    assert.equal(events.filter((event) => event.type === 'delta').map((event) => event.text).join(''), 'Sure thing.');
    assert.deepEqual(calls[0].messages, [{ role: 'user', content: [text('Plan a weekend in Goa')] }]);

    const saved = await getConversation(owner.id, conversation.id);
    assert.equal(saved.title, 'Plan a weekend in Goa');
    assert.ok(saved.config_hash);
  });

  it('answers a tool call and keeps going until Claude finishes', async () => {
    const conversation = await createConversation(owner.id, { model: 'claude-haiku-5-5' });
    const call = { type: 'tool_use', id: 'toolu_1', name: 'mystery_tool', input: { a: 1 } };
    const { calls, rows } = await turn(conversation, 'Use the tool', [
      reply([text('Let me check.'), call], 'tool_use'),
      reply([text('Done.')]),
    ]);

    assert.deepEqual(rows.map((row) => row.role), ['user', 'assistant', 'user', 'assistant']);
    assert.deepEqual(rows[2].content, [
      { type: 'tool_result', tool_use_id: 'toolu_1', is_error: true, content: 'Unknown tool: mystery_tool' },
    ]);
    // The second request carries the call and its result, in order.
    assert.deepEqual(calls[1].messages.slice(1), [
      { role: 'assistant', content: [text('Let me check.'), call] },
      { role: 'user', content: rows[2].content },
    ]);
  });

  it('replays reasoning while the setup is unchanged and drops it once tools change', async () => {
    const conversation = await createConversation(owner.id, { model: 'claude-haiku-5-5' });
    await turn(conversation, 'one', [reply([thinking('sig-a'), text('first')])]);

    const same = await turn(conversation, 'two', [reply([thinking('sig-b'), text('second')])]);
    assert.deepEqual(same.calls[0].messages[1].content, [thinking('sig-a'), text('first')]);

    await updateConversation(owner.id, conversation.id, { settings: { web_search: false } });
    const changed = await turn(conversation, 'three', [reply([thinking('sig-c'), text('third')])]);
    const sent = changed.calls[0].messages;
    assert.deepEqual(sent[1].content, [text('first')]);
    assert.deepEqual(sent[3].content, [text('second')]);
    // What is stored is never rewritten — only what is replayed changes.
    assert.deepEqual(changed.rows[1].content, [thinking('sig-a'), text('first')]);

    // Reasoning produced after the change is replayed again on the next turn.
    const next = await turn(conversation, 'four', [reply([text('fourth')])]);
    assert.deepEqual(next.calls[0].messages[1].content, [text('first')]);
    assert.deepEqual(next.calls[0].messages[5].content, [thinking('sig-c'), text('third')]);
  });

  it('retries once without reasoning or container when the request is rejected', async () => {
    const conversation = await createConversation(owner.id, { model: 'claude-haiku-5-5' });
    await turn(conversation, 'one', [reply([thinking('sig-a'), text('first')])]);

    const rejected = new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'bad' } }, 'bad', new Headers());
    const { calls, rows, events } = await turn(conversation, 'two', [rejected, reply([text('recovered')])]);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].messages[1].content[0].type, 'thinking');
    assert.deepEqual(calls[1].messages[1].content, [text('first')]);
    assert.ok(events.some((event) => event.type === 'reset'));
    assert.deepEqual(rows[3].content, [text('recovered')]);

    await assert.rejects(turn(conversation, 'three', [rejected, rejected]), Anthropic.BadRequestError);
  });

  it('keeps none of a declined reply', async () => {
    const conversation = await createConversation(owner.id, { model: 'claude-haiku-5-5' });
    const { rows, events } = await turn(conversation, 'something', [
      reply([text('half an ans')], 'refusal', { stop_details: { type: 'refusal', category: 'cyber' } }),
    ]);
    assert.deepEqual(rows[1].content, [text('Claude declined to answer this request.')]);
    assert.equal(rows[1].meta.refusal, true);
    assert.equal(rows[1].meta.category, 'cyber');
    assert.ok(events.some((event) => event.type === 'reset'));
  });

  it('continues a paused turn and records the files a skill produced', async () => {
    const conversation = await createConversation(owner.id, { model: 'claude-haiku-5-5', settings: { skills: ['pptx'] } });
    const paused = [{ type: 'server_tool_use', id: 'srv_1', name: 'bash_code_execution', input: {} }];
    const finished = [
      { type: 'bash_code_execution_tool_result', tool_use_id: 'srv_1', content: { type: 'bash_code_execution_result', stdout: '', stderr: '', return_code: 0, content: [{ type: 'bash_code_execution_output', file_id: 'file_abc' }] } },
      text('Here is your deck.'),
    ];
    const { calls, rows } = await turn(conversation, 'Make a deck', [
      reply(paused, 'pause_turn', { container: { id: 'container_1' } }),
      reply(finished, 'end_turn', { container: { id: 'container_1' } }),
    ]);

    assert.deepEqual(calls[0].container, { skills: [{ type: 'anthropic', skill_id: 'pptx', version: 'latest' }] });
    assert.equal(calls[1].container.id, 'container_1');
    assert.deepEqual(calls[1].messages[1], { role: 'assistant', content: paused });
    assert.deepEqual(rows.map((row) => row.role), ['user', 'assistant', 'assistant']);
    assert.deepEqual(rows[2].meta.files, [
      { file_id: 'file_abc', filename: 'file_abc.pptx', mime_type: 'application/vnd.ms-powerpoint', size_bytes: 2048 },
    ]);
    assert.equal((await getConversation(owner.id, conversation.id)).container_id, 'container_1');
  });

  it('stops after the step limit instead of looping forever', async () => {
    const conversation = await createConversation(owner.id, { model: 'claude-haiku-5-5' });
    const loop = Array.from({ length: 20 }, (_, index) =>
      reply([{ type: 'tool_use', id: `toolu_${index}`, name: 'mystery_tool', input: {} }], 'tool_use'),
    );
    const { calls, rows } = await turn(conversation, 'loop', loop);
    assert.equal(calls.length, 8);
    assert.equal(rows.at(-1).role, 'assistant');
    assert.equal(rows.at(-1).meta.step_limit, true);
  });

  describe('API', () => {
    it('describes the setup without ever returning a key', async () => {
      const response = await api('/state');
      assert.equal(response.status, 200);
      const body = await response.text();
      const state = JSON.parse(body);
      assert.equal(state.default_model, 'claude-opus-5-5');
      assert.equal(state.can_manage_agency, false);
      assert.deepEqual(state.builtin_skills.map((skill) => skill.id), ['pptx', 'xlsx', 'docx', 'pdf']);
      assert.ok(!/sk-[A-Za-z0-9_-]{10,}/.test(body));
      assert.ok(!body.includes('key_encrypted'));
    });

    it('requires a login', async () => {
      const response = await fetch(`${baseUrl}/api/assistant/state`);
      assert.equal(response.status, 401);
    });

    it('lets only admins set or remove the agency key', async () => {
      const save = await api('/connections/anthropic', { method: 'PUT', body: { scope: 'agency', api_key: 'sk-ant-not-a-real-key-000000000000' } });
      assert.equal(save.status, 403);
      const remove = await api('/connections/anthropic?scope=agency', { method: 'DELETE' });
      assert.equal(remove.status, 403);
    });

    it('rejects a malformed key before contacting the provider', async () => {
      const response = await api('/connections/anthropic', { method: 'PUT', body: { scope: 'user', api_key: 'short' } });
      assert.equal(response.status, 400);
    });

    it('keeps one user out of another user’s chats', async () => {
      const conversation = await createConversation(owner.id, { model: 'claude-haiku-5-5' });
      await turn(conversation, 'private', [reply([text('secret answer')])]);

      const mine = await api(`/conversations/${conversation.id}`);
      assert.equal(mine.status, 200);
      assert.equal((await mine.json()).messages.length, 2);

      for (const [path, options] of [
        [`/conversations/${conversation.id}`, {}],
        [`/conversations/${conversation.id}`, { method: 'DELETE' }],
        [`/conversations/${conversation.id}/messages`, { method: 'POST', body: { text: 'hi' } }],
        [`/conversations/${conversation.id}/generate`, { method: 'POST', body: { kind: 'image', prompt: 'x' } }],
        [`/conversations/${conversation.id}/files/file_abc`, {}],
      ]) {
        const response = await api(path, { ...options, user: other });
        assert.equal(response.status, 404, `${options.method || 'GET'} ${path}`);
      }
      const list = await (await api('/conversations', { user: other })).json();
      assert.ok(!list.conversations.some((entry) => entry.id === conversation.id));
    });

    it('validates a generate request before spending anything', async () => {
      const conversation = await createConversation(owner.id, {});
      const response = await api(`/conversations/${conversation.id}/generate`, { method: 'POST', body: { kind: 'image', prompt: '   ' } });
      assert.equal(response.status, 400);
      assert.equal((await listMessages(conversation.id)).length, 0);
    });

    it('serves a stored file only to someone holding its link, and only files of its own chat', async () => {
      const conversation = await createConversation(owner.id, {});
      const inserted = await query(
        `INSERT INTO assistant_media (admin_id, conversation_id, kind, provider, prompt, status, mime, data)
         VALUES ($1, $2, 'image', 'openai', 'a beach', 'ready', 'image/png', $3)
         RETURNING id, access_token`,
        [owner.id, conversation.id, Buffer.from('png-bytes')],
      );
      const { id, access_token: token } = inserted.rows[0];

      const detail = await (await api(`/conversations/${conversation.id}`)).json();
      assert.equal(detail.media[0].url, `/api/assistant/assets/${id}/${token}`);

      // No login header: the token in the link is the credential.
      const ok = await fetch(`${baseUrl}/api/assistant/assets/${id}/${token}`);
      assert.equal(ok.status, 200);
      assert.equal(ok.headers.get('content-type'), 'image/png');
      assert.equal(await ok.text(), 'png-bytes');

      const wrong = await fetch(`${baseUrl}/api/assistant/assets/${id}/${'0'.repeat(48)}`);
      assert.equal(wrong.status, 404);

      const unknownFile = await api(`/conversations/${conversation.id}/files/file_not_from_here`);
      assert.equal(unknownFile.status, 404);
    });
  });
});
