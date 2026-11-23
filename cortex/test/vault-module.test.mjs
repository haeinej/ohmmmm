import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { initCortex, openCortex } from '../src/folder.mjs';
import { moduleVault, vaultFrom } from '../src/vault.mjs';

// Every block here is invented. The reader modules are written by each test, so cortex is tested
// against the module kind itself, not against any one vault.
const template = fileURLToPath(new URL('../template', import.meta.url));
const cli = fileURLToPath(new URL('../bin/cortex.mjs', import.meta.url));
const refused = code => problem => problem.code === code;

// A reader module: a vault with two blocks, and a count of how often it was opened.
const READER = `
export let opened = 0;
export function openVault({ path }) {
  opened++;
  const blocks = { b1: { id: 'b1', title: 'On maps', channel: 'essays', body: 'Maps of ' + path }, b2: { id: 'b2', title: 'Atlas', channel: 'notes/reading', body: '' } };
  return {
    async shape() { return { blocks: 2, channels: [{ channel: 'essays', blocks: 1 }, { channel: 'notes', blocks: 1 }, { channel: 'notes/reading', blocks: 1 }] }; },
    async read(id) { return blocks[id] ? { ...blocks[id] } : null; },
    async exists(ids) { return Object.fromEntries(ids.map(id => [id, blocks[id] ? { exists: true, title: blocks[id].title, channel: blocks[id].channel } : { exists: false }])); },
    async changes(cursor) { return { changes: [], cursor: cursor ?? { seen: true } }; },
    async profile() { return []; },
  };
}`;

async function setup() {
  const base = await mkdtemp(join(tmpdir(), 'cortex-module-'));
  await mkdir(join(base, 'vault'));
  const write = async (name, text) => { await writeFile(join(base, name), text); return join(base, name); };
  return { base, vault: join(base, 'vault'), reader: await write('reader.mjs', READER), write };
}

test('a vault of kind module is read through the openVault its file exports, loaded on first use', async () => {
  const { vault, reader } = await setup();
  const opened = vaultFrom({ kind: 'module', module: reader, path: vault });
  assert.equal(opened.kind, 'module');
  const loaded = await import(reader);
  assert.equal(loaded.opened, 0);
  assert.equal((await opened.read('b1')).body, `Maps of ${vault}`);
  assert.deepEqual(await opened.exists(['b2', 'gone']), { b2: { exists: true, title: 'Atlas', channel: 'notes/reading' }, gone: { exists: false } });
  // A reader with no search gives no related blocks, as a vault without search does.
  assert.deepEqual(await opened.search('maps'), []);
  assert.equal(loaded.opened, 1);
});

test('a module that cannot be loaded, opened or checked is refused with a reason', async () => {
  const { vault, base, write } = await setup();
  assert.throws(() => vaultFrom({ kind: 'module', module: 'reader.mjs', path: vault }), refused('InvalidVault'));
  assert.throws(() => vaultFrom({ kind: 'module', module: join(base, 'reader.mjs'), path: 'vault' }), refused('InvalidVault'));
  await assert.rejects(moduleVault({ module: join(base, 'missing.mjs'), path: vault }).shape(), refused('VaultUnreachable'));
  const none = await write('none.mjs', 'export const nothing = 1;');
  await assert.rejects(moduleVault({ module: none, path: vault }).shape(), refused('InvalidVault'));
  const partial = await write('partial.mjs', 'export const openVault = () => ({ shape() {} });');
  await assert.rejects(moduleVault({ module: partial, path: vault }).read('x'), problem => problem.code === 'InvalidVault' && /missing read/.test(problem.message));
});

test('the person connects a vault with its reader, and cortex reads its channels', async () => {
  const { base, vault, reader } = await setup();
  const dir = join(base, 'cortex');
  await initCortex(dir, template);
  const connected = await openCortex(dir, { actor: 'member' }).connectVault({ kind: 'module', module: reader, path: vault });
  assert.deepEqual(JSON.parse(await readFile(join(dir, '.cortex', 'vault.json'), 'utf8')), { kind: 'module', module: reader, path: vault });
  assert.deepEqual(connected.channels.find(item => item.channel === 'essays'), { channel: 'essays', blocks: 1 });
  // From the command line, with --module before or after the folder.
  const other = join(base, 'cortex-cli');
  execFileSync('node', [cli, 'init', other]);
  assert.match(execFileSync('node', [cli, 'vault', 'connect', vault, other, '--module', reader], { encoding: 'utf8' }), new RegExp(`read by ${reader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: 3 channels$`, 'm'));
  assert.equal(JSON.parse(await readFile(join(other, '.cortex', 'vault.json'), 'utf8')).kind, 'module');
  assert.throws(() => execFileSync('node', [cli, 'vault', 'connect', vault, other, '--module'], { stdio: 'pipe' }));
});
