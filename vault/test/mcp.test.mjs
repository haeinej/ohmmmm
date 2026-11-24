import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createServer, serve } from '../mcp/protocol.mjs';
import { createTools, OFFERED, TOOLS } from '../mcp/tools.mjs';
import { REQUESTS } from '../service/src/capabilities/index.mjs';
import { createService } from '../service/src/worker.mjs';
import { blockStore } from '../service/src/blocks.mjs';
import { newPostId } from '../vault/file.mjs';
import { testDatabase } from './d1.mjs';
import { CONTENT, DOCUMENT, fromDocument, notFound, PUBLICATION, PUBLICATION_KEY, toDocument } from './standard.mjs';

// The tools, against the vault service itself: the real service, on a database in memory, asked
// the way the tools ask it. Only who is asking is stood in for.
const did = 'did:web:pds.example.test';
async function toolsOf({ beforeApply = () => {}, grants = null } = {}) {
  const env = { DB: await testDatabase(), SERVICE_DID: 'did:web:vault.example.test' };
  // What the person has published, as their own PDS lists it: a type of their own from before the
  // shared one. A test changes `published` to change what is there.
  const published = [['hello-world', { $type: 'com.example.post', body: 'Published long ago.', publishedAt: '2024-05-01T00:00:00.000Z', title: 'Hello, world', author: 'E. Example' }]];
  const get = async url => {
    const address = new URL(url);
    if (address.pathname === '/xrpc/com.atproto.repo.describeRepo') return Response.json({ collections: ['com.example.post', 'app.bsky.feed.post'] });
    if (address.pathname === '/xrpc/com.atproto.repo.listRecords' && address.searchParams.get('collection') === 'com.example.post') {
      return Response.json({ records: published.map(([key, value]) => ({ uri: `at://${did}/com.example.post/${key}`, value })) });
    }
    // The person's repository, as far as posts go: what publishing writes to. Posts are kept as
    // standard.site documents; `repository` holds the posts inside them.
    if (address.pathname === '/xrpc/com.atproto.repo.listRecords' && address.searchParams.get('collection') === DOCUMENT) {
      return Response.json({ records: [...repository].map(([key, value]) => ({ uri: `at://${did}/${DOCUMENT}/${key}`, value: toDocument(value, { did, site: 'https://pds.example.test' }) })) });
    }
    // The member's publication, made the first time anything is published.
    if (address.pathname === '/xrpc/com.atproto.repo.getRecord' && address.searchParams.get('collection') === PUBLICATION) {
      return publication.record ? Response.json({ uri: `at://${did}/${PUBLICATION}/${PUBLICATION_KEY}`, cid: 'cid-publication', value: publication.record }) : notFound();
    }
    // A picture on some other website, which a post places by its address.
    if (address.origin === 'https://photos.example.test') return new Response(new Uint8Array([137, 80, 78, 71, 1, 2, 3]), { headers: { 'Content-Type': 'image/png' } });
    return Response.json({ records: [] });
  };
  const repository = new Map();
  const publication = { record: null, written: 0 };
  const uploads = [];
  const service = createService({ whoIs: Object.assign(async request => request.headers.get('Authorization').slice(7), { pdsFor: async () => 'https://pds.example.test' }), get });
  const asked = [];
  const ask = async (name, { query, body, reader = did } = {}) => {
    asked.push(name);
    const url = new URL(`https://vault.example.test/xrpc/com.ohmmmm.vault.${name}`);
    if (query) url.search = new URLSearchParams(query);
    const response = await service(new Request(url, {
      method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${reader}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
    }), env);
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.message), { status: response.status, code: data.error, extra: data });
    return data;
  };
  const vault = {
    tree: () => ask('getTree'), search: query => ask('searchPosts', { query }), get: id => ask('getPost', { query: { id } }),
    put: (post, replaces) => ask('putPost', { body: { post, ...(replaces ? { replaces } : {}) } }), remove: (id, replaces) => ask('deletePost', { body: { id, replaces } }),
    listBlocks: since => ask('listBlocks', since === undefined ? {} : { query: { since } }),
    getBlock: id => ask('getBlock', { query: { id } }),
    putBlock: (block, replaces) => ask('putBlock', { body: { block, replaces } }),
    deleteBlock: (id, replaces) => ask('deleteBlock', { body: { id, replaces } }),
    listFriends: () => ask('listFriends'),
    removeFriend: did => ask('removeFriend', { body: { did } }),
    listShared: owner => ask('listShared', { query: { owner } }),
    getShared: (owner, id) => ask('getShared', { query: { owner, id } }),
    previewMove: (id, to) => ask('previewMove', { query: { id, to } }),
    hideBlock: move => ask('hideBlock', { body: move }),
    requestMove: move => ask('requestMove', { body: move }),
    mirror: ({ apply = false, expectedSummary } = {}) => {
      if (apply) beforeApply(published);
      return ask('importPublished', { body: { apply, ...(expectedSummary ? { expectedSummary } : {}) } });
    },
    publishPlan: ({ prepare = false } = {}) => ask('getPublishPlan', prepare ? { query: { prepare: '1' } } : {}),
    async attachment(id, attachment) {
      asked.push('getAttachment');
      const url = new URL('https://vault.example.test/xrpc/com.ohmmmm.vault.getAttachment');
      url.search = new URLSearchParams({ id, attachment });
      const response = await service(new Request(url, { headers: { Authorization: `Bearer ${did}` } }), env);
      if (!response.ok) throw Object.assign(new Error((await response.json()).message), { code: 'FileUnreachable' });
      return { bytes: new Uint8Array(await response.arrayBuffer()), mime: response.headers.get('Content-Type') };
    },
    // The person's own PDS, written to as the person: a file sent, and a batch of changes made.
    repository: did,
    async upload(bytes, mime) {
      uploads.push({ size: bytes.length, mime });
      return { $type: 'blob', ref: { $link: `bafkreitest${uploads.length}` }, mimeType: mime, size: bytes.length };
    },
    async apply(writes) {
      for (const write of writes) {
        if (write.collection === PUBLICATION) {
          assert.deepEqual([write.$type, write.rkey, write.value.$type], ['com.atproto.repo.applyWrites#create', PUBLICATION_KEY, PUBLICATION]);
          publication.record = write.value; publication.written++;
          continue;
        }
        assert.equal(write.collection, DOCUMENT, 'publishing writes only posts, as documents, and the publication');
        if (write.$type.endsWith('#delete')) { repository.delete(write.rkey); continue; }
        // A post is written as a document whose content is the post.
        assert.deepEqual([write.value.$type, write.value.content.$type, write.value.site], [DOCUMENT, CONTENT, `at://${did}/${PUBLICATION}/${PUBLICATION_KEY}`]);
        repository.set(write.rkey, fromDocument(write.value, { did }));
      }
    },
  };
  const seed = async (slug, fields = {}) => {
    const id = newPostId();
    await vault.put({ id, slug, label: '', sublabel: '', body: 'Seeded post.', visibility: 'friends', ...fields });
    return vault.get(id);
  };
  return { tools: createTools({ vault, by: 'agent:helper', grants }), vault, asked, published, repository, publication, uploads, seed, ask, blocks: blockStore(env.DB) };
}

test('service tools hide legacy private posts and keep search counts and publish previews free of private content', async () => {
  const { tools, seed, repository } = await toolsOf();
  const { post } = await seed('private-slug', { title: 'Private title', label: 'Private label', visibility: 'private', body: 'Rain. Private body.' });
  await seed('shared-slug', { title: 'Shared title', body: 'Shared rain.' });
  repository.set(post.id, { title: 'Former public title' });
  const tree = await tools.call('vault_tree');
  assert.deepEqual([tree.posts, tree.friends, tree.labels.length], [1, 1, 1]);
  assert.doesNotMatch(JSON.stringify(tree), /private/i);
  assert.deepEqual((await tools.call('vault_list')).posts.map(each => each.slug), ['shared-slug']);
  const search = await tools.call('vault_search', { query: 'rain' });
  assert.deepEqual([search.found, search.posts[0].passage], [1, 'Shared rain.']);
  assert.deepEqual((await tools.call('vault_status')).remove, [{ key: post.id, why: 'The published record will be taken down.' }]);
  assert.doesNotMatch(JSON.stringify(await tools.call('vault_publish')), /Private title|private-slug|Private body/);
  await assert.rejects(tools.call('vault_search', { query: 'rain', visibility: 'private' }), /public or friends/);
  for (const key of [post.id, post.slug]) {
    await assert.rejects(tools.call('vault_read', { key }), /No post uses/);
    await assert.rejects(tools.call('vault_set_visibility', { key, to: 'friends' }), /No post uses/);
    await assert.rejects(tools.call('vault_delete', { key }), /No post uses/);
    await assert.rejects(tools.call('vault_save', { key, body: 'Replacement' }), /vault_capture/);
  }
  await assert.rejects(tools.call('vault_save', { key: 'new', body: 'Proposed private text' }), /vault_capture/);
});

test('nothing other people are meant to see changes without the second call', async () => {
  const { tools, vault, seed } = await toolsOf();
  const { post: made } = await seed('hello', { title: 'Hello', label: 'Writings', body: 'A first post.' });
  const held = async () => (await vault.get(made.id)).post;

  const asked = await tools.call('vault_set_visibility', { key: 'hello', to: 'public', reason: 'It is finished.' });
  assert.equal(asked.done, false);
  assert.deepEqual([asked.willHappen.from, asked.willHappen.to, asked.willHappen.action], ['friends', 'public', 'publish']);
  assert.match(asked.willHappen.outcome, /request to the person/);
  assert.equal((await held()).visibility, 'friends');
  await assert.rejects(tools.call('vault_set_visibility', { key: 'hello', to: 'public', confirm: 'c0000000000000000' }), /has changed since it was shown/);
  // The value given for one request does not unlock another.
  await assert.rejects(tools.call('vault_delete', { key: 'hello', confirm: asked.confirm }), /has changed since it was shown/);
  // The second call asks the person; it never shows the post to more people itself.
  const moved = await tools.call('vault_set_visibility', { key: 'hello', to: 'public', reason: 'It is finished.', confirm: asked.confirm });
  assert.deepEqual([moved.done, moved.requested, moved.waitsFor], [true, true, 'the person, in their cockpit']);
  assert.equal((await held()).visibility, 'friends');
  const again = await tools.call('vault_set_visibility', { key: 'hello', to: 'public', reason: 'It is finished.' });
  assert.equal(again.willHappen.alreadyAsked.length, 1);
  assert.equal((await tools.call('vault_set_visibility', { key: 'hello', to: 'public', reason: 'It is finished.', confirm: again.confirm })).alreadyWaiting, true);

  // Editing a post that is not private is shown first too, with what changes.
  const read = await tools.call('vault_read', { key: 'hello' });
  const edit = { key: 'hello', version: read.version, body: 'A first post, corrected.', sublabel: 'Beginnings' };
  const shown = await tools.call('vault_save', edit);
  assert.equal(shown.done, false);
  assert.deepEqual(shown.willHappen.changes, ['body', 'sublabel']);
  assert.equal((await held()).body, 'A first post.');
  // A different edit cannot ride on the value shown for this one.
  await assert.rejects(tools.call('vault_save', { ...edit, body: 'Something else entirely.', confirm: shown.confirm }), /has changed since it was shown/);
  const saved = await tools.call('vault_save', { ...edit, confirm: shown.confirm });
  assert.deepEqual([saved.done, saved.sublabel], [true, 'Beginnings']);
  await assert.rejects(tools.call('vault_save', edit), /has changed since it was read/);
  assert.equal((await held()).body, 'A first post, corrected.');

  // Removing a post is two calls as well.
  const going = await tools.call('vault_delete', { key: 'hello' });
  assert.equal(going.done, false);
  assert.match(going.willHappen.warning, /for good/);
  assert.equal((await held()).slug, 'hello');
  assert.equal((await tools.call('vault_delete', { key: 'hello', confirm: going.confirm })).removed.slug, 'hello');
  await assert.rejects(tools.call('vault_read', { key: 'hello' }), /No post uses "hello"/);
});

test('the tree and the list show the vault\'s structure, and bad requests say what is wrong', async () => {
  const { tools, seed } = await toolsOf();
  await seed('trap', { title: 'Trap', label: 'Writings', sublabel: 'Collisions', body: 'Words.', date: '2026-03-01' });
  await seed('draft', { title: 'Draft', label: 'Writings', body: 'Words.', date: '2026-04-01',
    source: { platform: 'bluesky', uri: 'https://bsky.app/profile/example.test/post/3k' } });

  const tree = await tools.call('vault_tree');
  assert.deepEqual([tree.posts, tree.private, tree.public, tree.friends], [2, undefined, 0, 2]);
  assert.deepEqual(tree.labels.map(folder => [folder.label, folder.posts.map(each => each.slug), folder.sublabels.map(group => [group.sublabel, group.posts.map(each => each.slug)])]),
    [['Writings', ['draft'], [['Collisions', ['trap']]]]]);
  assert.deepEqual((await tools.call('vault_list', { label: 'writings' })).posts.map(each => each.slug), ['draft', 'trap']);
  assert.deepEqual((await tools.call('vault_list', { sublabel: 'Collisions' })).posts.map(each => each.slug), ['trap']);
  assert.deepEqual((await tools.call('vault_list', { platform: 'Bluesky' })).posts.map(each => [each.slug, each.platform]), [['draft', 'bluesky']]);
  assert.deepEqual((await tools.call('vault_list', { platform: 'own' })).posts.map(each => each.slug), ['trap']);

  // What the vault service will not take, it says in its own words, and the tool passes them on.
  await assert.rejects(tools.call('vault_read', { key: 'missing' }), /No post uses "missing"/);
  await assert.rejects(tools.call('vault_search', { query: '  ' }), /at least one word/);
  await assert.rejects(tools.call('vault_set_visibility', { key: 'trap', to: 'everyone' }), /Visibility is one of/);
  await assert.rejects(tools.call('vault_publish_everything'), /There is no tool named/);
  // Two posts cannot share a slug.
  const second = await tools.call('vault_read', { key: 'draft' });
  const args = { key: 'draft', version: second.version, slug: 'trap' };
  const { confirm } = await tools.call('vault_save', args);
  await assert.rejects(tools.call('vault_save', { ...args, confirm }), /already has the slug "trap"/);
});

test('an agent brings in what the person has published: it looks first, and brings in only on the second call', async () => {
  const { tools, published } = await toolsOf();
  const looked = await tools.call('vault_mirror');
  assert.equal(looked.done, false);
  assert.deepEqual([looked.willHappen.types, looked.willHappen.records, looked.willHappen.posts], [['com.example.post', DOCUMENT], 1, 1]);
  assert.match(looked.willHappen.note, /Nothing is published/);
  // Looking brought nothing in.
  assert.equal((await tools.call('vault_tree')).posts, 0);
  await assert.rejects(tools.call('vault_mirror', { confirm: 'c0000000000000000' }), /has changed since it was shown/);

  const done = await tools.call('vault_mirror', { confirm: looked.confirm });
  assert.deepEqual([done.done, done.broughtIn, done.alreadyThere], [true, ['hello-world'], 0]);
  assert.match(done.next, /under "other"/);
  // It came in as it was published: for everyone, with no label, so it wants filing.
  const tree = await tools.call('vault_tree');
  assert.deepEqual(tree.labels.map(folder => [folder.label, folder.posts.map(post => [post.slug, post.visibility])]), [['other', [['hello-world', 'public']]]]);
  const read = await tools.call('vault_read', { key: 'hello-world' });
  assert.deepEqual([read.title, read.body, read.site], ['Hello, world', 'Published long ago.', { $type: 'com.example.postSite', author: 'E. Example' }]);

  // A second mirror finds it already there. A post the person has changed here since is left alone.
  const again = await tools.call('vault_mirror');
  assert.deepEqual((await tools.call('vault_mirror', { confirm: again.confirm })).alreadyThere, 1);
  const filed = await tools.call('vault_save', { key: 'hello-world', version: read.version, label: 'Writings' });
  await tools.call('vault_save', { key: 'hello-world', version: read.version, label: 'Writings', confirm: filed.confirm });
  const third = await tools.call('vault_mirror');
  const kept = await tools.call('vault_mirror', { confirm: third.confirm });
  assert.deepEqual([kept.broughtIn, kept.leftAloneBecauseChangedInTheVault], [[], ['hello-world']]);
  assert.equal((await tools.call('vault_read', { key: 'hello-world' })).label, 'Writings');

  // What was shown stands for what was there: if the PDS has more by the second call, it is shown again.
  const before = await tools.call('vault_mirror');
  published.push(['second', { $type: 'com.example.post', body: 'Newer.', publishedAt: '2025-01-01T00:00:00.000Z' }]);
  await assert.rejects(tools.call('vault_mirror', { confirm: before.confirm }), /has changed since it was shown/);
});

test('mirror apply rechecks approved counts/losses on the same source read it saves', async () => {
  for (const change of ['body', 'key', 'count', 'loss']) {
    const { tools, published } = await toolsOf({ beforeApply(records) {
      if (change === 'body') records[0][1].body = 'Current published body';
      if (change === 'key') records[0][0] = 'other-key';
      if (change === 'count') records.push(['second', { ...records[0][1], title: 'Second' }]);
      if (change === 'loss') records[0][1].body = '![Missing](media:missing)';
    } });
    published[0][1].canonicalUrl = 'https://example.test/entry';
    const looked = await tools.call('vault_mirror');
    assert.equal(looked.willHappen.posts, 1);
    assert.equal(looked.willHappen.couldNotBeKept, undefined);
    if (change === 'count' || change === 'loss') {
      await assert.rejects(tools.call('vault_mirror', { confirm: looked.confirm }), /Call vault_mirror again without confirm/);
      assert.equal((await tools.call('vault_tree')).posts, 0);
    } else {
      const done = await tools.call('vault_mirror', { confirm: looked.confirm });
      assert.equal(done.done, true);
      const read = await tools.call('vault_read', { key: change === 'key' ? 'other-key' : 'hello-world' });
      assert.equal(read.body, change === 'body' ? 'Current published body' : 'Published long ago.');
    }
  }
});

test('invalid protocol params and unexpected handlers do not poison the ordered queue', async () => {
  const handle = createServer({ tools: { call: async () => ({ ok: true }) }, list: [] });
  const messages = [
    { id: 1, method: 'initialize', params: null },
    { id: 2, method: 'initialize', params: [] },
    { id: 3, method: 'tools/call', params: { name: 'example', arguments: null } },
    { id: 4, method: 'tools/call', params: {} },
    { id: 5, method: 'broken' },
    { id: 6, method: 'ping' },
    { id: 7, method: 'tools/call', params: { name: 'example', arguments: {} } },
  ].map(message => ({ jsonrpc: '2.0', ...message }));
  const responses = [];
  await serve(message => { if (message.method === 'broken') throw new Error('unexpected'); return handle(message); }, Readable.from(messages.map(message => `${JSON.stringify(message)}\n`)), { write: line => responses.push(JSON.parse(line)) });
  assert.deepEqual(responses.map(response => response.id), [1,2,3,4,5,6,7]);
  assert.deepEqual(responses.slice(0,5).map(response => response.error.code), [-32602,-32602,-32602,-32602,-32603]);
  assert.deepEqual(responses[5].result, {});
  assert.equal(responses[6].result.isError, undefined);
});

test('an agent publishes: it shows what would change first, and the repository changes only on the second call', async () => {
  const { tools, vault, repository, publication, uploads, seed } = await toolsOf();
  const confirmed = async (name, args) => tools.call(name, { ...args, confirm: (await tools.call(name, args)).confirm });
  const { post: made } = await seed('the-hill', { title: 'The hill', label: 'Photographs', date: '2026-02-01', body: 'Up early.\n\n![The hill at dawn](https://photos.example.test/hill.png)' });
  await seed('mine', { body: 'Only for me.', visibility: 'private' });
  // A record something else published, which the vault knows nothing about.
  repository.set('from-elsewhere', { $type: 'com.ohmmmm.post', title: 'From elsewhere', body: 'x', publishedAt: '2025-01-01T00:00:00.000Z' });

  // Nothing is for everyone yet, so there is nothing to publish.
  assert.deepEqual([(await tools.call('vault_status')).changes, (await tools.call('vault_publish')).nothingToPublish], [0, true]);
  // The person marks it for everyone; an agent cannot.
  const marked = await vault.get(made.id);
  await vault.put({ ...marked.post, visibility: 'public' }, marked.version);
  // Marking it for everyone published nothing.
  assert.equal(repository.size, 1);
  const status = await tools.call('vault_status');
  // One post to create, and the member's publication, which the first publish makes.
  assert.deepEqual([status.changes, status.create.map(each => each.slug), status.notInVault], [2, ['the-hill'], [{ key: 'from-elsewhere', title: 'From elsewhere' }]]);
  assert.deepEqual(status.publication, { create: true, url: 'https://pds.example.test', name: 'pds.example.test' });
  assert.equal(status.writes, undefined);

  const shown = await tools.call('vault_publish');
  assert.deepEqual([shown.done, shown.willHappen.create.map(each => each.address)], [false, ['https://pds.example.test/posts/photographs/the-hill']]);
  assert.match(shown.willHappen.note, /public at once/);
  assert.equal(repository.size, 1);
  await assert.rejects(tools.call('vault_publish', { confirm: 'c0000000000000000' }), /has changed since it was shown/);
  const done = await tools.call('vault_publish', { confirm: shown.confirm });
  assert.deepEqual([done.done, done.published], [true, { created: 1, replaced: 0, removed: 0, files: 1 }]);
  // The record is under the post's ID, and carries a copy of the picture with where it came from.
  const record = repository.get(made.id);
  assert.deepEqual([record.$type, record.slug, record.title, record.form], ['com.ohmmmm.post', 'the-hill', 'The hill', 'writing']);
  assert.match(record.body, /!\[The hill at dawn\]\(media:hill\)/);
  assert.deepEqual(record.media, [{ $type: 'com.ohmmmm.post#image', id: 'hill', file: { $type: 'blob', ref: { $link: 'bafkreitest1' }, mimeType: 'image/png', size: 7 }, sourceUrl: 'https://photos.example.test/hill.png', alt: 'The hill at dawn' }]);
  assert.deepEqual(uploads, [{ size: 7, mime: 'image/png' }]);
  // The first publish made the member's publication, once.
  assert.deepEqual([publication.written, publication.record.url], [1, 'https://pds.example.test']);
  // What something else published is still there, and the private post never left the vault.
  assert.deepEqual([...repository.keys()].sort(), [made.id, 'from-elsewhere'].sort());
  assert.deepEqual([(await tools.call('vault_status')).changes, (await tools.call('vault_status')).unchanged], [0, 1]);

  // An edit is in the vault only, until it is published.
  const read = await tools.call('vault_read', { key: 'the-hill' });
  await confirmed('vault_save', { key: 'the-hill', version: read.version, title: 'The hill, again' });
  assert.equal(repository.get(made.id).title, 'The hill');
  assert.deepEqual((await tools.call('vault_status')).replace, [{ id: made.id, slug: 'the-hill', title: 'The hill, again', changes: ['title'] }]);
  // A yes to one list is not a yes to another: the vault changed after this was shown.
  const stale = await tools.call('vault_publish');
  const again = await tools.call('vault_read', { key: 'the-hill' });
  await confirmed('vault_save', { key: 'the-hill', version: again.version, subtitle: 'At dawn' });
  await assert.rejects(tools.call('vault_publish', { confirm: stale.confirm }), /has changed since it was shown/);
  assert.deepEqual((await confirmed('vault_publish', {})).published, { created: 0, replaced: 1, removed: 0, files: 1 });
  assert.deepEqual([repository.get(made.id).title, repository.get(made.id).subtitle], ['The hill, again', 'At dawn']);

  // Changing it back to friends takes it down, on publish and not before.
  // An agent may only ask for a takedown; the person changes it.
  assert.equal((await confirmed('vault_set_visibility', { key: 'the-hill', to: 'friends' })).requested, true);
  assert.equal((await vault.get(made.id)).post.visibility, 'public');
  const back = await vault.get(made.id);
  await vault.put({ ...back.post, visibility: 'friends' }, back.version);
  assert.ok(repository.has(made.id));
  const down = await tools.call('vault_publish');
  assert.deepEqual(down.willHappen.remove, [{ key: made.id, why: 'The published record will be taken down.' }]);
  assert.deepEqual((await tools.call('vault_publish', { confirm: down.confirm })).published, { created: 0, replaced: 0, removed: 1, files: 0 });
  assert.deepEqual([...repository.keys()], ['from-elsewhere']);
  assert.equal(publication.written, 1);
});

test('friends tools preview changes, enforce versions and use the reader’s own DID', async () => {
  const { tools, asked, blocks, ask } = await toolsOf();
  const reader = 'did:web:reader.example.test';
  const block = { id: newPostId(), path: 'reading/first.md', text: '---\nkind: text\nvisibility: friends\n---\n\nCollected words.' };
  await assert.rejects(tools.call('vault_friends_save', { block: { ...block, text: 'A private block.' } }), /visibility: friends/);
  await assert.rejects(tools.call('vault_friends_save', { block: { ...block, text: block.text.replace('friends', 'public') } }), /visibility: friends/);
  assert.deepEqual(asked, []);
  const preview = await tools.call('vault_friends_save', { block });
  assert.equal(preview.done, false);
  assert.match(preview.willHappen.warning, /can read/);
  assert.deepEqual((await tools.call('vault_friends_list')).blocks, []);
  await assert.rejects(tools.call('vault_friends_save', { block: { ...block, text: block.text + ' Changed.' }, confirm: preview.confirm }), /has changed since it was shown/);
  const { version } = await tools.call('vault_friends_save', { block, confirm: preview.confirm });
  const list = await tools.call('vault_friends_list');
  assert.equal(list.blocks[0].id, block.id);
  assert.deepEqual(await tools.call('vault_friends_read', { id: block.id }), { block, version });
  await assert.rejects(ask('addFriend', { body: { did: reader } }), { code: 'SignInRequired' });
  assert.equal(REQUESTS['com.ohmmmm.vault.addFriend'].asks, 'ohm');
  await assert.rejects(tools.call('vault_friends_add', { did: reader }), /There is no tool/);
  const shared = createTools({ vault: {
    listShared: owner => ask('listShared', { query: { owner }, reader }),
    getShared: (owner, id) => ask('getShared', { query: { owner, id }, reader }),
  } });
  await assert.rejects(shared.call('vault_shared_list', { owner: did }), /Nothing here is shared/);
  await blocks.addFriend(did, reader);
  assert.equal((await tools.call('vault_friends_who')).friends[0].did, reader);
  assert.equal((await shared.call('vault_shared_list', { owner: did })).blocks[0].id, block.id);
  assert.deepEqual(await shared.call('vault_shared_read', { owner: did, id: block.id }), { block, version });
  const edit = { block: { ...block, text: block.text + ' More.' }, replaces: version };
  const deletion = { id: block.id, replaces: version };
  const removeBlock = await tools.call('vault_friends_delete', deletion);
  const saveEdit = await tools.call('vault_friends_save', edit);
  const edited = await tools.call('vault_friends_save', { ...edit, confirm: saveEdit.confirm });
  await assert.rejects(tools.call('vault_friends_delete', { ...deletion, confirm: removeBlock.confirm }), /has changed/);
  await assert.rejects(tools.call('vault_friends_save', { ...edit, block: { ...block, text: block.text + ' Stale.' },
    confirm: (await tools.call('vault_friends_save', { ...edit, block: { ...block, text: block.text + ' Stale.' } })).confirm }), /has changed/);
  const unfriend = await tools.call('vault_friends_remove', { did: reader });
  assert.equal((await shared.call('vault_shared_list', { owner: did })).blocks.length, 1);
  await assert.rejects(tools.call('vault_friends_remove', { did: reader, confirm: saveEdit.confirm }), /has changed since it was shown/);
  await tools.call('vault_friends_remove', { did: reader, confirm: unfriend.confirm });
  await assert.rejects(shared.call('vault_shared_read', { owner: did, id: block.id }), /Nothing here is shared/);
  const latestDeletion = { ...deletion, replaces: edited.version };
  const confirmed = await tools.call('vault_friends_delete', latestDeletion);
  assert.equal((await tools.call('vault_friends_delete', { ...latestDeletion, confirm: confirmed.confirm })).removed, true);
  assert.deepEqual((await tools.call('vault_friends_list', { since: list.cursor })).blocks, [{ id: block.id, removed: true }]);
  await assert.rejects(tools.call('vault_friends_read', { id: block.id }), /There is no such block/);
});

test('each tool names real API requests, and vault tools ask only for what they declare', async () => {
  const { tools, asked, seed } = await toolsOf();
  // Dated, so the publish plan is the same on both calls.
  const made = await seed('hello', { body: 'A first post.', visibility: 'public', date: '2026-11-01' });
  await seed('another');
  const calls = {
    vault_tree: [{}], vault_list: [{}], vault_read: [{ key: 'hello' }], vault_search: [{ query: 'first' }],
    vault_save: [{ key: 'hello', version: made.version, body: 'A first post, again.' }],
    vault_set_visibility: [{ key: 'hello', to: 'friends' }],
    vault_status: [{}],
    vault_publish: [{}],
    vault_mirror: [{}],
    vault_delete: [{ key: 'another' }],
  };
  for (const tool of TOOLS) {
    // Every request a tool names is one the service has, and reading tools name none that change anything.
    const request = name => REQUESTS[name.includes('.') ? name : `com.ohmmmm.vault.${name}`];
    for (const name of tool.requests) assert.ok(request(name), `${tool.name} names ${name}`);
    if (tool.annotations?.readOnlyHint) assert.deepEqual(tool.requests.filter(name => request(name).changes), [], tool.name);
    for (const args of calls[tool.name] ?? []) {
      asked.length = 0;
      const first = await tools.call(tool.name, args);
      if (first.confirm) await tools.call(tool.name, { ...args, confirm: first.confirm });
      assert.deepEqual([...new Set(asked)].filter(name => !tool.requests.includes(name)), [], `${tool.name} asked for more than it names`);
    }
  }
});

test('the server speaks the protocol: it lists the tools, answers calls, and reports a refusal as a result', async () => {
  const { tools } = await toolsOf();
  const handle = createServer({ tools, list: OFFERED });
  const ask = (method, params, id = 1) => handle({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });

  const hello = await ask('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  assert.deepEqual([hello.result.protocolVersion, hello.result.capabilities, hello.result.serverInfo.name], ['2025-03-26', { tools: {} }, 'ohm-vault']);
  assert.equal((await ask('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion, '2025-06-18');
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined);
  assert.deepEqual((await ask('ping')).result, {});

  const listed = (await ask('tools/list')).result.tools;
  assert.deepEqual(listed.map(tool => tool.name),
    ['vault_tree', 'vault_list', 'vault_read', 'vault_search', 'vault_save', 'vault_set_visibility', 'vault_status', 'vault_publish', 'vault_mirror', 'vault_delete',
      'vault_friends_list', 'vault_friends_read', 'vault_friends_save', 'vault_friends_delete', 'vault_friends_who', 'vault_friends_remove', 'vault_shared_list', 'vault_shared_read']);
  // An agent is told a tool's name, what it does and what it takes, and nothing else.
  for (const tool of listed) assert.deepEqual([tool.inputSchema.type, Object.keys(tool).filter(key => !['name', 'description', 'inputSchema', 'annotations'].includes(key))], ['object', []]);
  // Only the tools that read are marked as changing nothing.
  assert.deepEqual(listed.filter(tool => tool.annotations?.readOnlyHint).map(tool => tool.name),
    ['vault_tree', 'vault_list', 'vault_read', 'vault_search', 'vault_status', 'vault_friends_list', 'vault_friends_read', 'vault_friends_who', 'vault_shared_list', 'vault_shared_read']);

  const saved = await ask('tools/call', { name: 'vault_save', arguments: { key: 'hello', body: 'A first post.' } });
  assert.equal(saved.result.isError, true);
  const refused = await ask('tools/call', { name: 'vault_read', arguments: { key: 'missing' } });
  assert.deepEqual([refused.result.isError, refused.result.content[0].text], [true, 'No post uses "missing".']);
  assert.equal((await ask('resources/list')).error.code, -32601);
  assert.equal((await handle({ id: 4, method: 'ping' })).error.code, -32600);
});

test('the server starts on its own and answers over standard input and output', async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../mcp/server.mjs', import.meta.url))], {
    cwd: fileURLToPath(new URL('../test/', import.meta.url)), stdio: ['pipe', 'pipe', 'inherit'],
  });
  let out = '';
  child.stdout.on('data', chunk => { out += chunk; });
  for (const message of [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    // There is no site configuration in this folder, and the tool says so instead of failing.
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'vault_tree', arguments: {} } },
  ]) child.stdin.write(`${JSON.stringify(message)}\n`);
  child.stdin.end();
  const code = await new Promise(resolve => child.on('close', resolve));
  const lines = out.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(code, 0);
  assert.deepEqual(lines.map(line => line.id), [1, 2, 3]);
  assert.equal(lines[1].result.tools.length, 18);
  assert.match(lines[0].result.instructions, /Saving never publishes/);
  assert.equal(lines[2].result.isError, true);
  assert.match(lines[2].result.content[0].text, /No site configuration here/);
});
