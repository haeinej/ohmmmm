import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { document, did, fakePds } from '../testing/fake-pds.mjs';

const example = fileURLToPath(new URL('../example/', import.meta.url));
test('example builds with Astro getCollection and render against a fake PDS', {
  skip: !existsSync(join(example, 'node_modules/astro/astro.js')) &&
    'Install the example dependencies with npm ci --prefix vault/astro/example',
}, async t => {
  const pds = await fakePds(t, () => ({ records: [document('one')] }));
  const output = await mkdtemp(join(tmpdir(), 'ohm-astro-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const child = spawn(process.execPath, ['node_modules/astro/astro.js', 'build', '--outDir', output], {
    cwd: example, env: { ...process.env, OHM_DID: did, OHM_PDS: pds.origin, ASTRO_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', data => { log += data; });
  child.stderr.on('data', data => { log += data; });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  assert.equal(code, 0, log);
  const index = await readFile(join(output, 'index.html'), 'utf8');
  const page = await readFile(join(output, 'posts/essays/one/index.html'), 'utf8');
  assert.match(index, /href="\/posts\/essays\/one"/);
  assert.match(page, /<strong>quiet<\/strong>/);
  assert.match(page, /site.standard.document/);
  assert.match(page, /alt="A green tree"/);
  assert.ok(pds.requests.length > 0);
});
