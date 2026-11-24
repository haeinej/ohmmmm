import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { initCortex, LOCK, openCortex } from '../src/folder.mjs';

// Writes from the bridge and from the cortex MCP server, two processes on one folder, never land
// between each other's version check and write. Every person here is invented.
const template = fileURLToPath(new URL('../template', import.meta.url));
const folder = fileURLToPath(new URL('../src/folder.mjs', import.meta.url));
const fresh = async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'cortex-')), 'cortex');
  await initCortex(dir, template);
  return dir;
};
const refused = code => problem => problem.code === code;
const tmpFiles = async dir => (await readdir(dir, { recursive: true })).filter(name => name.endsWith('.tmp'));

test('two writers rewriting one observation from the same version: one is kept, the other is told it changed', async () => {
  const dir = await fresh();
  const bridge = openCortex(dir, { actor: 'member' });
  const mcp = openCortex(dir, { actor: 'member' });
  const made = await bridge.observe({ id: 'walks-early', text: 'Maya walks before work.' });
  const tries = await Promise.allSettled(Array.from({ length: 8 }, (_, n) => (n % 2 ? bridge : mcp).observe({ id: 'walks-early', text: `Maya walks at ${n}.`, replaces: made.version })));
  assert.equal(tries.filter(each => each.status === 'fulfilled').length, 1);
  assert.ok(tries.filter(each => each.status === 'rejected').every(each => each.reason.code === 'Changed'));
  // Every change line has its own seq, and the history holds each version replaced.
  const lines = (await readFile(join(dir, '.cortex', 'journal.jsonl'), 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert.equal(new Set(lines.map(line => line.seq)).size, lines.length);
  assert.equal(lines.filter(line => line.node === 'observation/walks-early').length, 2);
  assert.deepEqual(await tmpFiles(dir), []);
});

test('many writes at once from one process each land whole, with no temporary file left', async () => {
  const dir = await fresh();
  const cortex = openCortex(dir, { actor: 'member' });
  await Promise.all(Array.from({ length: 10 }, (_, n) => cortex.observe({ id: `seen-${n}`, text: `Jun reads on the train, day ${n}.` })));
  assert.equal((await cortex.observations()).observations.length, 10);
  const seqs = (await cortex.history({ limit: 100 })).changes.map(line => line.seq);
  assert.equal(new Set(seqs).size, seqs.length);
  assert.deepEqual(await tmpFiles(dir), []);
});

test('a write waits while another process holds the lock, and a lock left by a process that has gone is taken', async () => {
  const dir = await fresh();
  const other = spawn(process.execPath, ['--input-type=module', '-e', `
    const { withCortexLock } = await import(${JSON.stringify(folder)});
    await withCortexLock(${JSON.stringify(dir)}, async () => { console.log('held'); await new Promise(done => setTimeout(done, 400)); });
  `], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(done => other.stdout.once('data', done));
  let released = false;
  other.on('exit', () => { released = true; });
  await openCortex(dir, { actor: 'member' }).observe({ id: 'tea', text: 'Aiko drinks tea in the afternoon.' });
  assert.equal(released, true, 'the write waited for the other process');

  // A lock naming a process that is not running is not waited for.
  const dead = spawn(process.execPath, ['-e', '']);
  await new Promise(done => dead.on('exit', done));
  await writeFile(join(dir, LOCK), `${dead.pid} left-behind\n`);
  const started = Date.now();
  await openCortex(dir, { actor: 'member' }).observe({ id: 'coffee', text: 'Aiko drinks coffee in the morning.' });
  assert.ok(Date.now() - started < 5000);
});

test('creating an observation that says it is new, and retrying it, answers unchanged; different words are refused', async () => {
  const dir = await fresh();
  const person = openCortex(dir, { actor: 'member' });
  const made = await person.observe({ id: 'reads-late', text: 'Sol reads late at night.', replaces: null });
  const again = await person.observe({ id: 'reads-late', text: 'Sol reads late at night.', replaces: null });
  assert.deepEqual(again, { id: 'reads-late', version: made.version, unchanged: true });
  await assert.rejects(person.observe({ id: 'reads-late', text: 'Sol reads early.', replaces: null }), refused('Changed'));
  assert.equal((await person.history({ node: 'observation/reads-late' })).changes.length, 1);
});
