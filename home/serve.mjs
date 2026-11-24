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
//   /vault/publish     POST /plan shows what publishing a block would write; POST publishes it, as the person
//   /vault/unpublish   POST takes a published block's post down, then moves the block back, as the person
//   /cortex/…       the person's cortex for the app: its parts, its journal, and their changes (cortex-routes.mjs)
//   /               what this bridge serves
//
// It answers only this machine (it listens on 127.0.0.1, and a Host header naming anything else is
// refused, against DNS rebinding), only with one of the home's keys (`Authorization: Bearer`), and in a
// browser only to the app's origins and pages on this machine. A preflight, which carries no key,
// learns nothing but which headers it may send. There are two kinds of key:
//
//   the agent key   <home>/.ohmmmm/agent-key, kept as it is so the person can give it to agents. It
//                   reaches /vault/mcp, /cortex/mcp and / only.
//   app keys        one for each browser paired with the home. It reaches everything. Only its
//                   SHA-256 is kept (<home>/.ohmmmm/app-keys.json): the key itself is in the pairing
//                   link and in the paired browser, never in the home, so a program that reads the
//                   home's files does not find it there.
//
// MCP sessions are agents: each is named by its client, and the vault's grants decide what it may
// change. /media and /vault/file are the person, through the app (app/src/data/local-source.ts): their
// writes are journaled `by: me`, `via: editor`, and every version is kept, so any of it can be restored.
//
// Publishing signs in to the person's PDS with ATPROTO_APP_PASSWORD from this process's environment,
// for the account the home's site configuration names (<home>/ohm.jsonc, or --config). The password
// never leaves this process: no answer carries it, and the app never sees it. No agent tool publishes.
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
import { pdsConfig, webUrl } from '../vault/feed/pds.mjs';
import { signIn } from '../vault/scripts/rpc.mjs';
import { blobCid, FILE_TYPES, isSlug, VaultProblem } from '../vault/vault/core.mjs';
import { isPostId, setProperty, slugOf, writeNoteFile } from '../vault/vault/file.mjs';
import { CACHE, openIndex, scan, summary } from '../vault/vault/indexer.mjs';
import { appendEvents, readEvents } from '../vault/vault/journal.mjs';
import { CHANNEL_FILE, isChannelPath, newNodeId, nodeFile, readNode, SOURCES } from '../vault/vault/node.mjs';
import { blockPost, publishedAddresses } from '../vault/vault/publish-block.mjs';
import { memoryKv, ownStores, pdsStore } from '../vault/vault/stores.mjs';
import { createVault } from '../vault/vault/vault.mjs';
import { applyRename, planRename, readVaultFolder } from '../vault/vault/rename.mjs';
import { decideRequest, layerOf, publishedLayer, readRequests, withVisibility } from '../vault/vault/visibility.mjs';
import { cortexRoutes } from './cortex-routes.mjs';
import { findHome } from './home.mjs';

export const PORT = 8766;
export const APP = 'https://app.ohmmmm.com';
export const AGENT_KEY = '.ohmmmm/agent-key';
export const APP_KEYS = '.ohmmmm/app-keys.json';
// The one key the bridge had before agents had their own. It becomes the agent key.
export const OLD_TOKEN = '.ohmmmm/serve-token';
// What an agent key reaches; every other route is the person's, through the app.
export const AGENT_ROUTES = ['/vault/mcp', '/cortex/mcp', '/'];
export const SITE_CONFIG = 'ohm.jsonc';
export const MAX_IMAGE = 20 * 1024 * 1024;
export const IMAGE_TYPES = { 'image/avif': 'avif', 'image/gif': 'gif', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]', '::1'];
const CID = /^b[a-z2-7]{20,}$/;

// ---- The keys ----

const KEY_PART = /^[A-Za-z0-9_-]{20,200}$/;
const newKey = kind => `ohm_${kind}_${randomBytes(32).toString('base64url')}`;
const sha256 = value => createHash('sha256').update(value).digest();
const readText = path => readFile(path, 'utf8').catch(problem => { if (problem.code !== 'ENOENT') throw problem; });

// Written whole to a new file only the person can read, then moved over the old one.
async function writePrivate(home, path, text) {
  await mkdir(join(home, '.ohmmmm'), { recursive: true, mode: 0o700 });
  const fresh = join(home, '.ohmmmm', `.key-${randomUUID()}.tmp`);
  try {
    await writeFile(fresh, text, { mode: 0o600, flag: 'wx' });
    await chmod(fresh, 0o600);
    await rename(fresh, join(home, path));
  } finally {
    await rm(fresh, { force: true });
  }
}

/**
 * The home's agent key: the one kept, or a new one when there is none or `replace` asks. A home whose
 * bridge had one key for everyone (.ohmmmm/serve-token) keeps that key for its agents, and the file
 * goes, so it no longer opens the person's routes. Answers `{ key, made, fromOldToken }`.
 */
export async function agentKey(home, { replace = false } = {}) {
  const held = replace ? undefined : (await readText(join(home, AGENT_KEY)))?.trim();
  if (held && KEY_PART.test(held)) return { key: held, made: false, fromOldToken: false };
  const old = replace ? undefined : (await readText(join(home, OLD_TOKEN)))?.trim();
  const key = old && KEY_PART.test(old) ? old : newKey('agent');
  await writePrivate(home, AGENT_KEY, `${key}\n`);
  await rm(join(home, OLD_TOKEN), { force: true });
  return { key, made: true, fromOldToken: key === old };
}

/** The paired browsers' keys, as kept: `{ keys: [{ hash, made, app? }] }`, each `hash` the key's SHA-256 in hex. */
export async function appKeys(home) {
  const text = await readText(join(home, APP_KEYS));
  if (text === undefined) return [];
  try {
    const keys = JSON.parse(text)?.keys;
    return Array.isArray(keys) ? keys.filter(each => /^[0-9a-f]{64}$/.test(each?.hash ?? '')) : [];
  } catch {
    throw new Error(`${join(home, APP_KEYS)} is not JSON. Remove it and pair the app again with: ohmmmm pair`);
  }
}

/**
 * A key for one more browser: kept only as its SHA-256, and answered once, for the pairing link.
 * `replace` forgets every browser paired before. `app` notes which app origin it was made for.
 */
export async function pairApp(home, { replace = false, app } = {}) {
  const key = newKey('app');
  const kept = replace ? [] : await appKeys(home);
  const keys = [...kept, { hash: sha256(key).toString('hex'), made: new Date().toISOString(), ...(app ? { app } : {}) }];
  await writePrivate(home, APP_KEYS, `${JSON.stringify({ keys }, null, 2)}\n`);
  return key;
}

/** What each key the bridge accepts opens: `who(key)` is 'app', 'agent' or null, compared in constant time. */
export async function homeKeys(home) {
  const agent = (await readText(join(home, AGENT_KEY)))?.trim();
  const agentHash = agent && KEY_PART.test(agent) ? sha256(agent) : null;
  const apps = (await appKeys(home)).map(each => Buffer.from(each.hash, 'hex'));
  return key => {
    const presented = sha256(String(key));
    let found = null;
    // Every key is compared, so the time taken says nothing about which one was near.
    for (const hash of apps) if (timingSafeEqual(presented, hash)) found = 'app';
    if (agentHash && timingSafeEqual(presented, agentHash) && !found) found = 'agent';
    return found;
  };
}

/** The link that pairs the app with this bridge. The key rides in the fragment, which a browser never sends to a server. */
export const pairingLink = (app, url, key) => `${app}/#bridge=${encodeURIComponent(url)}&token=${encodeURIComponent(key)}`;

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

// ---- Publishing: a block to the person's PDS ----

const fail = (message, status) => Object.assign(new Error(message), { status });

/**
 * The site configuration Publish uses, as `ohm configure` writes it: the account (ATPROTO_DID), its
 * PDS (ATPROTO_PDS_ORIGIN) and the website (SITE_ORIGIN). Null when the file is not there.
 */
export async function siteSettings(file) {
  const text = await readFile(file, 'utf8').catch(problem => { if (problem.code !== 'ENOENT') throw problem; });
  if (text === undefined) return null;
  let vars;
  try { vars = JSON.parse(text)?.vars ?? {}; } catch { throw new VaultProblem(`${file} is not JSON. Make it again with ohm configure.`); }
  let account;
  try { account = pdsConfig(vars); } catch (problem) { throw new VaultProblem(`${file}: ${problem.message}`); }
  const site = webUrl(vars.SITE_ORIGIN);
  if (!site) throw new VaultProblem(`${file}: set SITE_ORIGIN to your website's address.`);
  return { did: account.did, origin: account.origin, collection: account.collection, site };
}

// What publishing still needs on this computer, in words for the person.
function needsOf({ settings, config, password }) {
  const needs = [];
  if (!settings) needs.push({ what: 'site', say: `Publishing needs your site's configuration in your home. Make it with: ohm configure --site https://… --handle … > ${config}` });
  if (!password) needs.push({ what: 'password', say: 'Start ohmmmm serve with ATPROTO_APP_PASSWORD set to an app password for your account. It stays on this computer.' });
  return needs;
}

// The vault's own stores for one publish: public is the person's PDS; the others are not touched.
const publicVault = ({ did, origin, collection, site }, { get, token } = {}) => createVault({
  collection,
  stores: { public: pdsStore({ did, origin, collection, site, get, token }), ...ownStores(memoryKv()) },
});

// The block, the vault around it, and what is published of it now.
async function readForPublish({ vault, path, settings, get, key }) {
  if (!editablePath(path)) throw fail('Give the block as its file\'s path in the vault', 400);
  const { files, paths } = await readVaultFolder(vault, { open: at => inVault(vault, at) });
  const held = files.find(file => file.path === path);
  if (!held) throw fail('There is no such file any more', 412);
  const node = readNode(path, held.text)?.node;
  if (node?.type !== 'block') throw new VaultProblem('Only a block can be published.');
  const recordKey = node.id ?? key;
  let published = null;
  if (settings && node.id) published = await publicVault(settings, { get }).find(node.id);
  if (published && published.visibility !== 'public') published = null;
  const addresses = publishedAddresses((await readEvents(vault)).events);
  return { files, paths, text: held.text, version: await versionOf(held.text), node, key: recordKey, published, addresses };
}

// Signs in once, when a write first needs it, with the app password from this process's environment.
const signedIn = ({ origin, did }, password) => {
  let session;
  return async () => (session ??= await signIn(origin, did, password).catch(problem => { throw new VaultProblem(problem.message); }));
};

const readBytes = vault => async path => new Uint8Array(await readFile(await inVault(vault, path)));

/**
 * What publishing a block would do, for the dialog the person approves: its address, its label (the
 * channel's by default; `label` and `sublabel` try others), its images, what changes on the way, what
 * stops it, and what this computer still needs (`needs`). Writes nothing.
 */
export async function planPublish({ vault, path, label, sublabel, config, password = process.env.ATPROTO_APP_PASSWORD, get = fetch }) {
  const settings = await siteSettings(config);
  const read = await readForPublish({ vault, path, settings, get });
  const post = await blockPost({
    files: read.files, paths: read.paths, path, read: readBytes(vault), label, sublabel,
    held: read.published?.record, addresses: read.addresses, ...(settings ?? {}),
  });
  const needs = needsOf({ settings, config, password });
  return {
    path, version: read.version, layer: layerOf(path, read.text), update: Boolean(read.published),
    ...(post.title ? { title: post.title } : {}), slug: post.slug, label: post.label, sublabel: post.sublabel, labelSaved: post.labelSaved,
    ...(post.address ? { address: post.address, form: post.form } : {}),
    ...(read.published ? { publishedAt: read.published.record.publishedAt } : {}),
    attachments: post.attachments.map(({ id, path: at, mime, size }) => ({ id, path: at, mime, size })),
    notes: post.notes, problems: post.problems, needs,
    ready: Boolean(post.confirm) && !needs.length, ...(post.confirm ? { confirm: post.confirm } : {}),
  };
}

// Writes a file the publish changed, keeping both versions; answers the journal event for it.
async function writePublished(vault, path, before, text, extra) {
  const file = await inVault(vault, path);
  const kept = before === undefined ? undefined : await keep(vault, before);
  const hash = await keep(vault, text);
  await mkdir(dirname(file), { recursive: true });
  const temp = join(dirname(file), `.publish-${randomUUID()}`);
  try {
    await writeFile(temp, text, { flag: 'wx' });
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
  return { event: { op: before === undefined ? 'added' : 'changed', root: 'vault', path, by: 'me', via: 'publish', ...extra, ...(kept ? { before: kept } : {}), hash }, file: { path, text, version: hash } };
}

/**
 * Publishes a block as the person, over the version read (`replaces`) and only as the plan they saw
 * (`confirm`, from planPublish). The post goes to their PDS first, under the block's ID (one is given
 * and written into the file when it has none); then the file is marked public, and the label is saved
 * on the block's channel when it is new. Journaled `changed` (`via: publish`, `layer`, `was`) and
 * `published` (`key`, `address`). An update keeps the post's address, label and date.
 */
export async function publishAsPerson({ vault, path, replaces, label, sublabel, confirm, config, password = process.env.ATPROTO_APP_PASSWORD, get = fetch, token }) {
  const settings = await siteSettings(config);
  const needs = needsOf({ settings, config, password });
  if (needs.length) throw new VaultProblem(needs.map(need => need.say).join(' '));
  const read = await readForPublish({ vault, path, settings, get, key: newNodeId() });
  if (read.version !== replaces) throw Object.assign(fail('The file changed since it was read', 412), { version: read.version });
  const post = await blockPost({
    files: read.files, paths: read.paths, path, read: readBytes(vault), label, sublabel, key: read.key,
    held: read.published?.record, addresses: read.addresses, ...settings,
  });
  if (post.problems.length) throw new VaultProblem(post.problems.join('\n'));
  if (post.confirm !== confirm) throw new VaultProblem('It changed since you saw the plan. Look at it again before publishing.');
  const written = await publicVault(settings, { get, token: token ?? signedIn(settings, password) }).save({
    key: read.key, record: post.record, visibility: 'public', files: post.files,
    ...(read.published ? { version: read.published.version } : {}),
  });

  // The file: its ID when it had none, and marked public.
  const was = layerOf(path, read.text);
  const at = new Date().toISOString();
  const events = [];
  const changed = [];
  let text = read.node.id ? read.text : setProperty(read.text, 'id', read.key);
  text = publishedLayer(path, text, 'public');
  if (text !== read.text) {
    const done = await writePublished(vault, path, read.text, text, { layer: 'public', was });
    events.push({ at, ...done.event });
    changed.push(done.file);
  }
  // The label, kept on the channel for next time.
  const home = read.node.home;
  if (home && !read.published && !post.labelSaved && post.label) {
    const channel = `${home}/${CHANNEL_FILE}`;
    const before = read.files.find(file => file.path === channel)?.text;
    const site = { label: post.label, ...(post.sublabel ? { sublabel: post.sublabel } : {}) };
    const after = before === undefined
      ? nodeFile({ type: 'channel', path: home, order: [], description: '', properties: {}, site, id: newNodeId() }).text
      : setProperty(before, 'site', site);
    if (after !== before) {
      const done = await writePublished(vault, channel, before, after, {});
      events.push({ at, ...done.event });
      changed.push(done.file);
    }
  }
  const last = changed.find(file => file.path === path)?.version ?? read.version;
  events.push({ at, op: 'published', root: 'vault', path, by: 'me', via: 'publish', key: read.key, address: post.address, record: written.version, hash: last });
  await appendEvents(vault, events);
  return { path, key: read.key, address: post.address, update: Boolean(read.published), files: changed };
}

/**
 * Takes a published block's post down from the person's PDS, then moves the block to `to` (private or
 * friends), over the version read. Journaled `unpublished` and `changed` (`via: publish`). Copies
 * others made of the post are not recalled. A block marked public with no post is only moved.
 */
export async function unpublishAsPerson({ vault, path, replaces, to, config, password = process.env.ATPROTO_APP_PASSWORD, get = fetch, token }) {
  if (!['private', 'friends'].includes(to)) throw fail('Say where the block goes: private or friends', 400);
  const settings = await siteSettings(config);
  const needs = needsOf({ settings, config, password });
  if (needs.length) throw new VaultProblem(needs.map(need => need.say).join(' '));
  const read = await readForPublish({ vault, path, settings, get });
  if (read.version !== replaces) throw Object.assign(fail('The file changed since it was read', 412), { version: read.version });
  if (layerOf(path, read.text) !== 'public') throw new VaultProblem('This block is not public.');
  if (read.published) await publicVault(settings, { get, token: token ?? signedIn(settings, password) }).remove(read.key, { version: read.published.version });
  const at = new Date().toISOString();
  const events = [];
  if (read.published) events.push({ at, op: 'unpublished', root: 'vault', path, by: 'me', via: 'publish', key: read.key, address: read.published.record.canonicalUrl, hash: read.version });
  const done = await writePublished(vault, path, read.text, publishedLayer(path, read.text, to), { layer: to, was: 'public' });
  events.push({ at, ...done.event });
  await appendEvents(vault, events);
  return { ...done.file, layer: to, removed: Boolean(read.published), ...(read.published ? { address: read.published.record.canonicalUrl } : {}) };
}

// ---- The bridge ----

const hostOf = header => {
  try { return new URL(`http://${header}`).hostname; } catch { return null; }
};
const isLoopbackOrigin = origin => {
  try { return LOOPBACK.includes(new URL(origin).hostname); } catch { return false; }
};

/**
 * The request handler: `layout` is the home (home.mjs), `origins` the app's origins (pages on this
 * machine are allowed too). `agent`, when given, names every MCP session. The home's keys are read
 * on each request (`keys`, homeKeys by default), so a browser paired with `ohmmmm pair` is let in
 * without a restart, and a key replaced stops working at once.
 * `config` is the site configuration Publish uses; `env` holds ATPROTO_APP_PASSWORD, read when needed.
 */
export function homeBridge({ layout, origins = [APP], DatabaseSync, agent, config = join(layout.home, SITE_CONFIG), env = process.env, keys = () => homeKeys(layout.home) }) {
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

  const cortexRoute = cortexRoutes({ dir: layout.cortex, send, said, body });
  const json = async (req, limit) => {
    try { return JSON.parse((await body(req, limit)).toString('utf8')); } catch { return undefined; }
  };
  const versionAsked = req => {
    const match = req.headers['if-match'];
    return match === undefined ? undefined : String(match).replace(/^W\//, '').replace(/^"|"$/g, '');
  };
  // A refusal with its status, or the PDS not answering; anything else is the handler's to answer.
  const answered = (res, problem) => {
    if (problem.status) return send(res, problem.status, { error: problem.message, ...(problem.version !== undefined ? { version: problem.version } : {}) });
    if (problem.name === 'TimeoutError' || (problem.name === 'TypeError' && /fetch/i.test(problem.message))) return said(res, 502, 'Your PDS did not answer. Try again in a moment.');
    throw problem;
  };
  const words = (value, most) => value === undefined || (typeof value === 'string' && value.length <= most && !value.includes('\n'));

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
      const signed = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
      const who = signed ? (await keys())(signed) : null;
      if (!who) return send(res, 401, undefined, { 'WWW-Authenticate': 'Bearer' });
      const url = new URL(req.url, 'http://home');
      if (who === 'agent' && !AGENT_ROUTES.includes(url.pathname)) return said(res, 403, 'This is the agent key. It reaches /vault/mcp and /cortex/mcp; the rest is the person\'s, through the app.');
      if (url.pathname === '/vault/mcp') return await vault(req, res);
      if (url.pathname === '/cortex/mcp') {
        const serve = await cortexReady();
        return serve ? await serve(req, res) : said(res, 404, 'This home has no cortex yet. Start one with: ohmmmm init <handle>');
      }
      if (url.pathname.startsWith('/cortex/')) {
        if (!await cortexReady()) return said(res, 404, 'This home has no cortex yet. Start one with: ohmmmm init <handle>');
        if (await cortexRoute(req, res, url)) return;
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
      if (url.pathname === '/vault/publish/plan' && req.method === 'POST') {
        const asked = await json(req, 16 * 1024);
        if (!asked || typeof asked.path !== 'string' || !words(asked.label, 100) || !words(asked.sublabel, 100)) return said(res, 400, 'A plan is { path, label?, sublabel? }');
        try {
          return send(res, 200, await planPublish({ vault: layout.vault, path: asked.path, label: asked.label, sublabel: asked.sublabel, config, password: env.ATPROTO_APP_PASSWORD }));
        } catch (problem) { return answered(res, problem); }
      }
      if (url.pathname === '/vault/publish' && req.method === 'POST') {
        const replaces = versionAsked(req);
        if (replaces === undefined) return said(res, 428, 'Say which version you read: If-Match: "<version>"');
        const asked = await json(req, 16 * 1024);
        if (!asked || typeof asked.path !== 'string' || typeof asked.confirm !== 'string' || !words(asked.label, 100) || !words(asked.sublabel, 100)) return said(res, 400, 'A publish is { path, confirm, label?, sublabel? }, confirm from the plan the person approved');
        try {
          return send(res, 200, await withCollectLock(layout.vault, DatabaseSync, () => publishAsPerson({
            vault: layout.vault, path: asked.path, replaces, label: asked.label, sublabel: asked.sublabel, confirm: asked.confirm, config, password: env.ATPROTO_APP_PASSWORD,
          })));
        } catch (problem) { return answered(res, problem); }
      }
      if (url.pathname === '/vault/unpublish' && req.method === 'POST') {
        const replaces = versionAsked(req);
        if (replaces === undefined) return said(res, 428, 'Say which version you read: If-Match: "<version>"');
        const asked = await json(req, 4 * 1024);
        if (!asked || typeof asked.path !== 'string' || typeof asked.to !== 'string') return said(res, 400, 'A take-down is { path, to }, to being private or friends');
        try {
          return send(res, 200, await withCollectLock(layout.vault, DatabaseSync, () => unpublishAsPerson({
            vault: layout.vault, path: asked.path, replaces, to: asked.to, config, password: env.ATPROTO_APP_PASSWORD,
          })));
        } catch (problem) { return answered(res, problem); }
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
          endpoints: { vault: '/vault/mcp', cortex: '/cortex/mcp', media: '/media/<cid>', files: '/vault/files', file: '/vault/file', journal: '/vault/journal', rename: '/vault/rename', visibility: '/vault/visibility', requests: '/vault/requests', publish: '/vault/publish', unpublish: '/vault/unpublish', cortexParts: '/cortex/parts', cortexJournal: '/cortex/journal' },
          publishing: { config: Boolean(await siteSettings(config).catch(() => null)), password: Boolean(env.ATPROTO_APP_PASSWORD) },
        });
      }
      return said(res, 404, 'Not here. The bridge serves /vault/mcp, /cortex/mcp, /vault/files, /vault/file, /vault/journal, /vault/rename, /vault/visibility, /vault/requests, /vault/publish, /vault/unpublish, /cortex/parts, /cortex/journal, /cortex/profile, /cortex/observation, /cortex/skill, /cortex/tool and /media/<cid>');
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

// ---- The commands ----
//   ohmmmm serve [--port 8766] [--app <origin>]… [--agent <name>] [--config <site configuration>] [--pair] [--new-keys]
//   ohmmmm pair  [--port 8766] [--app <origin>]…      one more browser, while the bridge runs

// Makes a key for one more browser and says how to pair it: one link for each app origin.
async function printPairing(layout, apps, url, { replace = false } = {}) {
  const key = await pairApp(layout.home, { replace, app: apps[0] });
  for (const app of apps) console.log(`Open this once, in the browser you use the app in, to pair it: ${pairingLink(app, url, key)}`);
  console.log('The link holds the key for that browser. It is shown only now; your home keeps no copy of it.');
}

const options = {
  port: { type: 'string' }, app: { type: 'string', multiple: true }, agent: { type: 'string' }, config: { type: 'string' },
  pair: { type: 'boolean' }, 'new-keys': { type: 'boolean' }, 'new-token': { type: 'boolean' },
};

async function command(args) {
  const [name, ...rest] = args[0] === 'serve' || args[0] === 'pair' ? args : ['serve', ...args];
  const { values } = parseArgs({ args: rest, options });
  const layout = findHome();
  if (!layout) throw new Error(`Run ohmmmm ${name} inside a home (ohmmmm.<handle>), or set OHMMMM_HOME.`);
  const port = values.port === undefined ? PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port is a port number');
  const apps = values.app?.length ? values.app.map(app => new URL(app).origin) : [APP];

  if (name === 'pair') {
    if (port === 0) throw new Error('Say the port the bridge listens on with --port');
    const url = `http://127.0.0.1:${port}`;
    await printPairing(layout, apps, url);
    const answering = await fetch(`${url}/`, { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
    if (!answering) console.log(`Nothing answers at ${url} yet. Start the bridge with: ohmmmm serve${port === PORT ? '' : ` --port ${port}`}`);
    return;
  }

  const sqlite = await import('node:sqlite');
  const renew = Boolean(values['new-keys'] || values['new-token']);
  const agentHeld = await agentKey(layout.home, { replace: renew });
  const paired = renew ? 0 : (await appKeys(layout.home)).length;
  const config = values.config ? resolve(values.config) : join(layout.home, SITE_CONFIG);
  const server = await listenHome(homeBridge({ layout, origins: apps, DatabaseSync: sqlite.DatabaseSync, agent: values.agent, config }), { port })
    .catch(problem => { throw new Error(problem.code === 'EADDRINUSE' ? `Port ${port} is in use. Choose another with --port.` : problem.message); });
  const url = `http://127.0.0.1:${server.address().port}`;
  console.log(`Serving ${layout.home} at ${url}, to this machine only.`);
  if (agentHeld.fromOldToken) console.log('Agents now have a key of their own: the key this home used for everything is now only theirs, and reaches only the vault\'s and the cortex\'s tools. Pair the app again with the link below.');
  if (renew) console.log('New keys: every browser paired before, and every agent given the old agent key, is shut out.');
  if (renew || values.pair || paired === 0) await printPairing(layout, apps, url, { replace: renew });
  else console.log(`The app is paired with ${paired === 1 ? 'one browser' : `${paired} browsers`}. To pair another, run: ohmmmm pair${server.address().port === PORT ? '' : ` --port ${server.address().port}`}`);
  console.log(`Agents: ${url}/vault/mcp and ${url}/cortex/mcp, with Authorization: Bearer <the agent key in ${join(layout.home, AGENT_KEY)}>. It reaches only those.`);
  const settings = await siteSettings(config).catch(problem => { console.log(`Publishing is off: ${problem.message}`); return undefined; });
  if (settings === null) console.log(`Publishing is off until there is a site configuration at ${config} (ohm configure).`);
  else if (settings && !process.env.ATPROTO_APP_PASSWORD) console.log('Publishing is off until ohmmmm serve is started with ATPROTO_APP_PASSWORD set.');
  else if (settings) console.log(`Publishing to ${settings.site}, as ${settings.did}, when you approve it in the app.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sqlite = await import('node:sqlite').catch(() => null);
  if (!sqlite && process.argv[2] !== 'pair') {
    if (process.execArgv.includes('--experimental-sqlite')) {
      console.error('This Node has no SQLite. Use Node 22.13 or newer.');
      process.exit(1);
    }
    const again = spawnSync(process.execPath, ['--experimental-sqlite', '--no-warnings=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
    process.exit(again.status ?? 1);
  }
  try {
    await command(process.argv.slice(2));
  } catch (problem) {
    console.error(problem.message);
    process.exitCode = 1;
  }
}
