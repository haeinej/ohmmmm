import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { check, SOURCES } from '../scripts/import-vendor.mjs';

const at = path => new URL(`../${path}`, import.meta.url);

test('vendored Cirrus matches its pin, unchanged, with nothing extra', () => {
  const { count, problems } = check();
  assert.ok(count > 0, 'vendor/IMPORTS.json lists files');
  assert.deepEqual(problems, []);
});

test('the check refuses a stray file, an edited file and a changed pin', () => {
  const stray = at('vendor/cirrus/packages/pds/src/stray.ts');
  const ledgerPath = at('vendor/IMPORTS.json');
  const ledgerText = readFileSync(ledgerPath, 'utf8');
  const edited = at(JSON.parse(ledgerText).files[0].destination);
  const original = readFileSync(edited);
  try {
    writeFileSync(stray, 'export {};\n');
    writeFileSync(edited, Buffer.concat([original, Buffer.from('\n')]));
    const ledger = JSON.parse(ledgerText);
    ledger.sources[0].commit = '0'.repeat(40);
    writeFileSync(ledgerPath, JSON.stringify(ledger));
    const { problems } = check();
    assert.ok(problems.some(p => p.startsWith('not in the ledger') && p.endsWith('stray.ts')), problems.join('\n'));
    assert.ok(problems.some(p => p.startsWith('changed:')), problems.join('\n'));
    assert.ok(problems.some(p => p.includes('sources differ')), problems.join('\n'));
  } finally {
    rmSync(stray, { force: true });
    writeFileSync(edited, original);
    writeFileSync(ledgerPath, ledgerText);
  }
});

test('the deployable depends on and locks the vendored release', () => {
  const pinned = JSON.parse(readFileSync(at('vendor/cirrus/packages/pds/package.json'), 'utf8'));
  const deployable = JSON.parse(readFileSync(at('cirrus/package.json'), 'utf8'));
  const [cirrus] = SOURCES;
  assert.equal(pinned.version, deployable.dependencies['@getcirrus/pds']);
  assert.equal(cirrus.npm.version, pinned.version);
  assert.equal(cirrus.tag, `@getcirrus/pds@${pinned.version}`);
  assert.match(readFileSync(at('cirrus/src/index.ts'), 'utf8'), /from "@getcirrus\/pds"/);
});
