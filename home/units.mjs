// Every unit in a home, read from its folder (docs/plans/units.md). The shape and the rules are in
// ../contract/unit.mjs; this only walks the home's parts and hands their files over. It reads; it never
// writes a file, the vault's index or the cortex's journal.
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import { artifactKind, feed, levelOf, unitsOf } from '../contract/unit.mjs';

// A site can be a large checkout. Past this many artifacts the rest are left out, not read.
export const MAX_SITE_FILES = 5000;

// The files under `dir`, as paths inside it. Folders starting with "." (the vault's .vault/, the
// cortex's .cortex/, the site's .git/ and .ohm/) are never units.
async function walk(dir, keep = () => true, limit = Infinity) {
  const found = [];
  const visit = async at => {
    let entries;
    try { entries = await readdir(at, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (found.length >= limit) return;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = join(at, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) {
        const path = relative(dir, full).split(sep).join('/');
        if (keep(path)) found.push(path);
      }
    }
  };
  await visit(dir);
  return found;
}

async function filesOf(dir, paths, withText = () => true) {
  return Promise.all(paths.map(async path => {
    const full = join(dir, path);
    const { mtimeMs } = await stat(full);
    return { path, mtime: mtimeMs, ...(withText(path) ? { text: await readFile(full, 'utf8') } : {}) };
  }));
}

async function part(dir, keep, withText, limit) {
  const paths = await walk(dir, keep, limit);
  return { folder: basename(dir), files: await filesOf(dir, paths, withText) };
}

/** Every unit in the home `layout` (home/home.mjs's layoutOf), each with its path from the top of the home. */
export async function readUnits(layout) {
  const markdown = path => path.endsWith('.md');
  const [collections, profile, agents, site] = await Promise.all([
    part(layout.vault, markdown),
    part(layout.profile, path => path === 'profile.md'),
    part(layout.cortex, markdown),
    part(layout.site, path => artifactKind(path) !== null, path => artifactKind(path) === 'page', MAX_SITE_FILES),
  ]);
  return unitsOf({ collections, profile, agents, site });
}

/** The home's feed for an audience: see feed() in ../contract/unit.mjs. */
export async function readFeed(layout, options) {
  return feed(await readUnits(layout), options);
}

/** One folder of the home, for a tree that opens a level at a time: see levelOf() in ../contract/unit.mjs. */
export async function readLevel(layout, folder = '') {
  return levelOf(await readUnits(layout), folder);
}
