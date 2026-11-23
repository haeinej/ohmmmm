import assert from 'node:assert/strict';
import test from 'node:test';
import { privateStore } from '../service/src/private.mjs';
import { testDatabase } from './d1.mjs';
import { running } from './members.mjs';
import { opaque, sealer } from './sealer.mjs';

// Every person and file here is invented.
const refusal = code => problem => problem.code === code;
const me = 'did:web:pds.alder.test';
const OBSERVATION = '---\nkind: observation\nby: agent:helper\nabout: [block:3mzocqfoc22if]\n---\n\nKeeps titles to three words.\n';

test('the cortex is kept sealed, apart from the private layer, with versions and compare-and-swap', async () => {
  const db = await testDatabase();
  const cortex = privateStore(db, { kind: 'cortex' }), vault = privateStore(db);
  const keys = await sealer('ohm-vault/cortex/v1');
  const id = opaque();
  const saved = await cortex.write(me, { id, ciphertext: await keys.seal(me, id, OBSERVATION) });
  assert.equal(await keys.open(me, id, (await cortex.read(me, id)).ciphertext), OBSERVATION);
  // The vault's private layer never sees a cortex file, and the other way round.
  assert.deepEqual((await vault.list(me)).blocks, []);
  await assert.rejects(vault.read(me, id), problem => problem.code === 'NotFound' && /private block/.test(problem.message));
  await assert.rejects(cortex.write(me, { id, ciphertext: await keys.seal(me, id, 'Other words.') }), problem => problem.code === 'Changed' && /cortex file/.test(problem.message));
  await assert.rejects(cortex.write(me, { id: opaque(), ciphertext: 'Keeps titles short.' }), refusal('InvalidBlock'));
  const edited = await cortex.write(me, { id, ciphertext: await keys.seal(me, id, OBSERVATION.replace('three', 'four')) }, { replaces: saved.version });
  assert.deepEqual((await cortex.versions(me, id)).versions.map(each => each.rev), [edited.rev, saved.rev]);
});

test('one key rotation covers the private layer and the cortex, and finishes only when both are re-wrapped', async () => {
  const db = await testDatabase();
  const cortex = privateStore(db, { kind: 'cortex' }), vault = privateStore(db);
  const keys = await sealer('ohm-vault/cortex/v1');
  const id = opaque();
  const sealed = await keys.seal(me, id, OBSERVATION);
  const saved = await cortex.write(me, { id, ciphertext: sealed });
  assert.equal((await vault.beginRotation(me, 2)).remaining, 1);
  await assert.rejects(vault.finishRotation(me, 2), refusal('RotationRemaining'));
  assert.deepEqual((await cortex.belowTarget(me, 2)).versions, [{ id, rev: saved.rev, generation: 1 }]);
  const rewrapped = await keys.rewrap(me, id, sealed, 2);
  assert.equal((await cortex.rewrap(me, 2, { versions: [{ id, rev: saved.rev, ciphertext: rewrapped }] })).remaining, 0);
  assert.deepEqual(await vault.finishRotation(me, 2), { target: 2, state: 'finished' });
});

test('cortex requests reach only the member', async () => {
  const { haein, jun, ask } = await running();
  const keys = await sealer('ohm-vault/cortex/v1');
  const id = opaque();
  const asCortex = (who, name, options) => ask(who, `cortex.${name}`, options);
  const put = await asCortex(haein, 'putFile', { body: { file: { id, ciphertext: await keys.seal(haein.did, id, OBSERVATION) } } });
  assert.equal(put.status, 200);
  assert.equal((await asCortex(haein, 'getFile', { query: { id } })).version, put.version);
  assert.equal((await asCortex(jun, 'getFile', { query: { id } })).status, 404);
});
