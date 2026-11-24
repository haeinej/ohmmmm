import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createLocalTools } from '../mcp/local.mjs';
import { readEvents } from '../vault/journal.mjs';
import { words } from '../vault/words.mjs';
import { newNodeId } from '../vault/node.mjs';

test('local MCP scans and searches, reads journal history, follows evidence, captures and collects', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'ohm-local-mcp-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const vault = join(folder, 'vault');
  const root = join(folder, 'inbound');
  await mkdir(join(vault, '.vault'), { recursive: true });
  await mkdir(root);
  await writeFile(join(vault, '.vault/config.json'), JSON.stringify({ roots: [{ name: 'inbound', path: root, include: ['*.md'] }] }));
  const file = join(root, 'garden.md');
  const sourceId = newNodeId();
  await writeFile(file, `---\nid: ${sourceId}\n---\n\nThe garden is quiet.`);
  await writeFile(join(root, '_letter.md'), 'A letter.');
  await writeFile(join(root, 'excluded.txt'), 'Excluded');
  await writeFile(join(folder, 'outside.md'), 'Outside');
  await symlink(join(folder, 'outside.md'), join(root, 'outside.md'));
  const tools = createLocalTools({ vault, by: 'agent:example', DatabaseSync });
  const call = tools.call;
  await assert.rejects(call('vault_local_search', { query: 'garden' }), /Run vault_index/);
  assert.ok((await call('vault_index')).nodes > 0);
  assert.equal((await call('vault_local_search', { query: 'garden' })).nodes[0].root, 'inbound');
  await assert.rejects(call('vault_capture', { source: join(root, 'excluded.txt') }), /configured root/);
  await assert.rejects(call('vault_capture', { source: join(root, 'outside.md') }), /symlinks/);
  await assert.rejects(call('vault_capture', { source: join(folder, 'outside.md') }), /configured root/);
  await assert.rejects(call('vault_collect', { block: 'garden', channel: 'reading' }), /read-only root/);
  const captured = await call('vault_capture', { source: file });
  const read = await call('vault_local_read', { ref: captured.block });
  assert.equal(read.root, 'vault');
  assert.notEqual(read.node.id, sourceId);
  assert.equal((await call('vault_local_read', { ref: `block:${sourceId}` })).root, 'inbound');
  assert.ok(read.file.size);
  assert.equal(read.node.body.trim(), 'The garden is quiet.');
  assert.equal(read.node.by, 'agent:example');
  assert.equal(read.node.status, 'proposed');
  assert.equal(read.history.find(event => event.via === 'add').by, 'agent:example');
  const letter = await call('vault_capture', { source: join(root, '_letter.md') });
  assert.equal(letter.block, 'inbox/letter.md');
  assert.equal((await call('vault_local_read', { ref: letter.node })).node.body.trim(), 'A letter.');
  const link = await call('vault_capture', { source: 'https://example.test/reading', channel: 'reading' });
  const neighbors = await call('vault_neighbors', { ref: link.node, direction: 'out', kind: 'from', depth: 2 });
  assert.deepEqual(neighbors.edges.map(edge => [edge.from, edge.to, edge.kind]), [[link.node, `source:${link.source}`, 'from']]);
  await assert.rejects(call('vault_neighbors', { ref: link.node, depth: 6 }), /depth/);
  const collected = await call('vault_collect', { block: read.key, channel: 'reading' });
  assert.deepEqual(collected.order, ['garden']);
  const moved = await call('vault_collect', { block: link.node, channel: 'reading', position: 0 });
  assert.deepEqual(moved.order, ['example-test-reading', 'garden']);
  assert.equal((await call('vault_collect', { block: link.node, channel: 'reading', position: 0 })).unchanged, true);
  assert.match(await readFile(join(vault, captured.block), 'utf8'), /channels:.*reading/s);
  assert.deepEqual((await readEvents(vault)).events.filter(event => event.via === 'collect')
    .map(event => [event.by, event.op, event.path]), [
    ['agent:example', 'changed', captured.block], ['agent:example', 'added', 'reading/_channel.md'],
    ['agent:example', 'changed', 'reading/_channel.md'],
  ]);
});

test('a competing local collection refuses while the vault lock is held and can be retried', async t => {
  const vault = await mkdtemp(join(tmpdir(), 'ohm-local-collect-'));
  t.after(() => rm(vault, { recursive: true, force: true }));
  const first = createLocalTools({ vault, by: 'agent:first', DatabaseSync });
  const second = createLocalTools({ vault, by: 'agent:second', DatabaseSync });
  const captured = await first.call('vault_capture', { source: 'https://example.test/reading' });
  const lock = new DatabaseSync(join(vault, '.vault', 'collect.sqlite'));
  try {
    lock.exec('BEGIN IMMEDIATE');
    await assert.rejects(second.call('vault_collect', { block: captured.node, channel: 'stories' }), /Another collection is running/);
    assert.deepEqual((await first.call('vault_local_read', { ref: captured.node })).node.channels, []);
  } finally {
    lock.close();
  }
  await first.call('vault_collect', { block: captured.node, channel: 'reading' });
  await second.call('vault_collect', { block: captured.node, channel: 'stories' });
  assert.deepEqual((await second.call('vault_local_read', { ref: captured.node })).node.channels, ['reading', 'stories']);
});

test('ohm vault mcp serves only local tools over stdio', async t => {
  const vault = await mkdtemp(join(tmpdir(), 'ohm-local-stdio-'));
  t.after(() => rm(vault, { recursive: true, force: true }));
  const command = fileURLToPath(new URL('../bin/ohm.mjs', import.meta.url));
  const args = ['vault', 'mcp', '--vault', vault, '--agent', 'example'];
  const input = [
    { method: 'initialize', params: { protocolVersion: '2025-03-26' } },
    { method: 'tools/list' },
    { method: 'tools/call', params: { name: 'vault_index' } },
  ].map((request, id) => JSON.stringify({ jsonrpc: '2.0', id, ...request })).join('\n') + '\n';
  const run = spawnSync(process.execPath, [command, ...args], { input, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const [initialized, listed, indexed] = run.stdout.trim().split('\n').map(line => JSON.parse(line).result);
  assert.equal(initialized.serverInfo.name, 'ohm-vault');
  assert.deepEqual(listed.tools.map(tool => tool.name), [
    'vault_local_search', 'vault_local_read', 'vault_neighbors', 'vault_capture', 'vault_collect', 'vault_index',
    'vault_where', 'vault_lint', 'vault_history', 'vault_write', 'vault_remove', 'vault_link', 'vault_restore', 'vault_rename',
  ]);
  assert.equal(listed.tools.filter(tool => tool.annotations?.readOnlyHint).length, 6);
  assert.equal(indexed.isError, undefined);
});

test('words splits normalized multilingual text without importing SQLite', () => {
  assert.deepEqual(words('ＤＡＷＮ 한국어 雨!'), ['dawn', '한국', '국어', '雨']);
});
