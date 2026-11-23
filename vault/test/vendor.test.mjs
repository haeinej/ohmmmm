import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { check } from '../scripts/import-vendor.mjs';

test('vendored Cirrus matches its pin, unchanged', () => {
  const { count, bad } = check();
  assert.ok(count > 0, 'vendor/IMPORTS.json lists files');
  assert.deepEqual(bad, []);
});

test('the deployable depends on the vendored version', () => {
  const ledger = JSON.parse(readFileSync(new URL('../vendor/IMPORTS.json', import.meta.url), 'utf8'));
  const pinned = JSON.parse(readFileSync(new URL('../vendor/cirrus/packages/pds/package.json', import.meta.url), 'utf8'));
  const deployable = JSON.parse(readFileSync(new URL('../cirrus/package.json', import.meta.url), 'utf8'));
  assert.equal(pinned.version, deployable.dependencies['@getcirrus/pds']);
  assert.equal(ledger.sources[0].tag, `@getcirrus/pds@${pinned.version}`);
});
