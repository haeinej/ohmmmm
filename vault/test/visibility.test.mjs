// Who can see a block, in the home folder (vault/vault/visibility.mjs): a move between private and
// friends rewrites the block's `visibility`; public goes through Publish; and an agent never changes it,
// only asks. Every note here is invented.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createLocalTools } from '../mcp/local.mjs';
import { blobCid } from '../vault/core.mjs';
import { readNode } from '../vault/node.mjs';
import { decideRequest, layerOf, readRequests, withVisibility } from '../vault/visibility.mjs';

test('a move rewrites visibility, keeps a plain note a block, and leaves public to Publish', () => {
  const plain = '---\ntitle: Slow walk\n---\n\nYanaka.\n';
  const friends = withVisibility('notes/walk.md', plain, 'friends');
  assert.equal(friends, '---\ntitle: Slow walk\nkind: text\nvisibility: friends\n---\n\nYanaka.\n');
  const read = readNode('notes/walk.md', friends).node;
  assert.deepEqual([read.kind, read.visibility, read.post], ['text', 'friends', undefined], 'still a block, not a post');
  assert.equal(layerOf('notes/walk.md', withVisibility('notes/walk.md', friends, 'private')), 'private');
  assert.doesNotMatch(withVisibility('notes/walk.md', friends, 'private'), /visibility/, 'private is the default, so it is not written');
  assert.equal(withVisibility('notes/walk.md', plain, 'private'), plain, 'no move, no change');
  assert.throws(() => withVisibility('notes/walk.md', plain, 'public'), /goes through Publish/);
  assert.throws(() => withVisibility('essays/on-rain.md', '---\ntitle: On rain\nvisibility: public\n---\n\nPublished.\n', 'private'), /goes through Publish/);
  assert.throws(() => withVisibility('notes/_channel.md', '---\ntitle: Notes\n---\n', 'friends'), /Only a block/);
});

async function setUp(t, rights) {
  const vault = await mkdtemp(join(tmpdir(), 'vault-visibility-'));
  t.after(() => rm(vault, { recursive: true, force: true }));
  await mkdir(join(vault, 'notes'), { recursive: true });
  await mkdir(join(vault, '.vault'), { recursive: true });
  await writeFile(join(vault, 'notes/walk.md'), '---\ntitle: Slow walk\n---\n\nYanaka.\n');
  await writeFile(join(vault, '.vault/grants.json'), JSON.stringify({ agents: { helper: rights } }));
  const tools = createLocalTools({ vault, by: 'agent:helper', DatabaseSync });
  await tools.call('vault_index');
  return { vault, call: tools.call };
}
const address = text => blobCid(Buffer.from(text, 'utf8'));

test('an agent never changes who can see a block, even with a write grant: it asks, and the person decides', async t => {
  const { vault, call } = await setUp(t, { write: ['notes'] });
  const walk = '---\ntitle: Slow walk\n---\n\nYanaka.\n';
  await assert.rejects(call('vault_write', { path: 'notes/walk.md', text: '---\ntitle: Slow walk\nkind: text\nvisibility: friends\n---\n\nYanaka.\n', replaces: await address(walk) }), /ask with vault_request_visibility/);
  await assert.rejects(call('vault_write', { path: 'notes/new.md', text: '---\ntitle: New\nkind: text\nvisibility: friends\n---\n\nHi.\n' }), /ask with vault_request_visibility/);
  // Writing within its grant, in the same layer, still works.
  const kept = await call('vault_write', { path: 'notes/walk.md', text: '---\ntitle: Slow walk\n---\n\nYanaka, in the rain.\n', replaces: await address(walk) });
  // Nor through a kept version in another layer.
  await writeFile(join(vault, 'notes/walk.md'), '---\ntitle: Slow walk\nkind: text\nvisibility: friends\n---\n\nShared.\n');
  await call('vault_index');
  await assert.rejects(call('vault_restore', { path: 'notes/walk.md', to: kept.hash, replaces: await address('---\ntitle: Slow walk\nkind: text\nvisibility: friends\n---\n\nShared.\n') }), /ask with vault_request_visibility/);

  // It asks instead; asking twice is the same request; public is refused.
  const asked = await call('vault_request_visibility', { ref: 'walk', to: 'private', why: 'It mentions a friend by name.' });
  assert.deepEqual([asked.path, asked.from, asked.to, asked.status], ['notes/walk.md', 'friends', 'private', 'waiting']);
  assert.equal((await call('vault_request_visibility', { ref: 'walk', to: 'private' })).request, asked.request);
  await assert.rejects(call('vault_request_visibility', { ref: 'walk', to: 'public' }), /goes through Publish/);
  assert.deepEqual(await call('vault_request_visibility', { ref: 'walk', to: 'friends' }), { path: 'notes/walk.md', visibility: 'friends', unchanged: true });

  // The person decides (the bridge does this for the app); the agent sees how it went.
  await decideRequest(vault, asked.request, 'declined');
  const { requests } = await call('vault_requests', {});
  assert.deepEqual(requests.map(each => [each.status, each.to, each.why]), [['declined', 'private', 'It mentions a friend by name.']]);
  assert.equal((await readRequests(vault)).length, 1);
  await assert.rejects(decideRequest(vault, asked.request, 'approved'), /declined already/);
});

test('asking needs no grant: approval is the gate', async t => {
  const { call } = await setUp(t, {});
  const asked = await call('vault_request_visibility', { ref: 'walk', to: 'friends', why: 'To share with June.' });
  assert.equal(asked.status, 'waiting');
});
