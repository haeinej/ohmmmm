import assert from 'node:assert/strict';
import test from 'node:test';
import { channelStore } from '../service/src/channels.mjs';
import { blockStore } from '../service/src/blocks.mjs';
import { mediaHash, mediaStore } from '../service/src/media.mjs';
import { postStore } from '../service/src/store.mjs';
import { newPostId } from '../vault/file.mjs';
import { testDatabase } from './d1.mjs';
import { running } from './members.mjs';
import { opaque } from './sealer.mjs';

// Every person and file here is invented.
const refusal = code => problem => problem.code === code;
const me = 'did:web:pds.alder.test', other = 'did:web:pds.birch.test';
// An R2 bucket, held in memory.
export function memoryBucket() {
  const held = new Map();
  return {
    held,
    head: async key => held.has(key) ? { size: held.get(key).bytes.byteLength } : null,
    get: async key => held.has(key) ? { body: held.get(key).bytes, httpMetadata: held.get(key).httpMetadata } : null,
    put: async (key, bytes, { httpMetadata } = {}) => { held.set(key, { bytes: new Uint8Array(bytes), httpMetadata }); },
  };
}

test('readable media is kept under its content address, per member, and sealed media under an opaque ID', async () => {
  const bucket = memoryBucket();
  const media = mediaStore(bucket);
  const bytes = new TextEncoder().encode('a small picture');
  const name = await mediaHash(bytes);
  assert.deepEqual(await media.put(me, name, bytes, { type: 'image/png' }), { name, size: bytes.byteLength });
  assert.equal((await media.put(me, name, bytes, { type: 'image/png' })).unchanged, true);
  await assert.rejects(media.put(me, name, new TextEncoder().encode('other bytes')), refusal('InvalidRequest'));
  assert.deepEqual(await media.has(me, name), { present: [name] });
  // Sending the same bytes tells another member nothing about what someone else holds.
  assert.deepEqual(await media.has(other, name), { present: [] });
  const answered = await media.get(me, name);
  assert.equal(answered.headers.get('Content-Type'), 'image/png');
  assert.equal(await answered.text(), 'a small picture');

  const sealed = opaque();
  await media.put(me, sealed, new Uint8Array([1, 2, 3]));
  await assert.rejects(media.put(me, opaque(), new Uint8Array([1]), { type: 'image/png' }), refusal('InvalidRequest'));
  await assert.rejects(media.rendition(me, sealed, 480), refusal('InvalidRequest'));
  // Without an image service, the original is shown.
  assert.equal(await (await media.rendition(me, name, 480)).text(), 'a small picture');
  await assert.rejects(media.rendition(me, name, 333), refusal('InvalidRequest'));
  await assert.rejects(media.put(me, 'photo.jpg', bytes), refusal('InvalidRequest'));
  await assert.rejects(mediaStore(undefined).get(me, name), refusal('MediaUnavailable'));
});

test('media is sent through the service as bytes, and read back by the member only', async () => {
  const { haein, jun, ask, env } = await running();
  env.MEDIA = memoryBucket();
  const bytes = new TextEncoder().encode('a picture');
  const name = await mediaHash(bytes);
  const sent = await ask(haein, 'media.putMedia', { query: { name }, raw: { bytes, type: 'image/jpeg' } });
  assert.equal(sent.status, 200);
  assert.deepEqual(await sent.json(), { name, size: bytes.byteLength });
  const back = await ask(haein, 'media.getMedia', { query: { name } });
  assert.equal(back.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(await back.text(), 'a picture');
  assert.equal((await ask(jun, 'media.getMedia', { query: { name } })).status, 404);
  assert.deepEqual((await ask(haein, 'media.hasMedia', { query: { names: name } })).present, [name]);
});

test('the agenda counts what waits for the member, from what the service may read', async () => {
  const db = await testDatabase();
  const channels = channelStore(db), blocks = blockStore(db);
  let made = 0;
  const id = () => newPostId(Date.parse('2026-11-23T00:00:00Z') + made++, 5);
  const now = new Date('2026-11-23T00:00:00Z');
  const block = (path, more) => ({ id: id(), path, text: `---\nkind: text\nvisibility: friends\n${more}---\n\nx\n` });
  await blocks.write(me, block('inbox/old.md', 'by: agent:helper\nstatus: proposed\ncreated: 2026-11-01\n'));
  await blocks.write(me, block('inbox/new.md', 'by: agent:helper\nstatus: proposed\ncreated: 2026-11-22\n'));
  await blocks.write(me, { id: id(), path: 'photographs/seoul/street.md', text: '---\nkind: media\nvisibility: friends\norigin: ~/site/photo archive/Seoul/street.jpg\n---\n' });
  await postStore(db).write(me, { id: id(), slug: 'why', label: 'other', sublabel: '', visibility: 'public', title: 'Why', body: 'Words.', properties: {} });
  assert.deepEqual(await channels.agenda(me, { now }), { unlabelled: 1, proposed: 2, waiting: 1, mediaWithoutAlt: 1, counted: 'public and friends-only' });
});
