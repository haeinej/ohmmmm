// `ohmmmm serve`: the home's bridge on this machine (docs/serve.md). The app at app.ohmmmm.com, and
// agents on this machine, reach the home folder through it, which a hosted page cannot otherwise do:
//
//   /vault/mcp      the vault's local tools (vault/mcp/local.mjs) over MCP's Streamable HTTP
//   /cortex/mcp     the cortex's tools, the same as `cortex serve`
//   /media/<cid>    GET an image's bytes by their CID; PUT them to make a media block in the home
//   /vault/files    GET the home's Markdown, each file with its version
//   /vault/file     PUT or DELETE one file, as the person, only over the version it was read at
//   /vault/journal  GET the vault's recent changes, with the kept versions they name, for the app's history
//   /vault/rename   POST a rename or move of a block or channel, as the person, rewriting what used the old name
//   /vault/visibility  POST a block's move between Only you and Friends, as the person
//   /vault/requests    GET what agents asked to change about who sees a block; POST /<id> approves or declines
//   /               what this bridge serves
//
// It answers only this machine (it listens on 127.0.0.1, and a Host header naming anything else is
// refused, against DNS rebinding), only with the home's token (`Authorization: Bearer`, kept in
// <home>/.ohmmmm/serve-token), and in a browser only to the app's origins and pages on this machine.
// A preflight, which carries no token, learns nothing but which headers it may send.
//
// MCP sessions are agents: each is named by its client, and the vault's grants decide what it may
// change. /media and /vault/file are the person, through the app (app/src/data/local-source.ts): their
// writes are journaled `by: me`, `via: editor`, and every version is kept, so any of it can be restored.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { cortexSessions, httpTransport } from '../cortex/src/http.mjs';
import { createServer as mcpServer } from '../vault/mcp/protocol.mjs';
import { createLocalTools, HISTORY, LOCAL_INSTRUCTIONS, LOCAL_TOOLS, withCollectLock } from '../vault/mcp/local.mjs';
import { blobCid, FILE_TYPES, isSlug, VaultProblem } from '../vault/vault/core.mjs';
import { isPostId, slugOf, writeNoteFile } from '../vault/vault/file.mjs';
import { CACHE, openIndex, scan, summary } from '../vault/vault/indexer.mjs';
import { appendEvents, readEvents } from '../vault/vault/journal.mjs';
import { isChannelPath, newNodeId, readNode, SOURCES } from '../vault/vault/node.mjs';
import { applyRename, planRename, readVaultFolder } from '../vault/vault/rename.mjs';
import { decideRequest, layerOf, readRequests, withVisibility } from '../vault/vault/visibility.mjs';
import { findHome } from './home.mjs';

export const PORT = 8766;
export const APP = 'https://app.ohmmmm.com';
export const TOKEN = '.ohmmmm/serve-token';
export const MAX_IMAGE = 20 * 1024 * 1024;
export const IMAGE_TYPES = { 'image/avif': 'avif', 'image/gif': 'gif', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]', '::1'];
const CID = /^b[a-z2-7]{20,}$/;

// ---- The token ----

/** The home's token: the one kept, or a new one when there is none or `replace` asks. Only the person can read it. */
export async function homeToken(home, { replace = false } = {}) {
  const path = join(home, TOKEN);
  if (!replace) {
    const held = (await readFile(path, 'utf8').catch(problem => { if (problem.code !== 'ENOENT') throw problem; }))?.trim();
    if (held) return held;
  }
  await mkdir(join(home, '.ohmmmm'), { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString('base64url');
  // Written whole to a new file only the person can read, then moved over the old one.
  const fresh = join(home, '.ohmmmm', `.serve-token-${randomUUID()}.tmp`);
  try {
    await writeFile(fresh, `${token}\n`, { mode: 0o600, flag: 'wx' });
    await chmod(fresh, 0o600);
    await rename(fresh, path);
  } finally {
    await rm(fresh, { force: true });
  }
  return token;
}

/** The link that pairs the app with this bridge. The token rides in the fragment, which a browser never sends to a server. */
export const pairingLink = (app, url, token) => `${app}/#bridge=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}`;

// ---- Sessions ----

// An agent's name, as the vault's journal and grants write it.
const agentOf = given => (typeof given === 'string' ? given.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) : '') || 'agent';

// Each MCP session on /vault/mcp: the local tools, for the agent its initialize names.
const vaultSessions = (vault, DatabaseSync, fixed) => () => {
  let agent = agentOf(fixed);
  const handle = mcpServer({ tools: () => createLocalTools({ vault, by: `agent:${agent}`, DatabaseSync }), list: LOCAL_TOOLS, instructions: LOCAL_INSTRUCTIONS });
  return message => {
    if (message?.method === 'initialize' && !fixed) agent = agentOf(message.params?.clientInfo?.name);
    return handle(message);
  };
};

// ---- Media ----

const isFile = path => lstat(path).then(info => info.isFile() && !info.isSymbolicLink(), () => false);
const typeOf = path => FILE_TYPES[`.${path.split('.').at(-1).toLowerCase()}`] ?? 'application/octet-stream';

// Where the bytes with this CID are in the home: a file in the vault, or one a full root cached.
async function findMedia(vault, db, cid) {
  const rows = db.prepare('SELECT root, path FROM files WHERE hash = ? ORDER BY root = \'vault\' DESC, path').all(cid);
  const own = rows.find(row => row.root === 'vault');
  if (own && await isFile(join(vault, own.path))) return { file: join(vault, own.path), type: typeOf(own.path) };
  const cached = join(vault, CACHE, cid);
  if (await isFile(cached)) return { file: cached, type: rows[0] ? typeOf(rows[0].path) : 'application/octet-stream' };
  return null;
}

// The bytes, only when they still are what their CID says: a file edited since the last scan is not served under its old name.
async function mediaBytes(vault, db, cid) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const found = await findMedia(vault, db, cid);
    if (found) {
      const bytes = await readFile(found.file);
      if (await blobCid(bytes) === cid) return { bytes, type: found.type };
    }
    if (attempt === 0) await scan({ vault, db });
  }
  return null;
}

/**
 * Makes a media block in the home from an image's bytes, as the person (vault/plans/media.md, step 3):
 * the file and its block beside it, `<channel>/<slug>.<ending>` and `<channel>/<slug>.md`, journaled
 * `by: me`, `via: editor`. An image the vault already has is not copied: its media block is returned,
 * or made beside the file when it has none.
 */
export async function addMedia({ vault, db, bytes, type, channel, name, title, alt, id, slug, width, height }) {
  const ending = IMAGE_TYPES[type];
  const hash = await blobCid(bytes);
  await scan({ vault, db });
  const blockOf = file => {
    const folder = file.split('/').slice(0, -1).join('/');
    const embed = `![[${file.split('/').at(-1)}]]`;
    return db.prepare("SELECT path, slug, node FROM nodes WHERE type = 'block' AND root = 'vault' AND home = ?").all(folder)
      .map(row => ({ ...row, node: JSON.parse(row.node) })).find(row => row.node.body?.trim() === embed);
  };
  const held = db.prepare("SELECT path FROM files WHERE root = 'vault' AND hash = ? ORDER BY path LIMIT 1").get(hash)?.path;
  if (held) {
    const block = blockOf(held);
    if (block) {
      const text = await readFile(join(vault, block.path), 'utf8');
      return { created: false, id: block.node.id, slug: block.slug, path: block.path, file: held, text, version: await blobCid(Buffer.from(text, 'utf8')) };
    }
  }
  // A file already there gets its block beside it; a new one goes in the channel asked for.
  const folder = held ? held.split('/').slice(0, -1).join('/') : channel;
  const taken = async path => Boolean(await lstat(join(vault, path)).catch(() => null));
  const slugTaken = value => Boolean(db.prepare("SELECT 1 FROM nodes WHERE type = 'block' AND slug = ?").get(value));
  const stem = String(name ?? '').replace(/\.[^.]+$/, '').trim();
  let base = slug ?? (slugOf(stem) || 'image');
  if (!isSlug(base)) base = 'image';
  let made = base;
  const at_ = name => (folder ? `${folder}/${name}` : name);
  for (let n = 2; slugTaken(made) || await taken(at_(`${made}.md`)) || (!held && await taken(at_(`${made}.${ending}`))); n++) made = `${base}-${n}`;
  const file = held ?? at_(`${made}.${ending}`);
  const path = at_(`${made}.md`);
  const label = (title ?? stem) || made;
  const text = writeNoteFile({
    properties: {
      kind: 'media', title: label, alt: alt || label, hash, mime: type,
      ...(width && height ? { width, height } : {}), id: id ?? newNodeId(),
    },
    body: `![[${file.split('/').at(-1)}]]`,
  });
  await mkdir(join(vault, folder), { recursive: true });
  // Stamped after the scan above, so the scan below knows these were said already.
  const at = new Date().toISOString();
  const events = [];
  if (!held) {
    await writeFile(join(vault, file), bytes, { flag: 'wx' });
    events.push({ at, op: 'added', root: 'vault', path: file, by: 'me', via: 'editor', hash });
  }
  await writeFile(join(vault, path), text, { flag: 'wx' });
  events.push({ at, op: 'added', root: 'vault', path, by: 'me', via: 'editor', hash: await blobCid(Buffer.from(text, 'utf8')) });
  await appendEvents(vault, events);
  await scan({ vault, db });
  return { created: true, id: readId(text), slug: made, path, file, text, version: await blobCid(Buffer.from(text, 'utf8')) };
}
const readId = text => /^id:\s*(\S+)/m.exec(text)?.[1];

// ---- Files: the person's edits from the app ----

export const MAX_TEXT = 600_000;
const versionOf = text => blobCid(Buffer.from(text, 'utf8'));

/** A path the app may write as the person: a Markdown file in the vault, not hidden, not machinery, not a captured source. */
export const editablePath = path => typeof path === 'string' && path.length <= 1000 && /^[^/]+(?:\/[^/]+)*\.md$/.test(path)
  && !path.split('/').some(part => !part || part.startsWith('.') || part === '..') && !path.startsWith(`${SOURCES}/`);

// The file, after checking that nothing on the way to it is a link out of the vault.
async function inVault(vault, path) {
  let at = vault;
  for (const part of path.split('/')) {
    at = join(at, part);
    const info = await lstat(at).catch(problem => { if (problem.code !== 'ENOENT') throw problem; });
    if (info?.isSymbolicLink()) throw Object.assign(new Error('A path through a link out of the vault is refused'), { status: 403 });
  }
  return at;
}

// A version kept once by its address, as the vault's tools keep theirs, so `ohm vault restore` can bring it back.
async function keep(vault, text) {
  const address = await versionOf(text);
  await mkdir(join(vault, HISTORY), { recursive: true });
  await writeFile(join(vault, HISTORY, address), text, { flag: 'wx' }).catch(problem => { if (problem.code !== 'EEXIST') throw problem; });
  return address;
}

/**
 * Writes one file as the person, only over the version it was read at: `replaces` is that version,
 * or null for a file that must not exist yet. `text` undefined removes it. Returns the new version.
 * Refusals carry the HTTP status they answer with: 412 when the file is not at that version any more.
 */
export async function writeAsPerson({ vault, path, text, replaces }) {
  if (!editablePath(path)) throw Object.assign(new Error('Give the path of a Markdown file inside the vault, such as notes/idea.md'), { status: 400 });
  if (text !== undefined) {
    const read = readNode(path, text);
    if (!read) throw Object.assign(new Error('That path is not a block, channel or entity'), { status: 422 });
    if (read.problems.length) throw Object.assign(new Error(`The file cannot be read: ${read.problems.join(' ')}`), { status: 422 });
  }
  const file = await inVault(vault, path);
  const before = await readFile(file, 'utf8').catch(problem => { if (problem.code !== 'ENOENT') throw problem; });
  const now = before === undefined ? null : await versionOf(before);
  if (now !== replaces) throw Object.assign(new Error(now === null ? 'There is no such file any more' : replaces === null ? 'A file is already there' : 'The file changed since it was read'), { status: 412, version: now });
  const at = new Date().toISOString();
  if (text === undefined) {
    const kept = await keep(vault, before);
    await unlink(file);
    await appendEvents(vault, [{ at, op: 'removed', root: 'vault', path, by: 'me', via: 'editor', before: kept }]);
    return { path, removed: true, before: kept };
  }
  const kept = before === undefined ? undefined : await keep(vault, before);
  const hash = await keep(vault, text);
  await mkdir(dirname(file), { recursive: true });
  const temp = join(dirname(file), `.edit-${randomUUID()}`);
  try {
    await writeFile(temp, text, { flag: 'wx' });
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
  await appendEvents(vault, [{ at, op: before === undefined ? 'added' : 'changed', root: 'vault', path, by: 'me', via: 'editor', ...(kept ? { before: kept } : {}), hash }]);
  return { path, version: hash, created: before === undefined };
}

/**
 * The vault's recent changes to its Markdown for the app's history: the last `limit` added, changed,
 * moved and removed events of the vault's own root, oldest first, with the text of every kept version
 * they name (`texts`, by content address). A version that was never kept is simply absent.
 */
export async function recentHistory(vault, { limit = 500 } = {}) {
  const { events } = await readEvents(vault);
  const changes = events
    .filter(event => event.root === 'vault' && ['added', 'changed', 'moved', 'removed'].includes(event.op) && event.path.endsWith('.md'))
    .slice(-limit);
  const texts = {};
  for (const event of changes) {
    for (const address of [event.before, event.hash]) {
      if (!address || address in texts || !/^b[a-z2-7]{20,}$/.test(address)) continue;
      const text = await readFile(join(vault, HISTORY, address), 'utf8').catch(() => undefined);
      if (text !== undefined) texts[address] = text;
    }
  }
  return { events: changes, texts };
}

/**
 * A rename or move as the person (vault/vault/rename.mjs): `{ channel, to }`, or `{ block, slug?,
 * title?, home? }`. Every file that used the old name is rewritten; all of it is journaled `by: me`,
 * `via: rename`. Answers what the rename did, and each file it moved or wrote as it is on disk now.
 */
export async function renameAsPerson({ vault, change }) {
  const { files, paths } = await readVaultFolder(vault, { open: path => inVault(vault, path) });
  const plan = planRename(files, change.block === undefined
    ? { channel: change.channel, to: change.to }
    : { block: change.block, ...(change.slug === undefined ? {} : { slug: change.slug }), ...(change.title === undefined ? {} : { title: change.title }), ...(change.home === undefined ? {} : { channel: change.home }) }, { paths });
  const done = await applyRename({ vault, plan, by: 'me', keep: text => keep(vault, text) });
  const touched = [...new Set([...plan.moves.map(move => move.to), ...plan.writes.map(write => write.path)])].filter(path => path.endsWith('.md'));
  const now = [];
  for (const path of touched) {
    const text = await readFile(join(vault, path), 'utf8').catch(() => undefined);
    if (text !== undefined) now.push({ path, text, version: await versionOf(text) });
  }
  return { ...done, moves: plan.moves, files: now };
}

/**
 * Moves a block between Only you and Friends as the person (vault/vault/visibility.mjs), over the
 * version read (`replaces`; left out when the person approves an agent's request on the file as it
 * is). Journaled `changed`, `via: visibility`, with `layer`, `was`, and the agent that `asked` and
 * its `why` when one did. Public is refused: that is Publish.
 */
export async function moveAsPerson({ vault, path, to, replaces, asked, why }) {
  if (!editablePath(path)) throw Object.assign(new Error('Give the block as its file\'s path in the vault'), { status: 400 });
  const file = await inVault(vault, path);
  const before = await readFile(file, 'utf8').catch(problem => { if (problem.code !== 'ENOENT') throw problem; });
  if (before === undefined) throw Object.assign(new Error('There is no such file any more'), { status: 412, version: null });
  const version = await versionOf(before);
  if (replaces !== undefined && replaces !== version) throw Object.assign(new Error('The file changed since it was read'), { status: 412, version });
  const was = layerOf(path, before);
  const text = withVisibility(path, before, to);
  if (text === before) return { path, text, version, layer: to, unchanged: true };
  const kept = await keep(vault, before);
  const hash = await keep(vault, text);
  const temp = join(dirname(file), `.edit-${randomUUID()}`);
  try {
    await writeFile(temp, text, { flag: 'wx' });
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
  await appendEvents(vault, [{
    at: new Date().toISOString(), op: 'changed', root: 'vault', path, by: 'me', via: 'visibility', layer: to, was,
    ...(asked ? { asked } : {}), ...(why ? { why } : {}), before: kept, hash,
  }]);
  return { path, text, version: hash, layer: to, was };
}

// ---- The bridge ----

const digest = value => createHash('sha256').update(value).digest();
const hostOf = header => {
  try { return new URL(`http://${header}`).hostname; } catch { return null; }
};
const isLoopbackOrigin = origin => {
  try { return LOOPBACK.includes(new URL(origin).hostname); } catch { return false; }
};

/**
 * The request handler: `layout` is the home (home.mjs), `token` the home's token, `origins` the
 * app's origins (pages on this machine are allowed too). `agent`, when given, names every MCP session.
 */
export function homeBridge({ layout, token, origins = [APP], DatabaseSync, agent }) {
  if (!token) throw new Error('The bridge needs the home\'s token.');
  const expected = digest(`Bearer ${token}`);
  const allowed = origin => origins.includes(origin) || isLoopbackOrigin(origin);
  const vault = httpTransport({ open: vaultSessions(layout.vault, DatabaseSync, agent), origins, endpoint: '/vault/mcp' });
  let cortex;
  const cortexReady = async () => (cortex ??= (await stat(join(layout.cortex, 'agents', 'AGENTS.md')).catch(() => null))
    ? httpTransport({ open: cortexSessions(layout.cortex, { agent }), origins, endpoint: '/cortex/mcp' }) : undefined);

  const send = (res, status, body, headers = {}) => {
    if (body === undefined) return res.writeHead(status, headers).end();
    const text = JSON.stringify(body);
    return res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), ...headers }).end(text);
  };
  const said = (res, status, message) => send(res, status, { error: message });
  const withIndex = async work => {
    const db = await openIndex(layout.vault, { DatabaseSync });
    try { return await work(db); } finally { db.close(); }
  };
  const body = (req, limit) => new Promise((done, fail) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
      else if (size > 2 * limit) req.destroy();
    });
    req.on('end', () => (size > limit ? fail(Object.assign(new Error('Too large'), { tooLarge: true })) : done(Buffer.concat(chunks))));
    req.on('error', fail);
  });

  async function putMedia(req, res, cid, query) {
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (!IMAGE_TYPES[type]) return said(res, 415, `An image is one of: ${Object.keys(IMAGE_TYPES).join(', ')}`);
    const channel = query.get('channel') ?? '';
    if (!isChannelPath(channel)) return said(res, 400, 'Give the channel the image goes in, as ?channel=<path>');
    const number = key => { const value = query.get(key); return value === null ? undefined : Number(value); };
    const width = number('width'), height = number('height');
    if ([width, height].some(value => value !== undefined && (!Number.isInteger(value) || value < 1 || value > 100_000))) return said(res, 400, 'width and height are whole numbers of pixels');
    const id = query.get('id') ?? undefined;
    if (id !== undefined && !isPostId(id)) return said(res, 400, 'id is a TID the vault gave');
    const slug = query.get('slug') ?? undefined;
    if (slug !== undefined && !isSlug(slug)) return said(res, 400, 'slug is lowercase Latin letters, digits and hyphens');
    const text = key => { const value = query.get(key); return value === null ? undefined : value.replace(/\s+/g, ' ').trim().slice(0, 1000) || undefined; };
    let bytes;
    try { bytes = await body(req, MAX_IMAGE); } catch (problem) { return problem.tooLarge ? said(res, 413, 'An image is up to 20 MB') : said(res, 400, 'The image did not arrive whole'); }
    if (await blobCid(bytes) !== cid) return said(res, 400, `These bytes are not ${cid}`);
    const added = await withCollectLock(layout.vault, DatabaseSync, () => withIndex(db => addMedia({
      vault: layout.vault, db, bytes, type, channel, name: text('name'), title: text('title'), alt: text('alt'), id, slug, width, height,
    })));
    return send(res, added.created ? 201 : 200, added);
  }

  return async function handle(req, res) {
    try {
      if (!LOOPBACK.includes(hostOf(req.headers.host ?? ''))) return said(res, 403, 'This bridge answers only this machine');
      const origin = req.headers.origin;
      if (origin !== undefined) {
        if (!allowed(origin)) return said(res, 403, 'Forbidden origin');
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, ETag');
      }
      if (req.method === 'OPTIONS') {
        return send(res, 204, undefined, {
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, If-Match, If-None-Match, Mcp-Session-Id, MCP-Protocol-Version',
          'Access-Control-Max-Age': '600',
          // A public page reaching this machine asks first (Private Network Access); this bridge says yes to the origins above.
          ...(req.headers['access-control-request-private-network'] === 'true' ? { 'Access-Control-Allow-Private-Network': 'true' } : {}),
        });
      }
      const signed = req.headers.authorization;
      if (typeof signed !== 'string' || !timingSafeEqual(digest(signed), expected)) return send(res, 401, undefined, { 'WWW-Authenticate': 'Bearer' });
      const url = new URL(req.url, 'http://home');
      if (url.pathname === '/vault/mcp') return await vault(req, res);
      if (url.pathname === '/cortex/mcp') {
        const serve = await cortexReady();
        return serve ? await serve(req, res) : said(res, 404, 'This home has no cortex yet. Start one with: ohmmmm init <handle>');
      }
      if (url.pathname === '/vault/journal' && req.method === 'GET') {
        const limit = Number(url.searchParams.get('limit') ?? 500);
        if (!Number.isInteger(limit) || limit < 1 || limit > 5000) return said(res, 400, 'limit is a whole number from 1 to 5000');
        // Changes made outside ohm since the last scan are found, journaled and kept first.
        await withCollectLock(layout.vault, DatabaseSync, () => withIndex(db => scan({ vault: layout.vault, db })));
        return send(res, 200, await recentHistory(layout.vault, { limit }));
      }
      if (url.pathname === '/vault/rename' && req.method === 'POST') {
        if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return said(res, 415, 'Send the rename as JSON');
        let change;
        try { change = JSON.parse((await body(req, 64 * 1024)).toString('utf8')); } catch { return said(res, 400, 'Send the rename as one JSON object'); }
        const text = value => value === undefined || (typeof value === 'string' && value.length <= 1000);
        if (!change || typeof change !== 'object' || !['block', 'channel', 'to', 'slug', 'title', 'home'].every(key => text(change[key]))) return said(res, 400, 'A rename is { channel, to } or { block, slug?, title?, home? }, each a string');
        if (change.block !== undefined && !editablePath(change.block)) return said(res, 400, 'Give the block as its file\'s path in the vault');
        const done = await withCollectLock(layout.vault, DatabaseSync, () => renameAsPerson({ vault: layout.vault, change }));
        return send(res, 200, done);
      }
      if (url.pathname === '/vault/visibility' && req.method === 'POST') {
        const match = req.headers['if-match'];
        if (match === undefined) return said(res, 428, 'Say which version you read: If-Match: "<version>"');
        let asked;
        try { asked = JSON.parse((await body(req, 16 * 1024)).toString('utf8')); } catch { return said(res, 400, 'Send the move as one JSON object'); }
        if (!asked || typeof asked.path !== 'string' || typeof asked.to !== 'string' || (asked.why !== undefined && typeof asked.why !== 'string')
          || (asked.asked !== undefined && !/^agent:[A-Za-z0-9._-]{1,100}$/.test(asked.asked))) return said(res, 400, 'A move is { path, to, why?, asked? }, asked naming the agent that asked, approved by the person');
        try {
          const done = await withCollectLock(layout.vault, DatabaseSync, () => moveAsPerson({ vault: layout.vault, path: asked.path, to: asked.to, replaces: String(match).replace(/^W\//, '').replace(/^"|"$/g, ''), asked: asked.asked, why: asked.why?.slice(0, 500) }));
          return send(res, 200, done);
        } catch (problem) {
          if (!problem.status) throw problem;
          return send(res, problem.status, { error: problem.message, ...(problem.version !== undefined ? { version: problem.version } : {}) });
        }
      }
      if (url.pathname === '/vault/requests' && req.method === 'GET') {
        return send(res, 200, { requests: (await readRequests(layout.vault)).filter(each => each.status === 'waiting') });
      }
      const deciding = /^\/vault\/requests\/([0-9a-f-]{36})$/.exec(url.pathname);
      if (deciding && req.method === 'POST') {
        let decision;
        try { decision = JSON.parse((await body(req, 4 * 1024)).toString('utf8')); } catch { return said(res, 400, 'Send { approve: true } or { approve: false }'); }
        if (typeof decision?.approve !== 'boolean') return said(res, 400, 'Send { approve: true } or { approve: false }');
        const done = await withCollectLock(layout.vault, DatabaseSync, async () => {
          const request = (await readRequests(layout.vault)).find(each => each.id === deciding[1]);
          if (!request) throw new VaultProblem('There is no such request.');
          if (!decision.approve) return { request: await decideRequest(layout.vault, request.id, 'declined') };
          try {
            const file = await moveAsPerson({ vault: layout.vault, path: request.path, to: request.to, asked: request.by, why: request.why });
            return { request: await decideRequest(layout.vault, request.id, 'approved'), file };
          } catch (problem) {
            if (!problem.status && !(problem instanceof VaultProblem)) throw problem;
            // It cannot be done as asked any more (the file went, or is public now): declined, saying why.
            return { request: await decideRequest(layout.vault, request.id, 'declined', { note: problem.message }) };
          }
        });
        return send(res, 200, done);
      }
      if (url.pathname === '/vault/files' && req.method === 'GET') {
        const { files } = await readVaultFolder(layout.vault, { open: path => inVault(layout.vault, path) });
        return send(res, 200, { home: layout.handle, files: await Promise.all(files.map(async file => ({ ...file, version: await versionOf(file.text) }))) });
      }
      if (url.pathname === '/vault/file' && (req.method === 'PUT' || req.method === 'DELETE')) {
        const path = url.searchParams.get('path') ?? '';
        const match = req.headers['if-match'];
        const none = req.headers['if-none-match'];
        if (match === undefined && none !== '*') return said(res, 428, 'Say which version you read: If-Match: "<version>", or If-None-Match: * for a new file');
        const replaces = match === undefined ? null : String(match).replace(/^W\//, '').replace(/^"|"$/g, '');
        let text;
        if (req.method === 'PUT') {
          try { text = (await body(req, MAX_TEXT)).toString('utf8'); } catch (problem) { return problem.tooLarge ? said(res, 413, 'A file is up to 600 KB') : said(res, 400, 'The file did not arrive whole'); }
        }
        try {
          const done = await withCollectLock(layout.vault, DatabaseSync, () => writeAsPerson({ vault: layout.vault, path, text, replaces }));
          return send(res, done.created ? 201 : 200, done, done.version ? { ETag: `"${done.version}"` } : {});
        } catch (problem) {
          if (!problem.status) throw problem;
          return send(res, problem.status, { error: problem.message, ...(problem.version !== undefined ? { version: problem.version } : {}) });
        }
      }
      const media = /^\/media\/([^/]+)$/.exec(url.pathname);
      if (media) {
        if (!CID.test(media[1])) return said(res, 400, 'Name an image by its CID');
        if (req.method === 'GET') {
          const found = await withIndex(db => mediaBytes(layout.vault, db, media[1]));
          if (!found) return said(res, 404, 'This home has no image with that CID');
          return res.writeHead(200, {
            'Content-Type': found.type, 'Content-Length': found.bytes.length, 'X-Content-Type-Options': 'nosniff',
            // The same CID is always the same bytes.
            'Cache-Control': 'private, max-age=31536000, immutable',
          }).end(found.bytes);
        }
        if (req.method === 'PUT') return await putMedia(req, res, media[1], url.searchParams);
        return send(res, 405, undefined, { Allow: 'GET, PUT' });
      }
      if (url.pathname === '/' && req.method === 'GET') {
        const scanned = await withIndex(db => summary(db).scanned);
        return send(res, 200, {
          home: layout.handle, vault: { scanned }, cortex: Boolean(await cortexReady()),
          endpoints: { vault: '/vault/mcp', cortex: '/cortex/mcp', media: '/media/<cid>', files: '/vault/files', file: '/vault/file', journal: '/vault/journal', rename: '/vault/rename', visibility: '/vault/visibility', requests: '/vault/requests' },
        });
      }
      return said(res, 404, 'Not here. The bridge serves /vault/mcp, /cortex/mcp, /vault/files, /vault/file, /vault/journal, /vault/rename, /vault/visibility, /vault/requests and /media/<cid>');
    } catch (problem) {
      // A refusal the vault explains (VaultProblem) is answered with its reason; anything else says nothing.
      if (!res.headersSent) said(res, problem instanceof VaultProblem ? 409 : 500, problem instanceof VaultProblem ? problem.message : 'Internal error');
      else res.destroy();
    }
  };
}

/** Listens on this machine only, and resolves to the node:http server once it does. Port 0 picks a free one. */
export function listenHome(handler, { port = PORT } = {}) {
  const server = createHttpServer(handler);
  return new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => { server.off('error', fail); done(server); });
  });
}

// ---- The command ----
//   ohmmmm serve [--port 8766] [--app <origin>]… [--agent <name>] [--new-token]

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sqlite = await import('node:sqlite').catch(() => null);
  if (!sqlite) {
    if (process.execArgv.includes('--experimental-sqlite')) {
      console.error('This Node has no SQLite. Use Node 22.13 or newer.');
      process.exit(1);
    }
    const again = spawnSync(process.execPath, ['--experimental-sqlite', '--no-warnings=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
    process.exit(again.status ?? 1);
  }
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2).filter(arg => arg !== 'serve'),
      options: { port: { type: 'string' }, app: { type: 'string', multiple: true }, agent: { type: 'string' }, 'new-token': { type: 'boolean' } },
    });
    const layout = findHome();
    if (!layout) throw new Error('Run ohmmmm serve inside a home (ohmmmm.<handle>), or set OHMMMM_HOME.');
    const port = values.port === undefined ? PORT : Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port is a port number');
    const apps = values.app?.length ? values.app.map(app => new URL(app).origin) : [APP];
    const token = await homeToken(layout.home, { replace: Boolean(values['new-token']) });
    const server = await listenHome(homeBridge({ layout, token, origins: apps, DatabaseSync: sqlite.DatabaseSync, agent: values.agent }), { port })
      .catch(problem => { throw new Error(problem.code === 'EADDRINUSE' ? `Port ${port} is in use. Choose another with --port.` : problem.message); });
    const url = `http://127.0.0.1:${server.address().port}`;
    console.log(`Serving ${layout.home} at ${url}, to this machine only.`);
    for (const app of apps) console.log(`Open this once to connect the app: ${pairingLink(app, url, token)}`);
    console.log(`Agents: ${url}/vault/mcp and ${url}/cortex/mcp, with Authorization: Bearer <the token in ${join(layout.home, TOKEN)}>.`);
  } catch (problem) {
    console.error(problem.message);
    process.exitCode = 1;
  }
}
