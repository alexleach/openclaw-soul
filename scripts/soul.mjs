#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_CATALOG_URL = 'https://raw.githubusercontent.com/mergisi/awesome-openclaw-agents/refs/heads/main/agents.json';
const DEFAULT_RAW_ROOT = 'https://raw.githubusercontent.com/mergisi/awesome-openclaw-agents/refs/heads/main/';

const cwd = process.cwd();
const workspaceDir = cwd;
const soulFile = path.join(workspaceDir, 'SOUL.md');
const dataDir = path.join(workspaceDir, 'soul-data');
const cacheDir = path.join(dataDir, 'cache');
const backupDir = path.join(dataDir, 'backups');
const stateFile = path.join(dataDir, 'state.json');
const cacheFile = path.join(cacheDir, 'agents.json');

const args = process.argv.slice(2);
const subcommand = (args[0] || '').trim();

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

async function writeJson(file, value) {
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'openclaw-soul/0.1.0',
      'accept': 'application/json, text/plain;q=0.9, */*;q=0.8'
    }
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText} for ${url}`);
  return await res.text();
}

async function loadState() {
  return await readJson(stateFile, {
    catalogUrl: DEFAULT_CATALOG_URL,
    rawRoot: DEFAULT_RAW_ROOT,
    lastFetchedAt: null,
    current: null,
    backups: []
  });
}

async function saveState(state) {
  await writeJson(stateFile, state);
}

async function loadCatalog(force = false) {
  const state = await loadState();
  if (!force) {
    const cached = await readJson(cacheFile, null);
    if (cached?.agents?.length) return { catalog: cached, state, source: 'cache' };
  }
  const text = await fetchText(state.catalogUrl || DEFAULT_CATALOG_URL);
  const catalog = JSON.parse(text);
  await writeJson(cacheFile, catalog);
  state.lastFetchedAt = new Date().toISOString();
  await saveState(state);
  return { catalog, state, source: 'remote' };
}

function byCategory(catalog) {
  const m = new Map();
  for (const agent of catalog.agents || []) {
    const cat = agent.category || 'uncategorized';
    const list = m.get(cat) || [];
    list.push(agent);
    m.set(cat, list);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function findAgent(catalog, id) {
  const needle = id.toLowerCase();
  return (catalog.agents || []).find(a =>
    (a.id || '').toLowerCase() === needle ||
    (a.name || '').toLowerCase() === needle
  );
}

function searchAgents(catalog, text) {
  const needle = text.toLowerCase();
  return (catalog.agents || []).filter(a =>
    [a.id, a.name, a.category, a.role].filter(Boolean).some(v => String(v).toLowerCase().includes(needle))
  );
}

function buildRawSoulUrl(state, agent) {
  const rawRoot = state.rawRoot || DEFAULT_RAW_ROOT;
  const relPath = agent.path || '';
  return new URL(relPath, rawRoot).toString();
}

async function backupCurrentSoul(state) {
  try {
    const current = await fs.readFile(soulFile, 'utf8');
    const timestamp = new Date().toISOString().replaceAll(':', '-');
    const backupPath = path.join(backupDir, `SOUL-${timestamp}.md`);
    await fs.writeFile(backupPath, current, 'utf8');
    state.backups = state.backups || [];
    state.backups.unshift({ path: backupPath, createdAt: new Date().toISOString() });
    state.backups = state.backups.slice(0, 20);
    return backupPath;
  } catch {
    return null;
  }
}

async function showHelp() {
  const state = await loadState();
  const current = state.current?.id ? `${state.current.id} (${state.current.category || 'unknown'})` : 'none recorded';
  console.log(`Current soul: ${current}\n\nCommands:\n  soul categories\n  soul list <category>\n  soul show <id>\n  soul apply <id>\n  soul current\n  soul restore\n  soul search <text>`);
}

async function main() {
  await ensureDirs();

  if (!subcommand) {
    await showHelp();
    return;
  }

  if (subcommand === 'current') {
    const state = await loadState();
    if (!state.current) {
      console.log('No recorded applied soul yet.');
      return;
    }
    console.log(`Current soul:\n- id: ${state.current.id}\n- category: ${state.current.category}\n- source: ${state.current.sourceUrl}\n- appliedAt: ${state.current.appliedAt}`);
    return;
  }

  if (subcommand === 'restore') {
    const state = await loadState();
    const latest = state.backups?.[0];
    if (!latest) {
      console.log('No backup found in soul-data/backups/.');
      return;
    }
    const content = await fs.readFile(latest.path, 'utf8');
    await fs.writeFile(soulFile, content, 'utf8');
    state.current = {
      id: 'restored-from-backup',
      category: 'local',
      sourceUrl: latest.path,
      appliedAt: new Date().toISOString()
    };
    await saveState(state);
    console.log(`Restored SOUL.md from backup:\n- ${latest.path}\n\nStart a new session or use /new to fully apply the restored soul.`);
    return;
  }

  const { catalog, state } = await loadCatalog(false);

  if (subcommand === 'categories') {
    for (const [category, list] of byCategory(catalog)) {
      console.log(`- ${category} (${list.length})`);
    }
    return;
  }

  if (subcommand === 'list') {
    const category = (args[1] || '').trim().toLowerCase();
    if (!category) {
      console.log('Usage: soul list <category>\n\nTip: run `soul categories` first.');
      return;
    }
    const matches = (catalog.agents || []).filter(a => (a.category || '').toLowerCase() === category);
    if (!matches.length) {
      console.log(`No souls found for category: ${category}`);
      return;
    }
    for (const a of matches) {
      const summary = a.role || a.name || a.id;
      console.log(`- ${a.id} — ${summary}`);
    }
    return;
  }

  if (subcommand === 'search') {
    const text = args.slice(1).join(' ').trim();
    if (!text) {
      console.log('Usage: soul search <text>');
      return;
    }
    const matches = searchAgents(catalog, text).slice(0, 40);
    if (!matches.length) {
      console.log(`No souls found matching: ${text}`);
      return;
    }
    for (const a of matches) {
      console.log(`- ${a.id} [${a.category}]${a.role ? ` — ${a.role}` : ''}`);
    }
    return;
  }

  if (subcommand === 'show') {
    const id = (args[1] || '').trim();
    if (!id) {
      console.log('Usage: soul show <id>');
      return;
    }
    const agent = findAgent(catalog, id);
    if (!agent) {
      console.log(`Soul not found: ${id}`);
      return;
    }
    const sourceUrl = buildRawSoulUrl(state, agent);
    console.log(`Soul:\n- id: ${agent.id}\n- category: ${agent.category}\n- name: ${agent.name}\n- role: ${agent.role || '(none)'}\n- source: ${sourceUrl}`);
    return;
  }

  if (subcommand === 'apply') {
    const id = (args[1] || '').trim();
    if (!id) {
      console.log('Usage: soul apply <id>');
      return;
    }
    const agent = findAgent(catalog, id);
    if (!agent) {
      console.log(`Soul not found: ${id}`);
      return;
    }
    const sourceUrl = buildRawSoulUrl(state, agent);
    const backupPath = await backupCurrentSoul(state);
    const content = await fetchText(sourceUrl);
    await fs.writeFile(soulFile, content, 'utf8');
    state.current = {
      id: agent.id,
      category: agent.category,
      name: agent.name,
      role: agent.role || null,
      sourceUrl,
      appliedAt: new Date().toISOString()
    };
    await saveState(state);
    console.log(`Applied soul:\n- id: ${agent.id}\n- category: ${agent.category}\n- source: ${sourceUrl}${backupPath ? `\n- backup: ${backupPath}` : ''}\n\nStart a new session or use /new to fully apply the new soul.`);
    return;
  }

  console.log(`Unknown subcommand: ${subcommand}\n\nRun: soul`);
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
