// Friends approved like devices (service/src/friendship.mjs): someone signed in to ohm asks; the
// member sees their name and email and approves them, for every channel or some. The same channels
// hold for the friends tools and for a site's content reads, and for the friend's own agents, which
// read as the friend. Every person here is invented.
import assert from 'node:assert/strict';
import test from 'node:test';
import { blockStore } from '../service/src/blocks.mjs';
import { contentStore } from '../service/src/content.mjs';
import { friendScope as friendScopeOf, friendshipStore } from '../service/src/friendship.mjs';
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
  // Asking takes an AT Protocol account connected to ohm. An agent's token alone is not enough
  // until that account has signed in to ohm, so the member asked can see who is asking.
  await assert.rejects(ask('askFriend', { body: { owner: ada }, as: bo }), { code: 'NotConnected' });
  await assert.rejects(ask('askFriend', { body: { owner: ada }, cookie: 'session=cy' }), { code: 'NotConnected' });
  assert.deepEqual(await ask('askFriend', { body: { owner: ada, message: 'From the walking club.' }, cookie: 'session=bo' }), { asked: true });
  assert.deepEqual(await ask('askFriend', { body: { owner: ada }, cookie: 'session=bo' }), { asked: true });
  const { requests } = await ask('listFriendRequests', { as: ada });
  assert.deepEqual(requests.map(request => [request.did, request.name, request.email, request.message]), [[bo, 'Bo', 'bo@example.test', 'From the walking club.']]);

  // Only the member, signed in to ohm, approves: not with a token, as an agent holds one.
  await assert.rejects(ask('approveFriend', { body: { id: requests[0].id }, as: ada }), { code: 'SignInRequired' });
  assert.deepEqual(await ask('approveFriend', { body: { id: requests[0].id, channels: ['walks'] }, cookie: 'session=ada' }), { did: bo, channels: ['walks'] });
  // Sent again with the same channels, say after the answer was lost, it answers the same; other channels are refused.
  assert.deepEqual(await ask('approveFriend', { body: { id: requests[0].id, channels: ['walks'] }, cookie: 'session=ada' }), { did: bo, channels: ['walks'] });
  await assert.rejects(ask('declineFriend', { body: { id: requests[0].id }, cookie: 'session=ada' }), { code: 'Answered' });
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
  // Sent again it answers the same; approving it now is refused.
  assert.deepEqual(await ask('declineFriend', { body: { id: request.id }, cookie: 'session=ada' }), { id: request.id, declined: true });
  await assert.rejects(ask('approveFriend', { body: { id: request.id }, cookie: 'session=ada' }), { code: 'Answered' });
  await assert.rejects(ask('declineFriend', { body: { id: 'f-none' }, cookie: 'session=ada' }), { code: 'NotFound' });
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

test('someone asked by email before they joined gets the request when they join, once', async () => {
  const { env, ask } = await setUp();
  const cy = 'did:web:pds.cy.test';
  // Bo asks Cy, who has an ohm account but no AT Protocol account connected yet: nothing to deliver to.
  await ask('listFriendRequests', { cookie: 'session=bo' });
  assert.deepEqual(await ask('askFriend', { body: { email: 'cy@example.test', message: 'Join me' }, cookie: 'session=bo' }), { asked: true });
  // Cy connects their account, then signs in: Bo's request is there, with Bo's name and email.
  await links(env.DB).connect('u-cy', cy);
  const [request] = (await ask('listFriendRequests', { cookie: 'session=cy' })).requests;
  assert.deepEqual([request.did, request.name, request.email, request.message], [bo, 'Bo', 'bo@example.test', 'Join me']);
  // Signing in again does not send it twice; and once declined, it is not sent again.
  assert.equal((await ask('listFriendRequests', { cookie: 'session=cy' })).requests.length, 1);
  await ask('declineFriend', { body: { id: request.id }, cookie: 'session=cy' });
  await env.DB.prepare('UPDATE links SET email = NULL WHERE did = ?1').bind(cy).run();
  assert.deepEqual((await ask('listFriendRequests', { cookie: 'session=cy' })).requests, []);
});

test('a friend added before names were kept is named from their ohm account', async () => {
  const { env, ask } = await setUp();
  await blockStore(env.DB).addFriend(ada, bo);
  // Bo has signed in to ohm, so his account's name and email are known.
  await ask('listFriendRequests', { cookie: 'session=bo' });
  assert.deepEqual((await ask('listFriends', { as: ada })).friends.map(each => [each.did, each.name, each.email]), [[bo, 'Bo', 'bo@example.test']]);
});

test('asking by email sends one invite from ohm with the asker\'s name, replies to the asker, at most 20 a day', async () => {
  const { env, ask } = await setUp();
  const sent = [];
  env.MAIL = { send: async message => { sent.push(message) } };
  env.MAIL_FROM = 'friends@ohmmmm.test';
  await ask('askFriend', { body: { email: 'new@example.test', message: 'Come see the walks' }, cookie: 'session=bo' });
  assert.equal(sent.length, 1);
  const [invite] = sent;
  assert.deepEqual([invite.to, invite.from, invite.replyTo, invite.subject], ['new@example.test', { email: 'friends@ohmmmm.test', name: 'Bo via ohm' }, 'bo@example.test', 'Bo wants to share with you on ohm']);
  assert.match(invite.text, /Come see the walks/);
  assert.match(invite.text, /https:\/\/app\.ohmmmm\.test\//);
  // Asking the same address again sends nothing more.
  await ask('askFriend', { body: { email: 'new@example.test' }, cookie: 'session=bo' });
  assert.equal(sent.length, 1);
  // At most 20 a day for each asker; the asks themselves are still kept.
  for (let index = 0; index < 25; index++) await ask('askFriend', { body: { email: `person${index}@example.test` }, cookie: 'session=bo' });
  assert.equal(sent.length, 20);
  assert.equal((await ask('listAsked', { cookie: 'session=bo' })).asks.length, 26);
  // Without mail set up, asking works and nothing is sent.
  delete env.MAIL;
  assert.deepEqual(await ask('askFriend', { body: { email: 'quiet@example.test' }, cookie: 'session=bo' }), { asked: true });
});

test('invite emails are claimed before they are sent: asks at the same moment send once, the day\'s limit holds, and a failed send is tried again', async () => {
  const db = await testDatabase();
  const friendship = friendshipStore(db);
  const sent = [];
  // Each send takes a moment, so asks made together are all in flight at once.
  const mail = async invite => { await new Promise(done => setTimeout(done, 5)); sent.push(invite.to); return true; };
  const asking = email => friendship.askByEmail({ viewer: bo, email, name: 'Bo', ownEmail: 'bo@example.test', didByEmail: async () => null, mail });
  await Promise.all(Array.from({ length: 5 }, () => asking('new@example.test')));
  assert.deepEqual(sent, ['new@example.test']);
  // 19 sent today; 5 new addresses at once: only one more goes.
  for (let index = 0; index < 18; index++) await asking(`person${index}@example.test`);
  assert.equal(sent.length, 19);
  await Promise.all(Array.from({ length: 5 }, (_, index) => asking(`late${index}@example.test`)));
  assert.equal(sent.length, 20);
  // A send that fails gives its claim back, so asking again sends it; the ask itself is kept.
  const other = 'did:web:pds.cy.test';
  const failing = async () => { throw new Error('The mail service is down'); };
  await assert.rejects(friendship.askByEmail({ viewer: other, email: 'dee@example.test', name: 'Cy', didByEmail: async () => null, mail: failing }), /down/);
  assert.equal(db.sqlite.prepare('SELECT mailed_at FROM friend_asks WHERE viewer = ? AND email = ?').get(other, 'dee@example.test').mailed_at, null);
  await friendship.askByEmail({ viewer: other, email: 'dee@example.test', name: 'Cy', didByEmail: async () => null, mail });
  assert.equal(sent.at(-1), 'dee@example.test');
});

test('a member\'s agent asks by email with the member\'s token, named from their ohm account', async () => {
  const { env, ask } = await setUp();
  const sent = [];
  env.MAIL = { send: async message => { sent.push(message) } };
  env.MAIL_FROM = 'friends@ohmmmm.test';
  // Bo has signed in to ohm once, so ohm knows the name and email his agent asks with.
  await ask('listFriendRequests', { cookie: 'session=bo' });
  await ask('listFriendRequests', { cookie: 'session=ada' });
  assert.deepEqual(await ask('askFriend', { body: { email: 'ada@example.test', message: 'From my inbox' }, as: bo }), { asked: true });
  await assert.rejects(ask('askFriend', { body: { email: 'bo@example.test' }, as: bo }), { code: 'InvalidRequest' });
  const [request] = (await ask('listFriendRequests', { as: ada })).requests;
  assert.deepEqual([request.did, request.name, request.email, request.message], [bo, 'Bo', 'bo@example.test', 'From my inbox']);
  assert.deepEqual([sent.length, sent[0].from.name, sent[0].replyTo], [1, 'Bo via ohm', 'bo@example.test']);
  // Approving stays the member's alone, in ohm.
  await assert.rejects(ask('approveFriend', { body: { id: request.id }, as: ada }), { code: 'SignInRequired' });
});

test('asks at the same moment keep one request waiting, and the database holds no second one', async () => {
  const db = await testDatabase();
  const friendship = friendshipStore(db);
  await Promise.all(Array.from({ length: 5 }, () => friendship.ask(ada, { viewer: bo, name: 'Bo' })));
  const { requests } = await friendship.requests(ada);
  assert.equal(requests.length, 1);
  assert.throws(() => db.sqlite.prepare("INSERT INTO friend_requests (did, id, friend, asked_at, state) VALUES (?, 'f-second', ?, '2026-11-24T00:00:00Z', 'waiting')").run(ada, bo), /UNIQUE/);
  // Once it is answered, Bo may ask again.
  await friendship.decline(ada, { id: requests[0].id });
  await friendship.ask(ada, { viewer: bo, name: 'Bo' });
  assert.equal((await friendship.requests(ada)).requests.length, 1);
});

test('a decline that lands while an approval is being written wins, and no friend is added', async () => {
  const db = await testDatabase();
  const friendship = friendshipStore(db);
  await friendship.ask(ada, { viewer: bo, name: 'Bo' });
  const [request] = (await friendship.requests(ada)).requests;
  // The approval has read the request as waiting; the decline is written before its batch.
  const racing = { ...db, batch: async statements => { await friendship.decline(ada, { id: request.id }); return db.batch(statements); } };
  await assert.rejects(friendshipStore(racing).approve(ada, { id: request.id, channels: ['walks'] }), { code: 'Answered' });
  assert.equal(await friendScopeOf(db, ada, bo), null);
  assert.equal(db.sqlite.prepare('SELECT state FROM friend_requests WHERE id = ?').get(request.id).state, 'declined');
});
