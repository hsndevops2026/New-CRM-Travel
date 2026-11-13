import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { pool } from '../config/database.js';
import { publicAddon, readBundle, validateConnectorUrl } from '../services/assistantAddons.js';

const skillMd = (name, description) => strToU8(`---\nname: ${name}\ndescription: "${description}"\n---\n\n# ${name}\n`);

describe('reading a skill or plugin archive', () => {
  after(async () => {
    await pool.end();
  });

  it('reads a skill whose SKILL.md sits at the root of the archive', () => {
    const bundle = readBundle(zipSync({ 'SKILL.md': skillMd('brand-voice', 'How we write'), 'examples/one.md': strToU8('x') }));
    assert.equal(bundle.skills.length, 1);
    assert.equal(bundle.skills[0].name, 'brand-voice');
    assert.equal(bundle.skills[0].description, 'How we write');
    // Uploaded under one folder, as the Skills API requires.
    assert.deepEqual(bundle.skills[0].files.map((file) => file.path).sort(), ['brand-voice/SKILL.md', 'brand-voice/examples/one.md']);
    assert.deepEqual(bundle.connectors, []);
  });

  it('reads a skill wrapped in a folder and ignores macOS clutter', () => {
    const bundle = readBundle(
      zipSync({
        'quote-writer/SKILL.md': skillMd('quote-writer', 'Writes quotes'),
        'quote-writer/scripts/run.py': strToU8('print(1)'),
        '__MACOSX/quote-writer/._SKILL.md': strToU8('junk'),
        'quote-writer/.DS_Store': strToU8('junk'),
      }),
    );
    assert.deepEqual(bundle.skills[0].files.map((file) => file.path).sort(), ['quote-writer/SKILL.md', 'quote-writer/scripts/run.py']);
  });

  it('takes the skills and remote connectors from a plugin and reports the rest as skipped', () => {
    const bundle = readBundle(
      zipSync({
        'travel-plugin/.claude-plugin/plugin.json': strToU8(JSON.stringify({ name: 'travel-plugin' })),
        'travel-plugin/skills/itinerary/SKILL.md': skillMd('itinerary', 'Builds itineraries'),
        'travel-plugin/skills/itinerary/reference/SKILL.md': strToU8('nested notes, part of the skill above'),
        'travel-plugin/skills/visa/SKILL.md': skillMd('visa', 'Visa rules'),
        'travel-plugin/commands/quote.md': strToU8('# /quote'),
        'travel-plugin/agents/researcher.md': strToU8('# agent'),
        'travel-plugin/hooks/hooks.json': strToU8('{}'),
        'travel-plugin/.mcp.json': strToU8(
          JSON.stringify({
            mcpServers: {
              flights: { type: 'http', url: 'https://mcp.flights.example/mcp', headers: { Authorization: 'Bearer abc123' } },
              local: { command: 'npx', args: ['some-server'] },
              templated: { type: 'http', url: 'https://${HOST}/mcp' },
              envtoken: { type: 'sse', url: 'https://mcp.hotels.example/sse', headers: { Authorization: 'Bearer ${TOKEN}' } },
            },
          }),
        ),
      }),
    );
    assert.deepEqual(bundle.skills.map((skill) => skill.name).sort(), ['itinerary', 'visa']);
    const itinerary = bundle.skills.find((skill) => skill.name === 'itinerary');
    assert.deepEqual(itinerary.files.map((file) => file.path).sort(), ['itinerary/SKILL.md', 'itinerary/reference/SKILL.md']);
    assert.deepEqual(bundle.connectors, [
      { name: 'flights', url: 'https://mcp.flights.example/mcp', token: 'abc123' },
      { name: 'envtoken', url: 'https://mcp.hotels.example/sse', token: null },
    ]);
    const skipped = bundle.skipped.join(' | ');
    assert.match(skipped, /"local" runs a local program/);
    assert.match(skipped, /"templated" needs a value/);
    assert.match(skipped, /1 slash command/);
    assert.match(skipped, /1 subagent/);
    assert.match(skipped, /Hooks/);
  });

  it('rejects something that is not a zip, and an archive that unpacks too large', () => {
    assert.throws(() => readBundle(strToU8('definitely not a zip file')), /not a readable \.zip/);
    // 31 MB of zeros compresses to a few kilobytes; it must be refused before inflating.
    const bomb = zipSync({ 'SKILL.md': skillMd('x', 'y'), 'big.bin': new Uint8Array(31 * 1024 * 1024) }, { level: 9 });
    assert.ok(bomb.length < 1024 * 1024);
    assert.throws(() => readBundle(bomb), /too large/);
  });

  it('only accepts https connector URLs without embedded credentials', () => {
    assert.equal(validateConnectorUrl(' https://mcp.example.com/mcp '), 'https://mcp.example.com/mcp');
    assert.throws(() => validateConnectorUrl('http://mcp.example.com'), /https/);
    assert.throws(() => validateConnectorUrl('https://user:pass@mcp.example.com'), /token field/);
    assert.throws(() => validateConnectorUrl('not a url'), /valid connector URL/);
  });

  it('marks a custom skill unavailable under a different Claude key and never exposes its token', () => {
    const skill = { id: 's', kind: 'skill', name: 'S', scope: 'agency', config: { skill_id: 'skill_1', key_fingerprint: 'aaaa' }, secret_encrypted: null };
    assert.equal(publicAddon(skill, 'aaaa').available, true);
    assert.equal(publicAddon(skill, 'bbbb').available, false);
    const connector = { id: 'c', kind: 'mcp', name: 'C', scope: 'user', config: { url: 'https://x.example' }, secret_encrypted: 'v1:a:b:c' };
    const shown = publicAddon(connector, null);
    assert.equal(shown.has_token, true);
    assert.ok(!JSON.stringify(shown).includes('v1:a:b:c'));
  });
});
