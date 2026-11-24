// Visibility moves (vault/visibility.mjs, service/src/visibility.mjs, the vault_set_visibility tool):
// one set of rules; only the member shows a block to more people; an agent asks, or with a grant hides
// a block on its way to private; every move is journalled by ID. Every person here is invented.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTools } from '../mcp/tools.mjs';
import { blockStore } from '../service/src/blocks.mjs';
import { links } from '../service/src/ohm.mjs';
import { visibilityStore } from '../service/src/visibility.mjs';
import { createService } from '../service/src/worker.mjs';
import { newPostId } from '../vault/file.mjs';
import { planMove, whyNot } from '../vault/visibility.mjs';
import { testDatabase } from './d1.mjs';

const ada = 'did:web:pds.ada.test';
const bo = 'did:web:pds.bo.test';
const APP = 'https://app.ohmmmm.test';
let made = 0;
const id = () => newPostId(Date.parse('2026-11-24T00:00:00Z') + made++, 4);

test('the rules: what each move does, and who may finish it', () => {
  assert.deepEqual(['private>friends', 'friends>private', 'friends>public', 'public>private'].map(pair => {
    const [from, to] = pair.split('>');
    const move = planMove({ from, to, title: 'A walk' });
    return [move.action, move.widens, move.finishes, move.via];
  }), [
    ['share', true, 'member', 'device'], ['seal', false, 'member-or-granted-agent', 'device'],
    ['publish', true, 'member', 'publish'], ['takedown', false, 'member', 'publish'],
  ]);
  assert.deepEqual(planMove({ from: 'friends', to: 'public' }).needs, ['title']);
  assert.throws(() => planMove({ from: 'friends', to: 'friends' }), { code: 'InvalidMove' });
  const seal = planMove({ from: 'friends', to: 'private' }), share = planMove({ from: 'private', to: 'friends' });
  assert.equal(whyNot(seal, { actor: 'agent:helper', granted: true }), null);
  assert.match(whyNot(seal, { actor: 'agent:helper', granted: false }), /no write grant/);
  // A grant never lets an agent show a block to more people, or take a published one down.
  assert.match(whyNot(share, { actor: 'agent:helper', granted: true }), /Only the person/);
  assert.match(whyNot(planMove({ from: 'public', to: 'private', title: 'x' }), { actor: 'agent:helper', granted: true }), /Only the person/);
  assert.equal(whyNot(share, { actor: 'me' }), null);
  assert.match(whyNot(planMove({ from: 'friends', to: 'public' }), { actor: 'me' }), /needs a title/);
});

async function setUp({ grant = null } = {}) {
  const env = { DB: await testDatabase(), MEMBERS: '*', OHM_APP_ORIGIN: APP };
  const sessions = new Map([['session=ada', { id: 'u-ada' }]]);
  await links(env.DB).connect('u-ada', ada);
  const get = async (url, options) => (String(url) === `${APP}/api/auth/get-session` ? Response.json({ user: sessions.get(options.headers.Cookie) ?? null }) : Response.json({ records: [] }));
  // A member's token here is their DID, as in the MCP tests.
  const service = createService({ whoIs: Object.assign(async request => request.headers.get('Authorization').slice(7), { pdsFor: async () => 'https://pds.ada.test' }), get });
  const ask = async (name, { query, body, as = ada, cookie } = {}) => {
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
  const vault = {
    tree: () => ask('getTree'), get: postId => ask('getPost', { query: { id: postId } }),
    getBlock: blockId => ask('getBlock', { query: { id: blockId } }),
    previewMove: (blockId, to) => ask('previewMove', { query: { id: blockId, to } }),
    hideBlock: move => ask('hideBlock', { body: move }), requestMove: move => ask('requestMove', { body: move }),
  };
  const tools = createTools({ vault, by: 'agent:helper', grants: { allowed: async (right, path) => Boolean(grant && right === 'write' && path.startsWith(`${grant}/`)) } });
  const blocks = blockStore(env.DB);
  const walk = id();
  await blocks.write(ada, { id: walk, path: 'walks/yanaka.md', text: '---\nkind: text\nvisibility: friends\ntitle: Yanaka\n---\n\nA slow walk.\n' });
  await blocks.addFriend(ada, bo);
  return { env, ask, tools, walk };
}
const twice = async (tools, args) => tools.call('vault_set_visibility', { ...args, confirm: (await tools.call('vault_set_visibility', args)).confirm });

test('an agent with a write grant hides a friends-only block on its way to private: friends stop reading it at once', async () => {
  const { ask, tools, walk } = await setUp({ grant: 'walks' });
  assert.equal((await ask('listShared', { query: { owner: ada }, as: bo })).blocks.length, 1);
  const shown = await tools.call('vault_set_visibility', { key: walk, to: 'private', reason: 'Too personal.' });
  assert.match(shown.willHappen.outcome, /Friends stop reading it now/);
  const done = await tools.call('vault_set_visibility', { key: walk, to: 'private', reason: 'Too personal.', confirm: shown.confirm });
  assert.equal(done.hidden, true);
  // No friend reads it; the member still holds it, marked as leaving, for their device to seal.
  assert.deepEqual((await ask('listShared', { query: { owner: ada }, as: bo })).blocks, []);
  await assert.rejects(ask('getShared', { query: { owner: ada, id: walk }, as: bo }), { code: 'NotFound' });
  assert.ok((await ask('listBlocks')).blocks.find(block => block.id === walk).leaving);
  // The device seals it, and records the move done.
  await ask('recordMove', { body: { block: walk, from: 'friends', to: 'private', sealedAs: 'opaque-1' }, cookie: 'session=ada' });
  const { moves } = await ask('listMoves');
  assert.deepEqual(moves.map(move => [move.block, move.action, move.state, move.askedBy, move.approvedBy ?? null]), [
    ['opaque-1', 'seal', 'done', 'me', 'me'], [walk, 'seal', 'hidden', 'agent:helper', 'agent:helper'],
  ]);
  assert.equal(moves[1].reason, 'Too personal.');
  // The journal holds IDs, never titles or text.
  assert.doesNotMatch(JSON.stringify(moves), /Yanaka|slow walk/);
});

test('without a grant, or to show a block to more people, an agent only asks; only the member answers', async () => {
  const { ask, tools, walk } = await setUp();
  const narrow = await twice(tools, { key: walk, to: 'private' });
  assert.equal(narrow.requested, true);
  assert.equal((await ask('listShared', { query: { owner: ada }, as: bo })).blocks.length, 1, 'still shared until the member acts');
  const { requests } = await ask('listMoveRequests');
  assert.deepEqual(requests.map(request => [request.block, request.from, request.to, request.askedBy, request.state]), [[walk, 'friends', 'private', 'agent:helper', 'waiting']]);

  // Only the member, signed in to ohm, answers. Their PDS token, as an agent holds it, cannot.
  await assert.rejects(ask('declineMoveRequest', { body: { id: requests[0].id } }), { code: 'SignInRequired' });
  await assert.rejects(ask('recordMove', { body: { block: walk, from: 'friends', to: 'private', request: requests[0].id } }), { code: 'SignInRequired' });
  // A record must be the move asked for.
  await assert.rejects(ask('recordMove', { body: { block: walk, from: 'friends', to: 'public', request: requests[0].id }, cookie: 'session=ada' }), { code: 'NotThisMove' });
  assert.deepEqual(await ask('declineMoveRequest', { body: { id: requests[0].id, reason: 'Keep sharing it.' }, cookie: 'session=ada' }), { id: requests[0].id, declined: true });
  // Declining it again changes nothing more; approving it now is too late.
  assert.deepEqual(await ask('declineMoveRequest', { body: { id: requests[0].id }, cookie: 'session=ada' }), { id: requests[0].id, declined: true, unchanged: true });
  await assert.rejects(ask('recordMove', { body: { block: walk, from: 'friends', to: 'private', request: requests[0].id }, cookie: 'session=ada' }), { code: 'Answered' });
  assert.deepEqual((await ask('listMoveRequests')).requests, []);

  // A request to show it to everyone waits too, and approving it is recorded with who asked.
  const wider = await twice(tools, { key: walk, to: 'public', reason: 'Ready.' });
  const recorded = await ask('recordMove', { body: { block: walk, from: 'friends', to: 'public', request: wider.request }, cookie: 'session=ada' });
  assert.deepEqual([recorded.state, recorded.approved], ['previewed', true]);
  const latest = (await ask('listMoves')).moves[0];
  assert.deepEqual([latest.action, latest.askedBy, latest.approvedBy, latest.request], ['publish', 'agent:helper', 'me', wider.request]);
  // A request is never made in the member's own name.
  await assert.rejects(ask('requestMove', { body: { block: walk, store: 'block', from: 'friends', to: 'public', by: 'me' } }), { code: 'InvalidRequest' });
});

test('a hidden block is not on a site either, and saving it again keeps it hidden until it is sealed', async () => {
  const { env, ask, walk } = await setUp({ grant: 'walks' });
  const { version } = await ask('getBlock', { query: { id: walk } });
  await ask('hideBlock', { body: { id: walk, replaces: version, by: 'agent:helper' } });
  const { contentStore } = await import('../service/src/content.mjs');
  const content = contentStore(env.DB, { get: async () => Response.json({ records: [] }), pdsFor: async () => 'https://pds.ada.test' });
  assert.deepEqual((await content.listBlocks(await content.audience(ada, bo))).blocks, []);
  const saved = await blockStore(env.DB).write(ada, { id: walk, path: 'walks/yanaka.md', text: '---\nkind: text\nvisibility: friends\ntitle: Yanaka\n---\n\nA slower walk.\n' }, { replaces: version });
  assert.ok(saved.version);
  assert.deepEqual((await ask('listShared', { query: { owner: ada }, as: bo })).blocks, []);
  await assert.rejects(ask('hideBlock', { body: { id: walk, replaces: 'old', by: 'agent:helper' } }), { code: 'Changed' });
});

// A database whose next statement matching `pattern` fails once, as a dropped connection would.
const failingOnce = (db, pattern) => {
  let failed = false;
  const wrap = (sql, statement) => ({
    ...statement,
    bind: (...values) => wrap(sql, statement.bind(...values)),
    ...Object.fromEntries(['first', 'all', 'run', 'runNow'].map(name => [name, (...args) => {
      if (!failed && pattern.test(sql)) { failed = true; throw new Error('The database went away'); }
      return statement[name](...args);
    }])),
  });
  return { ...db, prepare: sql => wrap(sql, db.prepare(sql)) };
};

test('a hide whose journal line fails is undone, so sending it again hides the block and journals it', async () => {
  const { env, ask, walk } = await setUp();
  const { version } = await ask('getBlock', { query: { id: walk } });
  const moves = visibilityStore(failingOnce(env.DB, /INSERT INTO moves/));
  await assert.rejects(moves.hide(ada, { id: walk, replaces: version, by: 'agent:helper' }), /went away/);
  assert.equal((await ask('listShared', { query: { owner: ada }, as: bo })).blocks.length, 1, 'nothing hidden without its journal line');
  const hidden = await moves.hide(ada, { id: walk, replaces: version, by: 'agent:helper' });
  assert.equal(hidden.unchanged, undefined);
  assert.deepEqual((await ask('listShared', { query: { owner: ada }, as: bo })).blocks, []);
  // Sent once more, it is hidden already: the same answer, and one journal line.
  assert.deepEqual(await moves.hide(ada, { id: walk, replaces: version, by: 'agent:helper' }), { id: walk, hidden: hidden.hidden, unchanged: true });
  assert.deepEqual((await ask('listMoves')).moves.map(move => [move.block, move.state]), [[walk, 'hidden']]);
});

test('an approval or a decline whose journal line fails answers nothing, and sending it again answers it once', async () => {
  const { env, ask, tools, walk } = await setUp();
  const first = await twice(tools, { key: walk, to: 'private' });
  const moves = visibilityStore(failingOnce(env.DB, /INSERT INTO moves/));
  await assert.rejects(moves.record(ada, { block: walk, from: 'friends', to: 'private', request: first.request, sealedAs: 'opaque-2', moveId: 'm-ada-1' }), /went away/);
  assert.equal((await ask('listMoveRequests')).requests[0].state, 'waiting', 'still waiting without its journal line');
  const recorded = await moves.record(ada, { block: walk, from: 'friends', to: 'private', request: first.request, sealedAs: 'opaque-2', moveId: 'm-ada-1' });
  assert.deepEqual([recorded.state, recorded.approved, recorded.unchanged], ['done', true, undefined]);
  // The same move sent again (its answer was lost): the first answer, and nothing more journalled.
  const again = await moves.record(ada, { block: walk, from: 'friends', to: 'private', request: first.request, sealedAs: 'opaque-2', moveId: 'm-ada-1' });
  assert.deepEqual([again.state, again.approved, again.unchanged], ['done', true, true]);
  // Another move cannot answer it.
  await assert.rejects(moves.record(ada, { block: walk, from: 'friends', to: 'private', request: first.request, moveId: 'm-ada-2' }), { code: 'Answered' });

  const second = await twice(tools, { key: walk, to: 'public' });
  const declining = visibilityStore(failingOnce(env.DB, /INSERT INTO moves/));
  await assert.rejects(declining.decline(ada, { id: second.request }), /went away/);
  assert.deepEqual((await ask('listMoveRequests')).requests.map(request => request.id), [second.request]);
  assert.deepEqual(await declining.decline(ada, { id: second.request }), { id: second.request, declined: true });
  assert.deepEqual(await declining.decline(ada, { id: second.request }), { id: second.request, declined: true, unchanged: true });
  const journal = (await ask('listMoves')).moves.filter(move => move.state !== 'requested');
  assert.deepEqual(journal.map(move => [move.block, move.state, move.request]), [[walk, 'declined', second.request], ['opaque-2', 'done', first.request]]);
});

test('the cockpit sending the same move twice journals it once', async () => {
  const { ask, walk } = await setUp();
  const move = { block: walk, from: 'friends', to: 'private', sealedAs: 'opaque-3', cleanupPending: true, moveId: 'm-ada-3' };
  const first = await ask('recordMove', { body: move, cookie: 'session=ada' });
  const again = await ask('recordMove', { body: move, cookie: 'session=ada' });
  assert.deepEqual([first.state, again.state, again.unchanged], ['cleanup-pending', 'cleanup-pending', true]);
  // Without a moveId, its opaque ID names the move.
  await ask('recordMove', { body: { block: walk, from: 'friends', to: 'private', sealedAs: 'opaque-4' }, cookie: 'session=ada' });
  await ask('recordMove', { body: { block: walk, from: 'friends', to: 'private', sealedAs: 'opaque-4' }, cookie: 'session=ada' });
  assert.deepEqual((await ask('listMoves')).moves.map(line => [line.block, line.state]), [['opaque-4', 'done'], ['opaque-3', 'cleanup-pending']]);
  await assert.rejects(ask('recordMove', { body: { ...move, moveId: 'not an id!' }, cookie: 'session=ada' }), { code: 'InvalidRequest' });
});

test('two agents asking for the same move at once leave one request waiting', async () => {
  const { env, ask, walk } = await setUp();
  const moves = visibilityStore(env.DB);
  const ask2 = by => moves.request(ada, { block: walk, store: 'block', from: 'friends', to: 'public', by, reason: `${by} thinks it is ready.` });
  const [one, two] = await Promise.all([ask2('agent:helper'), ask2('agent:scribe')]);
  assert.equal(one.request.id, two.request.id);
  assert.equal([one, two].filter(answer => answer.unchanged).length, 1);
  assert.equal((await ask('listMoveRequests')).requests.length, 1);
  assert.equal((await ask('listMoves')).moves.length, 1, 'one request journalled');
});
