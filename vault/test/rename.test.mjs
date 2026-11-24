// Renaming through ohm (plans/renames.md, step 2): the block or channel takes its new name, and every
// file that used the old one is rewritten, in one journaled change. Files an agent may not write keep
// working through the old name, and are listed. Every note here is invented.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createLocalTools } from '../mcp/local.mjs';
import { blobCid } from '../vault/core.mjs';
import { readEvents } from '../vault/journal.mjs';
import { readProperties, splitFile } from '../vault/file.mjs';
import { readNode } from '../vault/node.mjs';
import { formerNames } from '../vault/names.mjs';
import { applyRename, planRename, readVaultFolder } from '../vault/rename.mjs';

const CLI = fileURLToPath(new URL('../scripts/vault.mjs', import.meta.url));
const RAIN = '3m2zx5u6ifk2a';

const FILES = [
  { path: 'notes/rain.md', text: `---\ntitle: Rain in Seoul\nid: ${RAIN}\n---\n\nAll afternoon. See [[rain]] itself.\n` },
  { path: 'notes/2026/snow.md', text: '---\ntitle: First snow\n---\n\nIt settled.\n' },
  { path: 'writing/_channel.md', text: '---\ntitle: Writing\norder: [essay, rain, notes/2026]\n---\n\nEssays.\n' },
  {
    path: 'writing/essay.md',
    text: '---\ntitle: An essay\nchannels: [notes, notes/2026]\nconnect: [rain]\n---\n\nAfter [[rain|the rain]] and [[Rain in Seoul]] and [[notes/rain.md]].\n\n![[rain]]\n\n![[notes/photo.png]]\n\n```\n[[rain]] stays in code\n```\n\nAnd `[[rain]]` too, and [[notes/2026/snow]].\n',
  },
];
const PATHS = [...FILES.map(file => file.path), 'notes/photo.png'];
const text = (plan, path) => plan.writes.find(write => write.path === path)?.after;
const props = text => readProperties(splitFile(text).head).properties;

test('a channel renamed moves its folder, gets an ID, and every path to it or into it is rewritten', () => {
  const plan = planRename(FILES, { channel: 'notes', to: 'journal' }, { paths: PATHS, newId: () => '3m2zx5u6ifk2b' });
  assert.deepEqual(plan.moves.map(move => `${move.from} → ${move.to}`), [
    'notes/2026/snow.md → journal/2026/snow.md', 'notes/photo.png → journal/photo.png', 'notes/rain.md → journal/rain.md',
  ]);
  assert.deepEqual(plan.folder, { from: 'notes', to: 'journal' });
  assert.equal(plan.id, '3m2zx5u6ifk2b');
  assert.equal(readNode('journal/_channel.md', text(plan, 'journal/_channel.md')).node.id, '3m2zx5u6ifk2b');
  const essay = text(plan, 'writing/essay.md');
  assert.deepEqual(props(essay).channels, ['journal', 'journal/2026']);
  assert.match(essay, /\[\[journal\/rain\.md\]\]/);
  assert.match(essay, /!\[\[journal\/photo\.png\]\]/);
  assert.match(essay, /\[\[journal\/2026\/snow\]\]/);
  assert.match(essay, /\[\[rain\|the rain\]\]/, 'a link by slug is not about the folder');
  assert.deepEqual(props(text(plan, 'writing/_channel.md')).order, ['essay', 'rain', 'journal/2026']);
  assert.deepEqual(plan.renamed.map(each => `${each.from} → ${each.path}`).sort(), ['notes → journal', 'notes/2026 → journal/2026']);

  assert.throws(() => planRename(FILES, { channel: 'notes', to: 'notes/inside' }), /inside itself/);
  assert.throws(() => planRename(FILES, { channel: 'notes', to: 'writing' }), /already a channel/);
  assert.throws(() => planRename(FILES, { channel: 'nowhere', to: 'x' }), /no channel/);
});

test('a block renamed takes its new slug, title or channel, and each link keeps the form it was written in', () => {
  const plan = planRename(FILES, { block: 'notes/rain.md', slug: 'rain-walk', title: 'Rain in Busan', channel: 'writing' }, { paths: PATHS });
  assert.deepEqual(plan.moves, [{ from: 'notes/rain.md', to: 'writing/rain-walk.md' }]);
  const own = readNode('writing/rain-walk.md', text(plan, 'writing/rain-walk.md'));
  assert.deepEqual([own.node.slug, own.node.title, own.node.id], ['rain-walk', 'Rain in Busan', RAIN]);
  assert.match(text(plan, 'writing/rain-walk.md'), /See \[\[rain-walk\]\] itself/);
  const essay = text(plan, 'writing/essay.md');
  assert.match(essay, /\[\[rain-walk\|the rain\]\] and \[\[Rain in Busan\]\] and \[\[writing\/rain-walk\.md\]\]/);
  assert.match(essay, /\n!\[\[rain-walk\]\]\n/);
  assert.deepEqual(props(essay).connect, ['rain-walk']);
  assert.match(essay, /```\n\[\[rain\]\] stays in code\n```/);
  assert.match(essay, /`\[\[rain\]\]` too/);
  assert.match(essay, /!\[\[notes\/photo\.png\]\]/, 'an embedded file is not the block');
  assert.deepEqual(props(text(plan, 'writing/_channel.md')).order, ['essay', 'rain-walk', 'notes/2026']);
  assert.deepEqual(plan.renamed, [{ path: 'writing/rain-walk.md', from: 'Rain in Seoul' }]);

  // Only a title: the file stays, and links by slug are left as they are.
  const titled = planRename(FILES, { block: 'notes/rain.md', title: 'Rain in Busan' }, { paths: PATHS });
  assert.deepEqual(titled.moves, []);
  assert.match(text(titled, 'writing/essay.md'), /\[\[rain\|the rain\]\] and \[\[Rain in Busan\]\]/);

  assert.throws(() => planRename(FILES, { block: 'notes/rain.md', slug: 'snow' }), /Another block has the slug/);
  assert.throws(() => planRename(FILES, { block: 'notes/rain.md', slug: 'Not A Slug' }), /not a slug/);
  assert.throws(() => planRename(FILES, { block: 'notes/rain.md' }), /Say what changes/);
});

async function setUp(t) {
  const vault = await mkdtemp(join(tmpdir(), 'vault-rename-'));
  t.after(() => rm(vault, { recursive: true, force: true }));
  for (const file of FILES) {
    await mkdir(dirname(join(vault, file.path)), { recursive: true });
    await writeFile(join(vault, file.path), file.text);
  }
  await writeFile(join(vault, 'notes/photo.png'), 'not really a png');
  await mkdir(join(vault, 'diary'), { recursive: true });
  await writeFile(join(vault, 'diary/today.md'), '---\ntitle: Today\nchannels: [notes]\n---\n\nRead [[notes/rain]] again.\n');
  await mkdir(join(vault, '.vault'), { recursive: true });
  const tools = createLocalTools({ vault, by: 'agent:helper', DatabaseSync });
  await tools.call('vault_index');
  return { vault, call: tools.call };
}

test('a rename that stops after its moves strands nothing: old names keep working, and trying again finishes it', async t => {
  const { vault } = await setUp(t);
  const change = { block: 'notes/rain.md', slug: 'rain-walk', title: 'Rain in Busan' };
  const before = (await readEvents(vault)).events.length;
  const read = await readVaultFolder(vault);
  // The disk fills up once the file is moved: keeping the first version fails.
  const broken = async () => { throw new Error('ENOSPC: no space left on device'); };
  await assert.rejects(applyRename({ vault, plan: planRename(read.files, change, { paths: read.paths }), by: 'me', keep: broken }), /no space/);
  assert.ok((await stat(join(vault, 'notes/rain-walk.md'))).isFile());
  assert.match(await readFile(join(vault, 'writing/essay.md'), 'utf8'), /\[\[rain\|the rain\]\]/, 'not rewritten yet');

  // The move and the old names are journaled already, so [[rain]] and [[Rain in Seoul]] still find it.
  const stopped = (await readEvents(vault)).events.slice(before);
  assert.deepEqual(stopped.map(event => event.op), ['moved', 'renamed']);
  const { blocks } = formerNames((await readEvents(vault)).events);
  assert.deepEqual(['rain', 'rain in seoul', 'notes/rain'].map(name => blocks.get(name)), Array(3).fill('notes/rain-walk.md'));

  // The same rename again, by the path it had: the move is not made or journaled twice, the rest is done.
  const keep = text => blobCid(Buffer.from(text, 'utf8'));
  const now = await readVaultFolder(vault);
  assert.throws(() => planRename(now.files, change, { paths: now.paths }), /no block at "notes\/rain.md"/);
  const done = await applyRename({ vault, plan: planRename(now.files, change, { paths: now.paths, events: (await readEvents(vault)).events }), by: 'me', keep });
  assert.deepEqual([done.from, done.to, done.left], ['notes/rain.md', 'notes/rain-walk.md', []]);
  const essay = await readFile(join(vault, 'writing/essay.md'), 'utf8');
  assert.match(essay, /\[\[rain-walk\|the rain\]\] and \[\[Rain in Busan\]\]/);
  assert.equal(props(await readFile(join(vault, 'notes/rain-walk.md'), 'utf8')).title, 'Rain in Busan');
  const finished = (await readEvents(vault)).events.slice(before + stopped.length);
  assert.deepEqual(finished.filter(event => event.op !== 'changed'), []);
  assert.ok(finished.some(event => event.path === 'writing/essay.md'));
});

test('an agent renames within its grant; what it may not write keeps working through the old name', async t => {
  const { vault, call } = await setUp(t);
  await assert.rejects(call('vault_rename', { ref: 'notes', to: 'journal' }), /ohm vault grant helper write/);
  await writeFile(join(vault, '.vault/grants.json'), JSON.stringify({ agents: { helper: { write: ['notes', 'journal', 'writing'] } } }));
  const before = (await readEvents(vault)).events.length;
  const done = await call('vault_rename', { ref: 'notes', to: 'journal' });
  assert.deepEqual([done.kind, done.from, done.to, done.moved], ['channel', 'notes', 'journal', 3]);
  assert.match(done.id, /^[a-z2-7]{13}$/);
  assert.deepEqual(done.left, [{ path: 'diary/today.md', why: 'no grant' }]);
  assert.ok((await stat(join(vault, 'journal/photo.png'))).isFile());
  assert.deepEqual(props(await readFile(join(vault, 'writing/essay.md'), 'utf8')).channels, ['journal', 'journal/2026']);
  assert.deepEqual(props(await readFile(join(vault, 'diary/today.md'), 'utf8')).channels, ['notes'], 'not rewritten');

  // One journaled change, and the scan after it adds nothing of its own for these files.
  const events = (await readEvents(vault)).events.slice(before);
  assert.deepEqual([...new Set(events.map(event => `${event.op} ${event.via} ${event.by}`))].sort(), [
    'added rename agent:helper', 'changed rename agent:helper', 'moved rename agent:helper', 'renamed rename agent:helper',
  ]);
  const changed = events.find(event => event.op === 'changed' && event.path === 'writing/essay.md');
  assert.ok(changed.before && changed.hash, 'both versions kept');
  assert.deepEqual(props(await readFile(join(vault, '.vault/history', changed.before), 'utf8')).channels, ['notes', 'notes/2026']);
  const after = await call('vault_index');
  assert.equal(after.journaled, 0);
  assert.deepEqual(after.renamed, []);

  // The file it could not rewrite still counts in the renamed channel, and says what to write.
  const today = after.problems.find(each => each.path === 'diary/today.md')?.problems ?? [];
  assert.ok(today.some(problem => problem.includes('"notes", which is "journal" now')), today.join('\n'));
  assert.ok(today.some(problem => problem.includes('[[notes/rain]] on line 1 is "rain" now')), today.join('\n'));
  assert.ok(!today.some(problem => problem.includes('not a folder')));
  const read = await call('vault_local_read', { ref: 'journal' });
  assert.equal(read.key, `channel:${done.id}`, 'its ID is its key from now on');

  // A block: a new slug and title, and a refusal where there is no grant.
  const mark = (await readEvents(vault)).events.length;
  const block = await call('vault_rename', { ref: 'rain', to: 'rain-walk', title: 'Rain in Busan' });
  // Moved and rewritten at once, the file is still one move to the scan, not a removal and an addition.
  const own = (await readEvents(vault)).events.slice(mark);
  assert.deepEqual(own.filter(event => event.via === 'scan'), []);
  assert.deepEqual(own.filter(event => event.path === 'journal/rain-walk.md').map(event => event.op), ['moved', 'renamed', 'changed']);
  assert.deepEqual([block.kind, block.from, block.to, block.left], ['block', 'journal/rain.md', 'journal/rain-walk.md', []]);
  // The link it could not rewrite before follows the block through both renames.
  const again = await call('vault_index');
  assert.ok(again.problems.find(each => each.path === 'diary/today.md').problems.some(problem => problem.includes('[[notes/rain]] on line 1 is "rain-walk" now')));
  assert.match(await readFile(join(vault, 'writing/essay.md'), 'utf8'), /\[\[rain-walk\|the rain\]\] and \[\[Rain in Busan\]\]/);
  await assert.rejects(call('vault_rename', { ref: 'today', title: 'Tomorrow' }), /no write grant on diary\/today\.md/);
  await assert.rejects(call('vault_rename', { ref: 'channel:writing', title: 'x' }), /only its new path/);
});

test('ohm vault rename does the same for the person, rewriting every file', async t => {
  const { vault } = await setUp(t);
  const run = spawnSync(process.execPath, ['--experimental-sqlite', '--no-warnings', CLI, 'rename', 'notes', 'journal', '--vault', vault], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const done = JSON.parse(run.stdout);
  assert.deepEqual([done.kind, done.to, done.left], ['channel', 'journal', []]);
  const today = await readFile(join(vault, 'diary/today.md'), 'utf8');
  assert.deepEqual(props(today).channels, ['journal']);
  assert.match(today, /\[\[journal\/rain\]\]/);
  assert.ok(!done.index.problems.some(each => each.path === 'diary/today.md'));
  const { events } = await readEvents(vault);
  assert.ok(events.some(event => event.op === 'moved' && event.via === 'rename' && event.by === 'me'));
  const wrong = spawnSync(process.execPath, ['--experimental-sqlite', '--no-warnings', CLI, 'rename', 'journal', '--vault', vault], { encoding: 'utf8' });
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /Say what to rename/);
});
