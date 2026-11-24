import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { addToVault, hookEvent } from '../vault/add.mjs';
import { cortexVault, openVault, OPERATIONS } from '../vault/cortex.mjs';
import { inspect, openIndex, scan } from '../vault/indexer.mjs';
import { appendEvents, downloadedFrom, eventProblems, JOURNAL, readEvents } from '../vault/journal.mjs';
import { CONFIG } from '../vault/roots.mjs';

const run = promisify(execFile);

async function setup(t) {
  const base = await mkdtemp(join(tmpdir(), 'vault-provenance-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const put = async (path, text) => { await mkdir(dirname(join(base, path)), { recursive: true }); await writeFile(join(base, path), text); return join(base, path); };
  const vault = join(base, 'Vault');
  await put('Vault/writing/rain.md', '---\ntitle: Rain\n---\n\nAbout rain.\n');
  await mkdir(join(vault, '.vault'), { recursive: true });
  const db = await openIndex(vault, { DatabaseSync });
  t.after(() => { try { db.close(); } catch {} });
  return { base, vault, db, put };
}

test('the journal takes only well-formed events, appends them, and skips a damaged line', async t => {
  const { vault } = await setup(t);
  const event = { at: '2026-11-19T00:00:00.000Z', op: 'added', root: 'vault', path: 'a.md', by: 'me', via: 'add' };
  assert.deepEqual(eventProblems(event), []);
  for (const wrong of [{ ...event, op: 'guessed' }, { ...event, by: 'someone' }, { ...event, path: '../escape.md' }, { ...event, op: 'moved' }, { ...event, op: 'copied-from' }, { ...event, at: 'soon' }]) {
    assert.notDeepEqual(eventProblems(wrong), [], JSON.stringify(wrong));
  }
  await assert.rejects(appendEvents(vault, [event, { ...event, via: 'magic' }]), /cannot be written/);
  assert.deepEqual(await readEvents(vault), { events: [], unreadable: 0 });
  await appendEvents(vault, [event]);
  await writeFile(join(vault, JOURNAL), `${await readFile(join(vault, JOURNAL), 'utf8')}{"cut off`, { flag: 'w' });
  await appendEvents(vault, [{ ...event, path: 'b.md' }]);
  const read = await readEvents(vault);
  assert.equal(read.unreadable, 1);
  assert.deepEqual(read.events.map(each => each.path), ['a.md']);
});

test('adding a file copies it in beside a block that says where it came from; the original stays', async t => {
  const { base, vault, db, put } = await setup(t);
  const query = await put('work/queries/churn.sql', 'select 1;\n');
  await assert.rejects(addToVault({ vault, source: query }), /which channel/);
  const added = await addToVault({ vault, source: query, channel: 'queries', by: 'agent:claude-code', now: new Date('2026-11-19T01:00:00Z') });
  assert.deepEqual(added.files, ['queries/churn.sql', 'queries/churn.md']);
  assert.equal(await readFile(query, 'utf8'), 'select 1;\n');
  const block = await readFile(join(vault, 'queries/churn.md'), 'utf8');
  assert.match(block, /kind: code/);
  assert.match(block, new RegExp(`origin: "?${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"?`));
  assert.match(block, /by: "agent:claude-code"|by: agent:claude-code/);
  assert.doesNotMatch(block, /status:/);
  // An agent's block starts private, whatever it said: showing it to more people is the person's move.
  assert.match(block, /visibility: private/);
  assert.match(block, /!\[\[churn\.sql\]\]/);
  await assert.rejects(readFile(join(vault, 'queries/_channel.md')));
  // The same name again gets a free one; nothing is overwritten.
  const again = await addToVault({ vault, source: query, channel: 'queries' });
  assert.deepEqual(again.files, ['queries/churn-2.sql', 'queries/churn-2.md']);
  assert.doesNotMatch(await readFile(join(vault, 'queries/churn-2.md'), 'utf8'), /visibility:/);

  // A note keeps its own properties and gains its origin; with --move the original goes.
  const note = await put('Downloads/Reading list.md', '---\ntitle: Reading\n---\n\nBooks.\n');
  const moved = await addToVault({ vault, source: note, channel: 'reading', move: true });
  assert.equal(moved.block, 'reading/Reading list.md');
  await assert.rejects(readFile(note));
  assert.match(await readFile(join(vault, moved.block), 'utf8'), /title: Reading[\s\S]*origin:/);

  // An address becomes a source that refers to it, and a link block from it. Nothing is fetched.
  const link = await addToVault({ vault, source: 'https://example.com/essays/on-rain', channel: 'reading', title: 'On rain' });
  assert.match(link.block, /^reading\/example-com-essays-on-rain\.md$/);
  assert.equal(JSON.parse(await readFile(join(vault, `_sources/${link.source}/source.json`), 'utf8')).retain, 'reference');

  await assert.rejects(addToVault({ vault, source: join(vault, 'writing/rain.md'), channel: 'writing' }), /already in the vault/);
  await assert.rejects(addToVault({ vault, source: join(base, 'work'), channel: 'work' }), /one file at a time/);
  await assert.rejects(addToVault({ vault, source: join(base, 'nothing.txt'), channel: 'work' }), /There is no file/);
  await assert.rejects(addToVault({ vault, source: query, channel: '_hidden' }), /not a channel's path/);
  await assert.rejects(addToVault({ vault, source: query, channel: 'queries', by: 'someone' }), /by is me/);

  // Indexing afterwards keeps what add said, rather than recording the files again as unknown.
  await scan({ vault, db });
  const history = inspect(db, 'queries/churn.md').history;
  assert.deepEqual(history.map(event => [event.op, event.by, event.via]), [['added', 'agent:claude-code', 'add']]);
  assert.equal(history[0].origin, query);
  const { events } = await readEvents(vault);
  assert.equal(events.filter(event => event.path === 'queries/churn.md').length, 1);
});

test('a file dropped in by hand is recognised by its bytes, and its later moves are followed', async t => {
  const { base, vault, db, put } = await setup(t);
  await writeFile(join(vault, CONFIG), JSON.stringify({ roots: [{ name: 'papers', path: join(base, 'papers') }] }));
  await put('papers/attention.pdf', '%PDF same bytes');
  await scan({ vault, db });
  await put('Vault/reading/attention.pdf', '%PDF same bytes');
  await put('Vault/reading/unknown.pdf', '%PDF bytes nobody else has');
  const report = await scan({ vault, db });
  assert.deepEqual(report.recognised, [{ path: 'reading/attention.pdf', copiedFrom: join(base, 'papers/attention.pdf') }]);
  await rename(join(vault, 'reading/attention.pdf'), join(vault, 'reading/kept.pdf'));
  await scan({ vault, db });
  const history = (await readEvents(vault)).events.filter(event => ['reading/attention.pdf', 'reading/kept.pdf'].includes(event.path)).map(event => event.op);
  assert.deepEqual(history, ['added', 'copied-from', 'moved']);
  const unknown = (await readEvents(vault)).events.filter(event => event.path === 'reading/unknown.pdf');
  assert.deepEqual(unknown.map(event => [event.op, event.by]), [['added', 'unknown']]);
});

test('a file macOS downloaded says where from', { skip: process.platform !== 'darwin' && 'macOS only' }, async t => {
  const { vault, db, put } = await setup(t);
  const file = await put('Vault/reading/paper.pdf', '%PDF downloaded');
  // Write the attribute the way a browser does: a binary property list of addresses.
  const plist = await new Promise((resolve, reject) => {
    const child = spawn('plutil', ['-convert', 'binary1', '-o', '-', '-'], { stdio: ['pipe', 'pipe', 'inherit'] });
    const out = [];
    child.stdout.on('data', chunk => out.push(chunk));
    child.on('close', code => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error('plutil'))));
    child.stdin.end(JSON.stringify(['https://example.com/paper.pdf', 'https://example.com/papers']));
  });
  await run('xattr', ['-wx', 'com.apple.metadata:kMDItemWhereFroms', plist.toString('hex'), file]);
  assert.deepEqual(await downloadedFrom(file), ['https://example.com/paper.pdf', 'https://example.com/papers']);
  const report = await scan({ vault, db });
  assert.deepEqual(report.recognised, [{ path: 'reading/paper.pdf', downloadedFrom: 'https://example.com/paper.pdf' }]);
  assert.deepEqual(await downloadedFrom(join(vault, 'writing/rain.md')), []);
  assert.deepEqual(await downloadedFrom(file, { platform: 'linux' }), []);
});

test('an agent\'s hook journals what it wrote in the vault, and indexing says the agent wrote it', async t => {
  const { vault, db } = await setup(t);
  const input = { session_id: 'session-1', cwd: vault, tool_name: 'Write', tool_input: { file_path: join(vault, 'writing/new.md') } };
  const event = hookEvent(input, { vault, agent: 'claude-code', now: new Date('2026-11-19T02:00:00Z') });
  assert.deepEqual(event, { at: '2026-11-19T02:00:00.000Z', op: 'written', root: 'vault', path: 'writing/new.md', by: 'agent:claude-code', via: 'hook', session: 'session-1' });
  assert.equal(hookEvent({ ...input, tool_name: 'Read' }, { vault }), null);
  assert.equal(hookEvent({ ...input, tool_input: { file_path: '/elsewhere/a.md' } }, { vault }), null);
  assert.equal(hookEvent({ ...input, tool_input: { file_path: join(vault, '.vault/index.sqlite') } }, { vault }), null);
  assert.equal(hookEvent({ ...input, tool_input: { file_path: 'writing/relative.md' } }, { vault }).path, 'writing/relative.md');

  // Through the command, as Claude Code runs it: JSON on standard input, nothing on output, exit 0.
  const ohm = fileURLToPath(new URL('../bin/ohm.mjs', import.meta.url));
  await scan({ vault, db });
  await writeFile(join(vault, 'writing/new.md'), 'Written by an agent.\n');
  const child = spawn(process.execPath, [ohm, 'vault', 'hook', '--vault', vault], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', chunk => { out += chunk; });
  child.stdin.end(JSON.stringify(input));
  assert.equal(await new Promise(resolve => child.on('close', resolve)), 0);
  assert.equal(out, '');
  const bad = spawn(process.execPath, [ohm, 'vault', 'hook', '--vault', vault], { stdio: ['pipe', 'ignore', 'ignore'] });
  bad.stdin.end('not json');
  assert.equal(await new Promise(resolve => bad.on('close', resolve)), 0);
  await scan({ vault, db });
  assert.deepEqual(inspect(db, 'new').history.map(each => [each.op, each.by, each.via]), [['written', 'agent:claude-code', 'hook'], ['added', 'agent:claude-code', 'scan']]);
});

test('cortex reads this vault through its contract, the same way it read the folder, and writes nothing', async t => {
  const { base, vault, put } = await setup(t);
  await put('Vault/writing/_channel.md', '---\ntitle: Writing\n---\n');
  await put('Vault/writing/essays/long.md', '---\nid: 3mzocqfoc22if\ntitle: A long essay\n---\n\nAbout 서울 and rain.\n');
  await put('Vault/top.md', 'At the top.\n');
  await put('Vault/_entities/person/ada.md', 'Ada.\n');
  await put('queries/churn.sql', 'select 1;\n');
  await writeFile(join(vault, CONFIG), JSON.stringify({ roots: [{ name: 'queries', path: join(base, 'queries') }] }));
  const cortex = openVault({ path: vault });
  assert.throws(() => openVault({}), /which vault folder/);
  for (const operation of OPERATIONS) assert.equal(typeof cortex[operation], 'function', operation);

  const shape = await cortex.shape();
  assert.equal(shape.blocks, 4);
  assert.deepEqual(shape.channels, [
    { channel: 'other', blocks: 1 }, { channel: 'queries', blocks: 1 }, { channel: 'writing', blocks: 2 }, { channel: 'writing/essays', blocks: 1 },
  ]);
  assert.deepEqual(await cortex.read('3mzocqfoc22if'), { id: '3mzocqfoc22if', title: 'A long essay', channel: 'writing/essays', body: 'About 서울 and rain.' });
  // Without an id property a block is known by its path, as cortex's folder vault knows it.
  assert.deepEqual(await cortex.read('path:top.md'), { id: 'path:top.md', title: 'top', channel: 'other', body: 'At the top.' });
  assert.equal((await cortex.read('path:queries/churn.sql')).channel, 'queries');
  assert.deepEqual(await cortex.exists(['3mzocqfoc22if', 'path:gone.md']), {
    '3mzocqfoc22if': { exists: true, title: 'A long essay', channel: 'writing/essays' }, 'path:gone.md': { exists: false },
  });
  assert.deepEqual(await cortex.search('서울'), [{ id: '3mzocqfoc22if', title: 'A long essay', channel: 'writing/essays' }]);
  assert.deepEqual(await cortex.profile(), []);

  const { changes, cursor } = await cortex.changes();
  assert.deepEqual(changes, []);
  await put('Vault/writing/rain.md', '---\ntitle: Rain\n---\n\nNow about snow.\n');
  await mkdir(join(vault, 'archive'));
  await rename(join(vault, 'writing/essays/long.md'), join(vault, 'archive/long.md'));
  await rm(join(vault, 'top.md'));
  const later = await cortex.changes(cursor);
  assert.deepEqual(later.changes.map(change => `${change.type} ${change.id}${change.from ? ` from ${change.from}` : ''}`).sort(), [
    'moved 3mzocqfoc22if from writing/essays', 'removed path:top.md', 'saved path:writing/rain.md',
  ]);
  // The hash is cortex's own: the first 16 hex of the SHA-256 of the file's text.
  const { createHash } = await import('node:crypto');
  const text = await readFile(join(vault, 'writing/rain.md'), 'utf8');
  assert.equal(later.cursor['path:writing/rain.md'].hash, createHash('sha256').update(text).digest('hex').slice(0, 16));
  // Reading for cortex wrote nothing: no journal, and the index setup made is still empty.
  await assert.rejects(readFile(join(vault, JOURNAL)));
  const { DatabaseSync: Database } = await import('node:sqlite');
  const index = new Database(join(vault, '.vault/index.sqlite'));
  assert.equal(index.prepare('SELECT COUNT(*) AS n FROM files').get().n, 0);
  index.close();
  // A reference-only root is listed without being opened, and an unreadable root is named, not fatal.
  await writeFile(join(vault, CONFIG), JSON.stringify({ roots: [{ name: 'queries', path: join(base, 'queries'), retain: 'reference' }, { name: 'gone', path: join(base, 'gone') }] }));
  const later2 = await cortexVault(vault).shape();
  assert.ok(later2.channels.some(each => each.channel === 'queries'));
  assert.match(later2.problems.join(), /"gone" .* cannot be read/);
});
