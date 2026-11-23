import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { initCortex, openCortex } from '../src/folder.mjs';
import { createTools } from '../src/tools.mjs';
import { checkVault, folderVault } from '../src/vault.mjs';

// Every person and block here is invented.
const template = fileURLToPath(new URL('../template', import.meta.url));
const cli = fileURLToPath(new URL('../bin/cortex.mjs', import.meta.url));
const refused = code => problem => problem.code === code;
const writeBlock = async (root, path, { id, title, body = '' }) => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), `---\n${id ? `id: ${id}\n` : ''}${title ? `title: ${title}\n` : ''}---\n${body}`);
};
async function setup() {
  const base = await mkdtemp(join(tmpdir(), 'cortex-vault-'));
  const vault = join(base, 'vault');
  await writeBlock(vault, 'essays/on-maps.md', { id: 'p1', title: 'On maps', body: 'I moved to Lisbon last spring and started drawing maps.' });
  await writeBlock(vault, 'essays/on-rivers.md', { id: 'p2', title: 'On rivers' });
  await writeBlock(vault, 'notes/reading/atlas.md', { id: 'p3', title: 'Reading: an atlas' });
  const dir = join(base, 'cortex');
  await initCortex(dir, template);
  const person = openCortex(dir, { actor: 'member' });
  await person.connectVault({ kind: 'folder', path: vault });
  return { vault, dir, person, agent: openCortex(dir, { actor: 'claude-code' }) };
}

test('a folder vault answers the contract', async () => {
  const { vault } = await setup();
  await writeBlock(vault, 'loose.md', { title: 'A loose note' });
  const folder = folderVault(vault);
  assert.equal(checkVault(folder), folder);
  assert.throws(() => checkVault({ shape() {} }), refused('InvalidVault'));
  assert.deepEqual(await folder.shape(), { blocks: 4, channels: [{ channel: 'essays', blocks: 2 }, { channel: 'notes', blocks: 1 }, { channel: 'notes/reading', blocks: 1 }, { channel: 'other', blocks: 1 }] });
  assert.deepEqual(await folder.read('p3'), { id: 'p3', title: 'Reading: an atlas', channel: 'notes/reading', body: '' });
  assert.equal((await folder.read('path:loose.md')).channel, 'other');
  assert.deepEqual(await folder.exists(['p9', 'p1', 'p9']), { p9: { exists: false }, p1: { exists: true, title: 'On maps', channel: 'essays' } });

  const { changes: none, cursor } = await folder.changes(null);
  assert.deepEqual(none, []);
  await rename(join(vault, 'essays/on-rivers.md'), join(vault, 'notes/on-rivers.md'));
  await rm(join(vault, 'notes/reading/atlas.md'));
  await writeBlock(vault, 'essays/on-maps.md', { id: 'p1', title: 'On maps', body: 'Edited.' });
  await writeBlock(vault, 'essays/on-tides.md', { id: 'p4', title: 'On tides' });
  const { changes } = await folder.changes(cursor);
  assert.deepEqual(changes.map(change => [change.type, change.id, change.from]).sort(), [['moved', 'p2', 'essays'], ['removed', 'p3', undefined], ['saved', 'p1', undefined], ['saved', 'p4', undefined]].sort());
  await assert.rejects(folderVault(join(vault, 'missing')).shape(), refused('VaultUnreachable'));
});

test('connecting a vault reads its channels, and writes nothing about them', async () => {
  const { dir, person, agent } = await setup();
  const start = await agent.start();
  assert.deepEqual(start.vault.channels, [{ channel: 'essays', blocks: 2 }, { channel: 'notes', blocks: 1 }, { channel: 'notes/reading', blocks: 1 }]);
  assert.deepEqual(start.observations, [], 'a channel with nothing said about it is not something to act on');
  await assert.rejects(readFile(join(dir, 'vault.md'), 'utf8'), /ENOENT/);
  // What a channel is for is an observation about it, counted on the channel.
  await person.observe({ id: 'essays-are-finished', text: 'Finished long-form writing, one idea each.', about: ['channel:essays'] });
  assert.equal((await agent.start()).vault.channels.find(item => item.channel === 'essays').observations, 1);
});

test('an observation is only about blocks and channels the vault has', async () => {
  const { agent } = await setup();
  await agent.observe({ id: 'maps-and-rivers', text: 'The map essay and the river essay are about the same walk.', about: ['p1', 'p2', 'channel:essays'] });
  await assert.rejects(agent.observe({ id: 'nothing', text: 'x', about: ['p9'] }), refused('NotFound'));
  await assert.rejects(agent.observe({ id: 'nowhere', text: 'x', about: ['channel:poems'] }), refused('NotFound'));
  await assert.rejects(agent.observe({ id: 'twice', text: 'x', about: ['p1', 'p1'] }), refused('InvalidRequest'));
  assert.deepEqual((await agent.observations({ about: 'p2' })).observations.map(item => item.id), ['maps-and-rivers']);
});

test('removing or moving a block flags the observations about it, once', async () => {
  const { vault, agent, person } = await setup();
  await person.observe({ id: 'map-essay', text: 'Their essay on maps is the one they reread.', about: ['p1'] });
  await agent.observe({ id: 'river-essay', text: 'The river essay is unfinished.', about: ['p2'] });
  assert.equal((await agent.start()).vault.broken, undefined);

  await rm(join(vault, 'essays/on-maps.md'));
  await rename(join(vault, 'essays/on-rivers.md'), join(vault, 'notes/on-rivers.md'));
  const start = await agent.start();
  assert.deepEqual(start.vault.broken, [{ observation: 'map-essay', block: 'p1' }]);
  const reported = start.observations.filter(item => item.by === 'vault').map(item => item.text);
  assert.ok(reported.includes('Block "On maps" (p1) was removed from essays. These observations were about it: map-essay'));
  assert.ok(reported.includes('Block "On rivers" (p2) moved from essays to notes. These observations are about it: river-essay'));
  assert.equal((await person.syncVault()).changes, 0, 'a change is reported once');
  // What the vault wrote, an agent may clear once it has acted on it.
  const note = start.observations.find(item => item.by === 'vault');
  assert.equal((await agent.removeObservation(note.id, { replaces: note.version })).removed, true);
});

test('the person connects a vault from the command line', async () => {
  const base = await mkdtemp(join(tmpdir(), 'cortex-cli-'));
  await writeBlock(join(base, 'vault'), 'essays/one.md', { id: 'p1', title: 'One' });
  const dir = join(base, 'cortex');
  execFileSync('node', [cli, 'init', dir]);
  assert.throws(() => execFileSync('node', [cli, 'vault', dir], { stdio: 'pipe' }), 'no vault is connected yet');
  assert.match(execFileSync('node', [cli, 'vault', 'connect', join(base, 'vault'), dir], { encoding: 'utf8' }), /1 channel$/m);
  assert.deepEqual(JSON.parse(execFileSync('node', [cli, 'vault', 'sync', dir], { encoding: 'utf8' })).channels, [{ channel: 'essays', blocks: 1 }]);
});

test('a damaged cursor is started again, and the machine-local files stay out of git', async () => {
  const { dir, agent } = await setup();
  await writeFile(join(dir, '.cortex', 'vault-cursor.json'), '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> theirs\n');
  assert.equal((await agent.start()).vault.connected, true);
  assert.doesNotThrow(() => JSON.parse(readFileSync(join(dir, '.cortex', 'vault-cursor.json'), 'utf8')));
  await writeFile(join(dir, '.cortex', 'vault.json'), 'not json');
  const start = await openCortex(dir).start();
  assert.equal(start.vault.reachable, false);
  assert.match(start.problems.join(), /vault\.json cannot be read/);
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  assert.doesNotMatch(git('ls-files'), /vault\.json|vault-cursor\.json/);
});

test('two blocks with one ID: the first stands and the clash is reported', async () => {
  const { vault, agent } = await setup();
  await writeBlock(vault, 'notes/copy.md', { id: 'p1', title: 'A copy' });
  const start = await agent.start();
  assert.ok(start.problems.some(problem => /essays\/on-maps\.md and notes\/copy\.md have the same id, p1/.test(problem)), start.problems.join('\n'));
});

test('one session start reads the vault a fixed number of times, however many observations point into it', async () => {
  const { dir, vault, person } = await setup();
  for (const id of ['ref-a', 'ref-b', 'ref-c', 'ref-d', 'ref-e', 'ref-f']) await person.observe({ id, text: 'x', about: ['p1', 'p2'] });
  const real = folderVault(vault);
  let calls = 0;
  const counted = Object.fromEntries(Object.entries(real).map(([key, value]) => [key, typeof value === 'function' ? (...args) => { calls += 1; return value(...args); } : value]));
  await openCortex(dir, { vault: counted }).start();
  assert.equal(calls, 3);
});
