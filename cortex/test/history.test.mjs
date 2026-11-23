import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { initCortex, openCortex } from '../src/folder.mjs';
import { createTools } from '../src/tools.mjs';

// Every person here is invented.
const template = fileURLToPath(new URL('../template', import.meta.url));
const cli = fileURLToPath(new URL('../bin/cortex.mjs', import.meta.url));
const fresh = async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'cortex-')), 'cortex');
  await initCortex(dir, template);
  return dir;
};
const refused = code => problem => problem.code === code || JSON.parse(problem.message).error === code;
// A cortex opened on a given day, so the journal's times are known.
const on = (dir, actor, day) => openCortex(dir, { actor, now: () => new Date(`${day}T12:00:00.000Z`) });
const tools = (dir, actor, day) => createTools(on(dir, actor, day));

// Three days: Claude Code writes an observation and rewrites it, then the person writes their profile.
async function threeDays() {
  const dir = await fresh();
  const one = await on(dir, 'claude-code', '2026-11-01').observe({ id: 'titles', text: 'Short titles.' });
  await tools(dir, 'claude-code', '2026-11-01').call('cortex_save', { name: 'before-rewrite', note: 'Before the titles were rewritten' });
  const two = await on(dir, 'claude-code', '2026-11-02').observe({ id: 'titles', text: 'Short titles, no colons.', replaces: one.version });
  await on(dir, 'member', '2026-11-03').writeProfile('## Preferences\n\n- Short paragraphs\n');
  return { dir, one, two };
}

test('cortex_history lists changes, filtered by node, since a seq or a date, and by who made them', async () => {
  const { dir, one, two } = await threeDays();
  const call = args => tools(dir, 'codex', '2026-11-04').call('cortex_history', args);
  const all = await call({});
  assert.deepEqual(all.changes.map(line => [line.node, line.op, line.actor.name]), [
    ['observation/titles', 'create', 'claude-code'],
    ['observation/titles', 'update', 'claude-code'],
    ['profile', 'update', 'member'],
  ]);
  assert.deepEqual(all.saves.map(line => line.name), ['before-rewrite']);
  assert.deepEqual((await call({ node: 'observation/titles' })).changes.map(line => [line.before, line.after]), [[null, one.version], [one.version, two.version]]);
  assert.equal((await call({ node: 'observation/' })).changes.length, 2, 'a prefix ending in / takes every node under it');
  assert.deepEqual((await call({ since: '2026-11-02' })).changes.map(line => line.op), ['update', 'update']);
  assert.deepEqual((await call({ actor: 'human' })).changes.map(line => line.node), ['profile']);
  assert.equal((await call({ limit: 1 })).more, 2);
  await assert.rejects(call({ since: 'yesterday' }), refused('InvalidRequest'));
  assert.match(execFileSync('node', [cli, 'history', dir, '--actor', 'claude-code'], { encoding: 'utf8' }), /claude-code {2}update observation\/titles/);
});

test('cortex_as_of reads a node back as it was at a save, a date or a seq', async () => {
  const { dir } = await threeDays();
  const asOf = at => tools(dir, 'claude-code', '2026-11-04').call('cortex_as_of', { node: 'observation/titles', at });
  assert.match((await asOf('before-rewrite')).text, /Short titles\.\n$/);
  assert.match((await asOf('2026-11-02')).text, /no colons/);
  assert.equal((await asOf('2026-10-01')).exists, false);
  assert.match((await tools(dir, 'claude-code', '2026-11-04').call('cortex_as_of', { node: 'profile', at: '2026-11-03' })).text, /Short paragraphs/);
  assert.match(execFileSync('node', [cli, 'as-of', 'observation/titles', 'before-rewrite', dir], { encoding: 'utf8' }), /Short titles\./);
});

test('cortex_save names a point with a note, once, and changes nothing', async () => {
  const dir = await fresh();
  const save = tools(dir, 'codex', '2026-11-10');
  const before = await readdir(join(dir, 'observations'));
  const saved = await save.call('cortex_save', { name: 'from-before', note: 'Before the big tidy' });
  assert.equal(saved.name, 'from-before');
  await assert.rejects(save.call('cortex_save', { name: 'from-before', note: 'Again' }), refused('NameTaken'));
  for (const name of ['12', '2026-11-10', 'Not A Name']) await assert.rejects(save.call('cortex_save', { name, note: 'x' }), refused('InvalidRequest'));
  assert.deepEqual(await readdir(join(dir, 'observations')), before);
  assert.deepEqual((await save.call('cortex_history', {})).changes, []);
});

test('restoring is a new change: what it replaces is kept, and no line is rewritten', async () => {
  const { dir, one, two } = await threeDays();
  const agent = tools(dir, 'claude-code', '2026-11-05');
  await assert.rejects(agent.call('cortex_restore', { node: 'observation/titles', to: one.version, version: 'cstale' }), refused('Changed'));
  const done = await agent.call('cortex_restore', { node: 'observation/titles', to: one.version, version: two.version, reason: 'Colons were fine' });
  assert.deepEqual([done.op, done.restored], ['restore', one.version]);
  const journal = (await readFile(join(dir, '.cortex', 'journal.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const line = journal.at(-1);
  assert.deepEqual([line.node, line.op, line.before, line.after, line.reason, line.actor.name], ['observation/titles', 'restore', two.version, one.version, 'Colons were fine', 'claude-code']);
  assert.equal(journal.filter(each => each.type === 'change').length, 4, 'the earlier changes are where they were');
  const person = openCortex(dir, { actor: 'member' });
  assert.equal((await person.readObservation('titles', { version: two.version })).observation.text, 'Short titles, no colons.', 'the replaced version is kept');
  assert.equal((await agent.call('cortex_restore', { node: 'observation/titles', to: one.version, version: one.version })).unchanged, true);
  await assert.rejects(agent.call('cortex_restore', { node: 'observation/titles', to: 'cnothing', version: one.version }), refused('NotFound'));
  // Another agent never restores it, nor the profile, the playbook, a skill or a tool.
  const codex = tools(dir, 'codex', '2026-11-05');
  await assert.rejects(codex.call('cortex_restore', { node: 'observation/titles', to: two.version }), refused('PersonOnly'));
  const profile = (await codex.call('cortex_history', { node: 'profile' })).changes[0];
  for (const node of ['profile', 'playbook', 'skill/file-a-source', 'tool/calendar']) await assert.rejects(codex.call('cortex_restore', { node, to: profile.before }), refused('PersonOnly'), node);
  // The person restores from the command line.
  assert.match(execFileSync('node', [cli, 'restore', 'profile', profile.before, dir], { encoding: 'utf8' }), /is back to/);
  assert.equal((await person.profile()).text, '## Preferences\n\n## Goals\n\n## Notes');
});
