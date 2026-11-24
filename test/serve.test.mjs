// `ohmmmm serve`, the home's bridge on this machine (docs/serve.md): only this machine, only with one
// of the home's keys (the agent key reaching only MCP), only to the app's origins; the vault's and the cortex's tools over MCP; and images by
// CID, written into the home as media blocks by the person. Every person here is invented.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { initHome } from '../bin/ohmmmm.mjs';
import { AGENT_KEY, agentKey, APP, APP_KEYS, homeBridge, listenHome, OLD_TOKEN, pairApp, pairingLink } from '../home/serve.mjs';
import { blobCid } from '../vault/vault/core.mjs';
import { readEvents } from '../vault/vault/journal.mjs';
import { readNode } from '../vault/vault/node.mjs';
import { layerOf } from '../vault/vault/visibility.mjs';

// A 1×1 PNG, as a synthetic image.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function setUp(t) {
  const parent = await mkdtemp(join(tmpdir(), 'ohmmmm-serve-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const layout = await initHome(parent, 'mira.example.com');
  await mkdir(join(layout.vault, 'notes'), { recursive: true });
  await writeFile(join(layout.vault, 'notes/walk.md'), '---\ntitle: Slow walk\n---\n\nYanaka, lanterns, cats.\n');
  const agent = (await agentKey(layout.home)).key;
  const token = await pairApp(layout.home);
  const server = await listenHome(homeBridge({ layout, DatabaseSync }), { port: 0 });
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
  // Agents use the agent key, as they are given it.
  const mcp = async (endpoint, name, key = agent) => {
    const auth = { Authorization: `Bearer ${key}` };
    const init = await call('POST', endpoint, { headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name } } }) });
    const session = init.headers['mcp-session-id'];
    let id = 1;
    const send = (method, params = {}) => call('POST', endpoint, { headers: { ...auth, 'Content-Type': 'application/json', 'Mcp-Session-Id': session }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    return { init, session, send };
  };
  return { layout, token, agent, port, call, signed, mcp };
}

test('the bridge answers only this machine, only with one of the home\'s keys, and only to the app', async t => {
  const { layout, token, port, call, signed } = await setUp(t);
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

test("agents have a key of their own, which reaches only MCP; the app's keys are kept only as hashes", async t => {
  const { layout, token, agent, call, signed, mcp } = await setUp(t);
  const asAgent = { Authorization: `Bearer ${agent}` };
  assert.match(agent, /^ohm_agent_[A-Za-z0-9_-]{43}$/);
  assert.match(token, /^ohm_app_[A-Za-z0-9_-]{43}$/);
  // The agent key is kept as it is, for the person to give to agents; it stays until replaced.
  assert.equal((await stat(join(layout.home, AGENT_KEY))).mode & 0o777, 0o600);
  assert.equal((await stat(join(layout.home, '.ohmmmm'))).mode & 0o777, 0o700);
  assert.equal((await agentKey(layout.home)).key, agent);
  // The app's key is nowhere in the home: only its SHA-256.
  assert.equal((await stat(join(layout.home, APP_KEYS))).mode & 0o777, 0o600);
  const kept = JSON.parse(await readFile(join(layout.home, APP_KEYS), 'utf8')).keys;
  assert.deepEqual(kept.map(each => each.hash), [createHash('sha256').update(token).digest('hex')]);
  for (const name of await readdir(join(layout.home, '.ohmmmm'))) assert.ok(!(await readFile(join(layout.home, '.ohmmmm', name), 'utf8')).includes(token), name);

  // The agent key opens the vault's and the cortex's tools, and nothing of the person's.
  assert.equal((await call('GET', '/', { headers: asAgent })).status, 200);
  assert.equal((await mcp('/vault/mcp', 'helper')).init.status, 200);
  assert.equal((await mcp('/cortex/mcp', 'helper')).init.status, 200);
  const json = { ...asAgent, 'Content-Type': 'application/json' };
  for (const [method, path, headers, body] of [
    ['GET', '/vault/files'], ['GET', '/vault/journal'], ['GET', '/vault/requests'], ['GET', `/media/b${'a'.repeat(58)}`],
    ['PUT', '/vault/file?path=notes/walk.md', { 'If-None-Match': '*' }, 'Mine.'],
    ['POST', '/vault/rename', json, '{"channel":"notes","to":"diary"}'],
    ['POST', '/vault/visibility', { ...json, 'If-Match': '"x"' }, '{"path":"notes/walk.md","to":"friends"}'],
    ['POST', '/vault/publish/plan', json, '{"path":"notes/walk.md"}'],
    ['POST', '/vault/publish', { ...json, 'If-Match': '"x"' }, '{"path":"notes/walk.md","confirm":"v"}'],
    ['POST', '/vault/unpublish', { ...json, 'If-Match': '"x"' }, '{"path":"notes/walk.md","to":"private"}'],
  ]) {
    const answer = await call(method, path, { headers: { ...asAgent, ...headers }, body });
    assert.equal(answer.status, 403, `${method} ${path}`);
    assert.match(answer.json.error, /agent key/);
  }
  assert.equal(await readFile(join(layout.vault, 'notes/walk.md'), 'utf8'), '---\ntitle: Slow walk\n---\n\nYanaka, lanterns, cats.\n');
  // The app's key opens everything, MCP included.
  assert.equal((await call('GET', '/vault/files', { headers: signed })).status, 200);
  assert.equal((await mcp('/cortex/mcp', 'app', token)).init.status, 200);

  // Another browser, paired while the bridge runs, is let in at once; new keys shut out every old one.
  const second = await pairApp(layout.home);
  assert.equal((await call('GET', '/vault/files', { headers: { Authorization: `Bearer ${second}` } })).status, 200);
  assert.equal((await call('GET', '/vault/files', { headers: signed })).status, 200, 'the first browser stays paired');
  const fresh = await pairApp(layout.home, { replace: true });
  const renewed = (await agentKey(layout.home, { replace: true })).key;
  for (const old of [token, second, agent]) assert.equal((await call('GET', '/', { headers: { Authorization: `Bearer ${old}` } })).status, 401);
  assert.equal((await call('GET', '/vault/files', { headers: { Authorization: `Bearer ${fresh}` } })).status, 200);
  assert.equal((await call('GET', '/', { headers: { Authorization: `Bearer ${renewed}` } })).status, 200);
});

test('a home whose bridge had one key for everyone gives that key to its agents, so the app pairs again', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'ohmmmm-serve-old-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const layout = await initHome(parent, 'mira.example.com');
  await mkdir(join(layout.home, '.ohmmmm'), { recursive: true });
  const old = 'QexdqYGJ2FZs7RkxcsaXaQMMXE0wJv3TqcHALTiddso';
  await writeFile(join(layout.home, OLD_TOKEN), `${old}\n`, { mode: 0o600 });
  assert.deepEqual(await agentKey(layout.home), { key: old, made: true, fromOldToken: true });
  await assert.rejects(stat(join(layout.home, OLD_TOKEN)), { code: 'ENOENT' });
  const server = await listenHome(homeBridge({ layout, DatabaseSync }), { port: 0 });
  t.after(() => new Promise(done => { server.closeAllConnections(); server.close(done); }));
  const port = server.address().port;
  const status = path => new Promise((done, fail) => {
    request({ host: '127.0.0.1', port, path, headers: { Host: `127.0.0.1:${port}`, Authorization: `Bearer ${old}` } }, res => { res.resume(); done(res.statusCode); }).on('error', fail).end();
  });
  assert.equal(await status('/'), 200, 'agents given the old key still reach their tools');
  assert.equal(await status('/vault/files'), 403, "but no longer the person's routes");
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
  // The link holds a key for this browser; the home keeps only its hash, and agents get their own.
  const key = decodeURIComponent(/&token=([^\s]+)/.exec(printed)?.[1] ?? '');
  assert.match(printed, /to this machine only/);
  assert.ok(printed.includes(`http://localhost:5190/#bridge=http%3A%2F%2F127.0.0.1%3A`), printed);
  assert.match(key, /^ohm_app_/);
  assert.deepEqual(JSON.parse(await readFile(join(layout.home, APP_KEYS), 'utf8')).keys.map(each => each.hash), [createHash('sha256').update(key).digest('hex')]);
  assert.ok(printed.includes(join(layout.home, AGENT_KEY)));
  assert.ok(!printed.includes((await readFile(join(layout.home, AGENT_KEY), 'utf8')).trim()), 'the agent key is named, not printed');

  // Another browser, while it runs: a new link, and the first key still kept.
  const paired = spawnSync(process.execPath, [cli, 'pair', '--port', '8766', '--app', 'http://localhost:5190'], { cwd: layout.vault, env: { ...process.env, OHMMMM_HOME: '' }, encoding: 'utf8' });
  assert.equal(paired.status, 0, paired.stderr);
  assert.match(paired.stdout, /http:\/\/localhost:5190\/#bridge=http%3A%2F%2F127\.0\.0\.1%3A8766&token=ohm_app_/);
  assert.equal(JSON.parse(await readFile(join(layout.home, APP_KEYS), 'utf8')).keys.length, 2);
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

test('the app reads the vault\'s recent changes with their versions, and renames as the person', async t => {
  const { layout, call, signed } = await setUp(t);
  const json = (method, path, value) => call(method, path, { headers: { ...signed, 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  await writeFile(join(layout.vault, 'notes/link.md'), '---\ntitle: Link\n---\n\nSee [[notes/walk]].\n');
  const first = await call('GET', '/vault/journal', { headers: signed });
  assert.equal(first.status, 200);
  // An edit made outside ohm, in a text editor: the next read finds it, journals it and keeps both versions.
  await writeFile(join(layout.vault, 'notes/walk.md'), '---\ntitle: Slow walk\n---\n\nYanaka, in the rain.\n');
  const { json: history } = await call('GET', '/vault/journal', { headers: signed });
  const changed = history.events.filter(event => event.path === 'notes/walk.md');
  assert.deepEqual(changed.map(event => [event.op, event.via]), [['added', 'scan'], ['changed', 'scan']]);
  assert.match(history.texts[changed[0].hash], /Yanaka, lanterns, cats\./);
  assert.match(history.texts[changed[1].hash], /Yanaka, in the rain\./);

  // A rename as the person: the block moves, and a link to it by its path elsewhere is rewritten.
  const moved = await json('POST', '/vault/rename', { block: 'notes/walk.md', home: 'essays' });
  assert.equal(moved.status, 200);
  assert.deepEqual([moved.json.kind, moved.json.from, moved.json.to], ['block', 'notes/walk.md', 'essays/walk.md']);
  assert.deepEqual(moved.json.files.map(file => file.path).sort(), ['essays/walk.md', 'notes/link.md']);
  assert.match(await readFile(join(layout.vault, 'notes/link.md'), 'utf8'), /\[\[essays\/walk\]\]/);
  const back = moved.json.files.find(file => file.path === 'notes/link.md');
  assert.equal(back.version, await blobCid(Buffer.from(back.text, 'utf8')));
  const { events } = await readEvents(layout.vault);
  assert.ok(events.some(event => event.op === 'moved' && event.path === 'essays/walk.md' && event.by === 'me' && event.via === 'rename'));

  // A channel: one folder rename, and it gets an ID.
  const channel = await json('POST', '/vault/rename', { channel: 'essays', to: 'writing' });
  assert.equal(channel.status, 200);
  assert.match(channel.json.id, /^[a-z2-7]{13}$/);
  assert.ok((await stat(join(layout.vault, 'writing/walk.md'))).isFile());
  // Refused, with the reason: a channel already there, and anything but a rename.
  const taken = await json('POST', '/vault/rename', { channel: 'writing', to: 'notes' });
  assert.equal(taken.status, 409);
  assert.match(taken.json.error, /already a channel/);
  assert.equal((await json('POST', '/vault/rename', { block: '../x.md', home: 'y' })).status, 400);
});

test('who sees a block is changed by the person, over the version read; an agent\'s request waits for them', async t => {
  const { layout, call, signed, mcp } = await setUp(t);
  const json = (method, path, value, headers = {}) => call(method, path, { headers: { ...signed, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
  const walk = await readFile(join(layout.vault, 'notes/walk.md'), 'utf8');
  const version = await blobCid(Buffer.from(walk, 'utf8'));
  assert.equal((await json('POST', '/vault/visibility', { path: 'notes/walk.md', to: 'friends' })).status, 428);
  assert.equal((await json('POST', '/vault/visibility', { path: 'notes/walk.md', to: 'friends' }, { 'If-Match': '"bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaa"' })).status, 412);
  const moved = await json('POST', '/vault/visibility', { path: 'notes/walk.md', to: 'friends', why: 'For June.' }, { 'If-Match': `"${version}"` });
  assert.equal(moved.status, 200);
  assert.deepEqual([moved.json.layer, moved.json.was], ['friends', 'private']);
  assert.equal(readNode('notes/walk.md', await readFile(join(layout.vault, 'notes/walk.md'), 'utf8')).node.visibility, 'friends');
  assert.equal((await json('POST', '/vault/visibility', { path: 'notes/walk.md', to: 'private', asked: 'someone else' }, { 'If-Match': `"${moved.json.version}"` })).status, 400, 'asked names an agent');
  const public_ = await json('POST', '/vault/visibility', { path: 'notes/walk.md', to: 'public' }, { 'If-Match': `"${moved.json.version}"` });
  assert.equal(public_.status, 409);
  assert.match(public_.json.error, /goes through Publish/);

  // An agent asks to take it back to only you; the person approves in the app.
  const vault = await mcp('/vault/mcp', 'claude-code');
  await vault.send('tools/call', { name: 'vault_index' });
  const asked = JSON.parse((await vault.send('tools/call', { name: 'vault_request_visibility', arguments: { ref: 'walk', to: 'private', why: 'It names a friend.' } })).json.result.content[0].text);
  const waiting = await call('GET', '/vault/requests', { headers: signed });
  assert.deepEqual(waiting.json.requests.map(each => [each.by, each.path, each.to, each.why]), [['agent:claude-code', 'notes/walk.md', 'private', 'It names a friend.']]);
  const approved = await json('POST', `/vault/requests/${asked.request}`, { approve: true });
  assert.equal(approved.json.request.status, 'approved');
  assert.equal(approved.json.file.layer, 'private');
  assert.equal(layerOf('notes/walk.md', await readFile(join(layout.vault, 'notes/walk.md'), 'utf8')), 'private');
  const { events } = await readEvents(layout.vault);
  assert.deepEqual(events.filter(event => event.via === 'visibility').map(event => [event.by, event.layer, event.was, event.asked, event.why]), [
    ['me', 'friends', 'private', undefined, 'For June.'],
    ['me', 'private', 'friends', 'agent:claude-code', 'It names a friend.'],
  ]);
  assert.deepEqual((await call('GET', '/vault/requests', { headers: signed })).json.requests, []);
  // A declined one changes nothing, and the agent sees how it went.
  const again = JSON.parse((await vault.send('tools/call', { name: 'vault_request_visibility', arguments: { ref: 'walk', to: 'friends' } })).json.result.content[0].text);
  assert.equal((await json('POST', `/vault/requests/${again.request}`, { approve: false })).json.request.status, 'declined');
  assert.equal(layerOf('notes/walk.md', await readFile(join(layout.vault, 'notes/walk.md'), 'utf8')), 'private');
  const mine = JSON.parse((await vault.send('tools/call', { name: 'vault_requests' })).json.result.content[0].text);
  assert.deepEqual(mine.requests.map(each => each.status), ['declined', 'approved']);
});
