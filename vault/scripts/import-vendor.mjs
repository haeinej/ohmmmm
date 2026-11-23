#!/usr/bin/env node
// Copies pinned upstream source into vendor/, byte for byte, and records each file's provenance
// and SHA-256 in vendor/IMPORTS.json. Reads with `git show <commit>:<path>` from a clone you give
// it, so the clone is never switched or modified. Vendored files are never edited: ohm's changes
// live in the deployable that imports them (for Cirrus, cirrus/src/index.ts).
//
//   node scripts/import-vendor.mjs --from <path to a clone of ascorbic/cirrus>   import
//   node scripts/import-vendor.mjs --check                                        verify the ledger
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ledgerPath = join(root, 'vendor/IMPORTS.json');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// The source of @getcirrus/pds 0.18.0, the version cirrus/package.json depends on. Tests, e2e
// suites and dev scripts are left out: they are not part of the package, and node --test would
// pick up scripts/test-*.js.
const SOURCES = [
  {
    repository: 'cirrus',
    remote: 'https://github.com/ascorbic/cirrus.git',
    tag: '@getcirrus/pds@0.18.0',
    commit: '0aec63160b12bd6a7340eeeee3144f249fed9f23',
    license: 'MIT',
    from: 'packages/pds',
    to: 'vendor/cirrus/packages/pds',
    paths: ['src', 'package.json', 'README.md', 'CHANGELOG.md', 'tsconfig.json', 'tsdown.config.ts'],
  },
];

export function check() {
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  const bad = ledger.files.filter(entry => {
    const at = join(root, entry.destination);
    return !existsSync(at) || sha256(readFileSync(at)) !== entry.sha256;
  });
  return { count: ledger.files.length, bad: bad.map(entry => entry.destination) };
}

function importFrom(clone) {
  const git = (...args) => execFileSync('git', ['-C', clone, ...args], { maxBuffer: 1 << 26 });
  const files = [];
  for (const source of SOURCES) {
    const tagged = git('rev-list', '-n1', source.tag).toString().trim();
    if (tagged !== source.commit) throw new Error(`${source.tag} is ${tagged}, expected ${source.commit}`);
    const listed = git('ls-tree', '-r', '--name-only', source.commit, '--', ...source.paths.map(p => `${source.from}/${p}`))
      .toString().split('\n').filter(Boolean).sort();
    for (const path of listed) {
      const bytes = git('show', `${source.commit}:${path}`);
      const destination = `${source.to}/${path.slice(source.from.length + 1)}`;
      mkdirSync(dirname(join(root, destination)), { recursive: true });
      writeFileSync(join(root, destination), bytes);
      files.push({ repository: source.repository, remote: source.remote, commit: source.commit, path, destination, sha256: sha256(bytes) });
    }
  }
  const ledger = {
    about: 'Files copied unchanged from pinned upstream commits by scripts/import-vendor.mjs. Never edit them; ohm overrides live in cirrus/src/index.ts.',
    sources: SOURCES.map(({ repository, remote, tag, commit, license, from, to, paths }) => ({
      repository, remote, tag, commit, license,
      licenseNote: 'No LICENSE file at this commit; MIT is declared in packages/pds/package.json and in the root README ("MIT. © Matt Kane (@ascorbic)").',
      copied: paths.map(p => `${from}/${p}`), destination: to,
    })),
    files,
  };
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(`${files.length} files imported`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--check')) {
    const { count, bad } = check();
    for (const path of bad) console.error(`changed or missing: ${path}`);
    if (bad.length) process.exit(1);
    console.log(`${count} vendored files match vendor/IMPORTS.json`);
  } else {
    const at = process.argv.indexOf('--from');
    if (at < 0 || !process.argv[at + 1]) { console.error('usage: import-vendor.mjs --from <clone> | --check'); process.exit(2); }
    importFrom(process.argv[at + 1]);
  }
}
