import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { initCortex, openCortex } from '../src/folder.mjs';
import { openJournal } from '../src/journal.mjs';
import { cortexStatus } from '../src/status.mjs';
import { createTools } from '../src/tools.mjs';

// Every person here is invented.
const template = fileURLToPath(new URL('../template', import.meta.url));
const fresh = async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'cortex-')), 'cortex');
  await initCortex(dir, template);
  return dir;
};
const journal = async dir => (await readFile(join(dir, '.cortex', 'journal.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));

test('changes, sessions and saves are lines in one journal, each with seq, id, time, actor and type', async () => {
  const dir = await fresh();
  const agent = createTools(openCortex(dir, { actor: 'codex' }));
  const written = await agent.call('cortex_observe', { id: 'titles', text: 'Short titles.', session: 's1' });
  await agent.call('cortex_session', { summary: 'Noted how titles go', made: [written.change], session: 's1' });
  await agent.call('cortex_save', { name: 'after-titles', note: 'After the titles' });
  const lines = await journal(dir);
  assert.deepEqual(lines.map(line => [line.seq, line.type, line.actor.name]), [[1, 'change', 'codex'], [2, 'session', 'codex'], [3, 'save', 'codex']]);
  assert.ok(lines.every(line => typeof line.id === 'string' && Number.isFinite(Date.parse(line.at))));
  assert.deepEqual([lines[0].node, lines[0].session], ['observation/titles', 's1']);
  // Nothing else is written there.
  await assert.rejects(openJournal(dir).append('codex', 'observation', {}), /does not take observation lines/);
});

test('two machines\' journals joined by a union merge keep every line, with no ID shared', async () => {
  const dir = await fresh();
  await openCortex(dir, { actor: 'claude-code' }).observe({ id: 'before', text: 'Seen before the copy' });
  const other = join(await mkdtemp(join(tmpdir(), 'cortex-')), 'cortex');
  await cp(dir, other, { recursive: true });
  await openCortex(dir, { actor: 'claude-code' }).observe({ id: 'here', text: 'Seen on the laptop' });
  await openCortex(other, { actor: 'codex' }).observe({ id: 'there', text: 'Seen on the desktop' });

  // What git's union merge does: the lines of both, each kept once. Observation files never clash: one ID, one file.
  const ours = (await readFile(join(dir, '.cortex', 'journal.jsonl'), 'utf8')).split('\n').filter(Boolean);
  const theirs = (await readFile(join(other, '.cortex', 'journal.jsonl'), 'utf8')).split('\n').filter(Boolean);
  await writeFile(join(dir, '.cortex', 'journal.jsonl'), `${[...new Set([...ours, ...theirs])].join('\n')}\n`);
  await cp(join(other, 'observations', 'there.md'), join(dir, 'observations', 'there.md'));

  const merged = await journal(dir);
  assert.equal(merged.length, 3);
  assert.equal(new Set(merged.map(line => line.id)).size, 3);
  assert.equal(merged.filter(line => line.seq === 2).length, 2, 'both machines wrote a second line');
  const cortex = openCortex(dir, { actor: 'claude-code' });
  assert.deepEqual((await cortex.observations()).observations.map(item => item.id).sort(), ['before', 'here', 'there']);
  await cortex.observe({ id: 'after', text: 'Seen after the merge' });
  assert.equal((await journal(dir)).at(-1).seq, 3, 'the next line counts on from the highest seq either machine reached');
  assert.deepEqual((await openJournal(dir).read()).map(line => line.id), (await openJournal(dir).read()).map(line => line.id));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  assert.match(execFileSync('git', ['check-attr', 'merge', '--', '.cortex/journal.jsonl'], { cwd: dir, encoding: 'utf8' }), /merge: union/);
});

test('a journal from before docs/model.md still reads, and its old lines change nothing', async () => {
  const dir = await fresh();
  const at = '2026-11-18T10:00:00.000Z';
  const codex = { kind: 'agent', name: 'codex' };
  const member = { kind: 'human', name: 'member' };
  const old = [
    { seq: 1, id: 'old-1', at, actor: codex, type: 'note', note: 'n-old', text: 'Draws maps', session: 's-old', source: 'codex' },
    { seq: 2, id: 'old-2', at, actor: codex, type: 'proposal', proposal: 'p1', node: 'memory/likes-maps', op: 'create', before: null, after: 'cold', content: '---\n---\nMaps.\n' },
    { seq: 3, id: 'old-3', at, actor: member, type: 'decision', proposal: 'p1', outcome: 'rejected' },
    { seq: 4, id: 'old-4', at, actor: codex, type: 'decision', note: 'n-old', outcome: 'dropped' },
    { seq: 5, id: 'old-5', at, actor: codex, type: 'stamp', name: 'before', note: 'A save keeps its note' },
    { seq: 6, id: 'old-6', at, actor: codex, type: 'change', node: 'memory/likes-maps', op: 'create', before: null, after: 'cgone' },
  ];
  await writeFile(join(dir, '.cortex', 'journal.jsonl'), `${old.map(line => JSON.stringify(line)).join('\n')}\n`);
  const person = openCortex(dir, { actor: 'member' });
  assert.deepEqual((await openJournal(dir).read()).map(line => line.type), ['observation', 'proposal', 'decision', 'settled', 'save', 'change']);
  assert.deepEqual((await person.start()).waiting, { profile: [], skills: [], tools: [] });
  assert.deepEqual((await person.start()).observations, [], 'old journal lines are not observation files until migrated');
  assert.deepEqual((await cortexStatus(person)).map(item => item.kind), ['no-account']);
  // An old node's history is still readable, and only the person may restore it.
  assert.deepEqual((await person.history({ node: 'memory/' })).changes.map(line => line.node), ['memory/likes-maps']);
  assert.equal((await person.asOf({ node: 'memory/likes-maps', at: 6 })).kept, false);
  // New lines count on from the old ones.
  await person.observe({ id: 'new', text: 'After the old lines.' });
  assert.equal((await journal(dir)).at(-1).seq, 7);
});
