import test from 'node:test';
import assert from 'node:assert/strict';
import { ohm, pdsSource } from '../index.mjs';
import { document, did, fakePds } from '../testing/fake-pds.mjs';

const channels = { essays: { label: 'essays' }, reading: { label: 'notes', sublabel: 'reading' } };
const sourceAt = origin => pdsSource({ did, origin, channels });
function context(parseData = async ({ data }) => data) {
  const entries = new Map([['stale', { id: 'stale' }]]);
  return { entries, store: { clear: () => entries.clear(), set: entry => entries.set(entry.id, entry) },
    parseData, generateDigest: data => JSON.stringify(data) };
}

test('PDS source reads every page, decodes owned documents, and renders media and own links', async t => {
  const foreign = document('foreign');
  foreign.value.content.$type = 'com.example.article';
  const pds = await fakePds(t, url => ({ records: url.searchParams.has('cursor')
    ? [document('two', { body: `[One](at://${did}/com.ohmmmm.post/one)` })]
    : [document('one'), foreign], ...(url.searchParams.has('cursor') ? {} : { cursor: 'next' }) }));
  const entries = await sourceAt(pds.origin).read({ channel: 'essays' });
  assert.deepEqual(entries.map(entry => entry.id), ['one', 'two']);
  assert.equal(entries[0].data.uri, `at://${did}/site.standard.document/one`);
  assert.equal(entries[0].data.publishedAt, '2026-01-02T03:04:05.000Z');
  assert.match(entries[0].rendered.html, /<strong>quiet<\/strong>/);
  assert.match(entries[0].rendered.html, /alt="A green tree"/);
  assert.equal(new URL(entries[0].data.media[0].url).pathname, '/xrpc/com.atproto.sync.getBlob');
  assert.match(entries[1].rendered.html, /href="\/posts\/essays\/one"/);
  assert.equal(pds.requests.length, 2);
  for (const { url, method } of pds.requests) {
    assert.equal(method, 'GET');
    assert.equal(url.searchParams.get('collection'), 'site.standard.document');
    assert.equal(url.searchParams.get('repo'), did);
  }
});

test('channel mapping selects labels and sublabels and rejects unmapped channels', async t => {
  const pds = await fakePds(t, () => ({ records: [document('one'),
    document('two', { label: 'notes', sublabel: 'reading' }), document('three', { label: 'notes' })] }));
  const source = sourceAt(pds.origin);
  assert.deepEqual((await source.read({ channel: 'reading' })).map(entry => entry.id), ['two']);
  await assert.rejects(source.read({ channel: 'missing' }), /No PDS mapping/);
});

test('loader stages schema validation, uses stable keys and deletes withdrawn posts on success', async t => {
  let records = [document('one')];
  const pds = await fakePds(t, () => ({ records }));
  const loader = ohm({ source: sourceAt(pds.origin), channel: 'essays' });
  const state = context(async ({ id, data }) => ({ ...data, checked: id }));
  await loader.load(state);
  assert.deepEqual([...state.entries.keys()], ['one']);
  assert.equal(state.entries.get('one').data.checked, 'one');
  const digest = state.entries.get('one').digest;
  records = [document('one', { title: 'Changed' })];
  await loader.load(state);
  assert.notEqual(state.entries.get('one').digest, digest);
  records = [];
  await loader.load(state);
  assert.equal(state.entries.size, 0);
});

test('schema failure preserves the previous collection', async t => {
  const pds = await fakePds(t, () => ({ records: [document('one'), document('two')] }));
  const state = context(async ({ id, data }) => {
    if (id === 'two') throw new Error('Schema rejected');
    return data;
  });
  await assert.rejects(ohm({ source: sourceAt(pds.origin), channel: 'essays' }).load(state), /Schema rejected/);
  assert.deepEqual([...state.entries.keys()], ['stale']);
});

for (const [name, handler, error] of [
  ['HTTP failure', () => ({ status: 503, body: {} }), /HTTP 503/],
  ['invalid inventory', () => ({ records: {} }), /invalid record list/],
  ['repeated cursor', () => ({ records: [], cursor: 'same' }), /invalid cursor/],
  ['malformed owned post', () => ({ records: [document('bad', { body: null })] }), /Invalid ohm post/],
]) {
  test(`${name} preserves the previous collection`, async t => {
    const pds = await fakePds(t, handler);
    const state = context();
    await assert.rejects(ohm({ source: sourceAt(pds.origin), channel: 'essays' }).load(state), error);
    assert.deepEqual([...state.entries.keys()], ['stale']);
  });
}

test('bounded reads refuse partial success', async t => {
  const pds = await fakePds(t, () => ({ records: [document('one')], cursor: 'next' }));
  const source = pdsSource({ did, origin: pds.origin, channels, maxPages: 1 });
  await assert.rejects(source.read({ channel: 'essays' }), /inventory is incomplete/);
});

test('source interface validates snapshots before clearing a collection', async () => {
  for (const snapshot of [null, [{ id: 'one' }], [
    { id: 'one', data: {}, body: '', rendered: { html: '' } },
    { id: 'one', data: {}, body: '', rendered: { html: '' } },
  ]]) {
    const state = context();
    await assert.rejects(ohm({ source: { read: async () => snapshot }, channel: 'essays' }).load(state));
    assert.ok(state.entries.has('stale'));
  }
});

test('configuration rejects unsafe origins and invalid mappings', () => {
  assert.throws(() => sourceAt('http://pds.example.com'), /HTTPS/);
  assert.throws(() => sourceAt('https://user:password@pds.example.com'), /HTTPS/);
  assert.throws(() => pdsSource({ did, origin: 'https://pds.example.com', channels: { essays: {} } }), /label/);
  assert.throws(() => ohm({ source: {}, channel: 'essays' }), /implement read/);
});
