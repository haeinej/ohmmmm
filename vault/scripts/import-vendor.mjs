#!/usr/bin/env node
// Copies pinned upstream source into vendor/, byte for byte, and records each file's provenance
// and SHA-256 in vendor/IMPORTS.json. Reads with `git show <commit>:<path>` from a clone you give
// it, so the clone is never switched or modified. Vendored files are never edited: ohm's changes
// live in the deployable that imports them (for Cirrus, cirrus/src/index.ts).
//
//   node scripts/import-vendor.mjs --from <path to a clone of ascorbic/cirrus>   import
//   node scripts/import-vendor.mjs --check                                        verify
//
// To move to another version, change the tag, commit and npm integrity in SOURCES and the
// version in cirrus/package.json together, run `pnpm --dir cirrus install`, then import again.
// An import replaces the destination folder whole, so files from the old version do not linger.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = join(root, 'vendor');
const ledgerPath = join(vendor, 'IMPORTS.json');
// Files in vendor/ that are ohm's own, not imported.
const OWN = new Set(['IMPORTS.json', '.gitattributes']);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// The source of @getcirrus/pds 0.18.0, the version cirrus/package.json depends on. Tests, e2e
// suites and dev scripts are left out: they are not part of the package, and node --test would
// pick up scripts/test-*.js.
//
// `npm` ties the source to what is deployed: cirrus/ installs the published package, and its
// lockfile must name this exact tarball. The tarball's package.json and README match this commit.
export const SOURCES = [
  {
    repository: 'cirrus',
    remote: 'https://github.com/ascorbic/cirrus.git',
    tag: '@getcirrus/pds@0.18.0',
    commit: '0aec63160b12bd6a7340eeeee3144f249fed9f23',
    license: 'MIT',
    licenseNote: 'No LICENSE file at this commit; MIT is declared in packages/pds/package.json and in the root README ("MIT. © Matt Kane (@ascorbic)").',
    from: 'packages/pds',
    to: 'vendor/cirrus/packages/pds',
    paths: ['src', 'package.json', 'README.md', 'CHANGELOG.md', 'tsconfig.json', 'tsdown.config.ts'],
    npm: {
      name: '@getcirrus/pds',
      version: '0.18.0',
      integrity: 'sha512-JT11jVkRwjzxNKR3LwAytdjFJyIN11+Rv/YooAQK/NxuBOCzDPahFhxWh2lV0JsNFqCBG85fpSi/YXTENWliKw==',
      lockfile: 'cirrus/pnpm-lock.yaml',
    },
  },
];

const ledgerSource = ({ repository, remote, tag, commit, license, licenseNote, from, to, paths, npm }) => ({
  repository, remote, tag, commit, license, licenseNote,
  copied: paths.map(p => `${from}/${p}`), destination: to, npm,
});

function inVendor(destination) {
  const at = resolve(root, destination);
  if (!at.startsWith(vendor + sep)) throw new Error(`destination outside vendor/: ${destination}`);
  return at;
}

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter(entry => entry.isFile())
    .map(entry => relative(root, join(entry.parentPath ?? entry.path, entry.name)).split(sep).join('/'));
}

function lockedIntegrity(lockfile, name, version) {
  const text = readFileSync(join(root, lockfile), 'utf8');
  const key = `'${name}@${version}':`;
  const at = text.indexOf(`\n  ${key}`);
  if (at < 0) return null;
  const match = /resolution: \{integrity: ([^,}\s]+)/.exec(text.slice(at, at + 400));
  return match ? match[1] : null;
}

export function check() {
  const problems = [];
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  if (!isDeepStrictEqual(ledger.sources, SOURCES.map(ledgerSource))) problems.push('vendor/IMPORTS.json sources differ from SOURCES in scripts/import-vendor.mjs');

  const listed = new Set();
  for (const entry of ledger.files ?? []) {
    const source = SOURCES.find(s => s.repository === entry.repository);
    const prefix = source && `${source.from}/`;
    if (!source || entry.commit !== source.commit || entry.remote !== source.remote
      || !entry.path.startsWith(prefix)
      || !source.paths.some(p => entry.path === `${source.from}/${p}` || entry.path.startsWith(`${source.from}/${p}/`))
      || entry.destination !== `${source.to}/${entry.path.slice(prefix.length)}`) {
      problems.push(`ledger entry does not match its source: ${entry.destination}`);
      continue;
    }
    let at;
    try { at = inVendor(entry.destination); } catch (error) { problems.push(error.message); continue; }
    listed.add(entry.destination);
    if (!existsSync(at)) problems.push(`missing: ${entry.destination}`);
    else if (sha256(readFileSync(at)) !== entry.sha256) problems.push(`changed: ${entry.destination}`);
  }
  if (!listed.size) problems.push('vendor/IMPORTS.json lists no files');

  for (const file of filesUnder(vendor)) {
    if (OWN.has(relative('vendor', file))) continue;
    if (!listed.has(file)) problems.push(`not in the ledger: ${file}`);
  }

  for (const { npm } of SOURCES) {
    const locked = lockedIntegrity(npm.lockfile, npm.name, npm.version);
    if (locked !== npm.integrity) problems.push(`${npm.lockfile} does not lock ${npm.name}@${npm.version} to the pinned tarball (found ${locked})`);
  }
  return { count: listed.size, problems };
}

function importFrom(clone) {
  const git = (...args) => execFileSync('git', ['-C', clone, ...args], { maxBuffer: 1 << 26 });
  const files = [];
  for (const source of SOURCES) {
    const tagged = git('rev-list', '-n1', source.tag).toString().trim();
    if (tagged !== source.commit) throw new Error(`${source.tag} is ${tagged}, expected ${source.commit}`);
    rmSync(inVendor(source.to), { recursive: true, force: true });
    const paths = git('ls-tree', '-r', '--name-only', source.commit, '--', ...source.paths.map(p => `${source.from}/${p}`))
      .toString().split('\n').filter(Boolean).sort();
    for (const path of paths) {
      const bytes = git('show', `${source.commit}:${path}`);
      const destination = `${source.to}/${path.slice(source.from.length + 1)}`;
      const at = inVendor(destination);
      mkdirSync(dirname(at), { recursive: true });
      writeFileSync(at, bytes);
      files.push({ repository: source.repository, remote: source.remote, commit: source.commit, path, destination, sha256: sha256(bytes) });
    }
  }
  const ledger = {
    about: 'Files copied unchanged from pinned upstream commits by scripts/import-vendor.mjs. Never edit them; ohm overrides live in cirrus/src/index.ts. cirrus/ deploys the published npm tarball named under npm, which matches this source.',
    sources: SOURCES.map(ledgerSource),
    files,
  };
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(`${files.length} files imported`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--check')) {
    const { count, problems } = check();
    for (const problem of problems) console.error(problem);
    if (problems.length) process.exit(1);
    console.log(`${count} vendored files match vendor/IMPORTS.json, and the deployable locks the same release`);
  } else {
    const at = process.argv.indexOf('--from');
    if (at < 0 || !process.argv[at + 1]) { console.error('usage: import-vendor.mjs --from <clone> | --check'); process.exit(2); }
    importFrom(process.argv[at + 1]);
  }
}
