import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { initCortex } from '../src/folder.mjs';
import { cortexSessions, httpTransport, listen, makeToken } from '../src/http.mjs';

// Every person and agent here is invented. Servers bind only to 127.0.0.1, on a free port.
const template = fileURLToPath(new URL('../template', import.meta.url));
const cli = fileURLToPath(new URL('../bin/cortex.mjs', import.meta.url));
const fresh = async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'cortex-')), 'cortex');
  await initCortex(dir, template);
  return dir;
};

// A cortex served over real HTTP for the length of one test, and a client that speaks to it.
const served = async (t, { token, ...options } = {}) => {
  const dir = await fresh();
  const secret = token === false ? undefined : await makeToken(dir);
  const server = await listen(httpTransport({ open: cortexSessions(dir), token: secret, ...options }), { port: 0, host: '127.0.0.1' });
  t.after(() => new Promise(done => { server.closeAllConnections(); server.close(done); }));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  let next = 1;
  const post = async (message, { session, auth = secret, headers = {} } = {}) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
        ...(session ? { 'Mcp-Session-Id': session, 'MCP-Protocol-Version': '2025-06-18' } : {}),
        ...headers,
      },
      body: typeof message === 'string' ? message : JSON.stringify(message),
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : undefined, text };
  };
  const request = (method, params, options) => post({ jsonrpc: '2.0', id: next++, method, params }, options);
  const initialize = async (client = 'claude-code') => {
    const answer = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: client, version: '1.0.0' } });
    const session = answer.headers.get('mcp-session-id');
    if (session) await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { session });
    return { ...answer, session };
  };
  const call = async (session, name, args = {}) => {
    const answer = await request('tools/call', { name, arguments: args }, { session });
    return { ...answer, result: answer.body.result, value: answer.body.result && !answer.body.result.isError ? JSON.parse(answer.body.result.content[0].text) : undefined };
  };
  return { dir, url, secret, post, request, initialize, call };
};

test('over HTTP, initialize returns the short instructions and a session ID, as JSON', async t => {
  const { initialize } = await served(t);
  const answer = await initialize();
  assert.equal(answer.status, 200);
  assert.match(answer.headers.get('content-type'), /^application\/json/);
  assert.match(answer.session, /^[\x21-\x7e]{16,}$/);
  const { instructions, protocolVersion, capabilities } = answer.body.result;
  assert.equal(protocolVersion, '2025-06-18');
  assert.deepEqual(Object.keys(capabilities).sort(), ['prompts', 'resources', 'tools']);
  assert.ok(instructions.length <= 512, `${instructions.length} characters`);
  assert.match(instructions, /Call cortex_start before anything else/);
});

test('over HTTP, cortex_start returns the playbook', async t => {
  const { initialize, call, request } = await served(t);
  const { session } = await initialize();
  const start = await call(session, 'cortex_start');
  assert.equal(start.status, 200);
  assert.match(start.value.rules, /# How to keep this cortex/);
  const listed = await request('tools/list', {}, { session });
  assert.ok(listed.body.result.tools.some(tool => tool.name === 'cortex_start'));
});

test('a request without the token gets 401, and nothing about the cortex', async t => {
  const { post, request, url, secret } = await served(t);
  const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'claude-code' } } };
  for (const answer of [
    await post(initialize, { auth: null }),
    await post(initialize, { auth: `${secret}x` }),
    await post(initialize, { auth: null, headers: { Authorization: secret } }),
    await request('tools/list', {}, { auth: 'not-the-token', session: 'made-up' }),
  ]) {
    assert.equal(answer.status, 401);
    assert.equal(answer.headers.get('www-authenticate'), 'Bearer');
    assert.equal(answer.text, '');
  }
  // Not even which paths exist.
  const elsewhere = await fetch(url.replace('/mcp', '/anything'));
  assert.equal(elsewhere.status, 401);
  assert.equal(await elsewhere.text(), '');
});

test('a request with an unknown session ID is refused, and one with none is asked to initialize', async t => {
  const { initialize, request, call, post, url, secret } = await served(t);
  const unknown = await request('tools/list', {}, { session: 'no-such-session' });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.result, undefined);
  assert.match(unknown.body.error.message, /initialize again/);
  const none = await request('tools/list', {});
  assert.equal(none.status, 400);
  assert.match(none.body.error.message, /Send initialize first/);

  // A session that was ended is unknown too.
  const { session } = await initialize();
  assert.equal((await call(session, 'cortex_start')).status, 200);
  const ended = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${secret}`, 'Mcp-Session-Id': session } });
  assert.equal(ended.status, 204);
  assert.equal((await call(session, 'cortex_start')).status, 404);
  assert.equal((await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { session })).status, 404);
});

test('two sessions keep separate agent names', async t => {
  const { initialize, call } = await served(t);
  const first = await initialize('ada-desk');
  const second = await initialize('ben-laptop');
  assert.notEqual(first.session, second.session);
  assert.equal((await call(first.session, 'cortex_observe', { id: 'tides', text: 'Drafting the essay on tides.' })).result.isError, undefined);
  assert.equal((await call(second.session, 'cortex_observe', { id: 'reading', text: 'Sorts the reading list by month.' })).result.isError, undefined);
  const seen = (await call(second.session, 'cortex_start')).value.observations;
  assert.deepEqual(Object.fromEntries(seen.map(item => [item.id, item.by])), { tides: 'ada-desk', reading: 'ben-laptop' });
  // One session cannot rewrite what another agent wrote.
  const theirs = seen.find(item => item.id === 'tides');
  assert.equal((await call(second.session, 'cortex_observe', { id: 'tides', text: 'x', version: theirs.version })).result.isError, true);
  // A client cannot take the person's name.
  const posing = await initialize('member');
  await call(posing.session, 'cortex_observe', { id: 'posing', text: 'Posing as the person.' });
  assert.equal((await call(posing.session, 'cortex_recall', { id: 'posing' })).value.observation.by, 'agent:member');
});

test('notifications are accepted with 202, GET offers no stream, and bad messages are refused', async t => {
  const { initialize, post, request, url, secret } = await served(t);
  const { session } = await initialize();
  const accepted = await post({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 9 } }, { session });
  assert.equal(accepted.status, 202);
  assert.equal(accepted.text, '');
  const auth = { Authorization: `Bearer ${secret}` };
  assert.equal((await fetch(url, { headers: { ...auth, Accept: 'text/event-stream', 'Mcp-Session-Id': session } })).status, 405);
  assert.equal((await post('{not json', { session })).body.error.code, -32700);
  assert.equal((await post([{ jsonrpc: '2.0', id: 1, method: 'ping' }], { session })).status, 400);
  assert.equal((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { session, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await request('ping', {}, { session, headers: { 'MCP-Protocol-Version': '1999-01-01' } })).status, 400);
  assert.equal((await request('nothing/here', {}, { session })).body.error.code, -32601);
});

test('a browser page from another origin is refused, and this machine is not', async t => {
  const { initialize, post } = await served(t);
  const message = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'web' } } };
  assert.equal((await post(message, { headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await post(message, { headers: { Origin: 'http://localhost:3000' } })).status, 200);
  assert.equal((await initialize()).status, 200);
});

test('with no token, a cortex served on this machine needs no sign-in', async t => {
  const { initialize, call } = await served(t, { token: false });
  const { session } = await initialize();
  assert.match((await call(session, 'cortex_start')).value.rules, /# How to keep this cortex/);
});

test('cortex token writes a secret token once and prints it, and serve refuses another host without one', async () => {
  const dir = await fresh();
  const refused = spawnSync('node', [cli, 'serve', dir, '--host', '0.0.0.0', '--port', '0'], { encoding: 'utf8' });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /There is no token, so cortex serves only 127\.0\.0\.1/);

  const made = spawnSync('node', [cli, 'token', dir], { encoding: 'utf8' });
  assert.equal(made.status, 0);
  const printed = made.stdout.trim();
  assert.match(printed, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await readFile(join(dir, 'agents', 'secrets', 'mcp-token'), 'utf8')).trim(), printed);
  assert.equal((await stat(join(dir, 'agents', 'secrets', 'mcp-token'))).mode & 0o077, 0);
  assert.doesNotMatch(made.stderr, new RegExp(printed));

  const again = spawnSync('node', [cli, 'token', dir], { encoding: 'utf8' });
  assert.equal(again.status, 1);
  assert.doesNotMatch(again.stdout + again.stderr, new RegExp(printed));
  const replaced = spawnSync('node', [cli, 'token', dir, '--replace'], { encoding: 'utf8' });
  assert.equal(replaced.status, 0);
  assert.notEqual(replaced.stdout.trim(), printed);
});

test('cortex serve answers over HTTP, never prints the token, and asks for it', async t => {
  const dir = await fresh();
  const token = await makeToken(dir);
  const child = spawn('node', [cli, 'serve', dir, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  let output = '';
  const url = await new Promise((done, fail) => {
    child.stdout.on('data', chunk => {
      output += chunk;
      const found = output.match(/at (http:\/\/127\.0\.0\.1:\d+\/mcp)/);
      if (found) done(found[1]);
    });
    child.once('exit', code => fail(new Error(`cortex serve exited with ${code}`)));
  });
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'codex' } } });
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  assert.equal((await fetch(url, { method: 'POST', headers, body })).status, 401);
  const answer = await fetch(url, { method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` }, body });
  assert.equal(answer.status, 200);
  assert.ok(answer.headers.get('mcp-session-id'));
  assert.doesNotMatch(output, new RegExp(token));
});

test('cortex token --replace leaves a token file only the person can read, whatever the old one allowed', async () => {
  const dir = await fresh();
  const old = await makeToken(dir);
  const path = join(dir, 'agents', 'secrets', 'mcp-token');
  await chmod(path, 0o644);
  const replaced = await makeToken(dir, { replace: true });
  assert.notEqual(replaced, old);
  assert.equal((await readFile(path, 'utf8')).trim(), replaced);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual((await readdir(join(dir, 'agents', 'secrets'))).filter(name => name.endsWith('.tmp')), []);
});

test('a message over the size limit is answered 413, whether its length is given or not', async t => {
  const { initialize, url, secret } = await served(t);
  const { session } = await initialize();
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${secret}`, 'Mcp-Session-Id': session };
  const huge = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { padding: 'x'.repeat(5 * 1024 * 1024) } });
  const given = await fetch(url, { method: 'POST', headers, body: huge });
  assert.equal(given.status, 413);
  assert.match((await given.json()).error.message, /too large/);
  // Sent in pieces, with no Content-Length, so the server finds out only as it reads.
  const piece = new TextEncoder().encode('x'.repeat(1024 * 1024));
  let sent = 0;
  const body = new ReadableStream({ pull(controller) { if (sent++ < 6) controller.enqueue(piece); else controller.close(); } });
  const streamed = await fetch(url, { method: 'POST', headers, body, duplex: 'half' });
  assert.equal(streamed.status, 413);
  assert.match((await streamed.json()).error.message, /too large/);
});
