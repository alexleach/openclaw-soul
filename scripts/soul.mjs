#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_CATALOG_URL = 'https://raw.githubusercontent.com/mergisi/awesome-openclaw-agents/refs/heads/main/agents.json';
const DEFAULT_RAW_ROOT = 'https://raw.githubusercontent.com/mergisi/awesome-openclaw-agents/refs/heads/main/';
const USER_AGENT = 'openclaw-soul/0.1.0';
const FETCH_TIMEOUT_MS = 15000;

const workspaceDir = process.cwd();
const soulFile = path.join(workspaceDir, 'SOUL.md');
const dataDir = path.join(workspaceDir, 'soul-data');
const cacheDir = path.join(dataDir, 'cache');
const backupDir = path.join(dataDir, 'backups');
const stateFile = path.join(dataDir, 'state.json');
const cacheFile = path.join(cacheDir, 'agents.json');

const [subcommand = '', ...rest] = process.argv.slice(2).map(arg => arg.trim());
const stateDefaults = {
  catalogUrl: DEFAULT_CATALOG_URL,
  rawRoot: DEFAULT_RAW_ROOT,
  lastFetchedAt: null,
  current: null,
  backups: []
};

async function ensureDirs() {
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.mkdir(backupDir, { recursive: true });
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeAtomic(file, content) {
  const dir = path.dirname(file);
  const base = path.basename(file);
  const temp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(temp, content, 'utf8');
  await fs.rename(temp, file);
}

async function writeJson(file, value) {
  await writeAtomic(file, JSON.stringify(value, null, 2) + '\n');
}

function parseTrustedUrl(url, label) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid ${label}: ${url}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`${label} must use https: ${url}`);
  }
  if (parsed.hostname !== 'raw.githubusercontent.com') {
    throw new Error(`${label} must use raw.githubusercontent.com: ${url}`);
  }
  return parsed;
}

function normalizeRelativeSoulPath(relPath) {
  if (typeof relPath !== 'string' || !relPath.trim()) {
    throw new Error('Catalog agent path must be a non-empty string.');
  }
  const trimmed = relPath.trim();
  if (trimmed.startsWith('/') || trimmed.startsWith('\\')) {
    throw new Error(`Catalog agent path must be relative: ${relPath}`);
  }
  const parts = trimmed.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Catalog agent path contains invalid segments: ${relPath}`);
  }
  if (parts[parts.length - 1] !== 'SOUL.md') {
    throw new Error(`Catalog agent path must point to SOUL.md: ${relPath}`);
  }
  return parts.join('/');
}

function validateCatalog(catalog) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    throw new Error('Catalog must be a JSON object.');
  }
  if (!Array.isArray(catalog.agents)) {
    throw new Error('Catalog must contain an agents array.');
  }

  const ids = new Set();
  const agents = catalog.agents.map((agent, index) => {
    if (!agent || typeof agent !== 'object' || Array.isArray(agent)) {
      throw new Error(`Catalog agent at index ${index} must be an object.`);
    }
    const id = typeof agent.id === 'string' ? agent.id.trim() : '';
    const category = typeof agent.category === 'string' ? agent.category.trim() : '';
    const relPath = normalizeRelativeSoulPath(agent.path);
    if (!id) throw new Error(`Catalog agent at index ${index} is missing id.`);
    if (!category) throw new Error(`Catalog agent ${id} is missing category.`);
    const lowerId = id.toLowerCase();
    if (ids.has(lowerId)) throw new Error(`Duplicate catalog agent id: ${id}`);
    ids.add(lowerId);
    return {
      ...agent,
      id,
      category,
      path: relPath,
      name: typeof agent.name === 'string' ? agent.name.trim() : '',
      role: typeof agent.role === 'string' ? agent.role.trim() : ''
    };
  });

  return { ...catalog, agents };
}

async function fetchText(url) {
  const parsed = parseTrustedUrl(url, 'URL');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(parsed.toString(), {
      headers: {
        'user-agent': USER_AGENT,
        'accept': 'application/json, text/plain;q=0.9, */*;q=0.8'
      },
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText} for ${parsed}`);
    return await res.text();
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`Fetch timed out after ${FETCH_TIMEOUT_MS}ms for ${parsed}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadState() {
  const state = { ...stateDefaults, ...(await readJson(stateFile, stateDefaults)) };
  state.catalogUrl = parseTrustedUrl(state.catalogUrl, 'catalogUrl').toString();
  state.rawRoot = parseTrustedUrl(state.rawRoot, 'rawRoot').toString();
  state.backups = Array.isArray(state.backups) ? state.backups : [];
  return state;
}

async function saveState(state) {
  await writeJson(stateFile, state);
}

async function loadCatalog(force = false) {
  const state = await loadState();
  const cached = !force ? await readJson(cacheFile, null) : null;
  if (cached?.agents?.length) return { catalog: validateCatalog(cached), state, source: 'cache' };

  let parsed;
  try {
    parsed = JSON.parse(await fetchText(state.catalogUrl));
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error('Catalog fetch succeeded, but JSON parsing failed.');
    throw err;
  }

  const catalog = validateCatalog(parsed);
  state.lastFetchedAt = new Date().toISOString();
  await Promise.all([writeJson(cacheFile, catalog), saveState(state)]);
  return { catalog, state, source: 'remote' };
}

function byCategory({ agents = [] }) {
  const map = new Map();
  for (const agent of agents) {
    const category = agent.category || 'uncategorized';
    map.set(category, [...(map.get(category) || []), agent]);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function findAgent({ agents = [] }, id) {
  const needle = id.toLowerCase();
  return agents.find(a => [a.id, a.name].some(v => v?.toLowerCase() === needle));
}

function searchAgents({ agents = [] }, text) {
  const needle = text.toLowerCase();
  return agents.filter(a => [a.id, a.name, a.category, a.role].some(v => v?.toLowerCase().includes(needle)));
}

function buildRawSoulUrl(state, agent) {
  const rawRoot = parseTrustedUrl(state.rawRoot, 'rawRoot');
  const resolved = new URL(normalizeRelativeSoulPath(agent.path || ''), rawRoot);
  if (resolved.hostname !== rawRoot.hostname || !resolved.pathname.startsWith(rawRoot.pathname)) {
    throw new Error(`Resolved soul URL escapes configured rawRoot: ${resolved}`);
  }
  return resolved.toString();
}

function validateSoulContent(content, sourceUrl) {
  const text = typeof content === 'string' ? content.trim() : '';
  if (!text) throw new Error(`Fetched soul content is empty: ${sourceUrl}`);
  if (!(text.startsWith('#') || text.startsWith('---') || text.includes('\n# '))) {
    throw new Error(`Fetched content does not look like a SOUL.md file: ${sourceUrl}`);
  }
  return content;
}

async function backupCurrentSoul(state) {
  try {
    const current = await fs.readFile(soulFile, 'utf8');
    const timestamp = new Date().toISOString().replaceAll(':', '-');
    const backupPath = path.join(backupDir, `SOUL-${timestamp}.md`);
    await writeAtomic(backupPath, current);
    state.backups = state.backups || [];
    state.backups.unshift({ path: backupPath, createdAt: new Date().toISOString() });
    state.backups = state.backups.slice(0, 20);
    return backupPath;
  } catch {
    return null;
  }
}

function print(text) {
  console.log(text);
}

async function showHelp() {
  const { current } = await loadState();
  const active = current?.id ? `${current.id} (${current.category || 'unknown'})` : 'none recorded';
  print(`Current soul: ${active}\n\nCommands:\n  soul categories\n  soul list <category>\n  soul show <id>\n  soul apply <id>\n  soul current\n  soul restore\n  soul refresh\n  soul search <text>`);
}

async function main() {
  await ensureDirs();

  if (!subcommand) return showHelp();

  if (subcommand === 'current') {
    const { current } = await loadState();
    return print(current
      ? `Current soul:\n- id: ${current.id}\n- category: ${current.category}\n- source: ${current.sourceUrl}\n- appliedAt: ${current.appliedAt}`
      : 'No recorded applied soul yet.');
  }

  if (subcommand === 'restore') {
    const state = await loadState();
    const latest = state.backups[0];
    if (!latest) return print('No backup found in soul-data/backups/.');
    const content = validateSoulContent(await fs.readFile(latest.path, 'utf8'), latest.path);
    state.current = {
      id: 'restored-from-backup',
      category: 'local',
      sourceUrl: latest.path,
      appliedAt: new Date().toISOString()
    };
    await Promise.all([writeAtomic(soulFile, content), saveState(state)]);
    return print(`Restored SOUL.md from backup:\n- ${latest.path}\n\nStart a new session or use /new to fully apply the restored soul.`);
  }

  const { catalog, state, source } = await loadCatalog(subcommand === 'refresh');

  if (subcommand === 'refresh') {
    return print(`Catalog refreshed from ${source}:\n- url: ${state.catalogUrl}\n- agents: ${catalog.agents.length}\n- fetchedAt: ${state.lastFetchedAt}`);
  }

  if (subcommand === 'categories') {
    return print(byCategory(catalog).map(([category, list]) => `- ${category} (${list.length})`).join('\n'));
  }

  if (subcommand === 'list') {
    const category = (rest[0] || '').toLowerCase();
    if (!category) return print('Usage: soul list <category>\n\nTip: run `soul categories` first.');
    const matches = catalog.agents.filter(a => a.category.toLowerCase() === category);
    return print(matches.length
      ? matches.map(a => `- ${a.id} — ${a.role || a.name || a.id}`).join('\n')
      : `No souls found for category: ${category}`);
  }

  if (subcommand === 'search') {
    const text = rest.join(' ').trim();
    if (!text) return print('Usage: soul search <text>');
    const matches = searchAgents(catalog, text).slice(0, 40);
    return print(matches.length
      ? matches.map(a => `- ${a.id} [${a.category}]${a.role ? ` — ${a.role}` : ''}`).join('\n')
      : `No souls found matching: ${text}`);
  }

  if (subcommand === 'show') {
    const id = rest[0] || '';
    if (!id) return print('Usage: soul show <id>');
    const agent = findAgent(catalog, id);
    if (!agent) return print(`Soul not found: ${id}`);
    return print(`Soul:\n- id: ${agent.id}\n- category: ${agent.category}\n- name: ${agent.name || '(none)'}\n- role: ${agent.role || '(none)'}\n- source: ${buildRawSoulUrl(state, agent)}`);
  }

  if (subcommand === 'apply') {
    const id = rest[0] || '';
    if (!id) return print('Usage: soul apply <id>');
    const agent = findAgent(catalog, id);
    if (!agent) return print(`Soul not found: ${id}`);
    const sourceUrl = buildRawSoulUrl(state, agent);
    const content = validateSoulContent(await fetchText(sourceUrl), sourceUrl);
    const backupPath = await backupCurrentSoul(state);
    state.current = {
      id: agent.id,
      category: agent.category,
      name: agent.name || null,
      role: agent.role || null,
      sourceUrl,
      appliedAt: new Date().toISOString()
    };
    await Promise.all([writeAtomic(soulFile, content), saveState(state)]);
    return print(`Applied soul:\n- id: ${agent.id}\n- category: ${agent.category}\n- source: ${sourceUrl}${backupPath ? `\n- backup: ${backupPath}` : ''}\n\nStart a new session or use /new to fully apply the new soul.`);
  }

  print(`Unknown subcommand: ${subcommand}\n\nRun: soul`);
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
