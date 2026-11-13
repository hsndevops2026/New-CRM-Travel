import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  IMAGE_TOOL,
  systemPrompt,
  buildRequestConfig,
  buildUserContent,
  extractOutputFileIds,
  mcpServerName,
  normalizeSettings,
  parseImageToolInput,
  parseVideoToolInput,
  sanitizeFallbackTurn,
  titleFromText,
  toApiMessages,
} from '../services/assistantRequest.js';
import { decryptSecret, encryptSecret, secretFingerprint, secretHint } from '../services/secretBox.js';

const SKILL_ADDON = { id: '11111111-1111-4111-8111-111111111111', kind: 'skill', name: 'Brand voice', config: { skill_id: 'skill_01abc' } };
const MCP_ADDON = { id: '22222222-2222-4222-8222-222222222222', kind: 'mcp', name: 'My Notion!', config: { url: 'https://mcp.example.com/mcp' }, token: 'tok-123' };

describe('assistant request building', () => {
  it('sends a plain chat with adaptive thinking and no tools when everything is off', () => {
    const settings = normalizeSettings({ web_search: false, image_gen: false, video_gen: false, crm_data: false });
    const { params } = buildRequestConfig({ model: 'claude-haiku-5-5', settings, media: { image: true, video: true }, today: '2026-11-13' });
    assert.equal(params.model, 'claude-haiku-5-5');
    assert.equal(params.system, systemPrompt('2026-11-13'));
    assert.match(params.system, /Today is 2026-11-13\.$/);
    assert.deepEqual(params.thinking, { type: 'adaptive', display: 'summarized' });
    assert.equal(params.tools, undefined);
    assert.equal(params.mcp_servers, undefined);
    assert.equal(params.container, undefined);
    // Haiku has no server-side refusal fallback.
    assert.equal(params.fallbacks, undefined);
    assert.equal(params.betas, undefined);
  });

  it('opts the main models into the refusal fallback', () => {
    const { params } = buildRequestConfig({ model: 'claude-opus-5-5', settings: normalizeSettings({}), media: {} });
    assert.equal(params.fallbacks, 'default');
    assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01']);
  });

  it('offers image and video tools only when a provider key exists', () => {
    const settings = normalizeSettings({ crm_data: false, web_search: false });
    const without = buildRequestConfig({ model: 'claude-haiku-5-5', settings, media: { image: false, video: false } });
    assert.equal(without.params.tools, undefined);
    const withMedia = buildRequestConfig({ model: 'claude-haiku-5-5', settings, media: { image: true, video: true } });
    assert.deepEqual(withMedia.params.tools.map((tool) => tool.name), ['generate_image', 'generate_video']);
    assert.equal(withMedia.params.tools[0], IMAGE_TOOL);
  });

  it('attaches skills through the code container and uses the plain web search beside it', () => {
    const settings = normalizeSettings({ crm_data: false, skills: ['pptx', 'not-a-skill'], addons: [SKILL_ADDON.id], image_gen: false, video_gen: false });
    const { params } = buildRequestConfig({ model: 'claude-haiku-5-5', settings, addons: [SKILL_ADDON], media: {}, containerId: 'cont_1' });
    assert.deepEqual(params.container, {
      id: 'cont_1',
      skills: [
        { type: 'anthropic', skill_id: 'pptx', version: 'latest' },
        { type: 'custom', skill_id: 'skill_01abc', version: 'latest' },
      ],
    });
    assert.deepEqual(params.tools.map((tool) => tool.type), ['web_search_20250305', 'code_execution_20250825']);
  });

  it('uses the newer web search when no code sandbox is in play', () => {
    const { params } = buildRequestConfig({ model: 'claude-haiku-5-5', settings: normalizeSettings({ crm_data: false, image_gen: false, video_gen: false }), media: {} });
    assert.deepEqual(params.tools.map((tool) => tool.type), ['web_search_20260209']);
  });

  it('declares a connector both as a server and as a toolset with a matching name', () => {
    const settings = normalizeSettings({ crm_data: false, web_search: false, addons: [MCP_ADDON.id] });
    const { params } = buildRequestConfig({ model: 'claude-haiku-5-5', settings, addons: [MCP_ADDON], media: {} });
    const name = mcpServerName(MCP_ADDON);
    assert.equal(name, 'my-notion-222222');
    assert.deepEqual(params.mcp_servers, [{ type: 'url', name, url: 'https://mcp.example.com/mcp', authorization_token: 'tok-123' }]);
    assert.deepEqual(params.tools, [{ type: 'mcp_toolset', mcp_server_name: name }]);
    assert.deepEqual(params.betas, ['mcp-client-2025-11-20']);
  });

  it('ignores an installed add-on that is not switched on for the conversation', () => {
    const settings = normalizeSettings({ crm_data: false, web_search: false, image_gen: false, video_gen: false });
    const { params } = buildRequestConfig({ model: 'claude-haiku-5-5', settings, addons: [SKILL_ADDON, MCP_ADDON], media: {} });
    assert.equal(params.tools, undefined);
    assert.equal(params.container, undefined);
  });

  it('changes the fingerprint when the model or tool set changes, not when tokens do', () => {
    const base = normalizeSettings({ addons: [MCP_ADDON.id] });
    const hash = (model, settings, addons) => buildRequestConfig({ model, settings, addons, media: {} }).hash;
    const one = hash('claude-haiku-5-5', base, [MCP_ADDON]);
    assert.equal(one, hash('claude-haiku-5-5', base, [{ ...MCP_ADDON, token: 'rotated' }]));
    assert.notEqual(one, hash('claude-opus-5-5', base, [MCP_ADDON]));
    assert.notEqual(one, hash('claude-haiku-5-5', normalizeSettings({ addons: [MCP_ADDON.id], web_search: false }), [MCP_ADDON]));
  });

  it('drops unknown skills and malformed add-on ids from client settings', () => {
    const settings = normalizeSettings({ skills: ['xlsx', 'xlsx', '../etc'], addons: ['nope', SKILL_ADDON.id], web_search: 0 });
    assert.deepEqual(settings.skills, ['xlsx']);
    assert.deepEqual(settings.addons, [SKILL_ADDON.id]);
    assert.equal(settings.web_search, true);
  });

  it('offers the CRM lookups by default and the suggestion cards only in Trip planner', () => {
    const names = (settings) =>
      (buildRequestConfig({ model: 'claude-haiku-5-5', settings: normalizeSettings(settings), media: {} }).params.tools || [])
        .map((tool) => tool.name);
    const defaults = normalizeSettings({});
    assert.equal(defaults.crm_data, true);
    assert.equal(defaults.trip_planner, false);
    assert.ok(names({}).includes('search_leads'));
    assert.equal(names({}).includes('propose_suggestions'), false);
    assert.equal(names({ crm_data: false }).includes('search_leads'), false);
    // Trip planner starts from the lead and the packages, so it brings the lookups along.
    const planner = names({ crm_data: false, trip_planner: true });
    assert.ok(planner.includes('propose_suggestions'));
    assert.ok(planner.includes('search_packages'));
  });
});

describe('assistant history replay', () => {
  const rows = [
    { seq: 1, role: 'user', content: [{ type: 'text', text: 'hi' }] },
    { seq: 2, role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'a' }, { type: 'text', text: 'hello' }] },
    { seq: 3, role: 'user', content: [{ type: 'text', text: 'more' }] },
    { seq: 4, role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'b' }, { type: 'text', text: 'sure' }] },
  ];

  it('replays stored blocks untouched by default', () => {
    assert.deepEqual(toApiMessages(rows).map((message) => message.content), rows.map((row) => row.content));
  });

  it('removes reasoning only from turns at or before the cutoff', () => {
    const messages = toApiMessages(rows, { thinkingCutoff: 2 });
    assert.deepEqual(messages[1].content, [{ type: 'text', text: 'hello' }]);
    assert.equal(messages[3].content[0].type, 'thinking');
  });

  it('leaves out a turn that held nothing but reasoning', () => {
    const only = [{ seq: 1, role: 'assistant', content: [{ type: 'redacted_thinking', data: 'x' }] }];
    assert.deepEqual(toApiMessages(only, { thinkingCutoff: 5 }), []);
  });

  it('keeps only what may be echoed back from before a fallback boundary', () => {
    const content = [
      { type: 'thinking', thinking: '', signature: 'x' },
      { type: 'text', text: 'partial' },
      { type: 'server_tool_use', id: 'srv_done', name: 'web_search', input: {} },
      { type: 'web_search_tool_result', tool_use_id: 'srv_done', content: [] },
      { type: 'server_tool_use', id: 'srv_open', name: 'web_search', input: {} },
      { type: 'tool_use', id: 'tu_1', name: 'generate_image', input: {} },
      { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } },
      { type: 'thinking', thinking: '', signature: 'y' },
      { type: 'text', text: 'final' },
    ];
    assert.deepEqual(
      sanitizeFallbackTurn(content).map((block) => block.id || block.text || block.type),
      ['partial', 'srv_done', 'web_search_tool_result', 'fallback', 'thinking', 'final'],
    );
    const untouched = [{ type: 'thinking', thinking: '', signature: 'z' }, { type: 'text', text: 'x' }];
    assert.equal(sanitizeFallbackTurn(untouched), untouched);
  });

  it('finds files created in the code sandbox', () => {
    const content = [
      { type: 'text', text: 'made it', file_id: 'not-a-tool-result' },
      { type: 'bash_code_execution_tool_result', tool_use_id: 's1', content: { type: 'bash_code_execution_result', stdout: '', content: [{ type: 'bash_code_execution_output', file_id: 'file_1' }, { type: 'bash_code_execution_output', file_id: 'file_1' }] } },
      { type: 'code_execution_tool_result', tool_use_id: 's2', content: { content: [{ file_id: 'file_2' }] } },
    ];
    assert.deepEqual(extractOutputFileIds(content), ['file_1', 'file_2']);
  });
});

describe('assistant user input', () => {
  const b64 = (text) => Buffer.from(text).toString('base64');

  it('puts files before the text', () => {
    const content = buildUserContent({
      text: '  What is this?  ',
      attachments: [
        { name: 'a.png', media_type: 'image/png', data: b64('png') },
        { name: 'b.pdf', media_type: 'application/pdf', data: b64('pdf') },
        { name: 'c.csv', media_type: 'text/csv', data: b64('x,y') },
      ],
    });
    assert.deepEqual(content.map((block) => block.type), ['image', 'document', 'document', 'text']);
    assert.equal(content[2].source.data, 'x,y');
    assert.equal(content[3].text, 'What is this?');
  });

  it('rejects empty messages, unsupported files and oversized files', () => {
    assert.throws(() => buildUserContent({ text: '   ' }), /Write a message/);
    assert.throws(() => buildUserContent({ text: 'x', attachments: [{ name: 'a.exe', media_type: 'application/x-msdownload', data: b64('x') }] }), /only images/);
    assert.throws(() => buildUserContent({ text: 'x', attachments: [{ name: 'a.png', media_type: 'image/png', data: 'not base64!' }] }), /could not be read/);
    const big = 'A'.repeat(Math.ceil((4 * 1024 * 1024 * 4) / 3) + 8);
    assert.throws(() => buildUserContent({ text: 'x', attachments: [{ name: 'big.png', media_type: 'image/png', data: big }] }), /larger than 4 MB/);
    assert.throws(() => buildUserContent({ text: 'x', attachments: new Array(5).fill({ name: 'a.png', media_type: 'image/png', data: b64('x') }) }), /at most 4/);
  });

  it('validates tool inputs instead of trusting them', () => {
    assert.equal(parseImageToolInput({}), null);
    assert.equal(parseImageToolInput({ prompt: 42 }), null);
    assert.deepEqual(parseImageToolInput({ prompt: ' a beach ', aspect: 'diagonal' }), { prompt: 'a beach', aspect: 'square' });
    assert.deepEqual(parseVideoToolInput({ prompt: 'waves', seconds: 99, orientation: 'portrait' }), { prompt: 'waves', seconds: 4, orientation: 'portrait' });
    assert.deepEqual(parseVideoToolInput({ prompt: 'waves', seconds: '8' }), { prompt: 'waves', seconds: 8, orientation: 'landscape' });
  });

  it('titles a chat from its first message', () => {
    assert.equal(titleFromText('  Plan\n a trip  '), 'Plan a trip');
    assert.equal(titleFromText(''), 'New chat');
    assert.equal(titleFromText('x'.repeat(100)).length, 58);
  });
});

describe('secret storage', () => {
  it('round-trips a key and never stores it readable', () => {
    process.env.AI_KEYS_ENCRYPTION_KEY = 'a'.repeat(64);
    const stored = encryptSecret('sk-ant-api03-secret-value');
    assert.ok(!stored.includes('secret-value'));
    assert.notEqual(stored, encryptSecret('sk-ant-api03-secret-value'));
    assert.equal(decryptSecret(stored), 'sk-ant-api03-secret-value');
    assert.equal(secretHint('sk-ant-api03-secret-value'), '…alue');
    assert.equal(secretFingerprint('a').length, 16);
  });

  it('refuses a tampered value or a different encryption key', () => {
    process.env.AI_KEYS_ENCRYPTION_KEY = 'a'.repeat(64);
    const stored = encryptSecret('top-secret');
    const parts = stored.split(':');
    parts[3] = Buffer.from('tampered-data').toString('base64');
    assert.throws(() => decryptSecret(parts.join(':')), /no longer be read/);
    process.env.AI_KEYS_ENCRYPTION_KEY = 'b'.repeat(64);
    assert.throws(() => decryptSecret(stored), /no longer be read/);
    assert.throws(() => decryptSecret('garbage'), /unknown format/);
  });
});
