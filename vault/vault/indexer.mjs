// The vault's index: `.vault/index.sqlite`, built from the folder and its read-only roots, and
// rebuilt from them whenever it is missing, out of date or deleted. Nothing else writes to it, and
// nothing in it is the only copy of anything: the files are the vault.
//
// What it holds that the files do not: for every file, its size, times, a stat stamp and a content
// address; for read-only roots, which files were copied into `.vault/cache`; and, derived from the
// files, every node, every evidence edge and a word index for search.
//
// A file is read again only when its stat stamp (inode, size, modified and changed times) moves, so
// an unchanged vault scans in the time it takes to list it. A file in a root that keeps only a
// reference is never opened at all, because opening a Google Drive file that is kept online
// downloads it.
import { copyFile, lstat, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { blobCid, FILE_TYPES, kindOf as mediaKind } from './core.mjs';
import { slugOf } from './file.mjs';
import { formerNames, nameKey, renamesBetween } from './names.mjs';
import { evidence, nodeKey, originKind, readVault, SOURCES } from './node.mjs';
import { appendEvents, downloadedFrom, HISTORY, POST_OPS, readEvents } from './journal.mjs';
import { CANONICAL, CONFIG, readConfig } from './roots.mjs';
import { words } from './words.mjs';

export { words } from './words.mjs';

export const INDEX = '.vault/index.sqlite';
export const CACHE = '.vault/cache';
// Raise this when the tables or stored file content change.
export const INDEX_VERSION = '3';

// Endings whose files are text: their words are searchable when a root keeps text.
export const TEXT_ENDINGS = new Set(['md', 'txt', 'csv', 'tsv', 'json', 'yaml', 'yml', 'toml', 'xml', 'html', 'css', 'sql', 'py', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'sh', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'r', 'ipynb']);
// Of those, the ones that are code: a file of code in a root becomes a block of kind code.
export const CODE_ENDINGS = new Set(['sql', 'py', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'sh', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'r', 'ipynb']);
export const ending = path => (/\.([A-Za-z0-9]{1,8})$/.exec(path)?.[1] ?? '').toLowerCase();
const skipped = name => name.startsWith('.') || name === 'node_modules';

const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE files (
  root TEXT NOT NULL, path TEXT NOT NULL, abs TEXT NOT NULL,
  stamp TEXT NOT NULL, ino TEXT NOT NULL, size INTEGER NOT NULL, mtime TEXT NOT NULL,
  hash TEXT, text TEXT, cached INTEGER NOT NULL DEFAULT 0, seen TEXT NOT NULL,
  PRIMARY KEY (root, path));
CREATE TABLE nodes (
  key TEXT PRIMARY KEY, type TEXT NOT NULL, kind TEXT, root TEXT NOT NULL, path TEXT NOT NULL, file TEXT,
  slug TEXT, title TEXT, home TEXT, origin TEXT, origin_kind TEXT, node TEXT NOT NULL);
CREATE INDEX nodes_slug ON nodes (slug);
CREATE INDEX nodes_path ON nodes (path);
CREATE TABLE edges (kind TEXT NOT NULL, src TEXT NOT NULL, dst TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX edges_src ON edges (src);
CREATE INDEX edges_dst ON edges (dst);
CREATE TABLE terms (term TEXT NOT NULL, key TEXT NOT NULL, weight INTEGER NOT NULL, PRIMARY KEY (term, key));
CREATE TABLE problems (root TEXT NOT NULL, path TEXT NOT NULL, problem TEXT NOT NULL);
CREATE TABLE events (
  seq INTEGER PRIMARY KEY, at TEXT NOT NULL, op TEXT NOT NULL, root TEXT NOT NULL, path TEXT NOT NULL, from_path TEXT,
  origin TEXT, by TEXT NOT NULL, via TEXT NOT NULL, session TEXT, hash TEXT);
CREATE INDEX events_path ON events (root, path);
`;

// The index, opened, and made again from nothing when it is of another version or cannot be read.
//   DatabaseSync: node:sqlite's class, passed in so this module loads where SQLite is not on yet
export async function openIndex(vault, { DatabaseSync }) {
  await mkdir(join(vault, '.vault'), { recursive: true });
  const file = join(vault, INDEX);
  const fresh = () => {
    const db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode = WAL;');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);
    const version = tables.includes('meta') ? db.prepare("SELECT value FROM meta WHERE key = 'version'").get()?.value : undefined;
    if (version !== INDEX_VERSION) {
      for (const name of tables) db.exec(`DROP TABLE IF EXISTS "${name.replaceAll('"', '""')}"`);
      db.exec(SCHEMA);
      db.prepare("INSERT INTO meta (key, value) VALUES ('version', ?)").run(INDEX_VERSION);
    }
    return db;
  };
  try {
    return fresh();
  } catch {
    // A damaged index is put aside, never mended: everything in it comes from the files.
    await rename(file, `${file}.damaged-${Date.now()}`).catch(() => {});
    return fresh();
  }
}

// ---- Scanning ----

export async function walk(root, takes) {
  const found = [];
  const visit = async relative => {
    let entries;
    try {
      entries = await readdir(join(root, relative), { withFileTypes: true });
    } catch (problem) {
      if (!relative) throw problem;
      return;
    }
    for (const entry of entries) {
      if (skipped(entry.name)) continue;
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      // Links are not followed: a link out of a root would take in a folder nobody named.
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && takes(path)) found.push(path);
    }
  };
  await visit('');
  return found.sort();
}

export const stampOf = info => `${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;

// Bring the index into line with the vault folder and its roots, and say what changed.
//   vault: the vault's absolute path; db: from openIndex; home: for "~" in the configuration
export async function scan({ vault, db, home = homedir(), now = new Date() }) {
  const report = { at: now.toISOString(), roots: [], added: [], changed: [], removed: [], moved: [], renamed: [], recognised: [], journaled: 0, unchanged: 0, opened: 0, cached: 0, problems: [] };
  const lastScan = db.prepare("SELECT value FROM meta WHERE key = 'scanned'").get()?.value ?? '';
  let config;
  try {
    config = JSON.parse(await readFile(join(vault, CONFIG), 'utf8'));
  } catch (problem) {
    if (problem.code !== 'ENOENT') report.problems.push({ root: CANONICAL, path: CONFIG, problems: [`${CONFIG} is not JSON: ${problem.message}`] });
  }
  const { roots, problems: configProblems } = readConfig(config, { vault, home });
  if (configProblems.length) report.problems.push({ root: CANONICAL, path: CONFIG, problems: configProblems });
  const places = [
    { name: CANONICAL, path: vault, retain: 'full', channel: '', takes: path => !path.startsWith('.vault/') },
    ...roots,
  ];
  const held = new Map(db.prepare('SELECT * FROM files').all().map(row => [`${row.root}\u0000${row.path}`, row]));
  const upsert = db.prepare(`INSERT INTO files (root, path, abs, stamp, ino, size, mtime, hash, text, cached, seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (root, path) DO UPDATE SET abs = excluded.abs, stamp = excluded.stamp, ino = excluded.ino, size = excluded.size,
      mtime = excluded.mtime, hash = excluded.hash, text = excluded.text, cached = excluded.cached, seen = excluded.seen`);
  const drop = db.prepare('DELETE FROM files WHERE root = ? AND path = ?');
  const live = new Set(places.map(place => place.name));
  const gone = [], fresh = [];

  db.exec('BEGIN');
  try {
    // A root that is no longer configured is forgotten.
    for (const row of held.values()) if (!live.has(row.root)) { drop.run(row.root, row.path); held.delete(`${row.root}\u0000${row.path}`); }
    for (const place of places) {
      const summary = { name: place.name, path: place.path, files: 0, available: true };
      report.roots.push(summary);
      let paths;
      try {
        paths = await walk(place.path, place.takes);
      } catch (problem) {
        // A root that cannot be reached, such as Google Drive while it is not running, keeps what
        // the index already knew about it. Its files are not taken for removed.
        summary.available = false;
        report.problems.push({ root: place.name, path: place.path, problems: [`The folder cannot be read (${problem.code ?? problem.message}). What the index knew about it is kept.`] });
        continue;
      }
      summary.files = paths.length;
      const here = new Set(paths);
      for (const path of paths) {
        const abs = join(place.path, path);
        const info = await stat(abs).catch(() => null);
        if (!info?.isFile()) continue;
        const key = `${place.name}\u0000${path}`;
        const before = held.get(key);
        const stamp = stampOf(info);
        if (before && before.stamp === stamp) { report.unchanged++; continue; }
        const textual = TEXT_ENDINGS.has(ending(path));
        const open = place.retain !== 'reference' || (place.name === CANONICAL);
        let hash = null, content = null, cached = 0;
        if (open) {
          const bytes = await readFile(abs);
          report.opened++;
          hash = await blobCid(bytes);
          const ownNode = ending(path) === 'md' || (path.startsWith(`${SOURCES}/`) && path.endsWith('/source.json'));
          if (textual && (place.name !== CANONICAL || ownNode)) content = bytes.toString('utf8');
          if (place.retain === 'full' && place.name !== CANONICAL) {
            const target = join(vault, CACHE, hash);
            if (!(await lstat(target).catch(() => null))) {
              await mkdir(join(vault, CACHE), { recursive: true });
              await copyFile(abs, `${target}.writing`);
              await rename(`${target}.writing`, target);
              report.cached++;
            }
            cached = 1;
          }
        }
        upsert.run(place.name, path, abs, stamp, String(info.ino), info.size, new Date(info.mtimeMs).toISOString(), hash, content, cached, report.at);
        const row = { root: place.name, path, ino: String(info.ino), size: info.size, hash };
        (before ? report.changed : fresh).push(before ? { root: place.name, path } : row);
      }
      for (const row of [...held.values()].filter(row => row.root === place.name && !here.has(row.path))) {
        drop.run(row.root, row.path);
        gone.push(row);
      }
    }
    // A file that went from one path and appeared at another, the same file or the same bytes, moved.
    // So did one a tool said it moved since the last scan (a rename that also rewrote it), whatever
    // its bytes are now.
    const toldMoves = await movesSince(vault, lastScan);
    for (const row of fresh) {
      const said = toldMoves.get(`${row.root}\u0000${row.path}`);
      const twin = gone.findIndex(old => old.root === row.root && (old.path === said || (row.hash && old.hash === row.hash) || (old.ino === row.ino && old.size === row.size)));
      if (twin >= 0) report.moved.push({ root: row.root, from: gone.splice(twin, 1)[0].path, to: row.path });
      else report.added.push({ root: row.root, path: row.path });
    }
    report.removed.push(...gone.map(row => ({ root: row.root, path: row.path })));
    // The nodes as they were, to see what this scan finds renamed (names.mjs).
    const before = db.prepare('SELECT key, node FROM nodes').all().map(row => ({ key: row.key, node: JSON.parse(row.node) }));
    await journal(vault, db, report, lastScan);
    await rebuild(db, roots, report, { folder: vault, before });
    db.prepare("INSERT INTO meta (key, value) VALUES ('scanned', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(report.at);
    db.exec('COMMIT');
  } catch (problem) {
    db.exec('ROLLBACK');
    throw problem;
  }
  return report;
}

// Each version of the vault's own Markdown the scan finds, kept in .vault/history/ by its content
// address, as the tools keep theirs: so a change made outside ohm (in Obsidian, in a text editor) can
// be shown and restored too. Only text that hashes to the event's address is kept.
async function keepVersions(vault, db, events) {
  const text = db.prepare('SELECT text FROM files WHERE root = ? AND path = ?');
  for (const event of events) {
    if (event.root !== CANONICAL || !['added', 'changed'].includes(event.op) || !event.hash || !event.path.endsWith('.md')) continue;
    const held = text.get(event.root, event.path)?.text;
    if (typeof held !== 'string' || await blobCid(Buffer.from(held, 'utf8')) !== event.hash) continue;
    await mkdir(join(vault, HISTORY), { recursive: true });
    await writeFile(join(vault, HISTORY, event.hash), held, { flag: 'wx' }).catch(problem => { if (problem.code !== 'EEXIST') throw problem; });
  }
}

// The moves a tool journaled since the last scan, by where each file is now: root + path → from.
async function movesSince(vault, lastScan) {
  const { events } = await readEvents(vault);
  return new Map(events.filter(event => event.op === 'moved' && event.via !== 'scan' && event.at > lastScan)
    .map(event => [`${event.root}\u0000${event.path}`, event.from]));
}

// Write what this scan found to the journal, then load the whole journal into the index.
// Who did something is taken from what an agent's hook, ohm vault add or the editor said about that
// file since the last scan; otherwise it is unknown. A file new to the vault folder is checked for
// where it came from: the same bytes as a file the index already knows, or the address macOS kept
// when it was downloaded. Nothing is guessed.
async function journal(vault, db, report, lastScan) {
  const { events: before, unreadable } = await readEvents(vault);
  if (unreadable) report.problems.push({ root: CANONICAL, path: '.vault/journal.jsonl', problems: [`${unreadable} line(s) of the journal cannot be read and are skipped. The rest is used.`] });
  const told = new Map();
  for (const event of before) if (event.at > lastScan && event.via !== 'scan' && !POST_OPS.includes(event.op)) told.set(`${event.root}\u0000${event.path}`, event);
  const row = db.prepare('SELECT abs, hash FROM files WHERE root = ? AND path = ?');
  const twins = db.prepare("SELECT root, path, abs FROM files WHERE hash = ? AND NOT (root = ? AND path = ?) ORDER BY root = 'vault', root, path LIMIT 1");
  const at = report.at;
  const events = [];
  const said = (root, path) => told.get(`${root}\u0000${path}`);
  for (const { root, path } of report.added) {
    const file = row.get(root, path);
    const known = said(root, path);
    if (known?.op !== 'added') events.push({ at, op: 'added', root, path, by: known?.by ?? 'unknown', via: 'scan', ...(known?.session ? { session: known.session } : {}), ...(file?.hash ? { hash: file.hash } : {}) });
    if (root !== CANONICAL || known?.origin) continue;
    const twin = file?.hash ? twins.get(file.hash, root, path) : null;
    if (twin) {
      events.push({ at, op: 'copied-from', root, path, origin: twin.abs, by: known?.by ?? 'unknown', via: 'scan', hash: file.hash });
      report.recognised.push({ path, copiedFrom: twin.abs });
    }
    if (!path.endsWith('.md')) {
      const [address] = await downloadedFrom(file.abs);
      if (address) {
        events.push({ at, op: 'downloaded-from', root, path, origin: address, by: known?.by ?? 'unknown', via: 'scan' });
        report.recognised.push({ path, downloadedFrom: address });
      }
    }
  }
  // A tool that changed or removed a file journaled it already, with the versions it kept.
  const recorded = (known, op, hash) => known?.op === op && ['write', 'link', 'restore', 'rename', 'editor', 'visibility', 'publish'].includes(known.via) && (op === 'removed' || known.hash === hash);
  // A move a tool journaled already is not journaled again.
  const toldMove = new Set(before.filter(event => event.op === 'moved' && event.via !== 'scan' && event.at > lastScan)
    .map(event => `${event.root}\u0000${event.from}\u0000${event.path}`));
  for (const { root, path } of report.changed) {
    const known = said(root, path);
    if (recorded(known, 'changed', row.get(root, path)?.hash)) continue;
    events.push({ at, op: 'changed', root, path, by: known?.by ?? 'unknown', via: 'scan', ...(known?.session ? { session: known.session } : {}), ...(row.get(root, path)?.hash ? { hash: row.get(root, path).hash } : {}) });
  }
  for (const { root, from, to } of report.moved) {
    if (!toldMove.has(`${root}\u0000${from}\u0000${to}`)) events.push({ at, op: 'moved', root, path: to, from, by: said(root, to)?.by ?? 'unknown', via: 'scan' });
  }
  for (const { root, path } of report.removed) {
    if (!recorded(said(root, path), 'removed')) events.push({ at, op: 'removed', root, path, by: said(root, path)?.by ?? 'unknown', via: 'scan' });
  }
  await keepVersions(vault, db, events);
  await appendEvents(vault, events);
  report.journaled = events.length;
  db.exec('DELETE FROM events');
  const insert = db.prepare('INSERT INTO events (at, op, root, path, from_path, origin, by, via, session, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const event of [...before, ...events]) {
    insert.run(event.at, event.op, event.root, event.path, event.from ?? null, event.origin ?? null, event.by, event.via, event.session ?? null, event.hash ?? null);
  }
}

// A file in a read-only root as a block: in the root's channel, under the folders it sits in there,
// with `origin` saying where it is. A Markdown file whose text is kept is read as the block it is.
export function rootBlocks(root, rows) {
  const files = [], nodes = [], where = new Map();
  for (const row of rows) {
    const folders = row.path.split('/').slice(0, -1);
    const home = [root.channel, ...folders.map(folder => folder.replace(/^[._]+/, ''))].filter(Boolean).join('/');
    const name = row.path.split('/').at(-1);
    if (ending(name) === 'md' && row.text !== null) {
      const path = `${home}/${name}`;
      files.push({ path, text: row.text });
      where.set(path, row);
      continue;
    }
    const end = ending(name);
    const mime = FILE_TYPES[`.${end}`];
    const kind = CODE_ENDINGS.has(end) ? 'code' : mime && mediaKind(mime) !== 'file' ? 'media' : 'file';
    const base = slugOf(name.replace(/\.[^.]+$/, '')) || 'file';
    const node = {
      type: 'block', kind, kindGiven: true, path: `${home}/${name}`, home, slug: end && end !== 'md' ? `${base}-${end}` : base,
      title: name, channels: [], origin: row.abs, body: '', properties: {}, problems: [],
    };
    nodes.push(node);
    where.set(node.path, row);
  }
  return { files, nodes, where };
}

// The events the journal holds, as names.mjs reads them.
const journalEvents = db => db.prepare('SELECT op, root, path, from_path FROM events ORDER BY seq').all()
  .map(row => ({ op: row.op, root: row.root, path: row.path, from: row.from_path ?? undefined }));

async function rebuild(db, roots, report, { folder, before = [] }) {
  for (const table of ['nodes', 'edges', 'terms', 'problems']) db.exec(`DELETE FROM ${table}`);
  const rows = db.prepare('SELECT * FROM files').all();
  const own = rows.filter(row => row.root === CANONICAL);
  const files = own.filter(row => row.text !== null).map(row => ({ path: row.path, text: row.text }));
  const nodes = [];
  const where = new Map(own.map(row => [row.path, row]));
  for (const root of roots) {
    const made = rootBlocks(root, rows.filter(row => row.root === root.name));
    files.push(...made.files);
    nodes.push(...made.nodes);
    for (const [path, row] of made.where) where.set(path, row);
  }
  // Old names keep working: they come from the journal, and what this scan finds renamed is written
  // there first (renamed), so the index stays something the files and the journal can make again.
  let vault = readVault(files, { nodes, former: formerNames(journalEvents(db)) });
  // A rename a tool journaled already (vault_rename) is not journaled again.
  const said = new Set(journalEvents(db).filter(event => event.op === 'renamed').map(event => `${event.path}\u0000${event.from}`));
  const renamed = renamesBetween(before, vault, { moved: report.moved, at: report.at }).filter(event => !said.has(`${event.path}\u0000${event.from}`));
  report.renamed = renamed.map(({ path, from }) => ({ from, to: path }));
  if (renamed.length) {
    await appendEvents(folder, renamed);
    const insert = db.prepare('INSERT INTO events (at, op, root, path, from_path, origin, by, via, session, hash) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL)');
    for (const event of renamed) insert.run(event.at, event.op, event.root, event.path, event.from, event.by, event.via);
    report.journaled += renamed.length;
    vault = readVault(files, { nodes, former: formerNames(journalEvents(db)) });
  }
  // A block read from a root's Markdown says where it came from, like any other block of a root.
  for (const block of vault.blocks) {
    const row = where.get(block.path);
    if (row && row.root !== CANONICAL && !block.origin) block.origin = row.abs;
  }
  const insertNode = db.prepare('INSERT OR REPLACE INTO nodes (key, type, kind, root, path, file, slug, title, home, origin, origin_kind, node) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insertTerm = db.prepare('INSERT INTO terms (term, key, weight) VALUES (?, ?, ?) ON CONFLICT (term, key) DO UPDATE SET weight = weight + excluded.weight');
  const all = [...vault.blocks, ...vault.channels, ...vault.entities, ...vault.sources];
  for (const node of all) {
    const key = nodeKey(node);
    const row = where.get(node.path) ?? (node.type === 'channel' ? where.get(`${node.path}/_channel.md`) : undefined);
    const title = node.title ?? node.name ?? (node.type === 'channel' ? node.path.split('/').at(-1) : undefined);
    insertNode.run(key, node.type, node.kind ?? null, row?.root ?? CANONICAL, node.path, row ? row.path : null, node.slug ?? null, title ?? null,
      node.home ?? null, node.origin ?? null, node.origin ? originKind(node.origin) : null, JSON.stringify(node));
    const weights = new Map();
    const count = (text, weight) => { for (const word of words(text)) weights.set(word, (weights.get(word) ?? 0) + weight); };
    count([title, node.slug, ...(node.aliases ?? []), ...(node.tags ?? [])].filter(Boolean).join(' '), 2);
    count(node.body ?? node.description ?? '', 1);
    // A root's file of text is searchable by what it says, though it is not the block's body.
    if (row && row.root !== CANONICAL && row.text !== null && ending(row.path) !== 'md') count(row.text, 1);
    for (const [term, weight] of weights) insertTerm.run(term, key, weight);
  }
  const insertEdge = db.prepare('INSERT INTO edges (kind, src, dst, at) VALUES (?, ?, ?, ?)');
  const pathOf = new Map(all.map(node => [nodeKey(node), node.path]));
  const slugOfKey = new Map(vault.blocks.map(block => [nodeKey(block), block.slug]));
  for (const edge of evidence(vault)) {
    insertEdge.run(edge.kind, edge.from, edge.to, String(edge.at));
    // A link written with an old name still counts; it is listed to tidy.
    if (edge.former) {
      const path = pathOf.get(edge.from);
      const where = /^\d+$/.test(String(edge.at)) ? `on line ${edge.at}` : `in ${edge.at}`;
      const problem = `[[${edge.former}]] ${where} is "${slugOfKey.get(edge.to)}" now. It still links there; write [[${slugOfKey.get(edge.to)}]] to tidy it`;
      const held = vault.problems.find(each => each.path === path);
      if (held) held.problems.push(problem); else vault.problems.push({ path, problems: [problem] });
    }
  }
  const insertProblem = db.prepare('INSERT INTO problems (root, path, problem) VALUES (?, ?, ?)');
  for (const { path, problems } of vault.problems) {
    const row = where.get(path);
    for (const problem of problems) insertProblem.run(row?.root ?? CANONICAL, row?.path ?? path, problem);
  }
  for (const { root, path, problems } of report.problems) for (const problem of problems) insertProblem.run(root, path, problem);
  report.nodes = all.length;
  report.edges = db.prepare('SELECT COUNT(*) AS n FROM edges').get().n;
  report.problems = db.prepare('SELECT root, path, problem FROM problems ORDER BY root, path').all()
    .reduce((out, row) => {
      const held = out.find(each => each.root === row.root && each.path === row.path);
      if (held) held.problems.push(row.problem); else out.push({ root: row.root, path: row.path, problems: [row.problem] });
      return out;
    }, []);
}

// ---- Reading the index ----

// SQLite hands back rows with no prototype; callers get ordinary objects.
const plain = row => ({ ...row });

// One node with everything known about it: the node, its file's size, times and content address,
// and the edges into and out of it. `ref` is a node key, a slug, or a path in the vault, or a name
// it had before (`formerly` then says which).
export function inspect(db, ref) {
  let formerly;
  const byFormer = () => {
    const former = formerNames(journalEvents(db));
    const channel = former.channels.get(ref);
    const file = former.blocks.get(nameKey(ref)) ?? former.blocks.get(slugOf(nameKey(ref)));
    const found = (channel !== undefined && db.prepare("SELECT * FROM nodes WHERE type = 'channel' AND path = ?").get(channel))
      || (file && db.prepare("SELECT * FROM nodes WHERE root = 'vault' AND file = ?").get(file));
    if (found) formerly = ref;
    return found || undefined;
  };
  const row = db.prepare('SELECT * FROM nodes WHERE key = ?').get(ref)
    ?? db.prepare("SELECT * FROM nodes WHERE slug = ? ORDER BY type = 'block' DESC LIMIT 1").get(ref)
    ?? db.prepare('SELECT * FROM nodes WHERE path = ? OR file = ? LIMIT 1').get(ref, ref)
    ?? byFormer();
  if (!row) return null;
  const file = row.file ? db.prepare('SELECT root, path, abs, size, mtime, hash, cached, seen FROM files WHERE root = ? AND path = ?').get(row.root, row.file) : null;
  return {
    key: row.key, node: JSON.parse(row.node), root: row.root,
    ...(row.origin ? { origin: { where: row.origin, kind: row.origin_kind } } : {}),
    ...(file ? { file: { ...plain(file), size: Number(file.size), cached: Boolean(file.cached) } } : {}),
    out: db.prepare('SELECT kind, dst AS node, at FROM edges WHERE src = ? ORDER BY kind, dst').all(row.key).map(plain),
    in: db.prepare('SELECT kind, src AS node, at FROM edges WHERE dst = ? ORDER BY kind, src').all(row.key).map(plain),
    ...(row.file ? { history: history(db, row.root, row.file) } : {}),
    ...(formerly ? { formerly } : {}),
  };
}

// What the journal says happened to a file, oldest first, following it back through its moves.
export function history(db, root, path) {
  const paths = [path];
  const moved = db.prepare("SELECT from_path FROM events WHERE root = ? AND path = ? AND op = 'moved' ORDER BY seq DESC LIMIT 1");
  for (let at = paths[0]; ;) {
    const earlier = moved.get(root, at)?.from_path;
    if (!earlier || paths.includes(earlier)) break;
    paths.push(earlier);
    at = earlier;
  }
  const marks = paths.map(() => '?').join(', ');
  return db.prepare(`SELECT at, op, path, from_path, origin, by, via, session FROM events WHERE root = ? AND path IN (${marks}) ORDER BY seq`).all(root, ...paths)
    .map(event => Object.fromEntries(Object.entries({ ...event, from: event.from_path, from_path: undefined }).filter(([, value]) => value !== null && value !== undefined)));
}

// Nodes ranked by how many of the words they hold, then by weight: a word in a title, slug, alias or
// tag counts two, a word in the text one.
export function search(db, query, { limit = 20 } = {}) {
  const terms = [...new Set(words(query))];
  if (!terms.length) return [];
  const marks = terms.map(() => '?').join(', ');
  return db.prepare(`SELECT n.key, n.type, n.kind, n.title, n.slug, n.path, n.root, COUNT(*) AS matched, SUM(t.weight) AS weight
    FROM terms t JOIN nodes n ON n.key = t.key WHERE t.term IN (${marks})
    GROUP BY n.key ORDER BY matched DESC, weight DESC, n.path LIMIT ?`).all(...terms, limit)
    .map(row => ({ ...plain(row), matched: Number(row.matched), weight: Number(row.weight) }));
}

// How big the index is, by table, and when it last scanned.
export function summary(db) {
  const count = table => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
  return {
    version: INDEX_VERSION, scanned: db.prepare("SELECT value FROM meta WHERE key = 'scanned'").get()?.value ?? null,
    files: count('files'), nodes: count('nodes'), edges: count('edges'), problems: count('problems'),
    byRoot: db.prepare('SELECT root, COUNT(*) AS files, SUM(size) AS bytes FROM files GROUP BY root ORDER BY root').all()
      .map(row => ({ root: row.root, files: Number(row.files), bytes: Number(row.bytes) })),
  };
}
