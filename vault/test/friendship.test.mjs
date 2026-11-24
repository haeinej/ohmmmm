// Friends approved like devices (service/src/friendship.mjs): someone signed in to ohm asks; the
// member sees their name and email and approves them, for every channel or some. The same channels
// hold for the friends tools and for a site's content reads, and for the friend's own agents, which
// read as the friend. Every person here is invented.
import assert from 'node:assert/strict';
import test from 'node:test';
import { blockStore } from '../service/src/blocks.mjs';
import { contentStore } from '../service/src/content.mjs';
import { links } from '../service/src/ohm.mjs';
import { createService } from '../service/src/worker.mjs';
import { newPostId } from '../vault/file.mjs';
import { testDatabase } from './d1.mjs';

const ada = 'did:web:pds.ada.test';
const bo = 'did:web:pds.bo.test';
const APP = 'https://app.ohmmmm.test';
let made = 0;
const id = () => newPostId(Date.parse('2026-11-24T00:00:00Z') + made++, 5);

async function setUp() {
  const env = { DB: await testDatabase(), MEMBERS: '*', OHM_APP_ORIGIN: APP };
  const sessions = new Map([
    ['session=ada', { id: 'u-ada', name: 'Ada', email: 'ada@example.test' }],
    ['session=bo', { id: 'u-bo', name: 'Bo', email: 'bo@example.test' }],
    ['session=cy', { id: 'u-cy', name: 'Cy', email: 'cy@example.test' }],
  ]);
  await links(env.DB).connect('u-ada', ada);
  await links(env.DB).connect('u-bo', bo);
  const get = async (url, options) => (String(url) === `${APP}/api/auth/get-session` ? Response.json({ user: sessions.get(options.headers.Cookie) ?? null }) : Response.json({ records: [] }));
  // A token here is its holder's DID: Bo's agent holds Bo's.
  const service = createService({ whoIs: Object.assign(async request => request.headers.get('Authorization').slice(7), { pdsFor: async () => 'https://pds.ada.test' }), get });
  const ask = async (name, { query, body, as, cookie } = {}) => {
    const url = new URL(`https://vault.ohmmmm.test/xrpc/com.ohmmmm.vault.${name}`);
    if (query) url.search = new URLSearchParams(query);
    const response = await service(new Request(url, {
      method: body ? 'POST' : 'GET',
      headers: { ...(cookie ? { Cookie: cookie, Origin: APP } : { Authorization: `Bearer ${as}` }), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), env);
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.message), { code: data.error });
    return data;
  };
  const blocks = blockStore(env.DB);
  const walk = id(), recipe = id();
  await blocks.write(ada, { id: walk, path: 'walks/yanaka.md', text: '---\nkind: text\nvisibility: friends\ntitle: Yanaka\n---\n\nA slow walk.\n' });
  await blocks.write(ada, { id: recipe, path: 'kitchen/soup.md', text: '---\nkind: text\nvisibility: friends\ntitle: Soup\nchannels: [walks/food]\n---\n\nA soup.\n' });
  return { env, ask, walk, recipe };
}

test('someone signed in asks; the member sees who, by name and email, and approves them for some channels', async () => {
  const { env, ask, walk, recipe } = await setUp();
  // Not a friend: nothing is shared, the same as if there were nothing.
  await assert.rejects(ask('listShared', { query: { owner: ada }, as: bo }), { code: 'NotFound' });
  // Asking takes an ohm session from ohm's pages, with an AT Protocol account connected.
  await assert.rejects(ask('askFriend', { body: { owner: ada }, as: bo }), { code: 'SignInRequired' });
  await assert.rejects(ask('askFriend', { body: { owner: ada }, cookie: 'session=cy' }), { code: 'NotConnected' });
  assert.deepEqual(await ask('askFriend', { body: { owner: ada, message: 'From the walking club.' }, cookie: 'session=bo' }), { asked: true });
  assert.deepEqual(await ask('askFriend', { body: { owner: ada }, cookie: 'session=bo' }), { asked: true });
  const { requests } = await ask('listFriendRequests', { as: ada });
  assert.deepEqual(requests.map(request => [request.did, request.name, request.email, request.message]), [[bo, 'Bo', 'bo@example.test', 'From the walking club.']]);

  // Only the member, signed in to ohm, approves: not with a token, as an agent holds one.
  await assert.rejects(ask('approveFriend', { body: { id: requests[0].id }, as: ada }), { code: 'SignInRequired' });
  assert.deepEqual(await ask('approveFriend', { body: { id: requests[0].id, channels: ['walks'] }, cookie: 'session=ada' }), { did: bo, channels: ['walks'] });
  await assert.rejects(ask('approveFriend', { body: { id: requests[0].id }, cookie: 'session=ada' }), { code: 'Answered' });
  assert.deepEqual((await ask('listFriends', { as: ada })).friends.map(friend => [friend.did, friend.name, friend.email, friend.channels]), [[bo, 'Bo', 'bo@example.test', ['walks']]]);

  // Bo, and Bo's agent with Bo's token, read only what is filed in walks: the soup is listed under walks/food.
  const shared = (await ask('listShared', { query: { owner: ada }, as: bo })).blocks.map(block => block.id).sort();
  assert.deepEqual(shared, [walk, recipe].sort());
  await ask('setFriendChannels', { body: { friend: bo, channels: ['kitchen'] }, cookie: 'session=ada' });
  assert.deepEqual((await ask('listShared', { query: { owner: ada }, as: bo })).blocks.map(block => block.id), [recipe]);
  await assert.rejects(ask('getShared', { query: { owner: ada, id: walk }, as: bo }), { code: 'NotFound' });
  assert.equal((await ask('getShared', { query: { owner: ada, id: recipe }, as: bo })).block.id, recipe);

  // A site's content reads keep the same channels.
  const content = contentStore(env.DB, { get: async () => Response.json({ records: [] }), pdsFor: async () => 'https://pds.ada.test' });
  assert.deepEqual((await content.listBlocks(await content.audience(ada, bo))).blocks.map(block => block.id), [recipe]);
  // Every channel again, then removed: nothing.
  await ask('setFriendChannels', { body: { friend: bo, channels: '*' }, cookie: 'session=ada' });
  assert.equal((await ask('listShared', { query: { owner: ada }, as: bo })).blocks.length, 2);
  await ask('removeFriend', { body: { did: bo }, as: ada });
  await assert.rejects(ask('listShared', { query: { owner: ada }, as: bo }), { code: 'NotFound' });
});

test('declining lets no one in; a friend added before sees every channel', async () => {
  const { env, ask } = await setUp();
  await ask('askFriend', { body: { owner: ada }, cookie: 'session=bo' });
  const [request] = (await ask('listFriendRequests', { as: ada })).requests;
  assert.deepEqual(await ask('declineFriend', { body: { id: request.id }, cookie: 'session=ada' }), { id: request.id, declined: true });
  assert.deepEqual((await ask('listFriendRequests', { as: ada })).requests, []);
  await assert.rejects(ask('listShared', { query: { owner: ada }, as: bo }), { code: 'NotFound' });
  await blockStore(env.DB).addFriend(ada, bo);
  assert.deepEqual((await ask('listFriends', { as: ada })).friends[0].channels, '*');
  assert.equal((await ask('listShared', { query: { owner: ada }, as: bo })).blocks.length, 2);
  await assert.rejects(ask('setFriendChannels', { body: { friend: bo, channels: ['../x'] }, cookie: 'session=ada' }), { code: 'InvalidRequest' });
});

test('asking by email: the same answer whether or not the email is on ohm, and the asker sees who let them in', async () => {
  const { ask } = await setUp();
  // Ada has signed in to ohm, so her account's email is known.
  await ask('listFriendRequests', { cookie: 'session=ada' });
  assert.deepEqual(await ask('askFriend', { body: { email: 'ADA@example.test', message: 'Hi!' }, cookie: 'session=bo' }), { asked: true });
  assert.deepEqual(await ask('askFriend', { body: { email: 'nobody@example.test' }, cookie: 'session=bo' }), { asked: true });
  await assert.rejects(ask('askFriend', { body: { email: 'bo@example.test' }, cookie: 'session=bo' }), { code: 'InvalidRequest' });
  await assert.rejects(ask('askFriend', { body: { email: 'not an email' }, cookie: 'session=bo' }), { code: 'InvalidRequest' });
  // Bo's list cannot tell which email is on ohm: both wait.
  const waiting = (await ask('listAsked', { as: bo })).asks;
  assert.deepEqual(waiting.map(each => [each.email, each.state]).sort(), [['ada@example.test', 'waiting'], ['nobody@example.test', 'waiting']]);
  // Ada sees Bo, approves; Bo then sees Ada as a friend, with her name.
  const [request] = (await ask('listFriendRequests', { as: ada })).requests;
  assert.deepEqual([request.did, request.email, request.message], [bo, 'bo@example.test', 'Hi!']);
  await ask('approveFriend', { body: { id: request.id }, cookie: 'session=ada' });
  const after = (await ask('listAsked', { as: bo })).asks.find(each => each.email === 'ada@example.test');
  assert.deepEqual([after.state, after.did], ['friends', ada]);
  assert.deepEqual((await ask('listFriendOf', { as: bo })).people.map(each => [each.did, each.name, each.email]), [[ada, 'Ada', 'ada@example.test']]);
  assert.deepEqual((await ask('listFriendOf', { as: ada })).people, []);
});
