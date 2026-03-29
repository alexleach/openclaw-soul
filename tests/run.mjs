#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, '..', 'scripts', 'soul.mjs');

async function mktemp() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-soul-test-'));
}

function runCli(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

async function writeText(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, value, 'utf8');
}

async function setupWorkspace({ state, cache, soul } = {}) {
  const dir = await mktemp();
  if (state) await writeJson(path.join(dir, 'soul-data', 'state.json'), state);
  if (cache) await writeJson(path.join(dir, 'soul-data', 'cache', 'agents.json'), cache);
  if (typeof soul === 'string') await writeText(path.join(dir, 'SOUL.md'), soul);
  return dir;
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err?.stack || String(err));
    process.exitCode = 1;
  }
}

const validCatalog = {
  agents: [
    {
      id: 'pirate',
      category: 'fun',
      name: 'Pirate',
      role: 'Talks like a pirate',
      path: 'agents/pirate/SOUL.md'
    }
  ]
};

await test('help output includes refresh', async () => {
  const cwd = await setupWorkspace();
  const result = await runCli([], { cwd });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /soul refresh/);
});

await test('refresh fails on invalid cached catalog shape', async () => {
  const cwd = await setupWorkspace({
    state: {
      catalogUrl: 'https://raw.githubusercontent.com/mergisi/awesome-openclaw-agents/refs/heads/main/agents.json'
    },
    cache: { agents: 'broken' }
  });
  const result = await runCli(['categories'], { cwd });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Catalog must contain an agents array/);
});

await test('categories works from valid cache', async () => {
  const cwd = await setupWorkspace({
    state: {
      catalogUrl: 'https://raw.githubusercontent.com/mergisi/awesome-openclaw-agents/refs/heads/main/agents.json'
    },
    cache: validCatalog
  });
  const result = await runCli(['categories'], { cwd });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /- fun \(1\)/);
});

await test('show prints useful metadata', async () => {
  const cwd = await setupWorkspace({
    state: {
      catalogUrl: 'https://raw.githubusercontent.com/mergisi/awesome-openclaw-agents/refs/heads/main/agents.json'
    },
    cache: validCatalog
  });
  const result = await runCli(['show', 'pirate'], { cwd });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /id: pirate/);
  assert.match(result.stdout, /category: fun/);
  assert.match(result.stdout, /source: https:\/\/raw\.githubusercontent\.com\//);
});

await test('current defaults to builtin soul', async () => {
  const cwd = await setupWorkspace();
  const result = await runCli(['current'], { cwd });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /id: openclaw-default/);
  assert.match(result.stdout, /category: builtin/);
});

await test('restore fails cleanly when no backup exists', async () => {
  const cwd = await setupWorkspace();
  const result = await runCli(['restore'], { cwd });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /No backup found/);
});

await test('restore restores latest backup and stores checksum', async () => {
  const cwd = await setupWorkspace({
    state: {
      catalogUrl: 'https://raw.githubusercontent.com/mergisi/awesome-openclaw-agents/refs/heads/main/agents.json'
    },
    soul: '# Current\n\nOld soul\n'
  });
  const backupPath = path.join(cwd, 'soul-data', 'backups', 'SOUL-1.md');
  await writeText(backupPath, '# Restored\n\nBacked up soul\n');
  const result = await runCli(['restore'], { cwd });
  assert.equal(result.code, 0);
  const restored = await fs.readFile(path.join(cwd, 'SOUL.md'), 'utf8');
  assert.match(restored, /# Restored/);
  assert.match(result.stdout, /Restored SOUL\.md from backup/);
  const state = JSON.parse(await fs.readFile(path.join(cwd, 'soul-data', 'state.json'), 'utf8'));
  assert.equal(state.current.custom, true);
  assert.equal(state.current.id, 'custom');
  assert.equal(state.current.checksum, crypto.createHash('sha1').update(restored, 'utf8').digest('hex'));
});

await test('show returns a simple not-found message for unknown id', async () => {
  const cwd = await setupWorkspace({
    state: {
      catalogUrl: 'https://raw.githubusercontent.com/mergisi/awesome-openclaw-agents/refs/heads/main/agents.json'
    },
    cache: validCatalog
  });
  const result = await runCli(['show', 'pirat'], { cwd });
  assert.equal(result.code, 0);
  assert.equal(result.stdout.trim(), 'Soul not found: pirat');
});

await test('list returns a simple not-found message for unknown category', async () => {
  const cwd = await setupWorkspace({
    state: {
      catalogUrl: 'https://raw.githubusercontent.com/mergisi/awesome-openclaw-agents/refs/heads/main/agents.json'
    },
    cache: validCatalog
  });
  const result = await runCli(['list', 'fuun'], { cwd });
  assert.equal(result.code, 0);
  assert.equal(result.stdout.trim(), 'No souls found for category: fuun');
});

await test('apply accepts a relative path entry', async () => {
  const cwd = await setupWorkspace({
    state: {
      catalogUrl: 'https://raw.githubusercontent.com/mergisi/awesome-openclaw-agents/refs/heads/main/agents.json'
    },
    cache: { agents: [{ id: 'oops', category: 'fun', path: './local/SOUL.md' }] },
    soul: '# Existing\n'
  });
  await writeText(path.join(cwd, 'local', 'SOUL.md'), '# Local\n\nLocal soul\n');
  const result = await runCli(['apply', 'oops'], { cwd });
  assert.equal(result.code, 0);
  const current = await fs.readFile(path.join(cwd, 'SOUL.md'), 'utf8');
  assert.match(current, /# Local/);
  const state = JSON.parse(await fs.readFile(path.join(cwd, 'soul-data', 'state.json'), 'utf8'));
  assert.equal(state.current.checksum, crypto.createHash('sha1').update(current, 'utf8').digest('hex'));
  assert.equal(state.current.custom, false);
});

await test('rejects local paths outside workspace', async () => {
  const cwd = await setupWorkspace({
    state: {
      catalogUrl: 'https://raw.githubusercontent.com/mergisi/awesome-openclaw-agents/refs/heads/main/agents.json'
    },
    cache: { agents: [{ id: 'oops', category: 'fun', path: '../evil/SOUL.md' }] },
    soul: '# Existing\n'
  });
  const result = await runCli(['apply', 'oops'], { cwd });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /escapes workspace/);
});

await test('manual edit is detected as custom', async () => {
  const cwd = await setupWorkspace({
    state: {
      catalogUrl: 'https://raw.githubusercontent.com/mergisi/awesome-openclaw-agents/refs/heads/main/agents.json'
    },
    soul: '# Existing\n'
  });
  const state = JSON.parse(await fs.readFile(path.join(cwd, 'soul-data', 'state.json'), 'utf8'));
  state.current = {
    id: 'orion',
    category: 'curated',
    sourceUrl: 'https://example.invalid/orion/SOUL.md',
    appliedAt: '2026-03-29T00:00:00.000Z',
    checksum: crypto.createHash('sha1').update('# Original\n', 'utf8').digest('hex'),
    custom: false
  };
  await writeJson(path.join(cwd, 'soul-data', 'state.json'), state);
  await writeText(path.join(cwd, 'SOUL.md'), '# Edited\n');
  const result = await runCli(['current'], { cwd });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /custom, from https:\/\/example\.invalid\/orion\/SOUL\.md \(modified\)/);
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
