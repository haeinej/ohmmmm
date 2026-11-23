import assert from 'node:assert/strict';
import test from 'node:test';
import { blockStore } from '../service/src/blocks.mjs';
import { channelFile, channelStore } from '../service/src/channels.mjs';
import { postStore } from '../service/src/store.mjs';
import { newPostId } from '../vault/file.mjs';
import { testDatabase } from './d1.mjs';
import { running } from './members.mjs';

// Every person, channel and block here is invented.
const refusal = code => problem => problem.code === code;
let made = 0;
const id = () => newPostId(Date.parse('2026-11-23T00:00:00Z') + made++, 3);
const me = 'did:web:pds.alder.test';
const CHANNEL = '---\ntitle: Walks\nkind: collection\n---\n\nLong walks, written down.\n';
const block = (path, more = '') => ({ id: id(), path, text: `---\nkind: text\ntitle: A walk\nvisibility: friends\n${more}---\n\nWords.\n` });

test('a channel is kept as its file, with compare-and-set and a change list', async () => {
  const store = channelStore(await testDatabase());
  const saved = await store.write(me, { path: 'walks', text: CHANNEL });
  assert.deepEqual(await store.read(me, 'walks'), { channel: { path: 'walks', text: CHANNEL }, version: saved.version });
  assert.equal((await store.write(me, { path: 'walks', text: CHANNEL }, { replaces: saved.version })).unchanged, true);
  const listed = await store.list(me);
  assert.deepEqual(listed.channels, [{ path: 'walks', version: saved.version, title: 'Walks', kind: 'collection' }]);

  const edited = await store.write(me, { path: 'walks', text: CHANNEL.replace('Long', 'Short') }, { replaces: saved.version });
  await assert.rejects(store.write(me, { path: 'walks', text: CHANNEL.replace('Long', 'Other') }, { replaces: saved.version }), refusal('Changed'));
  await store.remove(me, 'walks', { replaces: edited.version });
  assert.deepEqual((await store.list(me, { since: listed.cursor })).channels, [{ path: 'walks', removed: true }]);
  await assert.rejects(store.read(me, 'walks'), refusal('NotFound'));

  const refused = given => assert.throws(() => channelFile(given), refusal('InvalidChannel'));
  refused({ path: '_drafts', text: CHANNEL });
  refused({ path: 'walks', text: '---\nvisibility: private\n---\n\nx' });
  refused({ path: 'walks', text: '---\nkind: shelf\n---\n\nx' });
  refused({ path: 'inbox', text: '---\nkind: collection\n---\n\nx' });
  refused({ path: 'walks', text: CHANNEL, extra: 1 });
});

test('a channel move takes only what is inside it: no wildcards, no case folding, no overwriting', async () => {
  const db = await testDatabase();
  const store = channelStore(db), blocks = blockStore(db);
  const underscore = await store.write(me, { path: 'to_read', text: CHANNEL });
  await store.write(me, { path: 'to-read', text: CHANNEL });
  await store.write(me, { path: 'to-read/novels', text: CHANNEL });
  await store.write(me, { path: 'Walks/seoul', text: CHANNEL });
  const walks = await store.write(me, { path: 'walks', text: CHANNEL });
  // `_` and `%` in a path are characters, and case matters.
  assert.deepEqual(await store.move(me, 'to_read', 'later', { replaces: underscore.version }), { from: 'to_read', to: 'later', channels: 1, blocks: 0 });
  await store.move(me, 'walks', 'hikes', { replaces: walks.version });
  assert.deepEqual((await store.list(me)).channels.map(each => each.path).sort(), ['Walks/seoul', 'hikes', 'later', 'to-read', 'to-read/novels']);
  await store.remove(me, 'later', { replaces: (await store.read(me, 'later')).version });
  // A folder with no _channel.md holding a block at the moved block's new path is refused, not a server error.
  const hikes = await store.read(me, 'hikes');
  await blocks.write(me, block('hikes/cliff.md'));
  await blocks.write(me, block('trails/cliff.md'));
  await assert.rejects(store.move(me, 'hikes', 'trails', { replaces: hikes.version }), refusal('PathTaken'));
});

test('a channel is removed only when empty, and moves with everything filed in it', async () => {
  const db = await testDatabase();
  const store = channelStore(db), blocks = blockStore(db);
  const walks = await store.write(me, { path: 'walks', text: CHANNEL });
  await store.write(me, { path: 'walks/coast', text: '---\ntitle: Coast\n---\n' });
  const home = block('walks/coast/cliff.md');
  const listedElsewhere = block('notes/river.md', 'channels: [walks]\n');
  await blocks.write(me, home);
  await blocks.write(me, listedElsewhere);

  await assert.rejects(store.remove(me, 'walks', { replaces: walks.version }), refusal('NotEmpty'));
  await assert.rejects(store.move(me, 'walks', 'walks/inside', { replaces: walks.version }), refusal('InvalidChannel'));
  await assert.rejects(store.move(me, 'walks', 'paths', { replaces: 'stale' }), refusal('Changed'));

  const done = await store.move(me, 'walks', 'paths', { replaces: walks.version });
  assert.deepEqual(done, { from: 'walks', to: 'paths', channels: 2, blocks: 2 });
  assert.deepEqual((await store.list(me)).channels.map(each => each.path).sort(), ['paths', 'paths/coast']);
  assert.equal((await blocks.read(me, home.id)).block.path, 'paths/coast/cliff.md');
  assert.match((await blocks.read(me, listedElsewhere.id)).block.text, /channels: \[?paths\]?|channels:\n\s+- paths/);

  // A published post's address comes from its label, so its channel does not move.
  await postStore(db).write(me, { id: id(), slug: 'a-walk', label: 'essays', sublabel: '', visibility: 'public', title: 'A walk', body: 'Words.', properties: {} });
  const essays = await store.write(me, { path: 'essays', text: '---\ntitle: Essays\n---\n' });
  await assert.rejects(store.move(me, 'essays', 'writing', { replaces: essays.version }), refusal('HasPosts'));
});

test('an agent\'s proposal waits in the inbox until it is kept or declined', async () => {
  const db = await testDatabase();
  const store = channelStore(db), blocks = blockStore(db);
  const proposal = block('inbox/idea.md', 'by: agent:helper\nstatus: proposed\n');
  const first = await blocks.write(me, proposal);
  const kept = await store.keep(me, { id: proposal.id, channel: 'walks', replaces: first.version });
  const now = (await blocks.read(me, proposal.id)).block;
  assert.equal(now.path, 'walks/idea.md');
  assert.doesNotMatch(now.text, /status:/);
  assert.match(now.text, /by: agent:helper/);
  assert.equal(kept.channel, 'walks');
  await assert.rejects(store.keep(me, { id: proposal.id, channel: 'walks', replaces: kept.version }), refusal('NotProposed'));

  const other = block('inbox/other.md', 'by: agent:helper\nstatus: proposed\n');
  const saved = await blocks.write(me, other);
  await assert.rejects(store.keep(me, { id: other.id, channel: 'inbox', replaces: saved.version }), refusal('InvalidChannel'));
  assert.deepEqual(await store.decline(me, { id: other.id, replaces: saved.version }), { id: other.id, removed: true });
});

test('channel requests go through the service for the member only', async () => {
  const { haein, jun, ask } = await running();
  const saved = await ask(haein, 'putChannel', { body: { channel: { path: 'walks', text: CHANNEL } } });
  assert.equal(saved.status, 200);
  assert.equal((await ask(haein, 'getChannel', { query: { path: 'walks' } })).channel.text, CHANNEL);
  assert.equal((await ask(jun, 'getChannel', { query: { path: 'walks' } })).status, 404);
  assert.deepEqual((await ask(haein, 'listChannels')).channels.map(each => each.path), ['walks']);
  assert.equal((await ask(haein, 'moveChannel', { body: { from: 'walks', to: 'paths', replaces: saved.version } })).status, 200);
});
