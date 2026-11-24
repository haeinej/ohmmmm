// Renaming breaks nothing (plans/renames.md, step 1): a block or a channel renamed or moved, even
// outside ohm, is still what its old names point at. The scan writes what it saw renamed to the
// journal, and the index reads old names from there, so they survive the index being made again.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { INDEX, inspect, openIndex, scan } from '../vault/indexer.mjs';
import { readEvents } from '../vault/journal.mjs';
import { formerNames } from '../vault/names.mjs';
import { evidence, readVault } from '../vault/node.mjs';

const RAIN = '3m2zx5u6ifk2a'; // a synthetic TID

async function setup(t) {
  const vault = await mkdtemp(join(tmpdir(), 'vault-renames-'));
  t.after(() => rm(vault, { recursive: true, force: true }));
  const put = async (path, text) => { await mkdir(dirname(join(vault, path)), { recursive: true }); await writeFile(join(vault, path), text); };
  const move = async (from, to) => { await mkdir(dirname(join(vault, to)), { recursive: true }); await rename(join(vault, from), join(vault, to)); };
  let db = await openIndex(vault, { DatabaseSync });
  t.after(() => { try { db.close(); } catch {} });
  const again = async () => { db.close(); await rm(join(vault, INDEX)); db = await openIndex(vault, { DatabaseSync }); return db; };
  return { vault, put, move, db: () => db, again };
}

const problemsOf = (report, path) => report.problems.find(each => each.path === path)?.problems ?? [];
const out = (db, ref) => inspect(db, ref).out.map(edge => `${edge.kind} ${edge.node}`).sort();

test('renames made outside ohm keep every old name working, and are listed to tidy', async t => {
  const { vault, put, move, db, again } = await setup(t);
  await put('notes/rain.md', `---\ntitle: Rain in Seoul\nchannels: [writing]\nid: ${RAIN}\n---\n\nAll afternoon.\n`);
  await put('notes/2026/snow.md', '---\ntitle: First snow\n---\n\nIt settled.\n');
  await put('writing/_channel.md', '---\ntitle: Writing\norder: [essay, rain]\n---\n');
  await put('writing/essay.md', '---\ntitle: An essay\nchannels: [notes, notes/2026]\n---\n\nAfter [[Rain in Seoul]] and [[rain]].\n\n![[snow]]\n');
  const first = await scan({ vault, db: db() });
  assert.deepEqual(first.problems, []);
  assert.deepEqual(first.renamed, []);

  // Outside ohm: the folder renamed, as Finder or git mv would, and the block in it retitled.
  await move('notes', 'journal');
  await put('journal/rain.md', `---\ntitle: Rain in Busan\nchannels: [writing]\nid: ${RAIN}\n---\n\nAll afternoon, and into the evening.\n`);
  const second = await scan({ vault, db: db() });
  assert.deepEqual(second.renamed.map(each => `${each.from} → ${each.to}`).sort(), [
    'Rain in Seoul → journal/rain.md',
    'notes → journal',
    'notes/2026 → journal/2026',
    'notes/rain.md → journal/rain.md',
  ]);
  // Nothing breaks: the essay is still in the renamed channels, and its links find the same blocks.
  const essay = problemsOf(second, 'writing/essay.md');
  assert.ok(!essay.some(problem => problem.includes('not a folder')), essay.join('\n'));
  assert.ok(essay.some(problem => problem.includes('"notes", which is "journal" now')));
  assert.ok(essay.some(problem => problem.includes('[[Rain in Seoul]] on line 1 is "rain" now')));
  assert.deepEqual(inspect(db(), 'essay').in.map(edge => `${edge.kind} ${edge.node}`).sort(),
    ['contains channel:journal', 'contains channel:journal/2026', 'contains channel:writing']);
  assert.ok(out(db(), 'essay').includes(`links block:${RAIN}`));
  // Its old names find it, and say they are old.
  assert.equal(inspect(db(), 'notes').key, 'channel:journal');
  assert.equal(inspect(db(), 'notes').formerly, 'notes');
  assert.equal(inspect(db(), 'Rain in Seoul').key, `block:${RAIN}`);
  // The journal holds the renames, written by the scan.
  const { events } = await readEvents(vault);
  assert.deepEqual(events.filter(event => event.op === 'renamed').map(event => [event.from, event.path, event.via]).sort(), [
    ['Rain in Seoul', 'journal/rain.md', 'scan'],
    ['notes', 'journal', 'scan'],
    ['notes/2026', 'journal/2026', 'scan'],
    ['notes/rain.md', 'journal/rain.md', 'scan'],
  ]);

  // Renamed again: a file moved with nothing else changed, and one with no ID. Old names chain on.
  await move('journal/rain.md', 'journal/rain-walk.md');
  await move('journal/2026/snow.md', 'journal/2026/first-snow.md');
  const third = await scan({ vault, db: db() });
  assert.deepEqual(third.moved.map(each => `${each.from} → ${each.to}`).sort(), ['journal/2026/snow.md → journal/2026/first-snow.md', 'journal/rain.md → journal/rain-walk.md']);
  assert.deepEqual(third.renamed, [], 'a move says it already');
  assert.ok(problemsOf(third, 'writing/_channel.md').some(problem => problem.includes('"rain", which is "rain-walk" now')));
  assert.ok(out(db(), 'essay').includes('embeds block:journal/2026/first-snow.md'), out(db(), 'essay').join('\n'));
  assert.ok(problemsOf(third, 'writing/essay.md').some(problem => problem.includes('[[snow]] on line 3 is "first-snow" now')));
  assert.ok(problemsOf(third, 'writing/essay.md').some(problem => problem.includes('[[rain]] on line 1 is "rain-walk" now')));

  // The index made again from nothing still knows every old name: they are in the journal.
  const fresh = await scan({ vault, db: await again() });
  assert.deepEqual(fresh.renamed, []);
  assert.ok(!problemsOf(fresh, 'writing/essay.md').some(problem => problem.includes('not a folder')));
  assert.deepEqual(out(db(), 'essay').filter(edge => !edge.startsWith('contains')), ['embeds block:journal/2026/first-snow.md', `links block:${RAIN}`, `links block:${RAIN}`]);
  assert.equal(inspect(db(), 'notes/2026').key, 'channel:journal/2026');
  assert.match(await readFile(join(vault, '.vault/journal.jsonl'), 'utf8'), /"op":"renamed"/);
});

test('a current name wins over an old one, and folders that split are not taken for a rename', async t => {
  // The journal says notes became journal, but a new notes folder exists: notes means the new one.
  const former = formerNames([
    { op: 'renamed', root: 'vault', path: 'journal', from: 'notes' },
    { op: 'renamed', root: 'vault', path: 'diary', from: 'journal' },
    { op: 'moved', root: 'vault', path: 'diary/b.md', from: 'journal/a.md' },
  ]);
  assert.equal(former.channels.get('notes'), 'diary', 'a chain of renames ends where the channel is now');
  assert.equal(former.blocks.get('a'), 'diary/b.md');
  const vault = readVault([
    { path: 'notes/new.md', text: '---\ntitle: New\n---\n\nHere.\n' },
    { path: 'diary/b.md', text: '---\ntitle: B\n---\n\nThere.\n' },
    { path: 'other/c.md', text: '---\ntitle: C\nchannels: [notes, journal]\n---\n\n[[a]] and [[new]].\n' },
  ], { former });
  const c = vault.blocks.find(block => block.slug === 'c');
  assert.deepEqual(c.channels, ['notes', 'diary']);
  assert.deepEqual(vault.problems.flatMap(each => each.problems), ['It names the channel "journal", which is "diary" now. It still counts there; write "diary" to tidy it']);
  const links = evidence(vault).filter(edge => edge.kind === 'links');
  assert.deepEqual(links.map(edge => [edge.to, edge.former]), [['block:diary/b.md', 'a'], ['block:notes/new.md', undefined]]);

  // Outside ohm, half a folder's blocks went one way and half another: no rename is guessed.
  const { vault: folder, put, move, db } = await setup(t);
  await put('mixed/one.md', '---\ntitle: One\n---\n\n1\n');
  await put('mixed/two.md', '---\ntitle: Two\n---\n\n2\n');
  await put('elsewhere/ref.md', '---\ntitle: Ref\nchannels: [mixed]\n---\n\nr\n');
  await scan({ vault: folder, db: db() });
  await move('mixed/one.md', 'left/one.md');
  await move('mixed/two.md', 'right/two.md');
  const split = await scan({ vault: folder, db: db() });
  assert.deepEqual(split.renamed, []);
  assert.ok(problemsOf(split, 'elsewhere/ref.md').some(problem => problem.includes('"mixed", which is not a folder')));
});
