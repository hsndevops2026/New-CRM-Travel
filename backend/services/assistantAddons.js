import Anthropic, { toFile } from '@anthropic-ai/sdk';
import { strFromU8, unzipSync } from 'fflate';
import { logError } from './logger.js';
import { requireAnthropic } from './assistantConnections.js';
import { createAddon, deleteAddon, getAddon, listAddons } from './assistantStore.js';
import { decryptSecret, encryptSecret } from './secretBox.js';

/**
 * Add-ons extend what Claude can do in the Assistant:
 *  - skills: instruction bundles (a folder with SKILL.md) uploaded to Anthropic
 *  - connectors: remote MCP servers Claude can call tools on
 * A Claude Code plugin is a bundle of these plus hooks, commands and subagents. Its
 * skills and remote connectors can be installed here; the rest only runs inside
 * Claude Code itself and is reported back as skipped.
 */

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const MAX_ZIP_BYTES = 7 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 30 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2000;
const MAX_SKILLS_PER_ZIP = 20;

function assertScope(scope, role) {
  if (!['user', 'agency'].includes(scope)) throw httpError(400, 'scope must be user or agency');
  if (scope === 'agency' && role !== 'admin') {
    throw httpError(403, 'Only an admin can add add-ons for the whole agency');
  }
}

/** What the browser sees. `available` is false for a skill uploaded with a different key. */
export function publicAddon(row, fingerprint) {
  const isSkill = row.kind === 'skill';
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    scope: row.scope,
    description: row.config?.description || null,
    url: isSkill ? null : row.config?.url || null,
    has_token: Boolean(row.secret_encrypted),
    available: isSkill ? row.config?.key_fingerprint === fingerprint : true,
    created_at: row.created_at,
  };
}

/** Add-ons that can be attached to a request made with the given Claude key. */
export async function usableAddons(adminId, fingerprint) {
  const rows = await listAddons(adminId);
  const usable = [];
  for (const row of rows) {
    if (row.kind === 'skill') {
      // A custom skill lives in the workspace of the key that uploaded it.
      if (row.config?.key_fingerprint !== fingerprint || !row.config?.skill_id) continue;
      usable.push({ id: row.id, kind: 'skill', name: row.name, config: row.config });
    } else if (row.kind === 'mcp') {
      let token = null;
      if (row.secret_encrypted) {
        try {
          token = decryptSecret(row.secret_encrypted);
        } catch {
          continue;
        }
      }
      usable.push({ id: row.id, kind: 'mcp', name: row.name, config: row.config, token });
    }
  }
  return usable;
}

export function validateConnectorUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw httpError(400, 'Enter a valid connector URL');
  }
  if (url.protocol !== 'https:') throw httpError(400, 'The connector URL must start with https://');
  if (url.username || url.password) throw httpError(400, 'Put the token in the token field, not in the URL');
  if (url.toString().length > 2000) throw httpError(400, 'That URL is too long');
  return url.toString();
}

export async function addConnector({ adminId, role, scope, name, url, token }) {
  assertScope(scope, role);
  const label = String(name || '').trim().slice(0, 80);
  if (!label) throw httpError(400, 'Give the connector a name');
  const secret = String(token || '').trim();
  if (secret.length > 4000) throw httpError(400, 'That token is too long');
  return createAddon({
    scope,
    adminId,
    kind: 'mcp',
    name: label,
    config: { url: validateConnectorUrl(url) },
    secretEncrypted: secret ? encryptSecret(secret) : null,
  });
}

// ── Zip parsing (pure) ────────────────────────────────────────────────────────────────

function isJunk(path) {
  return path.startsWith('__MACOSX/') || path.endsWith('.DS_Store') || path.endsWith('/');
}

function parseFrontmatter(text) {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const fields = {};
  if (!match) return fields;
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (pair) fields[pair[1].toLowerCase()] = pair[2].trim().replace(/^["']|["']$/g, '');
  }
  return fields;
}

function unzip(bytes) {
  let total = 0;
  let count = 0;
  try {
    return unzipSync(bytes, {
      filter: (file) => {
        count += 1;
        total += file.originalSize;
        // Checked before anything is inflated, so an oversized archive is never expanded.
        if (count > MAX_ZIP_ENTRIES || total > MAX_UNZIPPED_BYTES) {
          throw httpError(400, 'That archive is too large (30 MB unpacked at most)');
        }
        return !isJunk(file.name);
      },
    });
  } catch (error) {
    if (error.status) throw error;
    throw httpError(400, 'That file is not a readable .zip archive');
  }
}

function connectorsFromMcpConfig(json, skipped) {
  const servers = json?.mcpServers && typeof json.mcpServers === 'object' ? json.mcpServers : json;
  const connectors = [];
  if (!servers || typeof servers !== 'object') return connectors;
  for (const [name, server] of Object.entries(servers)) {
    if (!server || typeof server !== 'object') continue;
    if (typeof server.url !== 'string') {
      skipped.push(`Connector "${name}" runs a local program, which only works inside Claude Code`);
      continue;
    }
    if (server.url.includes('${')) {
      skipped.push(`Connector "${name}" needs a value filled into its URL — add it by hand`);
      continue;
    }
    const auth = server.headers?.Authorization || server.headers?.authorization || '';
    const bearer = /^Bearer\s+(\S+)$/i.exec(String(auth));
    const token = bearer && !bearer[1].includes('${') ? bearer[1] : null;
    connectors.push({ name, url: server.url, token });
  }
  return connectors;
}

/**
 * Read a skill .zip or a plugin .zip.
 * @returns {{ skills: Array<{name:string, description:string|null, files:Array<{path:string,data:Uint8Array}>}>,
 *             connectors: Array<{name:string,url:string,token:string|null}>, skipped: string[] }}
 */
export function readBundle(bytes) {
  if (bytes.length > MAX_ZIP_BYTES) throw httpError(400, 'That archive is larger than 7 MB');
  const entries = unzip(bytes);
  const paths = Object.keys(entries);
  const skipped = [];

  // Every folder holding a SKILL.md is a skill; one nested inside another is part of it.
  const skillDirs = paths
    .filter((path) => path === 'SKILL.md' || path.endsWith('/SKILL.md'))
    .map((path) => path.slice(0, -'SKILL.md'.length))
    .sort((a, b) => a.length - b.length);
  const roots = skillDirs.filter((dir, index) => !skillDirs.slice(0, index).some((outer) => dir.startsWith(outer)));

  const skills = roots.slice(0, MAX_SKILLS_PER_ZIP).map((dir) => {
    const meta = parseFrontmatter(strFromU8(entries[`${dir}SKILL.md`]));
    const folder = dir.split('/').filter(Boolean).pop() || meta.name || 'skill';
    const safeFolder = folder.replace(/[^A-Za-z0-9._-]+/g, '-') || 'skill';
    return {
      name: (meta.name || folder).slice(0, 80),
      description: meta.description ? meta.description.slice(0, 300) : null,
      files: paths
        .filter((path) => path.startsWith(dir))
        .map((path) => ({ path: `${safeFolder}/${path.slice(dir.length)}`, data: entries[path] })),
    };
  });
  if (roots.length > MAX_SKILLS_PER_ZIP) {
    skipped.push(`${roots.length - MAX_SKILLS_PER_ZIP} skills beyond the first ${MAX_SKILLS_PER_ZIP}`);
  }

  const inSkill = (path) => roots.some((dir) => path.startsWith(dir));
  const connectors = [];
  const seenUrls = new Set();
  const configPaths = paths
    .filter((path) => !inSkill(path) && /(^|\/)(\.mcp\.json|\.claude-plugin\/plugin\.json)$/.test(path))
    .sort((a, b) => a.length - b.length);
  for (const path of configPaths) {
    let json;
    try {
      json = JSON.parse(strFromU8(entries[path]));
    } catch {
      skipped.push(`${path} is not valid JSON`);
      continue;
    }
    // A plugin manifest may declare its connectors inline; without any there is nothing to read.
    const isManifest = path.endsWith('plugin.json');
    if (isManifest && (!json?.mcpServers || typeof json.mcpServers !== 'object')) continue;
    for (const connector of connectorsFromMcpConfig(isManifest ? json.mcpServers : json, skipped)) {
      if (seenUrls.has(connector.url)) continue;
      seenUrls.add(connector.url);
      connectors.push(connector);
    }
  }

  const count = (pattern) => paths.filter((path) => !inSkill(path) && pattern.test(path)).length;
  const commands = count(/(^|\/)commands\/[^/]+\.md$/);
  const agents = count(/(^|\/)agents\/[^/]+\.md$/);
  const hooks = count(/(^|\/)hooks\/[^/]+$/);
  if (commands) skipped.push(`${commands} slash command${commands > 1 ? 's' : ''} (Claude Code only)`);
  if (agents) skipped.push(`${agents} subagent${agents > 1 ? 's' : ''} (Claude Code only)`);
  if (hooks) skipped.push('Hooks (Claude Code only)');

  return { skills, connectors, skipped };
}

// ── Installing ────────────────────────────────────────────────────────────────────────

function mimeFor(path) {
  if (path.endsWith('.md')) return 'text/markdown';
  if (path.endsWith('.py')) return 'text/x-python';
  if (path.endsWith('.json')) return 'application/json';
  if (/\.(txt|sh|js|ts|yaml|yml|csv|html|css)$/.test(path)) return 'text/plain';
  return 'application/octet-stream';
}

async function uploadSkill(client, skill) {
  const files = await Promise.all(
    skill.files.map((file) => toFile(Buffer.from(file.data), file.path, { type: mimeFor(file.path) })),
  );
  try {
    return await client.skills.create({ files });
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      throw httpError(400, `Skill "${skill.name}" was rejected: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Install everything usable from an uploaded .zip (a single skill or a whole plugin).
 * @returns {{ installed: object[], skipped: string[] }}
 */
export async function installBundle({ adminId, role, scope, base64 }) {
  assertScope(scope, role);
  const data = String(base64 || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (!data || !/^[A-Za-z0-9+/]+=*$/.test(data)) throw httpError(400, 'Choose a .zip file');
  const bundle = readBundle(new Uint8Array(Buffer.from(data, 'base64')));
  if (!bundle.skills.length && !bundle.connectors.length) {
    throw httpError(400, 'No skill (a folder with SKILL.md) or remote connector was found in that archive');
  }

  const installed = [];
  const skipped = [...bundle.skipped];

  if (bundle.skills.length) {
    const { client, fingerprint } = await requireAnthropic(adminId);
    for (const skill of bundle.skills) {
      try {
        const created = await uploadSkill(client, skill);
        const row = await createAddon({
          scope,
          adminId,
          kind: 'skill',
          name: skill.name,
          config: { skill_id: created.id, description: skill.description, key_fingerprint: fingerprint },
        });
        installed.push(publicAddon(row, fingerprint));
      } catch (error) {
        if (!error.status || error.status >= 500) logError('assistant.addons.skill', error, {});
        skipped.push(error.status === 400 ? error.message : `Skill "${skill.name}" could not be uploaded`);
      }
    }
  }

  for (const connector of bundle.connectors) {
    try {
      const row = await addConnector({ adminId, role, scope, name: connector.name, url: connector.url, token: connector.token });
      installed.push(publicAddon(row, null));
    } catch (error) {
      skipped.push(`Connector "${connector.name}": ${error.message}`);
    }
  }

  if (!installed.length) {
    throw httpError(400, skipped[0] || 'Nothing in that archive could be installed');
  }
  return { installed, skipped };
}

export async function removeAddon({ adminId, role, id }) {
  const row = await getAddon(id);
  if (!row) throw httpError(404, 'Add-on not found');
  const mine = row.scope === 'user' && row.admin_id === adminId;
  if (!mine && !(row.scope === 'agency' && role === 'admin')) {
    throw httpError(403, 'You cannot remove this add-on');
  }
  if (row.kind === 'skill' && row.config?.skill_id) {
    // Best effort: also remove it from Anthropic when the same key is still in use.
    try {
      const { client, fingerprint } = await requireAnthropic(adminId);
      if (fingerprint === row.config.key_fingerprint) await client.skills.delete(row.config.skill_id);
    } catch (error) {
      logError('assistant.addons.skill_delete', error, { addon_id: id });
    }
  }
  await deleteAddon(id);
}
