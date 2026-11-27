// Posts from the network (home/network.mjs): Jetstream for who the person follows, and Discover from a
// feed generator. Synthetic accounts and posts; nothing here reaches the network.
import assert from 'node:assert/strict';
import test from 'node:test';
import { DISCOVER_FEEDS, discover, followsOf, JETSTREAM, KEPT, liveFollowing, postOfEvent, postOfView, resolveHandle } from '../home/network.mjs';

const A = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const event = (did, rkey, text, at, record = {}) => ({
  did, time_us: Date.parse(at) * 1000, kind: 'commit',
  commit: { operation: 'create', collection: 'app.bsky.feed.post', rkey, cid: `cid-${rkey}`, record: { $type: 'app.bsky.feed.post', text, createdAt: at, ...record } },
});

// A fetch that answers the AppView's reads from fixtures, and remembers what was asked.
function appview(pages) {
  const asked = [];
  const fetchImpl = async url => {
    asked.push(url);
    const path = new URL(url).pathname.split('/').at(-1);
    const body = typeof pages[path] === 'function' ? pages[path](new URL(url)) : pages[path];
    return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response('{}', { status: 404 });
  };
  return { fetchImpl, asked };
}

test('a Jetstream event is a post with its words, pictures, link and reply; anything else is not', () => {
  const authors = new Map([[A, { did: A, handle: 'ana.example.com', name: 'Ana', avatar: null }]]);
  const post = postOfEvent(event(A, '3k1', 'Lanterns tonight', '2026-11-27T10:00:00.000Z', {
    reply: { parent: { uri: `at://${B}/app.bsky.feed.post/3k0` } },
    embed: { $type: 'app.bsky.embed.images', images: [{ alt: 'a lantern', image: { ref: { $link: 'bafyimg' } } }] },
  }), authors);
  assert.equal(post.uri, `at://${A}/app.bsky.feed.post/3k1`);
  assert.equal(post.author.name, 'Ana');
  assert.equal(post.text, 'Lanterns tonight');
  assert.equal(post.replyTo, `at://${B}/app.bsky.feed.post/3k0`);
  assert.deepEqual(post.images, [{ thumb: `https://cdn.bsky.app/img/feed_thumbnail/plain/${A}/bafyimg@jpeg`, alt: 'a lantern' }]);
  const linked = postOfEvent(event(A, '3k2', '', '2026-11-27T10:00:00.000Z', { embed: { $type: 'app.bsky.embed.external', external: { uri: 'https://x.example.org/', title: 'X', description: 'about x' } } }));
  assert.deepEqual(linked.link, { uri: 'https://x.example.org/', title: 'X', description: 'about x', thumb: null });
  assert.equal(postOfEvent({ ...event(A, '3k3', 'x', '2026-11-27T10:00:00.000Z'), commit: { operation: 'delete', collection: 'app.bsky.feed.post', rkey: '3k3' } }), null);
  assert.equal(postOfEvent({ did: A, kind: 'identity' }), null);
});

test('who someone follows is read page by page, and Discover from a feed generator', async () => {
  const { fetchImpl, asked } = appview({
    'com.atproto.identity.resolveHandle': { did: A },
    'app.bsky.graph.getFollows': url => (url.searchParams.get('cursor')
      ? { follows: [{ did: 'did:plc:cccccccccccccccccccccccc', handle: 'cy.example.com' }] }
      : { follows: [{ did: B, handle: 'bo.example.com', displayName: 'Bo', avatar: 'https://cdn.example/bo.jpg' }], cursor: 'next' }),
    'app.bsky.feed.getFeed': { feed: [{ post: { uri: `at://${B}/app.bsky.feed.post/1`, cid: 'c1', author: { did: B, handle: 'bo.example.com', displayName: 'Bo' }, record: { text: 'Hot new open model', createdAt: '2026-11-27T09:00:00.000Z' }, embed: { $type: 'app.bsky.embed.images#view', images: [{ thumb: 'https://cdn.example/t.jpg', alt: '' }] } } }] },
  });
  assert.equal(await resolveHandle('ana.example.com', fetchImpl), A);
  assert.equal(await resolveHandle(A, fetchImpl), A);
  const follows = await followsOf(A, fetchImpl);
  assert.deepEqual(follows.map(each => [each.did, each.name]), [[B, 'Bo'], ['did:plc:cccccccccccccccccccccccc', 'cy.example.com']]);
  // Discover blends its feeds: each post once, newest first, whichever feeds answer.
  const hot = await discover({ fetchImpl });
  assert.deepEqual(hot.map(post => [post.author.name, post.text, post.images[0].thumb]), [['Bo', 'Hot new open model', 'https://cdn.example/t.jpg']]);
  for (const feed of DISCOVER_FEEDS) assert.ok(asked.some(url => url.includes(encodeURIComponent(feed))), feed);
  // Threads first: replies on their own are left out, and what was talked about ranks above what was not.
  const now = new Date().toISOString();
  const view = (n, extra = {}) => ({ post: { uri: `at://${B}/app.bsky.feed.post/${n}`, author: { did: B, handle: 'bo.example.com' }, record: { text: n, createdAt: now, ...extra.record }, replyCount: extra.replies ?? 0, likeCount: 0, repostCount: 0 } });
  const ranked = await discover({ feeds: ['at://x/app.bsky.feed.generator/one'], fetchImpl: async () => new Response(JSON.stringify({ feed: [
    view('quiet notes on how agents plan their work'), view('what we learned about LLMs this week', { replies: 5 }), view('my weekend', { replies: 50 }), view('Smart Money DUMPED $13,798 of #NEAR AI agents', { replies: 9 }), view('#AI #ML #agents www.example.com'), view('a reply', { replies: 9, record: { reply: { parent: { uri: 'at://x/app.bsky.feed.post/p' } } } }),
  ] })) });
  // Only what is about AI stays, however talked about the rest is.
  assert.deepEqual(ranked.map(post => post.text), ['what we learned about LLMs this week', 'quiet notes on how agents plan their work']);
  const failing = async () => new Response('{}', { status: 502 });
  await assert.rejects(discover({ fetchImpl: failing }));
  assert.equal(postOfView({ uri: 'at://x/app.bsky.feed.post/2', author: { did: B, handle: 'bo.example.com' }, record: { text: 'plain' }, indexedAt: '2026-11-27T08:00:00.000Z' }).author.name, 'bo.example.com');
});

test('following: Jetstream for exactly who is followed, newest first, kept to a limit, and reconnected', async () => {
  const sockets = [];
  class FakeSocket {
    constructor(url) { this.url = url; this.sent = []; this.listeners = {}; sockets.push(this); queueMicrotask(() => this.emit('open')); }
    addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
    emit(type, data) { for (const listener of this.listeners[type] ?? []) listener(data); }
    send(message) { this.sent.push(JSON.parse(message)); }
    close() { this.emit('close'); }
  }
  const { fetchImpl } = appview({
    'com.atproto.identity.resolveHandle': { did: A },
    'app.bsky.graph.getFollows': { follows: [{ did: B, handle: 'bo.example.com', displayName: 'Bo' }] },
  });
  const live = liveFollowing({ handle: 'ana.example.com', fetchImpl, WebSocketImpl: FakeSocket, now: () => Date.parse('2026-11-27T12:00:00.000Z'), retry: 1 });
  await live.start();
  await new Promise(done => setTimeout(done, 5));
  const [socket] = sockets;
  assert.ok(socket.url.startsWith(`${JETSTREAM}?wantedCollections=app.bsky.feed.post&requireHello=true&cursor=`));
  // It starts six hours back, so the feed has something at once.
  assert.equal(Number(new URL(socket.url).searchParams.get('cursor')), Date.parse('2026-11-27T06:00:00.000Z') * 1000);
  assert.deepEqual(socket.sent, [{ type: 'options_update', payload: { wantedCollections: ['app.bsky.feed.post'], wantedDids: [B] } }]);
  assert.deepEqual(live.state(), { connected: true, following: 1, problem: null });
  socket.emit('message', { data: JSON.stringify(event(B, '1', 'first', '2026-11-27T10:00:00.000Z')) });
  socket.emit('message', { data: JSON.stringify(event(B, '2', 'second', '2026-11-27T11:00:00.000Z')) });
  socket.emit('message', { data: 'not json' });
  assert.deepEqual(live.posts().map(post => [post.text, post.author.name]), [['second', 'Bo'], ['first', 'Bo']]);
  for (let i = 0; i < KEPT + 5; i++) live._keep(event(B, `k${i}`, `n${i}`, new Date(Date.parse('2026-11-27T11:30:00.000Z') + i * 1000).toISOString()));
  assert.equal(live.posts(1000).length, KEPT);
  assert.equal(live.posts(1)[0].text, `n${KEPT + 4}`);
  // Dropped, it connects again from the last event it saw.
  socket.emit('close');
  await new Promise(done => setTimeout(done, 20));
  assert.equal(sockets.length, 2);
  assert.equal(new URL(sockets[1].url).searchParams.get('cursor'), String(Date.parse('2026-11-27T11:00:00.000Z') * 1000));
  live.stop();
});
