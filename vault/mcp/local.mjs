// Tools for a vault folder the person chose when launching the local stdio process.
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { addToVault } from '../vault/add.mjs';
import { blobCid, VaultProblem } from '../vault/core.mjs';
import { allowed, GRANTS, readGrants } from '../vault/grants.mjs';
import { lint } from '../vault/lint.mjs';
import { setProperty } from '../vault/file.mjs';
import { CACHE, INDEX, inspect, openIndex, scan, search, summary } from '../vault/indexer.mjs';
import { appendEvents, HISTORY, JOURNAL, keepVersion, readEvents } from '../vault/journal.mjs';
import { applyRename, planRename, readVaultFolder } from '../vault/rename.mjs';
import { layerOf, LAYERS, readRequests, requestVisibility, THROUGH_PUBLISH } from '../vault/visibility-folder.mjs';
import { CHANNEL_FILE, EDGE_KINDS, isChannelPath, nodeFile, readNode, SOURCES } from '../vault/node.mjs';

// Every version an agent replaced or wrote, by content address, so any agent change can be undone.
export { HISTORY };
const CID = /^b[a-z2-7]{20,}$/;
import { CANONICAL, CONFIG, readConfig } from '../vault/roots.mjs';
import { createServer, serve } from './protocol.mjs';

const text = { type: 'string' };
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const tool = (name, description, properties, required = [], readOnlyHint = false) => ({
  name, description, inputSchema: { type: 'object', properties, required },
  ...(readOnlyHint ? { annotations: { readOnlyHint: true } } : {}),
});

export const LOCAL_TOOLS = [
  tool('vault_local_search', 'Search the local vault index by words.', { query: text, limit: integer(1, 50) }, ['query'], true),
  tool('vault_local_read', 'Read a local vault node with file stats and journal history.', { ref: text }, ['ref'], true),
  tool('vault_neighbors', 'Follow evidence from a local vault node. Filter by direction and kind, up to five steps away.', {
    ref: text, direction: { enum: ['in', 'out', 'both'] }, kind: { enum: EDGE_KINDS }, depth: integer(1, 5),
  }, ['ref'], true),
  tool('vault_capture', 'Bring a block into a channel from an HTTP(S) address or a file from a configured root, if the person granted you write on that channel. An address is kept as a reference. The block is marked as yours and starts private.', {
    source: text, channel: text, title: text,
  }, ['source', 'channel']),
  tool('vault_collect', 'File a local block in a channel, or move it to a zero-based position in the channel’s explicit order.', {
    block: text, channel: text, position: { type: 'integer', minimum: 0 },
  }, ['block', 'channel']),
  tool('vault_index', 'Scan the local vault and its configured roots. Returns what changed and any problems.', {}),
  tool('vault_where', 'Where the person\'s knowledge and data live: the vault\'s channels, each configured root (its folder, channel, what it keeps, how many files, and the person\'s note on how to use it), and what you may change. Read it before looking for data or changing anything.', {}, [], true),
  tool('vault_lint', 'Candidates for a semantic check of the vault: reported problems, links to nothing, orphan blocks, related blocks with no link between them, and blocks with the same title. You judge them: read, then record conclusions with cortex_observe and fix only within your grant.', {
    limit: integer(1, 100),
  }, [], true),
  tool('vault_history', 'What happened to one vault file, newest first, with the content address of each version kept in history. Use it to find a version to restore.', { path: text, limit: integer(1, 100) }, ['path'], true),
  tool('vault_write', 'Make or replace a block, channel or entity file, if the person granted you write on its folder. To replace a file, pass its current content address (file.hash from vault_local_read) as replaces. The old version is kept and can be restored. A new block is marked as yours and starts private.', {
    path: text, text, replaces: text,
  }, ['path', 'text']),
  tool('vault_remove', 'Remove a block, channel or entity file, if the person granted you write on its folder. Pass its current content address as replaces. The removed version is kept and can be restored.', {
    path: text, replaces: text,
  }, ['path', 'replaces']),
  tool('vault_link', 'Link a block to another block or entity, by adding [[its slug]] to the end of the block, if the person granted you link or write on the block\'s folder. A note says why. Nothing is added if the link is already there.', {
    from: text, to: text, note: text,
  }, ['from', 'to']),
  tool('vault_restore', 'Put a vault file back to a version kept in history (an address from vault_history), if the person granted you write on its folder. Pass the file\'s current content address as replaces when it exists.', {
    path: text, to: text, replaces: text,
  }, ['path', 'to']),
  tool('vault_request_visibility', 'Ask the person to change who can see a block: to private (only them) or friends. You never change it yourself; the request waits until they approve or decline it in the app. Public goes through Publish. Say why in one line.', {
    ref: text, to: { enum: LAYERS }, why: text,
  }, ['ref', 'to']),
  tool('vault_requests', 'Your requests to change who can see a block, newest first: waiting, approved or declined.', { limit: integer(1, 100) }, [], true),
  tool('vault_rename', 'Rename or move a block or a channel, if the person granted you write where it is and where it goes. Every file that used the old name is rewritten to the new one where you may write it; any other keeps working through the old name, and is listed in left. For a channel, give it as ref and its new path as to. For a block, give it as ref and any of: its new slug as to, a title, or a new home channel.', {
    ref: text, to: text, title: text, channel: text,
  }, ['ref']),
];
const WRITING = ['vault_collect', 'vault_write', 'vault_remove', 'vault_link', 'vault_restore', 'vault_rename', 'vault_request_visibility'];

const refuse = message => { throw new VaultProblem(message); };
const present = value => typeof value === 'string' && value.trim() && !value.includes('\0');
const info = path => lstat(path).catch(problem => { if (problem.code !== 'ENOENT') throw problem; });

// Resolve vault files without following symlinks in the path, including the index and journal.
async function beneath(root, parts) {
  let path = root;
  for (const [index, part] of parts.entries()) {
    if (!part || part === '.' || part === '..' || part.includes('/') || part.includes('\\')) refuse('Give a path inside the vault or a configured root.');
    path = join(path, part);
    const item = await info(path);
    if (item && (item.isSymbolicLink() || (index < parts.length - 1 && !item.isDirectory()))) {
      refuse('Choose a path with ordinary folders and files, without symlinks.');
    }
  }
  return path;
}

async function ordinaryFile(root, parts) {
  const path = await beneath(root, parts);
  const item = await info(path);
  if (item && !item.isFile()) refuse('Choose an ordinary file.');
  return path;
}

async function captureSource(vault, source) {
  if (!present(source)) refuse('Give an HTTP(S) address or the absolute path of a file in a configured root.');
  if (URL.canParse(source)) {
    const url = new URL(source);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href;
  }
  if (!isAbsolute(source)) refuse('Give an HTTP(S) address or the absolute path of a file in a configured root.');
  const configPath = await ordinaryFile(vault, CONFIG.split('/'));
  const config = await readFile(configPath, 'utf8').catch(problem => { if (problem.code !== 'ENOENT') throw problem; });
  const { roots } = readConfig(config && JSON.parse(config), { vault, home: homedir() });
  for (const root of roots) {
    const path = relative(root.path, source);
    const parts = path.split(sep);
    if (!path || isAbsolute(path) || parts.some(part => part.startsWith('.') || part === 'node_modules')
      || root.retain === 'reference' || !root.takes(parts.join('/'))) continue;
    const file = await ordinaryFile(await realpath(root.path), parts);
    if ((await info(file))?.isFile()) return file;
  }
  refuse('Choose a file that a configured root keeps as text or full.');
}

const lookedUp = (db, ref) => {
  if (!present(ref) || ref.length > 1000) refuse('Give a node key, slug, or a path in the vault.');
  return inspect(db, ref) ?? refuse('No indexed node matches. Run vault_index if the vault has changed.');
};

function neighbors(db, { ref, direction = 'both', kind, depth = 1 }) {
  if (!['in', 'out', 'both'].includes(direction) || (kind !== undefined && !EDGE_KINDS.includes(kind))
    || !Number.isInteger(depth) || depth < 1 || depth > 5) refuse('Use in, out, or both, an evidence kind, and a depth from 1 to 5.');
  const node = lookedUp(db, ref).key;
  const seen = new Set([node]);
  const edges = new Map();
  let frontier = [node];
  for (let step = 0; step < depth && frontier.length; step++) {
    const next = [];
    for (const key of frontier) {
      const found = inspect(db, key);
      if (!found) continue;
      for (const way of direction === 'both' ? ['out', 'in'] : [direction]) {
        for (const edge of found[way]) {
          if (kind !== undefined && edge.kind !== kind) continue;
          const [from, to] = way === 'out' ? [key, edge.node] : [edge.node, key];
          const value = { from, to, kind: edge.kind, at: edge.at };
          const id = JSON.stringify(value);
          if (!edges.has(id) && edges.size === 200) return { node, edges: [...edges.values()], truncated: true };
          edges.set(id, value);
          if (!seen.has(edge.node)) { seen.add(edge.node); next.push(edge.node); }
        }
      }
    }
    frontier = next;
  }
  return { node, edges: [...edges.values()] };
}

async function replaceFile(path, before, after) {
  if (after === undefined) {
    if (await readFile(path, 'utf8') !== before) refuse('The file changed while removing it. Try again.');
    await unlink(path);
    return;
  }
  const temp = join(dirname(path), `.collect-${randomUUID()}`);
  if (before === undefined) {
    await writeFile(path, after, { flag: 'wx' });
    return;
  }
  try {
    await writeFile(temp, after, { flag: 'wx', mode: (await lstat(path)).mode & 0o777 });
    if (await readFile(path, 'utf8') !== before) refuse('The file changed while collecting. Try again.');
    await rename(temp, path);
  } finally {
    await unlink(temp).catch(problem => { if (problem.code !== 'ENOENT') throw problem; });
  }
}

// SQLite releases this lock even if a local MCP process exits during collection.
export async function withCollectLock(vault, DatabaseSync, collect) {
  const path = await ordinaryFile(vault, ['.vault', 'collect.sqlite']);
  const lock = new DatabaseSync(path);
  try {
    try {
      lock.exec('BEGIN IMMEDIATE');
    } catch (problem) {
      if (problem.errcode === 5) refuse('Another collection is running in this vault. Try again.');
      throw problem;
    }
    return await collect();
  } finally {
    lock.close();
  }
}

const addressOf = text => blobCid(Buffer.from(text, 'utf8'));
const READABLE = /^[^/]+(?:\/[^/]+)*\.md$/;

export function createLocalTools({ vault, by, DatabaseSync }) {
  const agent = by.startsWith('agent:') ? by.slice('agent:'.length) : by;
  const rescan = db => scan({ vault, db });
  // A version kept once, by its address. Two writes of the same text keep one file.
  const keep = text => keepVersion(vault, text, { file: address => ordinaryFile(vault, [...HISTORY.split('/'), address]) });
  const recordChange = async (path, before, after, via = 'collect') => {
    if (before === after) return;
    const kept = via === 'collect' ? {} : {
      ...(before === undefined ? {} : { before: await keep(before) }),
      ...(after === undefined ? {} : { hash: await keep(after) }),
    };
    await replaceFile(join(vault, path), before, after);
    const op = before === undefined ? 'added' : after === undefined ? 'removed' : 'changed';
    await appendEvents(vault, [{ at: new Date().toISOString(), op, root: CANONICAL, path, by, via, ...kept }]);
  };
  const grants = async () => {
    const held = await readFile(await ordinaryFile(vault, GRANTS.split('/')), 'utf8').catch(problem => { if (problem.code !== 'ENOENT') throw problem; });
    let value;
    try { value = held === undefined ? undefined : JSON.parse(held); } catch { refuse(`${GRANTS} is not JSON. The person fixes it.`); }
    return readGrants(value);
  };
  const mayChange = async (right, path) => {
    const scope = allowed(await grants(), agent, right, path);
    if (!scope) {
      const folder = path.includes('/') ? path.split('/').slice(0, -1).join('/') : '*';
      refuse(`You have no ${right} grant on ${path}. Ask the person; they can run: ohm vault grant ${agent} ${right} ${folder}`);
    }
    return scope;
  };
  // A file an agent may write: Markdown, inside the vault, not machinery and not a captured source.
  const writable = path => {
    if (typeof path !== 'string' || path.length > 1000 || !READABLE.test(path)) refuse('Give the path of a Markdown file inside the vault, such as notes/idea.md.');
    const parts = path.split('/');
    if (parts.some(part => part.startsWith('.') || part === '..') || parts[0] === SOURCES) refuse('Agents write blocks, channels and entities; not hidden files, .vault/ or captured sources.');
    return parts;
  };
  const current = async parts => {
    const file = await ordinaryFile(vault, parts);
    return readFile(file, 'utf8').catch(problem => { if (problem.code !== 'ENOENT') throw problem; });
  };
  const checkReplaces = async (before, replaces) => {
    if (before === undefined) {
      if (replaces !== undefined) refuse('There is no file there to replace. Leave replaces out to make it.');
      return;
    }
    if (typeof replaces !== 'string') refuse('This file exists. Pass its current content address (file.hash from vault_local_read) as replaces.');
    if (replaces !== await addressOf(before)) refuse('The file has changed since you read it. Read it again with vault_local_read and retry.');
  };
  const readable = (path, text) => {
    const read = readNode(path, text);
    if (!read) refuse('That path is not a block, channel or entity.');
    if (read.problems.length) refuse(`Fix the file first: ${read.problems.join(' ')}`);
    return read.node;
  };
  // Who can see a block is the person's to change: an agent asks with vault_request_visibility.
  const sameLayer = (path, before, after) => {
    const was = before === undefined ? 'private' : layerOf(path, before) ?? 'private';
    const now = layerOf(path, after) ?? 'private';
    if (was !== now) refuse(`This would make the block ${now} where it is ${was}. Who can see a block is the person's to change: ask with vault_request_visibility.`);
  };
  const calls = {
    vault_local_search: (db, { query, limit = 20 }) => {
      if (!present(query) || query.length > 1000 || !Number.isInteger(limit) || limit < 1 || limit > 50) refuse('Give up to 1,000 characters of search text and a limit from 1 to 50.');
      return { nodes: search(db, query, { limit }) };
    },
    vault_local_read: (db, { ref }) => lookedUp(db, ref),
    vault_neighbors: neighbors,
    vault_index: rescan,
    vault_lint: (db, { limit = 30 }) => {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) refuse('Give a limit from 1 to 100.');
      return lint(db, { limit });
    },

    async vault_where(db) {
      const configPath = await ordinaryFile(vault, CONFIG.split('/'));
      const config = await readFile(configPath, 'utf8').catch(problem => { if (problem.code !== 'ENOENT') throw problem; });
      const { roots, problems } = readConfig(config && JSON.parse(config), { vault, home: homedir() });
      const counts = Object.fromEntries(summary(db).byRoot.map(row => [row.root, row]));
      const kinds = root => Object.fromEntries(db.prepare("SELECT COALESCE(kind, type) AS kind, COUNT(*) AS n FROM nodes WHERE root = ? GROUP BY 1 ORDER BY 2 DESC").all(root).map(row => [row.kind, Number(row.n)]));
      const channels = db.prepare("SELECT home AS channel, COUNT(*) AS n FROM nodes WHERE type = 'block' AND root = ? GROUP BY home ORDER BY n DESC LIMIT 50").all(CANONICAL)
        .map(row => ({ channel: row.channel || '(top)', blocks: Number(row.n) }));
      const { agents, problems: grantProblems } = await grants();
      return {
        vault: { root: CANONICAL, files: counts[CANONICAL]?.files ?? 0, kinds: kinds(CANONICAL), channels, writable: true },
        roots: roots.map(root => ({
          name: root.name, channel: root.channel, where: root.drive ? 'drive' : 'local', path: root.path, retain: root.retain,
          include: root.include, exclude: root.exclude, files: counts[root.name]?.files ?? 0, kinds: kinds(root.name),
          note: root.note ?? null, writable: false,
        })),
        you: { agent, grant: agents[agent] ?? {}, always: ['vault_collect'] },
        problems: [...problems, ...grantProblems],
        read: 'Roots are read where they live and never written: search and read them, and capture a copy to change one. A root without a note is one to ask the person about, then record what they say with cortex_observe about its channel.',
      };
    },

    async vault_history(db, { path, limit = 30 }) {
      writable(path);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) refuse('Give a limit from 1 to 100.');
      const { events } = await readEvents(vault);
      const mine = events.filter(event => event.root === CANONICAL && (event.path === path || event.from === path)).reverse().slice(0, limit);
      const kept = async address => Boolean(address && (await info(join(vault, HISTORY, address)))?.isFile());
      return {
        path,
        events: await Promise.all(mine.map(async event => ({ ...event, ...(event.before ? { beforeKept: await kept(event.before) } : {}), ...(event.hash ? { hashKept: await kept(event.hash) } : {}) }))),
      };
    },

    async vault_write(db, { path, text: content, replaces }) {
      const parts = writable(path);
      if (typeof content !== 'string' || !content.trim() || Buffer.byteLength(content) > 600_000) refuse('Give the file\'s text, at most 600 KB.');
      await mayChange('write', path);
      const before = await current(parts);
      const node = readable(path, content);
      // A new block from an agent says so and starts private: only the person shows a block to more people.
      const asNew = () => {
        let made = content;
        if (node.type !== 'block') return made;
        if (!node.post && !node.by) made = setProperty(made, 'by', by);
        if ((node.post?.visibility ?? node.visibility) !== 'private') made = setProperty(made, 'visibility', 'private');
        return made;
      };
      // The file says this already, as when the same write is tried again after its answer was lost.
      if (before !== undefined && (before === content || before === asNew())) {
        const hash = await addressOf(before);
        return { path, made: false, unchanged: true, hash, before: hash };
      }
      await checkReplaces(before, replaces);
      const after = before === undefined ? asNew() : content;
      readable(path, after);
      sameLayer(path, before, after);
      await mkdir(dirname(join(vault, path)), { recursive: true });
      await recordChange(path, before, after, 'write');
      await rescan(db);
      return { path, made: before === undefined, unchanged: before === after, hash: await addressOf(after), ...(before === undefined ? {} : { before: await addressOf(before) }) };
    },

    async vault_remove(db, { path, replaces }) {
      const parts = writable(path);
      await mayChange('write', path);
      const before = await current(parts);
      if (before === undefined) refuse('There is no file there.');
      await checkReplaces(before, replaces);
      await recordChange(path, before, undefined, 'write');
      await rescan(db);
      return { path, removed: true, before: await addressOf(before), restore: 'vault_restore with this path and before as to' };
    },

    async vault_link(db, { from, to, note }) {
      if (note !== undefined && (!present(note) || note.length > 500 || note.includes('\n'))) refuse('A note is one line of at most 500 characters.');
      const source = lookedUp(db, from);
      if (source.root !== CANONICAL || source.node.type !== 'block') refuse('Link from a block in the vault. Capture a copy first if it is in a read-only root.');
      const target = lookedUp(db, to);
      if (!['block', 'entity'].includes(target.node.type) || !target.node.slug) refuse('Link to a block or an entity with a slug.');
      if (target.key === source.key) refuse('A block does not link to itself.');
      const path = source.node.path;
      await mayChange('link', path);
      const before = await current(path.split('/'));
      if (before === undefined || readNode(path, before)?.node?.id !== source.node.id) refuse('The block changed. Run vault_index and try again.');
      const link = `[[${target.node.slug}]]`;
      if (before.includes(link)) return { from: source.key, to: target.key, unchanged: true };
      const line = `- ${link}${note ? ` ${note.trim()}` : ''}`;
      const trimmed = before.replace(/\s+$/, '');
      const after = `${trimmed}${/\n- \[\[[^\n]*$/.test(trimmed) ? '\n' : '\n\n'}${line}\n`;
      readable(path, after);
      await recordChange(path, before, after, 'link');
      await rescan(db);
      return { from: source.key, to: target.key, path, line, hash: await addressOf(after) };
    },

    async vault_restore(db, { path, to, replaces }) {
      const parts = writable(path);
      if (typeof to !== 'string' || !CID.test(to)) refuse('Give a content address from vault_history as to.');
      await mayChange('write', path);
      const kept = await readFile(await ordinaryFile(vault, [...HISTORY.split('/'), to]), 'utf8').catch(problem => { if (problem.code !== 'ENOENT') throw problem; });
      if (kept === undefined) refuse('That version is not kept in history.');
      readable(path, kept);
      const before = await current(parts);
      await checkReplaces(before, replaces);
      sameLayer(path, before, kept);
      await mkdir(dirname(join(vault, path)), { recursive: true });
      await recordChange(path, before, kept, 'restore');
      await rescan(db);
      return { path, restored: to, unchanged: before === kept };
    },

    async vault_request_visibility(db, { ref, to, why }) {
      const found = lookedUp(db, ref);
      if (found.root !== CANONICAL || found.node.type !== 'block') refuse('Ask about a block in the vault.');
      if (!LAYERS.includes(to)) refuse(`to is one of: ${LAYERS.join(', ')}.`);
      const path = found.node.path;
      const text = await current(path.split('/'));
      if (text === undefined) refuse('The block is not there any more. Run vault_index.');
      const from = layerOf(path, text) ?? 'private';
      if (from === to) return { path, visibility: to, unchanged: true };
      if (to === 'public' || from === 'public') refuse(THROUGH_PUBLISH);
      const request = await requestVisibility(vault, { by, path, from, to, why });
      return { request: request.id, path, from, to, status: request.status, next: 'The person approves or declines it in the app. Check with vault_requests.' };
    },

    async vault_requests(db, { limit = 30 }) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) refuse('Give a limit from 1 to 100.');
      return { requests: (await readRequests(vault)).filter(each => each.by === by).reverse().slice(0, limit) };
    },

    async vault_rename(db, { ref, to, title, channel }) {
      for (const [name, value] of Object.entries({ to, title, channel })) {
        if (value !== undefined && (!present(value) || value.length > 300 || value.includes('\n'))) refuse(`Give ${name} as one line of text.`);
      }
      const found = lookedUp(db, ref);
      if (found.root !== CANONICAL) refuse('Rename what is in the vault. A read-only root is renamed where it lives.');
      let change;
      if (found.node.type === 'channel') {
        if (to === undefined || title !== undefined || channel !== undefined) refuse('For a channel, give only its new path as to.');
        change = { channel: found.node.path, to };
      } else if (found.node.type === 'block') {
        change = { block: found.node.path, ...(to === undefined ? {} : { slug: to }), ...(title === undefined ? {} : { title }), ...(channel === undefined ? {} : { channel }) };
      } else refuse('Rename a block or a channel.');
      const { files, paths } = await readVaultFolder(vault, { open: path => ordinaryFile(vault, path.split('/')) });
      const plan = planRename(files, change, { paths });
      // No symlink anywhere a file is moved or written.
      if (plan.folder) await beneath(vault, plan.folder.from.split('/'));
      for (const path of [...plan.moves.flatMap(move => [move.from, move.to]), ...plan.writes.map(write => write.path)]) {
        if (path.split('/').some(part => part.startsWith('.'))) refuse('A rename does not touch hidden files.');
        await ordinaryFile(vault, path.split('/'));
      }
      const held = await grants();
      const may = path => Boolean(allowed(held, agent, 'write', path));
      if (!may(plan.from) || !may(plan.to)) await mayChange('write', may(plan.from) ? plan.to : plan.from);
      const done = await applyRename({ vault, plan, by, may, keep });
      await rescan(db);
      return done;
    },

    async vault_capture(db, { source, channel, title }) {
      if (typeof channel !== 'string' || !isChannelPath(channel)) refuse('Give the path of the channel it goes into.');
      if (title !== undefined && !present(title)) refuse('Give a title as text.');
      await mayChange('write', `${channel}/${CHANNEL_FILE}`);
      await beneath(vault, channel.split('/'));
      await beneath(vault, [SOURCES]);
      const added = await addToVault({ vault, source: await captureSource(vault, source), channel, title, by });
      await rescan(db);
      return { ...added, node: lookedUp(db, added.block).key };
    },

    async vault_collect(db, { block, channel, position }) {
      if (!isChannelPath(channel) || (position !== undefined && (!Number.isSafeInteger(position) || position < 0))) {
        refuse('Give the channel’s path and, optionally, a zero-based position in its order.');
      }
      const prior = lookedUp(db, block);
      if (prior.root !== CANONICAL || prior.node.type !== 'block') refuse('Choose a block in the canonical vault. Capture a copy first if it is in a read-only root.');
      const channelPath = `${channel}/${CHANNEL_FILE}`;
      const target = await ordinaryFile(vault, channelPath.split('/'));
      const blockPath = prior.node.path;
      const source = await ordinaryFile(vault, blockPath.split('/'));
      const before = await readFile(source, 'utf8');
      const node = readNode(blockPath, before)?.node;
      if (node?.type !== 'block' || node.slug !== prior.node.slug || node.id !== prior.node.id) refuse('The block changed. Run vault_index and try again.');
      const held = await readFile(target, 'utf8').catch(problem => { if (problem.code !== 'ENOENT') throw problem; });
      const parsed = held === undefined ? null : readNode(channelPath, held);
      if (held !== undefined && (parsed?.node?.type !== 'channel' || parsed.problems.length)) refuse('Fix the channel file before collecting blocks in it.');
      const previousOrder = parsed?.node.order ?? [];
      const order = previousOrder.filter(slug => slug !== node.slug);
      const oldPosition = previousOrder.indexOf(node.slug);
      order.splice(position ?? (oldPosition === -1 ? order.length : oldPosition), 0, node.slug);
      const needsMembership = node.home !== channel && !node.channels.includes(channel);
      const nextBlock = needsMembership ? setProperty(before, 'channels', [...node.channels, channel]) : before;
      const nextChannel = held === undefined ? nodeFile({ type: 'channel', path: channel, order }).text
        : JSON.stringify(order) === JSON.stringify(previousOrder) ? held : setProperty(held, 'order', order);
      await mkdir(dirname(target), { recursive: true });
      await recordChange(blockPath, before, nextBlock);
      await recordChange(channelPath, held, nextChannel);
      await rescan(db);
      return { block: prior.key, channel, order, unchanged: nextBlock === before && nextChannel === held };
    },
  };
  return {
    async call(name, args = {}) {
      if (!Object.hasOwn(calls, name)) refuse(`There is no tool named ${name}`);
      for (const path of [CONFIG, GRANTS, JOURNAL, INDEX, `${INDEX}-wal`, `${INDEX}-shm`]) {
        await ordinaryFile(vault, path.split('/'));
      }
      await beneath(vault, CACHE.split('/'));
      const db = await openIndex(vault, { DatabaseSync });
      try {
        if (!['vault_index', 'vault_capture', 'vault_history', 'vault_requests'].includes(name) && !summary(db).scanned) {
          refuse('Run vault_index to scan this vault first.');
        }
        const invoke = () => calls[name](db, args);
        return await (WRITING.includes(name) ? withCollectLock(vault, DatabaseSync, invoke) : invoke());
      } finally {
        db.close();
      }
    },
  };
}

// What the local tools tell an agent, over standard input and output or over HTTP (ohmmmm serve).
export const LOCAL_INSTRUCTIONS = 'These tools read the vault folder and its configured roots on this device. Run vault_index first, then vault_where to see where data lives and what you may change. Captures, writes, links, removals, restores and renames need the person\'s grant on that folder, and what you make starts private. Every change is journaled and the old version kept for vault_restore. vault_lint finds what to check.';

export async function serveLocalVault({ vault, agent, DatabaseSync, input, output }) {
  if (!vault) refuse('Launch from a home or select its vault with --vault.');
  if (!/^[A-Za-z0-9._-]+$/.test(agent)) refuse('Name the agent with letters, digits, dots, underscores or hyphens.');
  if (!(await info(vault))?.isDirectory()) refuse('Select an existing vault folder.');
  const tools = createLocalTools({ vault: await realpath(vault), by: `agent:${agent}`, DatabaseSync });
  input.setEncoding('utf8');
  await serve(createServer({ tools, list: LOCAL_TOOLS, instructions: LOCAL_INSTRUCTIONS }), input, output);
}
