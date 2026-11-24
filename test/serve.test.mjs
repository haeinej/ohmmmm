// `ohmmmm serve`, the home's bridge on this machine (docs/serve.md): only this machine, only with the
// home's token, only to the app's origins; the vault's and the cortex's tools over MCP; and images by
// CID, written into the home as media blocks by the person. Every person here is invented.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { initHome } from '../bin/ohmmmm.mjs';
import { APP, homeBridge, homeToken, listenHome, pairingLink, TOKEN } from '../home/serve.mjs';
import { blobCid } from '../vault/vault/core.mjs';
import { readEvents } from '../vault/vault/journal.mjs';
import { readNode } from '../vault/vault/node.mjs';

// A 1×1 PNG, as a synthetic image.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function setUp(t) {
  const parent = await mkdtemp(join(tmpdir(), 'ohmmmm-serve-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const layout = await initHome(parent, 'mira.example.com');
  await mkdir(join(layout.vault, 'notes'), { recursive: true });
  await writeFile(join(layout.vault, 'notes/walk.md'), '---\ntitle: Slow walk\n---\n\nYanaka, lanterns, cats.\n');
  const token = await homeToken(layout.home);
  const server = await listenHome(homeBridge({ layout, token, DatabaseSync }), { port: 0 });
  t.after(() => new Promise(done => { server.closeAllConnections(); server.close(done); }));
  const port = server.address().port;
  // node:http, so the Host and Origin headers are exactly what each check sends.
  const call = (method, path, { headers = {}, body } = {}) => new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { Host: `127.0.0.1:${port}`, ...headers } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const json = /json/.test(res.headers['content-type'] ?? '') ? JSON.parse(raw.toString('utf8')) : undefined;
        done({ status: res.statusCode, headers: res.headers, raw, json });
      });
    });
    req.on('error', fail);
    req.end(body);
  });
  const signed = { Authorization: `Bearer ${token}` };
  const mcp = async (endpoint, name) => {
    const init = await call('POST', endpoint, { headers: { ...signed, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name } } }) });
    const session = init.headers['mcp-session-id'];
    let id = 1;
    const send = (method, params = {}) => call('POST', endpoint, { headers: { ...signed, 'Content-Type': 'application/json', 'Mcp-Session-Id': session }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    return { init, session, send };
  };
  return { layout, token, port, call, signed, mcp };
}

test('the bridge answers only this machine, only with the token, and only to the app', async t => {
  const { layout, token, port, call, signed } = await setUp(t);
  // The token is kept for the person alone, and stays the same until replaced.
  assert.equal((await stat(join(layout.home, TOKEN))).mode & 0o777, 0o600);
  assert.equal(await homeToken(layout.home), token);
  assert.notEqual(await homeToken(layout.home, { replace: true }), token);
  assert.equal(pairingLink(APP, 'http://127.0.0.1:8766', 'abc'), 'https://app.ohmmmm.com/#bridge=http%3A%2F%2F127.0.0.1%3A8766&token=abc');

  assert.equal((await call('GET', '/')).status, 401);
  assert.equal((await call('GET', '/', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await call('GET', '/', { headers: { ...signed, Host: `evil.example:${port}` } })).status, 403, 'DNS rebinding');
  assert.equal((await call('GET', '/', { headers: { ...signed, Origin: 'https://evil.example' } })).status, 403);

  // A preflight from the app learns which headers it may send, and that this machine may be reached.
  const preflight = await call('OPTIONS', '/vault/mcp', { headers: { Origin: APP, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Private-Network': 'true' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], APP);
  assert.equal(preflight.headers['access-control-allow-private-network'], 'true');
  assert.match(preflight.headers['access-control-allow-headers'], /Authorization/);

  const status = await call('GET', '/', { headers: { ...signed, Origin: APP } });
  assert.equal(status.status, 200);
  assert.equal(status.headers['access-control-allow-origin'], APP);
  assert.deepEqual([status.json.home, status.json.cortex], ['mira.example.com', true]);
  // The app in development, on this machine, is let in too.
  assert.equal((await call('GET', '/', { headers: { ...signed, Origin: 'http://localhost:5190' } })).status, 200);
});

test('agents reach the vault and the cortex over MCP, each session named by its client', async t => {
  const { layout, mcp } = await setUp(t);
  const vault = await mcp('/vault/mcp', 'Claude Code');
  assert.equal(vault.init.json.result.serverInfo.name, 'ohm-vault');
  assert.ok(vault.session);
  const listed = await vault.send('tools/list');
  assert.ok(listed.json.result.tools.some(tool => tool.name === 'vault_rename'));
  await vault.send('tools/call', { name: 'vault_index' });
  const found = await vault.send('tools/call', { name: 'vault_local_search', arguments: { query: 'lanterns' } });
  assert.match(found.json.result.content[0].text, /notes\/walk\.md/);
  // Grants still decide: a write without one is refused, naming the agent as its client named it.
  const write = await vault.send('tools/call', { name: 'vault_write', arguments: { path: 'notes/new.md', text: 'Hello.' } });
  assert.equal(write.json.result.isError, true);
  assert.match(write.json.result.content[0].text, /ohm vault grant Claude-Code write notes/);

  const cortex = await mcp('/cortex/mcp', 'Claude Code');
  assert.ok(cortex.session);
  const tools = await cortex.send('tools/list');
  assert.ok(tools.json.result.tools.some(tool => tool.name === 'cortex_start'));
  assert.ok((await stat(join(layout.cortex, 'agents', 'AGENTS.md'))).isFile());
});

test('an image put through the bridge becomes a media block in the home, by the person, and comes back by its CID', async t => {
  const { layout, call, signed } = await setUp(t);
  const cid = await blobCid(PNG);
  const put = (query, bytes = PNG, type = 'image/png', at = cid) => call('PUT', `/media/${at}?${new URLSearchParams(query)}`, { headers: { ...signed, 'Content-Type': type }, body: bytes });

  assert.equal((await put({ channel: 'photos' }, PNG, 'text/plain')).status, 415);
  assert.equal((await put({ channel: '../x' })).status, 400);
  assert.equal((await put({ channel: 'photos' }, Buffer.from('other bytes'))).status, 400, 'the bytes must be what the CID says');

  const made = await put({ channel: 'photos', name: 'Wet street.png', alt: 'A wet street at dusk', width: '1', height: '1' });
  assert.equal(made.status, 201);
  assert.deepEqual([made.json.created, made.json.slug, made.json.path, made.json.file], [true, 'wet-street', 'photos/wet-street.md', 'photos/wet-street.png']);
  assert.deepEqual(await readFile(join(layout.vault, 'photos/wet-street.png')), PNG);
  const block = readNode('photos/wet-street.md', await readFile(join(layout.vault, 'photos/wet-street.md'), 'utf8'));
  assert.deepEqual(block.problems, []);
  assert.equal(block.node.kind, 'media');
  assert.equal(block.node.id, made.json.id);
  assert.equal(block.node.body, '![[wet-street.png]]');
  assert.deepEqual(block.node.properties, { alt: 'A wet street at dusk', hash: cid, mime: 'image/png', width: 1, height: 1 });
  const { events } = await readEvents(layout.vault);
  assert.deepEqual(events.filter(event => event.path.startsWith('photos/')).map(event => [event.op, event.path, event.by, event.via]), [
    ['added', 'photos/wet-street.png', 'me', 'editor'],
    ['added', 'photos/wet-street.md', 'me', 'editor'],
  ]);

  // The same bytes again are the same media block; nothing is copied.
  const again = await put({ channel: 'reading', name: 'copy.png' });
  assert.equal(again.status, 200);
  assert.deepEqual([again.json.created, again.json.path], [false, 'photos/wet-street.md']);

  const got = await call('GET', `/media/${cid}`, { headers: signed });
  assert.equal(got.status, 200);
  assert.deepEqual(got.raw, PNG);
  assert.equal(got.headers['content-type'], 'image/png');
  assert.match(got.headers['cache-control'], /immutable/);
  // A file edited since is not served under its old name.
  await writeFile(join(layout.vault, 'photos/wet-street.png'), 'changed');
  assert.equal((await call('GET', `/media/${cid}`, { headers: signed })).status, 404);
  assert.equal((await call('GET', '/media/not-a-cid', { headers: signed })).status, 400);
});

test('ohmmmm serve starts inside a home and prints the link that pairs the app', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'ohmmmm-serve-cli-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const layout = await initHome(parent, 'mira.example.com');
  const cli = fileURLToPath(new URL('../bin/ohmmmm.mjs', import.meta.url));
  // Its own process group, so stopping it stops the bridge it starts too, as Ctrl-C does in a terminal.
  const child = spawn(process.execPath, [cli, 'serve', '--port', '0', '--app', 'http://localhost:5190'], { cwd: layout.vault, env: { ...process.env, OHMMMM_HOME: '' }, detached: true });
  t.after(() => { try { process.kill(-child.pid); } catch {} });
  const printed = await new Promise((done, fail) => {
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; if (out.includes('/cortex/mcp')) done(out); });
    child.on('exit', code => fail(new Error(`exited ${code}: ${out}`)));
  });
  const token = (await readFile(join(layout.home, TOKEN), 'utf8')).trim();
  assert.match(printed, /to this machine only/);
  assert.ok(printed.includes(`http://localhost:5190/#bridge=http%3A%2F%2F127.0.0.1%3A`), printed);
  assert.ok(printed.includes(`&token=${token}`));
});

test('the person edits files through the bridge only over the version they read, and every version is kept', async t => {
  const { layout, call, signed, mcp } = await setUp(t);
  const vault = await mcp('/vault/mcp', 'checker');
  await vault.send('tools/call', { name: 'vault_index' });
  const listed = await call('GET', '/vault/files', { headers: signed });
  assert.equal(listed.status, 200);
  const walk = listed.json.files.find(file => file.path === 'notes/walk.md');
  assert.equal(walk.version, await blobCid(Buffer.from(walk.text, 'utf8')));
  const put = (path, text, headers) => call('PUT', `/vault/file?path=${encodeURIComponent(path)}`, { headers: { ...signed, 'Content-Type': 'text/markdown', ...headers }, body: text });

  // Which version was read must be said, and must still be the file's.
  assert.equal((await put('notes/walk.md', 'changed')).status, 428);
  const stale = await put('notes/walk.md', '---\ntitle: Slow walk\n---\n\nRain.\n', { 'If-Match': '"bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaa"' });
  assert.equal(stale.status, 412);
  assert.equal(stale.json.version, walk.version);
  const edited = '---\ntitle: Slow walk\norigin: /Users/mira/notes/walk.md\n---\n\nYanaka in the rain.\n';
  const saved = await put('notes/walk.md', edited, { 'If-Match': `"${walk.version}"` });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.version, await blobCid(Buffer.from(edited, 'utf8')));
  assert.equal(saved.headers.etag, `"${saved.json.version}"`);
  assert.equal(await readFile(join(layout.vault, 'notes/walk.md'), 'utf8'), edited);
  assert.equal(await readFile(join(layout.vault, '.vault/history', walk.version), 'utf8'), walk.text, 'the version before is kept');

  // A new file only where none is; and only Markdown the vault can read, in an ordinary place.
  assert.equal((await put('notes/new.md', '---\ntitle: New\n---\n\nHello.\n', { 'If-None-Match': '*' })).status, 201);
  assert.equal((await put('notes/new.md', '---\ntitle: New\n---\n\nAgain.\n', { 'If-None-Match': '*' })).status, 412);
  for (const path of ['.vault/grants.json', '../outside.md', 'notes/.hidden.md', '_sources/x/extracted.md', 'notes/image.png']) {
    assert.equal((await put(path, 'x', { 'If-None-Match': '*' })).status, 400, path);
  }
  assert.equal((await put('notes/bad.md', '---\ntitle: Bad\nid: not-one-the-vault-gave\n---\n\nx\n', { 'If-None-Match': '*' })).status, 422);

  const removed = await call('DELETE', '/vault/file?path=notes%2Fnew.md', { headers: { ...signed, 'If-Match': `"${await blobCid(Buffer.from('---\ntitle: New\n---\n\nHello.\n', 'utf8'))}"` } });
  assert.equal(removed.status, 200);
  assert.ok(removed.json.removed);

  // Journaled once, as the person; the next scan adds nothing of its own.
  const { events } = await readEvents(layout.vault);
  assert.deepEqual(events.filter(event => event.via === 'editor').map(event => `${event.op} ${event.path} ${event.by}`), [
    'changed notes/walk.md me', 'added notes/new.md me', 'removed notes/new.md me',
  ]);
  const indexed = JSON.parse((await vault.send('tools/call', { name: 'vault_index' })).json.result.content[0].text);
  assert.equal(indexed.journaled, 0);
});
