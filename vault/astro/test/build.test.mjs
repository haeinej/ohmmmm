import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { document, did, fakePds } from '../testing/fake-pds.mjs';

const example = fileURLToPath(new URL('../example/', import.meta.url));
const buildOptions = {
  skip: !existsSync(join(example, 'node_modules/astro/astro.js')) &&
    'Install the example dependencies with npm ci --prefix vault/astro/example',
};
async function build(t, records, env = {}) {
  const pds = await fakePds(t, () => ({ records }));
  const output = await mkdtemp(join(tmpdir(), 'ohm-astro-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const child = spawn(process.execPath, ['node_modules/astro/astro.js', 'build', '--outDir', output], {
    cwd: example, env: { ...process.env, OHM_DID: did, OHM_PDS: pds.origin,
      OHM_SERVICE: '', OHM_SITE: '', ASTRO_TELEMETRY_DISABLED: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', data => { log += data; });
  child.stderr.on('data', data => { log += data; });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  return { code, log, output, pds };
}

test('example builds with Astro getCollection and render against a fake PDS', buildOptions, async t => {
  const { code, log, output, pds } = await build(t, [document('one')]);
  assert.equal(code, 0, log);
  const index = await readFile(join(output, 'index.html'), 'utf8');
  const page = await readFile(join(output, 'posts/essays/one/index.html'), 'utf8');
  assert.match(index, /href="\/posts\/essays\/one"/);
  assert.match(page, /<strong>quiet<\/strong>/);
  assert.match(page, /site.standard.document/);
  assert.match(page, /alt="A green tree"/);
  assert.ok(pds.requests.length > 0);
});

test('example refuses conflicting post permalinks', buildOptions, async t => {
  const { code, log } = await build(t, [document('one'), document('two', { slug: 'one' })]);
  assert.notEqual(code, 0, log);
  assert.match(log, /Duplicate ohm permalink/);
});

test('example refuses routes that collide after Astro Unicode normalization', buildOptions, async t => {
  const { code, log } = await build(t, [
    document('one', { sublabel: 'J\u030c' }), document('two', { slug: 'one', sublabel: '\u01f0' }),
  ]);
  assert.notEqual(code, 0, log);
  assert.match(log, /Duplicate ohm permalink/);
});

test('Astro builds public from C2 and reads Friends only during live requests', buildOptions, async t => {
  const media = { name: 'sha256-' + 'a'.repeat(64), type: 'image/png' };
  const publicPost = {
    id: 'one', layer: 'public', channel: 'essays', channels: [], kind: 'post',
    slug: 'one', title: 'Public essay', body: 'This is **public**.', address: '/posts/essays/one',
    created: '2026-01-02T03:04:05Z',
  };
  const friendPost = {
    id: 'two', layer: 'friends', channel: 'essays', channels: [], kind: 'media', slug: 'two',
    title: 'Friends essay', media, body: `This is **for Friends**. ![Tree](media:${media.name})`,
  };
  const service = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const visible = request.headers.authorization === 'Bearer test-friend'
      ? [publicPost, friendPost] : [publicPost];
    if (url.pathname.endsWith('.getMedia') && visible.includes(friendPost) && url.searchParams.get('name') === media.name) {
      response.writeHead(200, { 'Content-Type': 'image/png' }).end('test media');
      return;
    }
    if (url.pathname.endsWith('.listBlocks')) {
      const blocks = visible.map(({ body, ...head }) => head);
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ owner: did, blocks }));
      return;
    }
    const block = visible.find(entry => entry.id === url.searchParams.get('id'));
    if (block) {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ owner: did, block }));
    } else {
      response.writeHead(404).end();
    }
  });
  service.listen(0, '127.0.0.1');
  await once(service, 'listening');
  t.after(() => new Promise(resolve => { service.close(resolve); service.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${service.address().port}`;
  const site = 'https://member.example.com';
  const { code, log, output, pds } = await build(t, [], { OHM_SERVICE: origin, OHM_SITE: site });
  assert.equal(code, 0, log);
  assert.equal(pds.requests.length, 0);
  const page = await readFile(join(output, 'posts/essays/one/index.html'), 'utf8');
  assert.match(page, /<strong>public<\/strong>/);
  assert.ok(page.includes(`href="${site}${publicPost.address}"`));
  assert.doesNotMatch(page, /Friends essay/);

  const env = { OHM_SERVICE: origin, OHM_DID: did, ASTRO_TELEMETRY_DISABLED: '1' };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const { dev } = await import(new URL('../example/node_modules/astro/dist/index.js', import.meta.url));
  const app = await dev({ root: join(example, 'friends'), server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
  t.after(() => app.stop());
  const url = `http://127.0.0.1:${app.address.port}`;
  const viewer = { headers: { Cookie: 'ohm_viewer=test-friend' } };
  const friendPage = await fetch(url, viewer);
  assert.equal(friendPage.status, 200);
  assert.equal(friendPage.headers.get('cache-control'), 'private, no-store');
  const html = await friendPage.text();
  assert.match(html, /<strong>for Friends<\/strong>/);
  assert.doesNotMatch(html, /Public essay|test-friend/);
  assert.doesNotMatch(await (await fetch(url)).text(), /Friends essay/);
  assert.match(await (await fetch(`${url}/?id=two`, viewer)).text(), /Friends essay/);
  const absent = await fetch(`${url}/?id=three`, viewer);
  assert.equal(absent.status, 404);
  assert.doesNotMatch(await absent.text(), /test-friend/);
  const asset = await fetch(`${url}/media/${media.name}`, viewer);
  assert.equal(asset.headers.get('cache-control'), 'private, no-store');
  assert.equal(await asset.text(), 'test media');
  assert.equal((await fetch(`${url}/media/${media.name}`)).status, 404);
});
