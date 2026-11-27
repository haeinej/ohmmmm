// Short posts to Bluesky (home/serve.mjs, app/flows/short-post.md): the preview the person approves,
// then the post, as an app.bsky.feed.post under the block's own ID. A fake PDS; nothing leaves this machine.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { initHome } from '../bin/ohmmmm.mjs';
import { planShort, publishShort, SHORT_COLLECTION, shortFacets, SITE_CONFIG } from '../home/serve.mjs';

const DID = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const FRIEND = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const resolve = async handle => (handle === 'friend.example.com' ? FRIEND : null);

async function home(t, { configured = true } = {}) {
  const parent = await mkdtemp(join(tmpdir(), 'ohm-short-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const layout = await initHome(parent, 'alice.example.com');
  await mkdir(join(layout.vault, 'posts'), { recursive: true });
  await writeFile(join(layout.vault, 'posts', 'walk.md'), '---\nkind: short\n---\n\nWalked through Yanaka with @friend.example.com and @nobody.example.org, notes at https://example.com/yanaka. #walks\n');
  const config = join(layout.home, SITE_CONFIG);
  if (configured) await writeFile(config, JSON.stringify({ vars: { ATPROTO_DID: DID, ATPROTO_PDS_ORIGIN: 'https://pds.example.com', SITE_ORIGIN: 'https://alice.example.com' } }));
  return { layout, config };
}

// A PDS that takes putRecord and remembers what it was given.
function fakePds() {
  const put = [];
  const call = async (origin, endpoint, { body, token }) => {
    put.push({ origin, endpoint, body, token });
    return { response: { ok: true, status: 200 }, data: { uri: `at://${body.repo}/${body.collection}/${body.rkey}`, cid: 'bafyfake' } };
  };
  return { put, call };
}

test('facets: links, tags and mentions that resolve, by UTF-8 bytes', async () => {
  const text = 'é https://x.example/a. #ohm @friend.example.com @nobody.example.org';
  const facets = await shortFacets(text, resolve);
  const bytes = new TextEncoder().encode(text);
  const said = facets.map(facet => [facet.features[0].$type.split('#')[1], new TextDecoder().decode(bytes.slice(facet.index.byteStart, facet.index.byteEnd))]);
  assert.deepEqual(said, [['link', 'https://x.example/a'], ['tag', '#ohm'], ['mention', '@friend.example.com']]);
  assert.equal(facets.find(facet => facet.features[0].tag)?.features[0].tag, 'ohm');
});

test('the preview says what will be posted and what is missing, and writes nothing', async t => {
  const { layout, config } = await home(t, { configured: false });
  const before = await readFile(join(layout.vault, 'posts', 'walk.md'), 'utf8');
  const plan = await planShort({ vault: layout.vault, path: 'posts/walk.md', config, password: undefined, resolve });
  assert.equal(plan.collection, SHORT_COLLECTION);
  assert.match(plan.text, /^Walked through Yanaka/);
  assert.equal(plan.ready, false);
  assert.equal(plan.needs.length, 2);
  assert.ok(plan.facets.some(facet => facet.features[0].did === FRIEND));
  assert.equal(await readFile(join(layout.vault, 'posts', 'walk.md'), 'utf8'), before);
  await writeFile(join(layout.vault, 'posts', 'long.md'), `---\nkind: short\n---\n\n${'a'.repeat(301)}\n`);
  await assert.rejects(planShort({ vault: layout.vault, path: 'posts/long.md', config }), /at most 300/);
  await writeFile(join(layout.vault, 'posts', 'essay.md'), '---\ntitle: An essay\n---\n\nLong.\n');
  await assert.rejects(planShort({ vault: layout.vault, path: 'posts/essay.md', config }), /Only a short post/);
});

test('publishing posts it under the block\'s own ID, marks it public, and again replaces rather than posting twice', async t => {
  const { layout, config } = await home(t);
  const plan = await planShort({ vault: layout.vault, path: 'posts/walk.md', config, password: 'app-password', resolve });
  assert.equal(plan.ready, true);
  const { put, call } = fakePds();
  const args = { vault: layout.vault, path: 'posts/walk.md', config, password: 'app-password', resolve, token: 'jwt', call, now: () => new Date('2026-11-27T12:00:00Z') };
  // Not the plan the person saw, or not the version they read: nothing is posted.
  await assert.rejects(publishShort({ ...args, replaces: plan.version, confirm: 'other' }), /changed since you saw/);
  await assert.rejects(publishShort({ ...args, replaces: 'old', confirm: plan.confirm }), /changed since it was read/);
  assert.equal(put.length, 0);

  const done = await publishShort({ ...args, replaces: plan.version, confirm: plan.confirm });
  assert.equal(put.length, 1);
  const [{ endpoint, body, token }] = put;
  assert.equal(endpoint, 'com.atproto.repo.putRecord');
  assert.equal(token, 'jwt');
  assert.equal(body.repo, DID);
  assert.equal(body.collection, SHORT_COLLECTION);
  assert.equal(body.record.$type, SHORT_COLLECTION);
  assert.match(body.record.text, /^Walked through Yanaka/);
  assert.equal(body.record.createdAt, '2026-11-27T12:00:00.000Z');
  assert.ok(body.record.facets.length >= 3);
  const file = await readFile(join(layout.vault, 'posts', 'walk.md'), 'utf8');
  assert.match(file, new RegExp(`id: "?${body.rkey}`));
  assert.match(file, /visibility: "?public/);
  assert.match(file, new RegExp(`posted: "?${done.uri.replaceAll('/', '\\/')}`));
  const journal = await readFile(join(layout.vault, '.vault', 'journal.jsonl'), 'utf8');
  assert.match(journal, /"op":"published"/);

  // Tried again over the new version, the same key: the post is replaced, not made twice.
  const again = await planShort({ vault: layout.vault, path: 'posts/walk.md', config, password: 'app-password', resolve });
  assert.equal(again.posted, done.uri);
  await publishShort({ ...args, replaces: again.version, confirm: again.confirm });
  assert.equal(put[1].body.rkey, body.rkey);
});
