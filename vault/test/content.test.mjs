// Content for sites (service/src/content.mjs, viewers.mjs): what a member's website may show, read
// by their DID. Public is what is on their PDS; Friends only for a viewer they let in; never private.
// Every person here is invented.
import assert from 'node:assert/strict';
import test from 'node:test';
import { blockStore } from '../service/src/blocks.mjs';
import { channelStore } from '../service/src/channels.mjs';
import { audienceOf, forgetPublished, sees } from '../service/src/content.mjs';
import { links } from '../service/src/ohm.mjs';
import { postStore } from '../service/src/store.mjs';
import { makeViewerToken, viewerOf } from '../service/src/viewers.mjs';
import { createService } from '../service/src/worker.mjs';
import { newPostId } from '../vault/file.mjs';
import { testDatabase } from './d1.mjs';
import { CONTENT, DOCUMENT, toDocument } from './standard.mjs';

const owner = 'did:web:pds.ada.test';
const friend = 'did:web:pds.bo.test';
const stranger = 'did:web:pds.cy.test';
const SECRET = 'a test secret that is long enough to sign with';
const APP = 'https://app.ohmmmm.test';
const SITE = 'https://ada.example.test';
let made = 0;
const id = () => newPostId(Date.parse('2026-11-24T00:00:00Z') + made++, 3);

async function setUp() {
  const env = { DB: await testDatabase(), MEMBERS: `${owner},${friend},${stranger}`, OHM_APP_ORIGIN: APP, VIEWER_TOKEN_SECRET: SECRET };
  const published = id();
  // What Ada published: one post on her PDS, as a standard.site document.
  const record = { $type: CONTENT, title: 'On rain', slug: 'on-rain', label: 'essays', sublabel: '', body: 'It rained.', publishedAt: '2026-11-01T00:00:00.000Z' };
  const repository = [[published, toDocument(record, { did: owner, site: SITE })]];
  const sessions = new Map();
  let pdsReads = 0;
  const pds = { down: false };
  const get = async (url, options) => {
    if (String(url) === `${APP}/api/auth/get-session`) {
      const user = sessions.get(options.headers.Cookie);
      return Response.json(user ? { user } : null);
    }
    if (url.pathname === '/xrpc/com.atproto.repo.listRecords' && url.searchParams.get('collection') === DOCUMENT) {
      if (pds.down) return new Response('down', { status: 503 });
      pdsReads++;
      return Response.json({ records: repository.map(([key, value]) => ({ uri: `at://${owner}/${DOCUMENT}/${key}`, value })) });
    }
    return Response.json({ records: [] });
  };
  // A member's token here is their DID, as in the MCP tests: content reads never use it.
  const whoIs = Object.assign(async request => request.headers.get('Authorization').slice(7), { pdsFor: async did => (did === owner ? 'https://pds.ada.test' : null) });
  const service = createService({ whoIs, get });
  const ask = async (name, { query = {}, bearer, cookie, origin, body } = {}) => {
    const url = new URL(`https://vault.ohmmmm.test/xrpc/com.ohmmmm.content.${name}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return service(new Request(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env);
  };
  const json = async (...args) => { const response = await ask(...args); return { status: response.status, ...(await response.json()) }; };

  // Ada's friends layer: a friends-only block and post, a media block, and posts she has not published.
  const blocks = blockStore(env.DB), posts = postStore(env.DB);
  const walk = id(), photo = id(), letter = id(), draft = id(), secret = id();
  await blocks.write(owner, { id: walk, path: 'walks/yanaka.md', text: '---\nvisibility: friends\ntitle: Yanaka\norigin: ~/Desktop/private/yanaka.md\nby: agent:helper\n---\n\nA slow walk.\n' });
  await blocks.write(owner, { id: photo, path: 'walks/lantern.md', text: '---\nkind: media\nvisibility: friends\ntitle: Lantern\nhash: sha256-aa\nalt: A paper lantern\n---\n\n![[lantern.jpg]]\n' });
  await posts.write(owner, { id: letter, slug: 'a-letter', label: 'letters', sublabel: '', visibility: 'friends', title: 'A letter', body: 'Dear friends.', properties: {} });
  // Marked public but never published: no one sees it until Publish.
  await posts.write(owner, { id: draft, slug: 'not-yet', label: 'essays', sublabel: '', visibility: 'public', title: 'Not yet', body: 'Unpublished.', properties: {} });
  await posts.write(owner, { id: secret, slug: 'diary', label: 'diary', sublabel: '', visibility: 'private', title: 'Diary', body: 'Mine.', properties: {} });
  await channelStore(env.DB).write(owner, { path: 'walks', text: `---\ntitle: Walks\norder: [lantern, yanaka]\n---\n\nWhere I walked.\n` });
  await blocks.addFriend(owner, friend);
  return { env, ask, json, sessions, pds, get, ids: { published, walk, photo, letter, draft, secret }, reads: () => pdsReads };
}

test('anyone reads only what the member published, by DID, with no session', async () => {
  const { json, ids, reads } = await setUp();
  const channels = await json('listChannels', { query: { did: owner } });
  assert.equal(channels.status, 200);
  assert.deepEqual(channels.channels.map(channel => channel.path), ['essays']);
  const listed = await json('listBlocks', { query: { did: owner } });
  assert.deepEqual(listed.blocks.map(block => [block.id, block.layer, block.kind, block.channel, block.address]), [[ids.published, 'public', 'post', 'essays', `/posts/essays/on-rain`]]);
  assert.equal(listed.blocks[0].body, undefined);
  const read = await json('getBlock', { query: { did: owner, id: ids.published } });
  assert.equal(read.block.body, 'It rained.');
  // Marked public is not published; friends-only and private are not anyone's.
  for (const hidden of [ids.draft, ids.walk, ids.letter, ids.secret]) assert.equal((await json('getBlock', { query: { did: owner, id: hidden } })).error, 'NotFound');
  assert.equal((await json('getChannel', { query: { did: owner, path: 'walks' } })).error, 'NotFound');
  // The PDS is read once a minute at most for each member.
  assert.equal(reads(), 1);
  // Someone not let in to the service, or no DID, has nothing here.
  assert.equal((await json('listBlocks', { query: { did: 'did:web:pds.nobody.test' } })).error, 'NotFound');
  assert.equal((await json('listBlocks')).error, 'NotFound');
});

test('a friend with a viewer token also reads the friends layer; a stranger with one reads exactly what anyone does', async () => {
  const { json, ask, ids } = await setUp();
  const asFriend = await makeViewerToken(SECRET, { viewer: friend, owner });
  const asStranger = await makeViewerToken(SECRET, { viewer: stranger, owner });
  const listed = await json('listBlocks', { query: { did: owner }, bearer: asFriend });
  assert.deepEqual(listed.blocks.map(block => block.id).sort(), [ids.published, ids.walk, ids.photo, ids.letter].sort());
  assert.ok(!listed.blocks.some(block => [ids.draft, ids.secret].includes(block.id)), 'never unpublished public, never private');
  const walk = (await json('getBlock', { query: { did: owner, id: ids.walk }, bearer: asFriend })).block;
  assert.deepEqual([walk.layer, walk.channel, walk.title, walk.body.trim()], ['friends', 'walks', 'Yanaka', 'A slow walk.']);
  // Where a file came from and who made it stay with the member.
  assert.equal(JSON.stringify(walk).includes('Desktop'), false);
  assert.equal(walk.by, undefined);
  // A channel lists, in its order, only what the viewer may see.
  const walks = (await json('getChannel', { query: { did: owner, path: 'walks' }, bearer: asFriend })).channel;
  assert.deepEqual([walks.title, walks.description, walks.order, walks.count], ['Walks', 'Where I walked.', ['lantern', 'yanaka'], 2]);
  assert.deepEqual((await json('listBlocks', { query: { did: owner, channel: 'walks' }, bearer: asFriend })).blocks.map(block => block.slug), ['lantern', 'yanaka']);

  const strangers = await json('listBlocks', { query: { did: owner }, bearer: asStranger });
  const anyone = await json('listBlocks', { query: { did: owner } });
  assert.deepEqual(strangers, anyone);
  // A token for another member, a forged one, or one that ran out is refused, never read as anyone.
  const elsewhere = await makeViewerToken(SECRET, { viewer: friend, owner: stranger });
  const old = await makeViewerToken(SECRET, { viewer: friend, owner, now: Date.now() - 11 * 60 * 1000 });
  for (const bad of [elsewhere, old, `${asFriend.split('.')[0]}.AAAA`, 'nonsense']) {
    assert.equal((await json('listBlocks', { query: { did: owner }, bearer: bad })).error, 'ViewerTokenInvalid', bad);
  }
  // Media only when a block the viewer may see names it.
  assert.equal((await json('getMedia', { query: { did: owner, name: 'sha256-aa' } })).error, 'NotFound');
  assert.equal((await json('getMedia', { query: { did: owner, name: 'sha256-bb' }, bearer: asFriend })).error, 'NotFound');
  assert.equal((await ask('getMedia', { query: { did: owner, name: 'sha256-aa' }, bearer: asFriend })).status, 503, 'allowed, and the test has no media cache');
});

test('removing a friend takes effect on the next read, whatever token they hold', async () => {
  const { env, json, ids } = await setUp();
  const token = await makeViewerToken(SECRET, { viewer: friend, owner });
  assert.ok((await json('listBlocks', { query: { did: owner }, bearer: token })).blocks.some(block => block.id === ids.walk));
  await blockStore(env.DB).removeFriend(owner, friend);
  assert.deepEqual((await json('listBlocks', { query: { did: owner }, bearer: token })).blocks.map(block => block.id), [ids.published]);
});

test('who sees what is one rule: the audience and sees', async () => {
  const db = await testDatabase();
  await blockStore(db).addFriend(owner, friend);
  const anyone = await audienceOf(db, owner, null), mate = await audienceOf(db, owner, friend), self = await audienceOf(db, owner, owner);
  assert.deepEqual([anyone.layers, mate.layers, self.layers], [['public'], ['public', 'friends'], ['public']]);
  assert.equal(sees(mate, { layer: 'private' }), false);
  assert.equal(sees(anyone, { layer: 'friends' }), false);
  await assert.rejects(viewerOf('short', 'x.y', owner), { code: 'ViewersUnavailable' });
});

test('ohm hands a viewer token back only to one of the member\'s own sites, which only the member adds', async () => {
  const { env, ask, json, sessions } = await setUp();
  const view = (cookie, returnTo = `${SITE}/ohm/back`) => ask('view', { query: { owner, return: returnTo }, ...(cookie ? { cookie } : {}) });
  // Not one of Ada's sites yet.
  assert.equal((await (await view()).json()).error, 'NotTheirSite');
  // Only Ada, signed in to ohm and from ohm's pages, adds a site; her token alone cannot.
  sessions.set('session=ada', { id: 'u-ada' });
  await links(env.DB).connect('u-ada', owner);
  assert.equal((await json('addSite', { body: { origin: SITE }, bearer: owner })).error, 'SignInRequired');
  assert.equal((await json('addSite', { body: { origin: SITE }, cookie: 'session=ada' })).error, 'WrongOrigin');
  assert.deepEqual(await json('addSite', { body: { origin: `${SITE}/any/path` }, cookie: 'session=ada', origin: APP }), { status: 200, origin: SITE });
  assert.equal((await json('addSite', { body: { origin: 'http://ada.example.test' }, cookie: 'session=ada', origin: APP })).error, 'InvalidRequest');
  assert.deepEqual((await json('listSites', { bearer: owner })).sites.map(site => site.origin), [SITE]);
  assert.equal((await (await view(null, 'https://evil.example.test/back')).json()).error, 'NotTheirSite');

  // Signed out: the page posts back an error, and no token.
  const out = await view();
  assert.match(out.headers.get('Content-Security-Policy'), new RegExp(`form-action ${SITE}`));
  const outPage = await out.text();
  assert.match(outPage, /name="error" value="SignInRequired"/);
  assert.doesNotMatch(outPage, /name="viewer"/);
  // Signed in, with no AT Protocol account connected.
  sessions.set('session=dee', { id: 'u-dee' });
  assert.match(await (await view('session=dee')).text(), /value="NotConnected"/);
  // Bo, signed in: a token for Ada's content, posted to Ada's site.
  sessions.set('session=bo', { id: 'u-bo' });
  await links(env.DB).connect('u-bo', friend);
  const page = await (await view('session=bo')).text();
  assert.match(page, new RegExp(`action="${SITE}/ohm/back"`));
  const token = /name="viewer" value="([^"]+)"/.exec(page)[1];
  assert.equal(await viewerOf(SECRET, token, owner), friend);
  assert.ok((await json('listBlocks', { query: { did: owner }, bearer: token })).blocks.length > 1);
  // Once the site is removed, no token goes there.
  assert.deepEqual(await json('removeSite', { body: { origin: SITE }, bearer: owner }), { status: 200, origin: SITE, removed: true });
  assert.equal((await (await view('session=bo')).json()).error, 'NotTheirSite');
});

test('when the PDS is down, friends still read Friends, and the last public copy is served as stale', async () => {
  const { json, pds, get, ids } = await setUp();
  const asFriend = await makeViewerToken(SECRET, { viewer: friend, owner });
  // Down before anything was ever read: Friends is served, and the answer says public is not.
  pds.down = true;
  const first = await json('listBlocks', { query: { did: owner }, bearer: asFriend });
  assert.equal(first.status, 200);
  assert.equal(first.publicUnavailable, true);
  assert.deepEqual(first.blocks.map(block => block.id).sort(), [ids.walk, ids.photo, ids.letter].sort());
  assert.deepEqual((await json('listBlocks', { query: { did: owner } })).blocks, []);
  // Up again: read, and a copy kept.
  pds.down = false;
  const fresh = await json('listBlocks', { query: { did: owner } });
  assert.deepEqual([fresh.blocks.map(block => block.id), fresh.publicStale, fresh.publicUnavailable], [[ids.published], undefined, undefined]);
  // Down once more, after the minute's memory: the copy, marked with when it was read.
  pds.down = true;
  forgetPublished(get);
  const stale = await json('getBlock', { query: { did: owner, id: ids.published } });
  assert.equal(stale.block.body, 'It rained.');
  assert.match(stale.publicStale, /^\d{4}-\d\d-\d\dT/);
  const both = await json('listBlocks', { query: { did: owner }, bearer: asFriend });
  assert.equal(both.blocks.length, 4);
});
