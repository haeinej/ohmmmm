import test from 'node:test';
import assert from 'node:assert/strict';
import { ohmLive, serviceSource } from '../index.mjs';

const did = 'did:web:alice.example.com';
const media = { name: 'sha256-' + 'a'.repeat(64), type: 'image/png', alt: 'A tree' };
const publicPost = {
  id: 'one', layer: 'public', kind: 'post', channel: 'essays', channels: [], slug: 'first',
  address: '/posts/essays/first', created: '2026-01-02T03:04:05Z',
  body: `**Public** essay. [Here](at://${did}/com.ohmmmm.post/one) [Elsewhere](at://${did}/com.ohmmmm.post/other)`,
};
const friendsPost = {
  id: 'two', layer: 'friends', kind: 'media', channel: 'garden', channels: ['essays'], slug: 'tree',
  media, body: '**Friends** only\n\n![[tree.png|Tree]]\n\n`![[example.png]]`\n\n![[other.png]]\n\n<script>blocked()</script>',
};
const privatePost = { ...friendsPost, id: 'three', layer: 'private' };
const entries = [publicPost, friendsPost, privatePost];
const { body: _public, ...publicHead } = publicPost;
const { body: _friends, ...friendsHead } = friendsPost;

function setup(options = {}, override = () => undefined) {
  const requests = [];
  let friend = true;
  const source = serviceSource({
    origin: 'https://service.example.com', site: 'https://alice.example.com', did, ...options,
    async get(url, init) {
      const method = url.pathname.split('.').at(-1);
      const token = new Headers(init.headers).get('authorization');
      const { id, cursor, channel, name } = Object.fromEntries(url.searchParams);
      assert.equal(url.searchParams.get('did'), did);
      assert.equal(init.redirect, 'error');
      assert.equal(init.cache, 'no-store');
      requests.push({ method, token, id, cursor, channel, name });
      const overridden = override({ method, token, id, cursor });
      if (overridden) return overridden;
      if (token === 'Bearer expired') return new Response('expired', { status: 401 });
      const allowed = token === 'Bearer friend' && friend;
      if (method === 'listBlocks') {
        return Response.json({ owner: did, publicStale: '2026-01-02T03:04:05Z', ...(
          !cursor ? { blocks: [publicHead], cursor: '1' } : { blocks: allowed ? [friendsHead, privatePost] : [] }
        ) });
      }
      if (method === 'getMedia' && allowed && name === media.name) {
        return new Response('image bytes', {
          headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=31536000, immutable' },
        });
      }
      const block = method === 'getBlock' && entries.find(entry => entry.id === id);
      if (block && (block.layer === 'public' || allowed)) return Response.json({ owner: did, block });
      return new Response(null, { status: 404 });
    },
  });
  return { source, requests, revoke: () => { friend = false; } };
}

test('service public source reads complete anonymous snapshots and accepts the service public copy', async () => {
  const { source, requests } = setup();
  const [entry, extra] = await source.read({ channel: 'essays', viewerToken: 'friend' });
  assert.equal(extra, undefined);
  assert.equal(entry.id, 'one');
  assert.equal(entry.data.permalink, publicPost.address);
  assert.equal(entry.data.canonicalUrl, `https://alice.example.com${publicPost.address}`);
  assert.equal(entry.data.uri, `at://${did}/site.standard.document/one`);
  assert.equal(entry.data.publishedAt, publicPost.created);
  assert.match(entry.rendered.html, /<strong>Public<\/strong>/);
  assert.match(entry.rendered.html, /href="\/posts\/essays\/first">Here/);
  assert.match(entry.rendered.html, /href="at:\/\/did:web:alice\.example\.com\/com\.ohmmmm\.post\/other">Elsewhere/);
  assert.deepEqual(requests.map(({ method, cursor, token }) => [method, cursor, token]), [
    ['listBlocks', undefined, null], ['listBlocks', '1', null], ['getBlock', undefined, null],
  ]);
});

test('public fallback handles absence or outage without silently replacing a malformed snapshot', async () => {
  const calls = [];
  const fallback = { async read(options) { calls.push(options); return []; } };
  for (const response of [
    new Response(null, { status: 404 }), new Response(null, { status: 502 }),
    Response.json({ owner: did, blocks: [], publicUnavailable: true }),
  ]) {
    const { source } = setup({ fallback }, () => response);
    assert.deepEqual(await source.read({ channel: 'essays' }), []);
  }
  const { source } = setup({ fallback }, () => Response.json({ owner: did, blocks: [], cursor: 'same' }));
  await assert.rejects(source.read({ channel: 'essays' }), /invalid cursor/);
  const changed = setup({ fallback }, ({ method }) => method === 'getBlock' ? new Response(null, { status: 404 }) : undefined);
  await assert.rejects(changed.source.read({ channel: 'essays' }), /HTTP 404/);
  assert.deepEqual(calls, Array(3).fill({ channel: 'essays' }));
});

test('live reads use only the current viewer and expose only Friends entries from the selected channel', async () => {
  const { source, requests, revoke } = setup({ mediaPath: name => `/friends/media/${name}` });
  const loader = ohmLive({ source, channel: 'essays' });
  assert.deepEqual(await loader.loadCollection({}), { entries: [] });
  assert.equal(requests.length, 0);
  const filter = { viewerToken: 'friend' };
  const [allowed, stranger] = await Promise.all([
    loader.loadCollection({ filter }), loader.loadCollection({ filter: { viewerToken: 'stranger' } }),
  ]);
  assert.deepEqual(allowed.entries.map(({ id }) => id), ['two']);
  assert.deepEqual(stranger, { entries: [] });
  const entry = await loader.loadEntry({ filter: { ...filter, id: 'two' } });
  assert.equal(entry.data.layer, 'friends');
  assert.equal(entry.body, friendsPost.body);
  assert.equal(entry.data.media.url, `/friends/media/${media.name}`);
  assert.match(entry.rendered.html, /<strong>Friends<\/strong>/);
  assert.match(entry.rendered.html, /alt="A tree"/);
  assert.match(entry.rendered.html, /<code>!\[\[example\.png\]\]<\/code>/);
  assert.match(entry.rendered.html, /!\[\[other\.png\]\]/);
  assert.doesNotMatch(entry.rendered.html, /<script>/);
  for (const id of ['one', 'three', 'missing']) {
    const { error } = await loader.loadEntry({ filter: { ...filter, id } });
    assert.equal(error.status, 404);
    assert.doesNotMatch(error.message, /viewerToken|missing/);
  }
  const other = ohmLive({ source, channel: 'other' });
  assert.equal((await other.loadEntry({ filter: { ...filter, id: 'two' } })).error.status, 404);
  const expired = await loader.loadEntry({ filter: { id: 'two', viewerToken: 'expired' } });
  assert.equal(expired.error.status, 401);
  assert.doesNotMatch(expired.error.message, /expired/);
  revoke();
  assert.equal((await loader.loadEntry({ filter: { ...filter, id: 'two' } })).error.status, 404);
});

test('Friends still load when public is unavailable, and media uses fresh viewer authorization', async () => {
  const { source, requests, revoke } = setup({}, ({ method, token, cursor }) => {
    if (method === 'listBlocks' && token && !cursor) {
      return Response.json({ owner: did, blocks: [friendsHead], publicUnavailable: true });
    }
  });
  const options = { name: media.name, viewerToken: 'friend' };
  const loader = ohmLive({ source, channel: 'essays' });
  assert.equal((await loader.loadCollection({ filter: options })).entries[0].id, 'two');
  const response = await source.readMedia(options);
  assert.equal(await response.text(), 'image bytes');
  assert.equal(response.headers.get('Content-Type'), 'image/png');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  await assert.rejects(source.readMedia({ name: media.name }), { status: 401 });
  revoke();
  await assert.rejects(source.readMedia(options), { status: 404 });
  assert.equal(requests.filter(({ method }) => method === 'getMedia').length, 2);
});
