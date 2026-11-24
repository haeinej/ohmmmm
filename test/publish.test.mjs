// Publishing a block from the app, through `ohmmmm serve` (docs/serve.md, "Publishing"): the plan the
// person approves, the post written to their PDS with the app password kept on this computer, the
// block's file marked public and its label kept on the channel, and taking it down again. The PDS is a
// fake one on this machine, and every person, place and address here is invented.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { initHome } from '../bin/ohmmmm.mjs';
import { homeBridge, homeToken, listenHome, SITE_CONFIG } from '../home/serve.mjs';
import { DOCUMENT, fromDocument, PUBLICATION, PUBLICATION_KEY } from '../vault/feed/standard.mjs';
import { LOCAL_TOOLS } from '../vault/mcp/local.mjs';
import { blobCid } from '../vault/vault/core.mjs';
import { readEvents } from '../vault/vault/journal.mjs';
import { readNode } from '../vault/vault/node.mjs';

const did = 'did:web:pds.example.test';
const site = 'https://example.test';
// A 1×1 PNG, as a synthetic image.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// A PDS on this machine that answers what publishing asks of it, and checks versions as a PDS does.
async function fakePds(t) {
  const asked = [];
  const records = new Map();
  let written = 0;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const method = url.pathname.split('/').at(-1);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const sent = Buffer.concat(chunks);
    const signed = req.headers.authorization === 'Bearer token-1';
    asked.push(`${method}${signed ? ' (signed in)' : ''}`);
    const answer = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (method === 'com.atproto.server.createSession') {
      const { identifier, password } = JSON.parse(sent);
      return password === 'app-password' ? answer(200, { did: identifier, accessJwt: 'token-1' }) : answer(401, { error: 'AuthenticationRequired' });
    }
    if (method === 'com.atproto.repo.getRecord') {
      const held = records.get(`${url.searchParams.get('collection')}/${url.searchParams.get('rkey')}`);
      return held ? answer(200, { cid: held.cid, value: held.value }) : answer(400, { error: 'RecordNotFound' });
    }
    if (!signed) return answer(401, { error: 'AuthenticationRequired' });
    if (method === 'com.atproto.repo.uploadBlob') {
      return answer(200, { blob: { $type: 'blob', ref: { $link: await blobCid(new Uint8Array(sent)) }, mimeType: req.headers['content-type'], size: sent.length } });
    }
    const body = JSON.parse(sent);
    const at = `${body.collection}/${body.rkey}`;
    if (method === 'com.atproto.repo.createRecord') {
      if (records.has(at)) return answer(400, { error: 'InvalidRequest', message: 'Record already exists' });
      records.set(at, { value: body.record, cid: `cid-${++written}` });
      return answer(200, { uri: `at://${body.repo}/${at}`, cid: records.get(at).cid });
    }
    if (method === 'com.atproto.repo.putRecord') {
      if (records.get(at)?.cid !== body.swapRecord) return answer(400, { error: 'InvalidSwap' });
      records.set(at, { value: body.record, cid: `cid-${++written}` });
      return answer(200, { uri: `at://${body.repo}/${at}`, cid: records.get(at).cid });
    }
    if (method === 'com.atproto.repo.deleteRecord') {
      if (body.swapRecord && records.get(at)?.cid !== body.swapRecord) return answer(400, { error: 'InvalidSwap' });
      records.delete(at);
      return answer(200, {});
    }
    answer(404, { error: 'MethodNotImplemented' });
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => { server.closeAllConnections(); server.close(done); }));
  return { asked, records, origin: `http://127.0.0.1:${server.address().port}` };
}

async function setUp(t, { config = true, password = 'app-password' } = {}) {
  const pds = await fakePds(t);
  const parent = await mkdtemp(join(tmpdir(), 'ohmmmm-publish-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const layout = await initHome(parent, 'mira.example.com');
  await mkdir(join(layout.vault, 'notes'), { recursive: true });
  await writeFile(join(layout.vault, 'notes/_channel.md'), '---\ntitle: Field notes\n---\n\nWalks, mostly.\n');
  await writeFile(join(layout.vault, 'notes/walk.md'), '---\ntitle: Slow walk\n---\n\nYanaka after the rain, as [[Tea house]] said.\n\n![[street]]\n');
  await writeFile(join(layout.vault, 'notes/street.png'), PNG);
  await writeFile(join(layout.vault, 'notes/street.md'), '---\nkind: media\ntitle: Street\nalt: A wet street at dusk\nmime: image/png\n---\n\n![[street.png]]\n');
  await writeFile(join(layout.vault, 'notes/tea-house.md'), '---\ntitle: Tea house\n---\n\nA quiet one.\n');
  if (config) await writeFile(join(layout.home, SITE_CONFIG), JSON.stringify({ vars: { ATPROTO_DID: did, ATPROTO_PDS_ORIGIN: pds.origin, SITE_ORIGIN: site } }));
  const token = await homeToken(layout.home);
  const server = await listenHome(homeBridge({ layout, token, DatabaseSync, env: password ? { ATPROTO_APP_PASSWORD: password } : {} }), { port: 0 });
  t.after(() => new Promise(done => { server.closeAllConnections(); server.close(done); }));
  const port = server.address().port;
  const call = (method, path, { headers = {}, body } = {}) => new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { Host: `127.0.0.1:${port}`, Authorization: `Bearer ${token}`, ...headers } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => done({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') }));
    });
    req.on('error', fail);
    req.end(body);
  });
  const post = (path, value, headers = {}) => call('POST', path, { headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
  const file = async path => readFile(join(layout.vault, path), 'utf8');
  const version = async path => blobCid(Buffer.from(await file(path), 'utf8'));
  return { layout, pds, call, post, file, version };
}

test('the plan says what publishing would write, and what this computer still needs, without writing', async t => {
  const bare = await setUp(t, { config: false, password: '' });
  const plan = (await bare.post('/vault/publish/plan', { path: 'notes/walk.md' })).json;
  assert.equal(plan.ready, false);
  assert.deepEqual(plan.needs.map(need => need.what), ['site', 'password']);
  assert.equal(plan.address, undefined);
  assert.deepEqual([plan.title, plan.label, plan.labelSaved, plan.layer], ['Slow walk', 'Field notes', false, 'private']);
  assert.deepEqual(plan.attachments.map(each => [each.id, each.path, each.mime]), [['street', 'notes/street.png', 'image/png']]);
  assert.deepEqual(bare.pds.asked, []);

  const { post, pds, file } = await setUp(t);
  const ready = (await post('/vault/publish/plan', { path: 'notes/walk.md' })).json;
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.needs, []);
  assert.equal(ready.address, `${site}/posts/field-notes/walk`);
  assert.equal(ready.update, false);
  assert.match(ready.notes.join(' '), /“Tea house” becomes plain words/);
  assert.match(ready.confirm, /^v[a-z2-7]+$/);
  // Another label, another address. Planning only read the PDS, signed out.
  assert.equal((await post('/vault/publish/plan', { path: 'notes/walk.md', label: 'Walks', sublabel: 'Tokyo' })).json.address, `${site}/posts/walks/tokyo/walk`);
  assert.ok(pds.asked.every(each => !each.includes('signed in')));
  assert.equal(pds.records.size, 0);
  assert.doesNotMatch(await file('notes/walk.md'), /visibility/);

  // What cannot be published says why.
  const broken = await setUp(t);
  await writeFile(join(broken.layout.vault, 'notes/walk.md'), '---\ntitle: Slow walk\n---\n\n![A view](https://images.example.test/view.png) and ![[gone.png]]\n');
  const refused = (await broken.post('/vault/publish/plan', { path: 'notes/walk.md' })).json;
  assert.equal(refused.ready, false);
  assert.match(refused.problems.join(' '), /images\.example\.test, which is not in your home/);
  assert.match(refused.problems.join(' '), /“gone\.png”, which is not a file in your home/);
});

test('publishing writes the post under the block\'s ID, marks the file public and keeps the label; an update keeps its address', async t => {
  const { layout, post, pds, file, version, call } = await setUp(t);
  // Indexed first, as a home that has been open a while is, so the publish is a change the next scan sees.
  await call('GET', '/vault/journal');
  const planned = (await post('/vault/publish/plan', { path: 'notes/walk.md', label: 'Walks' })).json;
  assert.equal((await post('/vault/publish', { path: 'notes/walk.md', label: 'Walks', confirm: planned.confirm })).status, 428);
  // Only the plan the person saw is published: another label is another plan.
  const other = await post('/vault/publish', { path: 'notes/walk.md', label: 'Elsewhere', confirm: planned.confirm }, { 'If-Match': `"${planned.version}"` });
  assert.deepEqual([other.status, other.json.error], [409, 'It changed since you saw the plan. Look at it again before publishing.']);
  const stale = await post('/vault/publish', { path: 'notes/walk.md', label: 'Walks', confirm: planned.confirm }, { 'If-Match': '"bstale"' });
  assert.equal(stale.status, 412);
  assert.equal(pds.records.size, 0);

  const done = await post('/vault/publish', { path: 'notes/walk.md', label: 'Walks', confirm: planned.confirm }, { 'If-Match': `"${planned.version}"` });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.address, `${site}/posts/walks/walk`);
  // The publication first, then the document, under the ID now written into the block's file.
  const walk = readNode('notes/walk.md', await file('notes/walk.md')).node;
  assert.equal(done.json.key, walk.id);
  assert.deepEqual([walk.visibility, walk.kind], ['public', 'text']);
  assert.deepEqual([...pds.records.keys()], [`${PUBLICATION}/${PUBLICATION_KEY}`, `${DOCUMENT}/${walk.id}`]);
  const record = fromDocument(pds.records.get(`${DOCUMENT}/${walk.id}`).value, { did });
  assert.equal(record.body, 'Yanaka after the rain, as Tea house said.\n\n![A wet street at dusk](media:street)');
  assert.deepEqual([record.label, record.slug, record.form, record.canonicalUrl], ['Walks', 'walk', 'writing', `${site}/posts/walks/walk`]);
  assert.deepEqual(record.media.map(item => [item.id, item.file.mimeType, item.file.ref.$link, item.width, item.height]), [['street', 'image/png', await blobCid(PNG), 1, 1]]);
  // The label is kept on the channel, so it is the default next time.
  assert.deepEqual(readNode('notes/_channel.md', await file('notes/_channel.md')).node.site, { label: 'Walks' });
  assert.deepEqual(done.json.files.map(each => each.path), ['notes/walk.md', 'notes/_channel.md']);

  // Journaled as the person's, and a scan does not count the publish again.
  await call('GET', '/vault/journal');
  const mine = (await readEvents(layout.vault)).events.filter(event => event.path === 'notes/walk.md' || event.path === 'notes/_channel.md');
  assert.deepEqual(mine.filter(event => event.via !== 'scan' || event.op !== 'added').map(event => [event.op, event.path, event.via, event.layer, event.was, event.key, event.address]), [
    ['changed', 'notes/walk.md', 'publish', 'public', 'private', undefined, undefined],
    ['changed', 'notes/_channel.md', 'publish', undefined, undefined, undefined, undefined],
    ['published', 'notes/walk.md', 'publish', undefined, undefined, walk.id, `${site}/posts/walks/walk`],
  ]);

  // Another block now links to the post; the next block in the channel files under the kept label.
  const tea = (await post('/vault/publish/plan', { path: 'notes/tea-house.md' })).json;
  assert.deepEqual([tea.label, tea.labelSaved, tea.address], ['Walks', true, `${site}/posts/walks/tea-house`]);
  await writeFile(join(layout.vault, 'notes/tea-house.md'), '---\ntitle: Tea house\n---\n\nA quiet one, after a [[Slow walk]].\n');
  const linking = (await post('/vault/publish/plan', { path: 'notes/tea-house.md' })).json;
  const teaDone = await post('/vault/publish', { path: 'notes/tea-house.md', confirm: linking.confirm }, { 'If-Match': `"${linking.version}"` });
  assert.equal(teaDone.status, 200, JSON.stringify(teaDone.json));
  const teaId = readNode('notes/tea-house.md', await file('notes/tea-house.md')).node.id;
  assert.equal(fromDocument(pds.records.get(`${DOCUMENT}/${teaId}`).value, { did }).body, `A quiet one, after a [Slow walk](${site}/posts/walks/walk).`);

  // An update: renamed and edited, it keeps its record, address, label and date.
  const before = fromDocument(pds.records.get(`${DOCUMENT}/${walk.id}`).value, { did });
  await writeFile(join(layout.vault, 'notes/walk.md'), (await file('notes/walk.md')).replace('Yanaka after the rain', 'Yanaka after the long rain').replace('title: Slow walk', 'title: A slow walk'));
  const again = (await post('/vault/publish/plan', { path: 'notes/walk.md', label: 'Ignored' })).json;
  assert.deepEqual([again.update, again.label, again.address, again.publishedAt], [true, 'Walks', `${site}/posts/walks/walk`, before.publishedAt]);
  const updated = await post('/vault/publish', { path: 'notes/walk.md', confirm: again.confirm }, { 'If-Match': `"${await version('notes/walk.md')}"` });
  assert.equal(updated.status, 200, JSON.stringify(updated.json));
  assert.deepEqual(updated.json.files, [], 'the file was public already');
  const after = fromDocument(pds.records.get(`${DOCUMENT}/${walk.id}`).value, { did });
  assert.deepEqual([after.title, after.publishedAt, after.canonicalUrl], ['A slow walk', before.publishedAt, before.canonicalUrl]);
  assert.match(after.body, /long rain/);
  assert.ok(after.updatedAt);
  assert.equal(pds.records.size, 3);
});

test('taking a post down removes its record first, then moves the block; agents have no way to publish', async t => {
  const { layout, post, pds, file, version } = await setUp(t);
  const planned = (await post('/vault/publish/plan', { path: 'notes/walk.md' })).json;
  assert.equal((await post('/vault/publish', { path: 'notes/walk.md', confirm: planned.confirm }, { 'If-Match': `"${planned.version}"` })).status, 200);
  const id = readNode('notes/walk.md', await file('notes/walk.md')).node.id;
  // A public block is not moved by the visibility route: that is Publish's.
  assert.equal((await post('/vault/visibility', { path: 'notes/walk.md', to: 'private' }, { 'If-Match': `"${await version('notes/walk.md')}"` })).status, 409);
  assert.equal((await post('/vault/unpublish', { path: 'notes/walk.md', to: 'public' }, { 'If-Match': `"${await version('notes/walk.md')}"` })).status, 400);

  const down = await post('/vault/unpublish', { path: 'notes/walk.md', to: 'friends' }, { 'If-Match': `"${await version('notes/walk.md')}"` });
  assert.equal(down.status, 200, JSON.stringify(down.json));
  assert.deepEqual([down.json.layer, down.json.removed, down.json.address], ['friends', true, `${site}/posts/field-notes/walk`]);
  assert.equal(pds.records.has(`${DOCUMENT}/${id}`), false);
  assert.equal(readNode('notes/walk.md', await file('notes/walk.md')).node.visibility, 'friends');
  const last = (await readEvents(layout.vault)).events.slice(-2);
  assert.deepEqual(last.map(event => [event.op, event.via, event.key, event.layer, event.was]), [['unpublished', 'publish', id, undefined, undefined], ['changed', 'publish', undefined, 'friends', 'public']]);
  assert.equal((await post('/vault/unpublish', { path: 'notes/walk.md', to: 'private' }, { 'If-Match': `"${await version('notes/walk.md')}"` })).json.error, 'This block is not public.');

  // Publishing is the person's: no tool an agent is given publishes or takes down.
  assert.deepEqual(LOCAL_TOOLS.map(tool => tool.name).filter(name => /publish/.test(name)), []);
});

test('a wrong app password publishes nothing', async t => {
  const { post, pds, file } = await setUp(t, { password: 'not-it' });
  const planned = (await post('/vault/publish/plan', { path: 'notes/walk.md' })).json;
  const refused = await post('/vault/publish', { path: 'notes/walk.md', confirm: planned.confirm }, { 'If-Match': `"${planned.version}"` });
  assert.equal(refused.status, 409);
  assert.match(refused.json.error, /Could not sign in/);
  assert.equal(pds.records.size, 0);
  assert.doesNotMatch(await file('notes/walk.md'), /visibility/);
  assert.doesNotMatch(JSON.stringify(refused.json), /not-it/);
});
