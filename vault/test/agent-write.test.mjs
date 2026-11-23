import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createLocalTools } from '../mcp/local.mjs';
import { allowed, changeGrants, readGrants } from '../vault/grants.mjs';
import { readEvents } from '../vault/journal.mjs';
import { readConfig } from '../vault/roots.mjs';

// Every note here is invented.
const setUp = async t => {
  const folder = await mkdtemp(join(tmpdir(), 'ohm-agent-write-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const vault = join(folder, 'vault');
  const papers = join(folder, 'papers');
  await mkdir(join(vault, '.vault'), { recursive: true });
  await mkdir(join(vault, 'notes'), { recursive: true });
  await mkdir(join(vault, 'diary'), { recursive: true });
  await mkdir(papers);
  await writeFile(join(papers, 'tides.md'), 'Tidal pools and slow walks.');
  await writeFile(join(vault, '.vault/config.json'), JSON.stringify({ roots: [{ name: 'papers', path: papers, include: ['*.md'], note: 'Papers I cite. Trust the newest.' }] }));
  await writeFile(join(vault, 'notes/walk.md'), '---\ntitle: Slow walk\n---\n\nA slow walk through Yanaka, tidal light, lanterns, cats.\n');
  await writeFile(join(vault, 'notes/lanterns.md'), '---\ntitle: Lanterns\n---\n\nPaper lanterns in Yanaka, tidal light, cats asleep.\n');
  await writeFile(join(vault, 'diary/today.md'), '---\ntitle: Today\n---\n\nPrivate thoughts.\n');
  const tools = createLocalTools({ vault, by: 'agent:helper', DatabaseSync });
  await tools.call('vault_index');
  return { vault, call: tools.call };
};
const grant = async (vault, rights) => writeFile(join(vault, '.vault/grants.json'), JSON.stringify({ agents: { helper: rights } }));

test('grants are scopes of channels; write includes link; bad entries are dropped with a problem', () => {
  const { agents, problems } = readGrants({ agents: { helper: { write: ['notes'], link: ['*'], delete: ['x'] }, 'bad name': {} } });
  assert.equal(problems.length, 2);
  assert.equal(allowed({ agents }, 'helper', 'write', 'notes/a.md'), 'notes');
  assert.equal(allowed({ agents }, 'helper', 'write', 'notes/deeper/a.md'), 'notes');
  assert.equal(allowed({ agents }, 'helper', 'write', 'notesy/a.md'), null);
  assert.equal(allowed({ agents }, 'helper', 'link', 'diary/a.md'), '*');
  assert.equal(allowed({ agents }, 'other', 'link', 'diary/a.md'), null);
  const next = changeGrants({ agents }, { agent: 'helper', right: 'write', scope: 'notes', give: false });
  assert.deepEqual(next.agents.helper, { link: ['*'] });
  assert.deepEqual(changeGrants(next, { agent: 'helper', give: false }).agents, {});
  assert.throws(() => changeGrants({}, { agent: 'helper', right: 'write', scope: '../x', give: true }), /not a scope/);
});

test('without a grant an agent cannot write, link or remove, and is told how to ask', async t => {
  const { call } = await setUp(t);
  await assert.rejects(call('vault_write', { path: 'notes/new.md', text: 'Hello.' }), /ohm vault grant helper write notes/);
  await assert.rejects(call('vault_link', { from: 'walk', to: 'lanterns' }), /no link grant/);
});

test('an agent writes within its grant, replaces only what it read, and every version is kept for restore', async t => {
  const { vault, call } = await setUp(t);
  await grant(vault, { write: ['notes'] });
  const made = await call('vault_write', { path: 'notes/new.md', text: 'A new idea about lanterns.' });
  assert.equal(made.made, true);
  assert.match(await readFile(join(vault, 'notes/new.md'), 'utf8'), /by: "?agent:helper/);
  await assert.rejects(call('vault_write', { path: 'diary/today.md', text: 'Changed.' }), /no write grant/);
  await assert.rejects(call('vault_write', { path: '.vault/grants.json', text: '{}' }), /Markdown file/);
  await assert.rejects(call('vault_write', { path: 'notes/.hidden.md', text: 'x' }), /hidden files/);
  await assert.rejects(call('vault_write', { path: 'notes/walk.md', text: 'Replaced.' }), /replaces/);
  const read = await call('vault_local_read', { ref: 'walk' });
  await assert.rejects(call('vault_write', { path: 'notes/walk.md', text: 'Replaced.', replaces: made.hash }), /changed since you read it/);
  const original = await readFile(join(vault, 'notes/walk.md'), 'utf8');
  const changed = await call('vault_write', { path: 'notes/walk.md', text: '---\ntitle: Slow walk\n---\n\nRewritten.\n', replaces: read.file.hash });
  assert.equal(changed.before, read.file.hash);
  const { events: history } = await call('vault_history', { path: 'notes/walk.md' });
  assert.equal(history[0].via, 'write');
  assert.equal(history[0].by, 'agent:helper');
  assert.equal(history[0].beforeKept, true);
  await call('vault_restore', { path: 'notes/walk.md', to: changed.before, replaces: changed.hash });
  assert.equal(await readFile(join(vault, 'notes/walk.md'), 'utf8'), original);
  const removed = await call('vault_remove', { path: 'notes/new.md', replaces: made.hash });
  await call('vault_restore', { path: 'notes/new.md', to: removed.before });
  assert.match(await readFile(join(vault, 'notes/new.md'), 'utf8'), /new idea/);
  const { events } = await readEvents(vault);
  assert.ok(events.filter(event => event.via === 'restore').length === 2);
});

test('an agent links within a link grant, once, with a note, and the link becomes evidence', async t => {
  const { vault, call } = await setUp(t);
  await grant(vault, { link: ['notes'] });
  const linked = await call('vault_link', { from: 'walk', to: 'lanterns', note: 'the same evening' });
  assert.equal(linked.line, '- [[lanterns]] the same evening');
  assert.equal((await call('vault_link', { from: 'walk', to: 'lanterns' })).unchanged, true);
  const read = await call('vault_local_read', { ref: 'walk' });
  assert.ok(read.out.some(edge => edge.kind === 'links' && edge.node === linked.to));
  await assert.rejects(call('vault_write', { path: 'notes/walk.md', text: 'x', replaces: read.file.hash }), /no write grant/);
  await assert.rejects(call('vault_link', { from: 'today', to: 'walk' }), /no link grant/);
});

test('vault_where gives roots with the person\'s notes and the agent\'s grant; vault_lint finds related unlinked blocks', async t => {
  const { vault, call } = await setUp(t);
  await grant(vault, { link: ['notes'] });
  const where = await call('vault_where');
  assert.equal(where.roots[0].note, 'Papers I cite. Trust the newest.');
  assert.equal(where.roots[0].writable, false);
  assert.deepEqual(where.you.grant, { link: ['notes'] });
  const found = await call('vault_lint');
  assert.ok(found.related.some(pair => [pair.a.slug, pair.b.slug].sort().join() === 'lanterns,walk'));
  assert.ok(found.orphans.length >= 1);
  await call('vault_link', { from: 'walk', to: 'lanterns' });
  assert.ok(!(await call('vault_lint')).related.some(pair => [pair.a.slug, pair.b.slug].sort().join() === 'lanterns,walk'), 'linked pairs drop out');
  assert.match(readConfig({ roots: [{ name: 'x', path: '/tmp/elsewhere-x', note: 5 }] }, { vault, home: '/home/sam' }).problems[0], /note/);
});
