// The private layer's store: private blocks as { id, ciphertext, version }, which the service keeps
// and cannot read. Sealed here with WebCrypto in the format ohm-onboarding's packages/keys makes (a
// file key wrapped by a master key, the contents encrypted with the file key); no real member key,
// passkey or device is involved.
import assert from 'node:assert/strict';
import test from 'node:test';
import { privateStore, privateVersion, sealedBlock } from '../service/src/private.mjs';
import { blockStore } from '../service/src/blocks.mjs';
import { testDatabase } from './d1.mjs';
import { sealer } from './sealer.mjs';
import { running } from './members.mjs';

const refusal = code => problem => problem.code === code;
const b64 = bytes => Buffer.from(bytes).toString('base64url');
const opaque = () => b64(crypto.getRandomValues(new Uint8Array(16)));

test('the private store keeps sealed files only, with compare-and-swap on a version over the ciphertext', async () => {
  const db = await testDatabase();
  const store = privateStore(db);
  const keys = await sealer();
  const me = 'did:web:pds.haein.test';
  const id = opaque();
  const words = '---\nid: 3mzocqfoc22if\nkind: text\ntitle: Only mine\nvisibility: private\n---\n\nA secret about walking.\n';
  const ciphertext = await keys.seal(me, id, words);

  const saved = await store.write(me, { id, ciphertext });
  assert.match(saved.version, /^pv_[0-9a-f]{32}$/);
  assert.deepEqual(await store.read(me, id), { id, ciphertext, version: saved.version, rev: saved.rev });
  assert.equal(await keys.open(me, id, (await store.read(me, id)).ciphertext), words);
  // Nothing readable is in the database: not the text, the title, the path or the TID.
  const held = JSON.stringify(db.sqlite.prepare('SELECT * FROM private_blocks').all());
  for (const secret of ['walking', 'Only mine', 'notes', '3mzocqfoc22if', 'private']) assert.ok(!held.includes(secret), secret);
  // The same ciphertext again changes nothing; the version names exactly one ciphertext.
  assert.equal((await store.write(me, { id, ciphertext }, { replaces: saved.version })).unchanged, true);
  assert.equal(saved.version, await privateVersion(sealedBlock({ id, ciphertext }).text));
  // A write sent again after its answer was lost, still naming the version it replaced, is the same
  // write: nothing changes and nothing is refused.
  const again = await store.write(me, { id, ciphertext }, { replaces: null });
  assert.deepEqual([again.version, again.unchanged], [saved.version, true]);

  // Two devices edit from the same version: the second is refused and told the current version.
  const first = await store.write(me, { id, ciphertext: await keys.seal(me, id, 'edit one') }, { replaces: saved.version });
  const stale = await store.write(me, { id, ciphertext: await keys.seal(me, id, 'edit two') }, { replaces: saved.version }).catch(problem => problem);
  assert.deepEqual([stale.code, stale.extra.current], ['Changed', first.version]);
  await assert.rejects(store.write(me, { id: opaque(), ciphertext }, { replaces: 'pv_0' }), refusal('Changed'));
  await assert.rejects(store.write(me, { id, ciphertext }), refusal('Changed'));

  // Listing says only what the service can know: IDs, versions, sizes, generations.
  const listed = await store.list(me);
  assert.deepEqual(Object.keys(listed.blocks[0]).sort(), ['generation', 'id', 'rev', 'size', 'version']);
  // Removing names the version; afterwards the list since then says it went.
  await assert.rejects(store.remove(me, id, { replaces: saved.version }), refusal('Changed'));
  await store.remove(me, id, { replaces: first.version });
  assert.deepEqual((await store.list(me, { since: listed.cursor })).blocks, [{ id, removed: true }]);
  await assert.rejects(store.read(me, id), refusal('NotFound'));
  assert.equal((await store.remove(me, id)).unchanged, true);
});

test('readable text, wrong shapes and named IDs are refused before anything is kept', async () => {
  const keys = await sealer();
  const did = 'did:web:pds.haein.test';
  const id = opaque();
  const good = await keys.seal(did, id, 'x');
  const refused = (given, pattern) => assert.throws(() => sealedBlock(given), problem => problem.code === 'InvalidBlock' && (!pattern || pattern.test(problem.message)));
  refused({ id, ciphertext: '---\ntitle: Mine\n---\n\nplain text' }, /sealed file/);
  refused({ id, ciphertext: { ...good, text: 'plain text' } }, /never sent readable/);
  refused({ id, ciphertext: good, path: 'notes/mine.md' }, /id and ciphertext/);
  refused({ id: 'notes/mine.md', ciphertext: good }, /opaque ID/);
  refused({ id: 'short', ciphertext: good }, /opaque ID/);
  refused({ id, ciphertext: { ...good, v: 2 } });
  refused({ id, ciphertext: { ...good, generation: 0 } });
  refused({ id, ciphertext: { ...good, key: { ...good.key, ciphertext: 'not base64url!' } } });
  refused({ id, ciphertext: { ...good, key: { ...good.key, ciphertext: good.key.ciphertext.slice(4) } } }, /file key/);
  refused({ id, ciphertext: { ...good, data: { ...good.data, iv: 'AAAA' } } }, /nonce/);
  assert.throws(() => sealedBlock({ id, ciphertext: { ...good, data: { ...good.data, ciphertext: 'A'.repeat(1_000_001) } } }), refusal('TooLarge'));
  // A changed ciphertext is the member's device's to notice: the service keeps what it was sent, and
  // the file no longer opens.
  const store = privateStore(await testDatabase());
  const tampered = { ...good, data: { ...good.data, ciphertext: good.data.ciphertext.replace(/^./, good.data.ciphertext[0] === 'A' ? 'B' : 'A') } };
  await store.write(did, { id, ciphertext: tampered });
  await assert.rejects(keys.open(did, id, (await store.read(did, id)).ciphertext));
});

test('a key rotation finds the files it has not re-wrapped, and finishes by compare-and-swap', async () => {
  const store = privateStore(await testDatabase());
  const keys = await sealer();
  const did = 'did:web:pds.haein.test';
  const ids = [opaque(), opaque(), opaque()];
  const versions = {};
  for (const id of ids) versions[id] = (await store.write(did, { id, ciphertext: await keys.seal(did, id, id) })).version;
  // One is re-wrapped by master key 2; the other two are still below it.
  const moved = await store.write(did, { id: ids[0], ciphertext: await keys.seal(did, ids[0], ids[0], 2) }, { replaces: versions[ids[0]] });
  assert.deepEqual((await store.list(did, { below: 2 })).blocks.map(each => each.id).sort(), ids.slice(1).sort());
  assert.equal((await store.read(did, ids[0])).ciphertext.generation, 2);
  assert.equal((await store.list(did)).blocks.find(each => each.id === ids[0]).generation, 2);
  await assert.rejects(store.list(did, { below: 0 }), refusal('InvalidRequest'));
  assert.ok(moved.version);
});

test('only the member reaches their private blocks; friends and other members see nothing', async () => {
  const { haein, jun, ask, env } = await running();
  const keys = await sealer();
  const id = opaque();
  const ciphertext = await keys.seal(haein.did, id, 'mine alone');
  const put = await ask(haein, 'putPrivateBlock', { body: { block: { id, ciphertext } } });
  assert.equal(put.status, 200);
  assert.equal((await ask(haein, 'getPrivateBlock', { query: { id } })).version, put.version);
  assert.equal((await ask(haein, 'listPrivateBlocks')).blocks.length, 1);

  // Even a friend: private blocks are not in the friends layer, by ID or by listing.
  await blockStore(env.DB).addFriend(haein.did, jun.did);
  // (An opaque ID is not even a block ID the friends layer takes, so it is refused as malformed.)
  const asFriend = await ask(jun, 'getShared', { query: { owner: haein.did, id } });
  assert.deepEqual([asFriend.status, asFriend.ciphertext, asFriend.block], [400, undefined, undefined]);
  assert.deepEqual((await ask(jun, 'listShared', { query: { owner: haein.did } })).blocks, []);
  // Another member's own requests see only their own (none), and cannot change Haein's.
  assert.equal((await ask(jun, 'getPrivateBlock', { query: { id } })).status, 404);
  assert.deepEqual((await ask(jun, 'listPrivateBlocks')).blocks, []);
  const theirs = await ask(jun, 'putPrivateBlock', { body: { block: { id, ciphertext } } });
  assert.equal(theirs.status, 200);
  assert.equal((await ask(haein, 'getPrivateBlock', { query: { id } })).version, put.version);
  // Refusals come through the service as from the store.
  const refused = await ask(haein, 'putPrivateBlock', { body: { block: { id, ciphertext: 'plain text' } } });
  assert.deepEqual([refused.status, refused.error], [400, 'InvalidBlock']);
  const stale = await ask(haein, 'deletePrivateBlock', { body: { id, replaces: 'pv_old' } });
  assert.deepEqual([stale.status, stale.error, stale.current], [409, 'Changed', put.version]);
  assert.equal((await ask(haein, 'deletePrivateBlock', { body: { id, replaces: put.version } })).removed, true);
});

test('during a rotation, old-key writes are refused, and it finishes only when nothing is below the target', async () => {
  const store = privateStore(await testDatabase());
  const keys = await sealer();
  const did = 'did:web:pds.haein.test';
  const [a, b] = [opaque(), opaque()];
  const va = (await store.write(did, { id: a, ciphertext: await keys.seal(did, a, 'a') })).version;
  const vb = (await store.write(did, { id: b, ciphertext: await keys.seal(did, b, 'b') })).version;
  assert.deepEqual((await store.rotation(did)).rotation, null);

  const begun = await store.beginRotation(did, 2);
  assert.deepEqual([begun.target, begun.state, begun.remaining], [2, 'rotating', 2]);
  assert.equal((await store.beginRotation(did, 2)).unchanged, true);
  await assert.rejects(store.beginRotation(did, 1), refusal('InvalidRequest'));
  // A device still on the old key cannot add or change a file the rotation would miss.
  await assert.rejects(store.write(did, { id: opaque(), ciphertext: await keys.seal(did, 'x', 'late') }), refusal('OlderKey'));
  await assert.rejects(store.write(did, { id: a, ciphertext: await keys.seal(did, a, 'a edited') }, { replaces: va }), refusal('OlderKey'));
  // Not finished while anything kept is left below; the answer says how many. Writing a new version
  // under the new key leaves the old version still to re-wrap.
  await store.write(did, { id: a, ciphertext: await keys.seal(did, a, 'a', 2) }, { replaces: va });
  const early = await store.finishRotation(did, 2).catch(problem => problem);
  assert.deepEqual([early.code, early.extra.remaining], ['RotationRemaining', 2]);
  // Re-wrap everything listed below the target, old versions included.
  const left = await store.belowTarget(did, 2);
  assert.deepEqual(left.versions.map(each => each.id).sort(), [a, b].sort());
  const rewrapped = await Promise.all(left.versions.map(async each => ({ id: each.id, rev: each.rev, ciphertext: await keys.rewrap(did, each.id, (await store.readVersion(did, each.id, each.rev)).ciphertext, 2) })));
  assert.equal((await store.rewrap(did, 2, { versions: rewrapped })).remaining, 0);
  // b's latest moved with its version: it opens under key 2, its contents unchanged, its version renamed.
  const bNow = await store.read(did, b);
  assert.deepEqual([bNow.ciphertext.generation, await keys.open(did, b, bNow.ciphertext)], [2, 'b']);
  assert.notEqual(bNow.version, vb);
  assert.deepEqual(await store.finishRotation(did, 2), { target: 2, state: 'finished' });
  assert.equal((await store.finishRotation(did, 2)).unchanged, true);
  await assert.rejects(store.finishRotation(did, 3), refusal('NotFound'));
  // The floor stays: an old-key write is still refused after the rotation finished.
  await assert.rejects(store.write(did, { id: opaque(), ciphertext: await keys.seal(did, 'y', 'stale') }), refusal('OlderKey'));
  assert.ok(await store.write(did, { id: opaque(), ciphertext: await keys.seal(did, 'z', 'new', 2) }));
  // A later rotation moves the floor; an earlier one is refused.
  assert.equal((await store.beginRotation(did, 3)).target, 3);
  await assert.rejects(store.beginRotation(did, 2), refusal('RotationAhead'));
});

test('a move changes several files together, or none of them', async () => {
  const db = await testDatabase();
  const store = privateStore(db);
  const keys = await sealer();
  const did = 'did:web:pds.haein.test';
  // A block and two channel files (each a private file like any other, its order inside).
  const [block, from, to] = [opaque(), opaque(), opaque()];
  const saved = {};
  for (const [id, text] of [[block, 'block in walks'], [from, 'walks: block'], [to, 'cities: -']]) saved[id] = (await store.write(did, { id, ciphertext: await keys.seal(did, id, text) })).version;

  // One stale version in the batch refuses all of it: the block is not left in neither channel or both.
  const move = async (replacesTo, batchId) => store.apply(did, [
    { id: block, ciphertext: await keys.seal(did, block, 'block in cities'), replaces: saved[block] },
    { id: from, ciphertext: await keys.seal(did, from, 'walks: -'), replaces: saved[from] },
    { id: to, ciphertext: await keys.seal(did, to, 'cities: block'), replaces: replacesTo },
  ], { batchId, journal: await keys.seal(did, 'journal', 'Moved block: walks → cities') });
  const refused = await move('pv_stale', 'move-0001').catch(problem => problem);
  assert.deepEqual([refused.code, refused.extra.id], ['Changed', to]);
  for (const id of [block, from, to]) assert.equal((await store.read(did, id)).version, saved[id]);
  assert.equal((await store.journal(did)).entries.length, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM private_guard').get().n, 0);

  const moved = await move(saved[to], 'move-0002');
  assert.equal(moved.blocks.length, 3);
  assert.equal(await keys.open(did, to, (await store.read(did, to)).ciphertext), 'cities: block');
  // The same batch again (its answer was lost) answers the same and changes nothing.
  const again = await move(saved[to], 'move-0002');
  assert.deepEqual(again, { ...moved, blocks: moved.blocks.map(({ rev, ...each }) => each), replayed: true });
  const { entries } = await store.journal(did);
  assert.equal(entries.length, 1);
  assert.equal(await keys.open(did, 'journal', entries[0].entry), 'Moved block: walks → cities');
  // A batch changes each block once, at most 100, and a removal is part of it like any change.
  await assert.rejects(store.apply(did, [{ id: block, remove: true, replaces: 'x' }, { id: block, remove: true, replaces: 'x' }]), refusal('InvalidRequest'));
  await assert.rejects(store.apply(did, []), refusal('InvalidRequest'));
  const gone = await store.apply(did, [{ id: from, remove: true, replaces: moved.blocks[1].version }], { batchId: 'remove-0001' });
  assert.deepEqual(gone.blocks, [{ id: from, removed: true }]);
});

test('every version is kept for restoring, and a removed block can come back', async () => {
  const store = privateStore(await testDatabase());
  const keys = await sealer();
  const did = 'did:web:pds.haein.test';
  const id = opaque();
  const one = await store.write(did, { id, ciphertext: await keys.seal(did, id, 'first') });
  const two = await store.write(did, { id, ciphertext: await keys.seal(did, id, 'second') }, { replaces: one.version });
  const { versions } = await store.versions(did, id);
  assert.deepEqual(versions.map(each => each.rev), [two.rev, one.rev]);
  assert.equal(await keys.open(did, id, (await store.readVersion(did, id, one.rev)).ciphertext), 'first');
  // Restoring is a new change made on the device from an old version's contents.
  await store.remove(did, id, { replaces: two.version });
  await assert.rejects(store.read(did, id), refusal('NotFound'));
  assert.equal((await store.versions(did, id)).versions.length, 2);
  const restored = await store.write(did, { id, ciphertext: await keys.seal(did, id, await keys.open(did, id, (await store.readVersion(did, id, one.rev)).ciphertext)) });
  assert.equal(await keys.open(did, id, (await store.read(did, id)).ciphertext), 'first');
  assert.equal((await store.versions(did, id)).versions[0].rev, restored.rev);
  await assert.rejects(store.readVersion(did, id, 999), refusal('NotFound'));
});

test('a rotation re-wraps journal entries too, and a re-wrap may change only the file key', async () => {
  const store = privateStore(await testDatabase());
  const keys = await sealer();
  const did = 'did:web:pds.haein.test';
  const id = opaque();
  const saved = await store.write(did, { id, ciphertext: await keys.seal(did, id, 'kept') }, { journal: await keys.seal(did, 'journal', 'Created kept') });
  await assert.rejects(store.rewrap(did, 2, { versions: [{ id, rev: saved.rev, ciphertext: await keys.seal(did, id, 'kept', 2) }] }), refusal('NoRotation'));
  await store.beginRotation(did, 2);
  const left = await store.belowTarget(did, 2);
  assert.deepEqual([left.versions.length, left.journal.length], [1, 1]);
  // Different contents under the new key are refused, as is a re-wrap under the wrong generation.
  await assert.rejects(store.rewrap(did, 2, { versions: [{ id, rev: saved.rev, ciphertext: await keys.seal(did, id, 'other', 2) }] }), problem => problem.code === 'InvalidBlock' && /contents/.test(problem.message));
  const old = (await store.readVersion(did, id, saved.rev)).ciphertext;
  await assert.rejects(store.rewrap(did, 2, { versions: [{ id, rev: saved.rev, ciphertext: await keys.rewrap(did, id, old, 3) }] }), problem => problem.code === 'InvalidBlock' && /under 2/.test(problem.message));
  // The journal entry alone left: not finished.
  assert.equal((await store.rewrap(did, 2, { versions: [{ id, rev: saved.rev, ciphertext: await keys.rewrap(did, id, old, 2) }] })).remaining, 1);
  await assert.rejects(store.finishRotation(did, 2), refusal('RotationRemaining'));
  const entry = (await store.journal(did)).entries[0];
  assert.equal((await store.rewrap(did, 2, { journal: [{ seq: entry.seq, entry: await keys.rewrap(did, 'journal', entry.entry, 2) }] })).remaining, 0);
  assert.equal((await store.finishRotation(did, 2)).state, 'finished');
  assert.equal(await keys.open(did, 'journal', (await store.journal(did)).entries[0].entry), 'Created kept');
  // A journal entry under the old key is refused once the floor is up.
  await assert.rejects(store.write(did, { id, ciphertext: await keys.seal(did, id, 'new', 2) }, { replaces: (await store.read(did, id)).version, journal: await keys.seal(did, 'journal', 'old key') }), refusal('OlderKey'));
});
