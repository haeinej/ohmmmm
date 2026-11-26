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
//   /vault/keys        GET the paired browsers and the agents with keys; POST /self names this browser;
//                      DELETE /<id> forgets one browser
//   /cortex/…       the person's cortex for the app: its parts, its journal, and their changes (cortex-routes.mjs)
//   /               what this bridge serves
//
// It answers only this machine (it listens on 127.0.0.1, and a Host header naming anything else is
// refused, against DNS rebinding), only with one of the home's keys (`Authorization: Bearer`), and in a
// browser only to the app's origins and pages on this machine. A preflight, which carries no key,
// learns nothing but which headers it may send. The keys:
//
//   agents' keys    one for each agent, made with `ohmmmm agents add <name>` and shown once. It reaches
//                   /vault/mcp, /cortex/mcp and / only, and every session it opens is that agent,
//                   whatever the agent calls itself, so grants and the journal name it truly. Only
//                   its SHA-256 is kept (<home>/.ohmmmm/agent-keys.json).
//   app keys        one for each browser paired with the home. It reaches everything. Only its
//                   SHA-256 is kept (<home>/.ohmmmm/app-keys.json): the key itself is in the pairing
//                   link and in the paired browser, never in the home.
//   the shared agent key  <home>/.ohmmmm/agent-key, from before each agent had its own: reaches what an
//                   agent's key does, its sessions name themselves, and none may take a name an
//                   agent's own key holds. It is never made anew.
//
// A program that reads the home's files finds no key there but the shared one, if it is still kept.
// An MCP session answers only the key that opened it.
//
// MCP sessions are agents: each is named by its key (or, for the shared key and the app, by its
// client), and the vault's grants decide what it may change. /media and /vault/file are the person,
// through the app (app/src/data/local-source.ts): their writes are journaled `by: me`, `via: editor`, and every version is kept, so any of it can be restored.
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
import { createSiteTools, SITE_INSTRUCTIONS, SITE_TOOLS } from './site-mcp.mjs';
import { moveOldTools, watchTools } from './site-tools.mjs';
import { siteLive } from './site-live.mjs';
import { createLocalTools, HISTORY, LOCAL_INSTRUCTIONS, LOCAL_TOOLS, withCollectLock } from '../vault/mcp/local.mjs';
import { pdsConfig, webUrl } from '../vault/feed/pds.mjs';
import { signIn } from '../vault/scripts/rpc.mjs';
import { blobCid, FILE_TYPES, isSlug, recordVersion, VaultProblem } from '../vault/vault/core.mjs';
import { isPostId, setProperty, slugOf, writeNoteFile } from '../vault/vault/file.mjs';
import { CACHE, openIndex, scan, summary } from '../vault/vault/indexer.mjs';
import { appendEvents, keepVersion, readEvents } from '../vault/vault/journal.mjs';
import { CHANNEL_FILE, isChannelPath, newNodeId, nodeFile, readNode, SOURCES } from '../vault/vault/node.mjs';
import { blockPost, publishedAddresses } from '../vault/vault/publish-block.mjs';
import { memoryKv, ownStores, pdsStore } from '../vault/vault/stores.mjs';
import { createVault } from '../vault/vault/vault.mjs';
import { applyRename, planRename, readVaultFolder } from '../vault/vault/rename.mjs';
import { decideRequest, layerOf, publishedLayer, readRequests, withVisibility } from '../vault/vault/visibility-folder.mjs';
import { cortexRoutes } from './cortex-routes.mjs';
import { findHome } from './home.mjs';
import { isSiteRoute, siteRoutes } from './site.mjs';

export const PORT = 8766;
export const APP = 'https://app.ohmmmm.com';
export const AGENT_KEYS = '.ohmmmm/agent-keys.json';
export const KEYS_LOCK = '.ohmmmm/keys.lock';
export const APP_KEYS = '.ohmmmm/app-keys.json';
// The shared agent key, from before each agent had its own; it is never made anew.
export const AGENT_KEY = '.ohmmmm/agent-key';
// The one key the bridge had before agents had keys at all. It becomes the shared agent key.
export const OLD_TOKEN = '.ohmmmm/serve-token';
// What an agent's key reaches; every other route is the person's, through the app.
export const AGENT_ROUTES = ['/vault/mcp', '/cortex/mcp', '/site/mcp', '/site/activity', '/'];
export const SITE_CONFIG = 'ohm.jsonc';
export const MAX_IMAGE = 20 * 1024 * 1024;
export const IMAGE_TYPES = { 'image/avif': 'avif', 'image/gif': 'gif', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]', '::1'];
const CID = /^b[a-z2-7]{20,}$/;

// ---- The keys ----

const KEY_PART = /^[A-Za-z0-9_-]{20,200}$/;
// An agent's name, as the vault's journal and grants write it.
const AGENT_NAME = /^[A-Za-z0-9._-]{1,64}$/;
const newKey = kind => `ohm_${kind}_${randomBytes(32).toString('base64url')}`;
const sha256 = value => createHash('sha256').update(value).digest();
const readText = path => readFile(path, 'utf8').catch(problem => { if (problem.code !== 'ENOENT') throw problem; });
const keyProblem = (path, list) => new Error(`${path} is not JSON. Remove it and make the keys again (${list}).`);

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
// A list of keys kept as their SHA-256, in hex: [{ hash, made, … }].
async function readHashes(home, path, field, list) {
  const text = await readText(join(home, path));
  if (text === undefined) return [];
  let value;
  try { value = JSON.parse(text)?.[field]; } catch { throw keyProblem(join(home, path), list); }
  return Array.isArray(value) ? value.filter(each => /^[0-9a-f]{64}$/.test(each?.hash ?? '')) : [];
}
const writeHashes = (home, path, field, entries) => writePrivate(home, path, `${JSON.stringify({ [field]: entries }, null, 2)}\n`);

/**
 * Runs `work` while holding the keys' lock (.ohmmmm/keys.lock), so the bridge and the commands, in
 * other processes, never write the key files over each other's change. A lock left by a process that
 * died is taken after 30 seconds.
 */
export async function withKeysLock(home, work) {
  await mkdir(join(home, '.ohmmmm'), { recursive: true, mode: 0o700 });
  const lock = join(home, KEYS_LOCK);
  for (let waited = 0; ; waited += 25) {
    try {
      await writeFile(lock, `${process.pid}\n`, { flag: 'wx', mode: 0o600 });
      break;
    } catch (problem) {
      if (problem.code !== 'EEXIST') throw problem;
      const held = await stat(lock).catch(() => null);
      if (held && Date.now() - held.mtimeMs > 30_000) { await rm(lock, { force: true }); continue; }
      if (waited > 10_000) throw new Error(`The keys are locked (${lock}). If no ohmmmm command is running, remove that file.`);
      await new Promise(done => setTimeout(done, 25));
    }
  }
  try { return await work(); } finally { await rm(lock, { force: true }); }
}

/** The paired browsers' keys, as kept: `[{ hash, made, app?, name?, seen? }]`, each `hash` the key's SHA-256 in hex. */
export const appKeys = home => readHashes(home, APP_KEYS, 'keys', 'ohm pair');

/**
 * A key for one more browser: kept only as its SHA-256, and answered once, for the pairing link.
 * `replace` forgets every browser paired before. `app` notes which app origin it was made for.
 */
export async function pairApp(home, { replace = false, app } = {}) {
  const key = newKey('app');
  await withKeysLock(home, async () => {
    const kept = replace ? [] : await appKeys(home);
    await writeHashes(home, APP_KEYS, 'keys', [...kept, { hash: sha256(key).toString('hex'), made: new Date().toISOString(), ...(app ? { app } : {}) }]);
  });
  return key;
}

// ---- Paired browsers: seen, named, and forgotten one at a time ----

// A browser's ID, to tell it apart in lists: the start of its key's SHA-256, which says nothing of the key.
export const browserId = hash => hash.slice(0, 12);
const BROWSER_NAME = 80;

/** The paired browsers, for the person: `[{ id, made, app?, name?, seen? }]`, oldest first. */
export async function pairedBrowsers(home) {
  return (await appKeys(home)).map(({ hash, made, app, name, seen }) => ({ id: browserId(hash), made, ...(app ? { app } : {}), ...(name ? { name } : {}), ...(seen ? { seen } : {}) }));
}

// One browser's entry changed, under the lock: `change(entry)` answers the entry to keep, or null to forget it.
async function changeBrowser(home, match, change) {
  return withKeysLock(home, async () => {
    const kept = await appKeys(home);
    const found = kept.filter(match);
    if (found.length !== 1) return null;
    const next = change(found[0]);
    await writeHashes(home, APP_KEYS, 'keys', kept.flatMap(each => (each === found[0] ? (next ? [next] : []) : [each])));
    return { before: found[0], after: next };
  });
}

/** Forgets one paired browser by its ID: its key stops working at once. Answers whether there was one. */
export async function forgetBrowser(home, id) {
  if (!/^[0-9a-f]{12}$/.test(id ?? '')) return false;
  return Boolean(await changeBrowser(home, each => browserId(each.hash) === id, () => null));
}

/** Names the browser whose key has this SHA-256 (hex), as it says it is, such as "Chrome on macOS". */
export async function nameBrowser(home, hash, name) {
  const words = String(name ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, BROWSER_NAME);
  if (!words) throw new VaultProblem('Give the browser a name of one line.');
  const done = await changeBrowser(home, each => each.hash === hash, each => ({ ...each, name: words }));
  return done ? { id: browserId(hash), name: words } : null;
}

/** Notes when a browser was last used, at most once an hour, so a list can say which are still in use. */
export async function browserSeen(home, hash, now = new Date()) {
  await changeBrowser(home, each => each.hash === hash, each => {
    if (each.seen && now - new Date(each.seen) < 3_600_000) return each;
    return { ...each, seen: now.toISOString() };
  });
}

/** The agents with keys of their own, as kept: `[{ name, hash, made }]`. */
export const agentKeys = async home => (await readHashes(home, AGENT_KEYS, 'agents', 'ohm agents add <name>')).filter(each => AGENT_NAME.test(each.name ?? ''));

/**
 * A key of its own for the agent named, answered once: the person gives it to that agent, and the
 * home keeps only its SHA-256. Every session it opens is that agent, whatever the agent calls itself,
 * so the vault's grants and journal name it truly. An agent that has a key keeps it unless `replace`
 * asks for a new one, which shuts the old one out.
 */
export async function addAgent(home, name, { replace = false } = {}) {
  if (!AGENT_NAME.test(name ?? '')) throw new VaultProblem('An agent\'s name is 1 to 64 letters, digits, dots, hyphens or underscores, such as claude-code.');
  const kept = await agentKeys(home);
  if (!replace && kept.some(each => each.name === name)) throw new VaultProblem(`${name} has a key already. To give it a new one, which shuts the old one out: ohm agents add ${name} --new-key`);
  const near = kept.find(each => each.name !== name && each.name.toLowerCase() === name.toLowerCase());
  if (near) throw new VaultProblem(`${name} would be too easily taken for ${near.name}, which has a key. Use ${near.name}, or another name.`);
  const key = newKey('agent');
  await withKeysLock(home, async () => {
    const now = await agentKeys(home);
    await writeHashes(home, AGENT_KEYS, 'agents', [...now.filter(each => each.name !== name), { name, hash: sha256(key).toString('hex'), made: new Date().toISOString() }]);
  });
  return key;
}

/** Takes the named agent's key away. Answers whether it had one. */
export async function removeAgent(home, name) {
  return withKeysLock(home, async () => {
    const kept = await agentKeys(home);
    if (!kept.some(each => each.name === name)) return false;
    await writeHashes(home, AGENT_KEYS, 'agents', kept.filter(each => each.name !== name));
    return true;
  });
}

/**
 * The shared agent key, from before each agent had its own: the key a home's bridge once had for
 * everything (.ohmmmm/serve-token) becomes it, and that file goes. It is never made anew. Its sessions
 * name themselves, and cannot take the name of an agent that has its own key. Answers
 * `{ key, fromOldToken }`, or null when there is none.
 */
export async function sharedAgentKey(home) {
  const held = (await readText(join(home, AGENT_KEY)))?.trim();
  if (held && KEY_PART.test(held)) return { key: held, fromOldToken: false };
  const old = (await readText(join(home, OLD_TOKEN)))?.trim();
  if (!old || !KEY_PART.test(old)) return null;
  await writePrivate(home, AGENT_KEY, `${old}\n`);
  await rm(join(home, OLD_TOKEN), { force: true });
  return { key: old, fromOldToken: true };
}
export const removeSharedAgentKey = home => Promise.all([AGENT_KEY, OLD_TOKEN].map(path => rm(join(home, path), { force: true })));

/**
 * Who each key the bridge accepts is: `who(key)` answers `{ kind: 'app' }`, `{ kind: 'agent', name }`
 * for an agent's own key, `{ kind: 'agent', shared: true }` for the shared one, or null. The key's
 * SHA-256 is compared with every key's, in constant time. `reserved` lists the names agents' own keys hold.
 */
export async function homeKeys(home) {
  const shared = (await readText(join(home, AGENT_KEY)))?.trim();
  const keys = [
    ...(await appKeys(home)).map(each => ({ hash: Buffer.from(each.hash, 'hex'), who: { kind: 'app' } })),
    ...(await agentKeys(home)).map(each => ({ hash: Buffer.from(each.hash, 'hex'), who: { kind: 'agent', name: each.name } })),
    ...(shared && KEY_PART.test(shared) ? [{ hash: sha256(shared), who: { kind: 'agent', shared: true } }] : []),
  ];
  // Held names, by their lower case: a self-named session may not take one in any case.
  const reserved = new Map(keys.filter(each => each.who.name).map(each => [each.who.name.toLowerCase(), each.who.name]));
  const who = key => {
    const presented = sha256(String(key));
    let found = null;
    // Every key is compared, so the time taken says nothing about which one was near.
    for (const each of keys) if (timingSafeEqual(presented, each.hash) && !found) found = each.who;
    return found;
  };
  return Object.assign(who, { reserved });
}

/** The link that pairs the app with this bridge. The key rides in the fragment, which a browser never sends to a server. */
export const pairingLink = (app, url, key) => `${app}/#bridge=${encodeURIComponent(url)}&token=${encodeURIComponent(key)}`;

// ---- Sessions ----

// An agent's name, as the vault's journal and grants write it.
const agentOf = given => (typeof given === 'string' ? given.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) : '') || 'agent';

/**
 * What a session is named. An agent's own key names it; otherwise (the shared agent key, or the app)
 * its initialize does, or `fixed` (--agent). A name one of the agents' own keys holds is refused to
 * the shared key: `refused` is then the message to answer with.
 */
function sessionName(caller, message, fixed) {
  if (caller?.name) return { name: caller.name };
  const name = agentOf(fixed ?? message?.params?.clientInfo?.name);
  const held = caller?.shared && caller.reserved?.get(name.toLowerCase());
  if (held) return { name, refused: `${held} has a key of its own. Connect with that key; the shared agent key cannot use its name.` };
  return { name };
}
const refusal = (message, text) => ({ jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32001, message: text } });

// Each MCP session on /vault/mcp: the local tools, for the agent the session is.
const vaultSessions = (vault, DatabaseSync, fixed, callerOf) => req => {
  const caller = callerOf(req);
  let agent = agentOf(caller?.name ?? fixed);
  const handle = mcpServer({ tools: () => createLocalTools({ vault, by: `agent:${agent}`, DatabaseSync }), list: LOCAL_TOOLS, instructions: LOCAL_INSTRUCTIONS });
  return message => {
    if (message?.method === 'initialize') {
      const named = sessionName(caller, message, fixed);
      if (named.refused) return refusal(message, named.refused);
      agent = named.name;
    }
    return handle(message);
  };
};

// Each MCP session on /site/mcp: the website's tools (home/site-mcp.mjs), for the agent the session is.
const siteSessions = (dir, fixed, callerOf, live) => req => {
  const caller = callerOf(req);
  let agent = agentOf(caller?.name ?? fixed);
  const handle = mcpServer({ tools: () => createSiteTools({ dir, agent, live }), list: SITE_TOOLS, name: 'ohm-site', instructions: SITE_INSTRUCTIONS });
  return message => {
    if (message?.method === 'initialize') {
      const named = sessionName(caller, message, fixed);
      if (named.refused) return refusal(message, named.refused);
      agent = named.name;
    }
    live?.agentSeen(agent);
    return handle(message);
  };
};

// Each MCP session on /cortex/mcp, as `cortex serve` makes them, for the agent the session is.
const cortexSessionsFor = (dir, fixed, callerOf) => req => {
  const caller = callerOf(req);
  let inner;
  return message => {
    if (!inner) {
      const named = sessionName(caller, message?.method === 'initialize' ? message : undefined, fixed);
      if (named.refused) return refusal(message, named.refused);
      // An agent's own key, or --agent, names every message; otherwise the cortex takes the client's name.
      inner = cortexSessions(dir, { agent: caller?.name ?? fixed })();
    }
    return inner(message);
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
const keep = (vault, text) => keepVersion(vault, text);

/**
 * Writes one file as the person, only over the version it was read at: `replaces` is that version,
 * or null for a file that must not exist yet. `text` undefined removes it. Returns the new version.
 * A file that already says `text` (or is already gone, for a removal) is left as it is and answered
 * `unchanged`, whatever `replaces` says, so the same change tried again after its answer was lost
 * is not refused. Refusals carry the HTTP status they answer with: 412 when the file is not at that
 * version any more.
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
  if (text === undefined && before === undefined) return { path, removed: true, unchanged: true };
  if (text !== undefined && before === text) return { path, version: now, created: false, unchanged: true };
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
 * The same rename tried again after it stopped part-way finishes what is left (planRename's `events`).
 */
export async function renameAsPerson({ vault, change }) {
  const { files, paths } = await readVaultFolder(vault, { open: path => inVault(vault, path) });
  const plan = planRename(files, change.block === undefined
    ? { channel: change.channel, to: change.to }
    : { block: change.block, ...(change.slug === undefined ? {} : { slug: change.slug }), ...(change.title === undefined ? {} : { title: change.title }), ...(change.home === undefined ? {} : { channel: change.home }) }, { paths, events: (await readEvents(vault)).events });
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
  const was = layerOf(path, before);
  const text = withVisibility(path, before, to);
  // Already where it goes, as when the same move is tried again: nothing to refuse or write.
  if (text === before) return { path, text, version, layer: to, unchanged: true };
  if (replaces !== undefined && replaces !== version) throw Object.assign(new Error('The file changed since it was read'), { status: 412, version });
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
  if (!password) needs.push({ what: 'password', say: 'Start ohm serve with ATPROTO_APP_PASSWORD set to an app password for your account. It stays on this computer.' });
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

// Whether the file is at the version the person read, or was taken from it only by an earlier try of
// this same publish: its ID written (a `changed` with the `key`), then marked public. So a publish
// tried again, after its answer was lost or a step after the post failed, is still the one they approved.
async function publishedFrom(vault, path, replaces, version) {
  if (version === replaces) return true;
  let at = replaces;
  for (const event of (await readEvents(vault)).events) {
    if (event.path !== path || event.via !== 'publish' || event.op !== 'changed' || event.before !== at) continue;
    if (event.key || event.layer === 'public') at = event.hash;
  }
  return at === version;
}

// Whether the post held on the PDS already says what publishing would write: the same fields, and the
// same files under the same IDs. Its dates aside.
async function holdsPost(held, post) {
  const fields = ({ media: _, publishedAt: __, updatedAt: ___, ...rest }) => recordVersion(rest);
  const files = list => recordVersion(list.map(([id, cid]) => [id, cid]).sort((a, b) => a[0].localeCompare(b[0])));
  return await fields(held) === await fields(post.record)
    && await files((held.media ?? []).map(item => [item?.id, item?.file?.ref?.$link])) === await files(post.attachments.map(each => [each.id, each.cid]));
}

/**
 * Publishes a block as the person, over the version read (`replaces`) and only as the plan they saw
 * (`confirm`, from planPublish). A block with no ID is given one, written into its file before
 * anything reaches the PDS, so a publish tried again uses the same key and never makes a second post.
 * Then the post goes to their PDS under the block's ID, the file is marked public, and the label is
 * saved on the block's channel when it is new. Journaled `changed` (`via: publish`, `key`) for the
 * ID, `changed` (`via: publish`, `layer`, `was`) and `published` (`key`, `address`). An update
 * keeps the post's address, label and date. Tried again over the same version and plan, it finishes
 * what the first try left undone, and answers what that try did once the post is already there.
 */
export async function publishAsPerson({ vault, path, replaces, label, sublabel, confirm, config, password = process.env.ATPROTO_APP_PASSWORD, get = fetch, token }) {
  const settings = await siteSettings(config);
  const needs = needsOf({ settings, config, password });
  if (needs.length) throw new VaultProblem(needs.map(need => need.say).join(' '));
  let read = await readForPublish({ vault, path, settings, get, key: newNodeId() });
  if (!await publishedFrom(vault, path, replaces, read.version)) throw Object.assign(fail('The file changed since it was read', 412), { version: read.version });
  const plan = held => blockPost({
    files: read.files, paths: read.paths, path, read: readBytes(vault), label, sublabel, key: read.key,
    held, addresses: read.addresses, ...settings,
  });
  let post = await plan(read.published?.record);
  if (post.problems.length) throw new VaultProblem(post.problems.join('\n'));
  // Tried again after the first try wrote the post: the plan the person saw was for a new post.
  let written = null;
  if (post.confirm !== confirm && read.published && read.version !== replaces) {
    const first = await plan(undefined);
    if (first.confirm === confirm && await holdsPost(read.published.record, post)) {
      written = read.published;
      post = first;
    }
  }
  if (post.confirm !== confirm) throw new VaultProblem('It changed since you saw the plan. Look at it again before publishing.');
  const session = token ?? signedIn(settings, password);
  if (!written && typeof session === 'function') await session();

  const was = layerOf(path, read.text);
  const at = new Date().toISOString();
  const events = [];
  // Each file this publish wrote, once, as it is at the end.
  const changed = [];
  const wrote = file => changed.splice(changed.some(each => each.path === file.path) ? changed.findIndex(each => each.path === file.path) : changed.length, 1, file);
  // The ID first, in the file and the journal, so the key is kept whatever happens next.
  if (!read.node.id) {
    const done = await writePublished(vault, path, read.text, setProperty(read.text, 'id', read.key), { key: read.key });
    await appendEvents(vault, [{ at, ...done.event }]);
    wrote(done.file);
    read = { ...read, text: done.file.text, version: done.file.version };
  }
  written ??= await publicVault(settings, { get, token: session }).save({
    key: read.key, record: post.record, visibility: 'public', files: post.files,
    ...(read.published ? { version: read.published.version } : {}),
  });

  // The file, marked public.
  const text = publishedLayer(path, read.text, 'public');
  if (text !== read.text) {
    const done = await writePublished(vault, path, read.text, text, { layer: 'public', was });
    events.push({ at, ...done.event });
    wrote(done.file);
  }
  // The label, kept on the channel for next time.
  const home = read.node.home;
  const first = !read.published || written === read.published;
  if (home && first && !post.labelSaved && post.label) {
    const channel = `${home}/${CHANNEL_FILE}`;
    const before = read.files.find(file => file.path === channel)?.text;
    const site = { label: post.label, ...(post.sublabel ? { sublabel: post.sublabel } : {}) };
    const after = before === undefined
      ? nodeFile({ type: 'channel', path: home, order: [], description: '', properties: {}, site, id: newNodeId() }).text
      : setProperty(before, 'site', site);
    if (after !== before) {
      const done = await writePublished(vault, channel, before, after, {});
      events.push({ at, ...done.event });
      wrote(done.file);
    }
  }
  const last = changed.find(file => file.path === path)?.version ?? read.version;
  const journal = written === read.published ? (await readEvents(vault)).events : [];
  if (!journal.some(event => event.op === 'published' && event.path === path && event.key === read.key && event.record === written.version)) {
    events.push({ at, op: 'published', root: 'vault', path, by: 'me', via: 'publish', key: read.key, address: post.address, record: written.version, hash: last });
  }
  await appendEvents(vault, events);
  // Tried again with nothing left to do: the block and its channel as the first try left them.
  if (written === read.published && !changed.length) {
    for (const each of [path, ...(home ? [`${home}/${CHANNEL_FILE}`] : [])]) {
      const held = read.files.find(file => file.path === each);
      if (held) changed.push({ path: each, text: held.text, version: await versionOf(held.text) });
    }
  }
  return { path, key: read.key, address: post.address, update: Boolean(read.published) && written !== read.published, files: changed };
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
 * machine are allowed too). `agent`, when given, names every MCP session an agent's own key does not
 * (the shared agent key's, and the app's). The home's keys are read
 * on each request (`keys`, homeKeys by default), so a browser paired with `ohmmmm pair` is let in
 * without a restart, and a key replaced stops working at once.
 * `config` is the site configuration Publish uses; `env` holds ATPROTO_APP_PASSWORD, read when needed.
 */
export function homeBridge({ layout, origins = [APP], DatabaseSync, agent, config = join(layout.home, SITE_CONFIG), env = process.env, keys = () => homeKeys(layout.home) }) {
  const allowed = origin => origins.includes(origin) || isLoopbackOrigin(origin);
  // Who signed each request: its key's kind, the agent it names, and the key's own hash, which binds
  // an MCP session to the key that opened it.
  const callers = new WeakMap();
  const seenAt = new Map();
  const callerOf = req => callers.get(req);
  const owner = req => callers.get(req)?.owner;
  const vault = httpTransport({ open: vaultSessions(layout.vault, DatabaseSync, agent, callerOf), origins, endpoint: '/vault/mcp', owner });
  const live = layout.site ? siteLive(layout.site) : null;
  // Tools are folders beside the site, written by the person's agent; new ones go on the canvas.
  const tools = layout.site ? watchTools(layout.site, live) : null;
  if (layout.site) void moveOldTools(layout.site).catch(() => {});
  const siteMcp = layout.site ? httpTransport({ open: siteSessions(layout.site, agent, callerOf, live), origins, endpoint: '/site/mcp', owner }) : null;
  let cortex;
  const cortexReady = async () => (cortex ??= (await stat(join(layout.cortex, 'agents', 'AGENTS.md')).catch(() => null))
    ? httpTransport({ open: cortexSessionsFor(layout.cortex, agent, callerOf), origins, endpoint: '/cortex/mcp', owner }) : undefined);

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
  // The person's website, `site/` in their ohm (home/site.mjs). An app key's alone, like every route outside AGENT_ROUTES.
  const siteRoute = layout.site ? siteRoutes({ layout, send, said, body, live }) : null;
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
      const known = signed ? await keys() : null;
      const who = known?.(signed) ?? null;
      if (!who) return send(res, 401, undefined, { 'WWW-Authenticate': 'Bearer' });
      callers.set(req, { ...who, reserved: known.reserved, owner: createHash('sha256').update(signed).digest('hex') });
      const url = new URL(req.url, 'http://home');
      if (who.kind === 'agent' && !AGENT_ROUTES.includes(url.pathname)) return said(res, 403, 'This key is an agent\'s. It reaches /vault/mcp, /cortex/mcp and /site/mcp; the rest is the person\'s, through the app.');
      const mine = callers.get(req).owner;
      // When a browser was last used, noted at most once an hour, so the person can tell which are still in use.
      if (who.kind === 'app' && Date.now() - (seenAt.get(mine) ?? 0) > 3_600_000) {
        seenAt.set(mine, Date.now());
        await browserSeen(layout.home, mine).catch(() => {});
      }
      // What an agent's own hooks say it is doing (the ohm plugin): its presence, and the files it edits.
      if (url.pathname === '/site/activity') {
        if (req.method !== 'POST') return said(res, 405, 'POST what you are doing');
        if (!live) return said(res, 404, 'No site');
        if (who.kind !== 'agent') return said(res, 403, 'Only an agent says what it is doing');
        const said_ = await json(req, 16_384);
        if (!said_ || typeof said_ !== 'object') return said(res, 400, 'Send { event, tool, path }');
        return send(res, 200, live.activity(agentOf(who.name ?? agent), said_));
      }
      // The site's MCP is the agents' own door, not one of the site's routes for the app.
      if (siteRoute && isSiteRoute(url.pathname) && url.pathname !== '/site/mcp') {
        if (await siteRoute(req, res, url)) return;
        return said(res, 404, 'Not a step of the site');
      }
      if (url.pathname === '/vault/keys' && req.method === 'GET') {
        const shared = await readText(join(layout.home, AGENT_KEY));
        return send(res, 200, {
          browsers: (await pairedBrowsers(layout.home)).map(each => (each.id === browserId(mine) ? { ...each, you: true } : each)),
          agents: (await agentKeys(layout.home)).map(({ name, made }) => ({ name, made })),
          shared: shared !== undefined,
        });
      }
      if (url.pathname === '/vault/keys/self' && req.method === 'POST') {
        const asked = await json(req, 4 * 1024);
        if (typeof asked?.name !== 'string' || asked.name.length > 200) return said(res, 400, 'Name this browser with { name }, one line');
        const named = await nameBrowser(layout.home, mine, asked.name);
        return named ? send(res, 200, named) : said(res, 404, 'This browser is not paired any more');
      }
      const forgetting = /^\/vault\/keys\/([0-9a-f]{12})$/.exec(url.pathname);
      if (forgetting && req.method === 'DELETE') {
        if (!await forgetBrowser(layout.home, forgetting[1])) return said(res, 404, 'No paired browser has that ID');
        return send(res, 200, { forgotten: forgetting[1], you: forgetting[1] === browserId(mine) });
      }
      if (url.pathname === '/vault/mcp') return await vault(req, res);
      if (url.pathname === '/site/mcp') return siteMcp ? await siteMcp(req, res) : said(res, 404, 'This ohm has no site yet. Connect one with: ohm site connect <your repository>');
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
          // Decided already (the answer was lost): the same decision answers the request, another is refused. Nothing moves again.
          if (request.status !== 'waiting') return { request: await decideRequest(layout.vault, request.id, decision.approve ? 'approved' : 'declined') };
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
          // Who the key that asked is: the app, an agent by the name its key holds, or the shared agent key.
          you: who.kind === 'app' ? { app: true } : who.name ? { agent: who.name } : { agent: null, shared: true },
          endpoints: { vault: '/vault/mcp', cortex: '/cortex/mcp', media: '/media/<cid>', files: '/vault/files', file: '/vault/file', journal: '/vault/journal', rename: '/vault/rename', visibility: '/vault/visibility', requests: '/vault/requests', publish: '/vault/publish', unpublish: '/vault/unpublish', keys: '/vault/keys', cortexParts: '/cortex/parts', cortexJournal: '/cortex/journal' },
          publishing: { config: Boolean(await siteSettings(config).catch(() => null)), password: Boolean(env.ATPROTO_APP_PASSWORD) },
        });
      }
      return said(res, 404, 'Not here. The bridge serves /vault/mcp, /cortex/mcp, /vault/files, /vault/file, /vault/journal, /vault/rename, /vault/visibility, /vault/requests, /vault/publish, /vault/unpublish, /vault/keys, /cortex/parts, /cortex/journal, /cortex/profile, /cortex/observation, /cortex/skill, /cortex/tool and /media/<cid>');
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
//   ohmmmm agents [list] | add <name> [--new-key] [--port 8766] | remove <name> | remove --shared
//   ohmmmm browsers [list] | forget <id>                the paired browsers, and forgetting one

const COMMANDS = ['serve', 'pair', 'agents', 'browsers'];
const day = iso => (iso ? iso.slice(0, 10) : '');

// Makes a key for one more browser and says how to pair it: one link for each app origin.
async function printPairing(layout, apps, url, { replace = false } = {}) {
  const key = await pairApp(layout.home, { replace, app: apps[0] });
  for (const app of apps) console.log(`Open this once, in the browser you use the app in, to pair it: ${pairingLink(app, url, key)}`);
  console.log('The link holds the key for that browser. It is shown only now; your home keeps no copy of it.');
}

// Who has a key to give agents' tools, in a line or two.
async function printAgents(layout, port) {
  const own = await agentKeys(layout.home);
  const shared = await readText(join(layout.home, AGENT_KEY));
  const url = `http://127.0.0.1:${port}`;
  console.log(`Agents: ${url}/vault/mcp, ${url}/cortex/mcp and ${url}/site/mcp (your website), each with its own key, which reaches only those. ${own.length ? `With keys: ${own.map(each => each.name).join(', ')}.` : 'No agent has a key yet.'} To give one: ohm agents add <name>`);
  if (shared !== undefined) console.log(`The shared agent key (${join(layout.home, AGENT_KEY)}) still opens agents' tools, and agents using it name themselves. Give each its own key, then: ohm agents remove --shared`);
}

const options = {
  port: { type: 'string' }, app: { type: 'string', multiple: true }, agent: { type: 'string' }, config: { type: 'string' },
  pair: { type: 'boolean' }, 'new-keys': { type: 'boolean' }, 'new-token': { type: 'boolean' }, 'new-key': { type: 'boolean' }, shared: { type: 'boolean' },
};

async function command(args) {
  const [name, ...rest] = COMMANDS.includes(args[0]) ? args : ['serve', ...args];
  const { values, positionals } = parseArgs({ args: rest, options, allowPositionals: name === 'agents' || name === 'browsers' });
  const layout = findHome();
  if (!layout) throw new Error(`Run ohm ${name} inside your ohm (a folder named ohm.<handle>), or set OHMMMM_HOME.`);
  const port = values.port === undefined ? PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port is a port number');
  const apps = values.app?.length ? values.app.map(app => new URL(app).origin) : [APP];

  if (name === 'pair') {
    if (port === 0) throw new Error('Say the port the bridge listens on with --port');
    const url = `http://127.0.0.1:${port}`;
    await printPairing(layout, apps, url);
    const answering = await fetch(`${url}/`, { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
    if (!answering) console.log(`Nothing answers at ${url} yet. Start the bridge with: ohm serve${port === PORT ? '' : ` --port ${port}`}`);
    return;
  }

  if (name === 'browsers') {
    const [action = 'list', id] = positionals;
    if (action === 'list') {
      const browsers = await pairedBrowsers(layout.home);
      for (const each of browsers) console.log([each.id, each.name ?? 'a browser not named yet', `paired ${day(each.made)}`, each.seen ? `last used ${day(each.seen)}` : 'not used since it was paired', each.app ?? ''].filter(Boolean).join('\t'));
      if (!browsers.length) console.log('No browser is paired. Pair one with: ohm pair');
      return;
    }
    if (action === 'forget') {
      if (!id) throw new Error('Say which browser, by the ID ohm browsers shows: ohm browsers forget <id>');
      console.log(await forgetBrowser(layout.home, id) ? `Forgotten: that browser can no longer open your home. To use it again, pair it with: ohm pair` : `No paired browser has the ID ${id}. See them with: ohm browsers`);
      return;
    }
    throw new Error('ohm browsers [list] | forget <id>');
  }

  if (name === 'agents') {
    const [action = 'list', agent] = positionals;
    if (action === 'list') {
      const own = await agentKeys(layout.home);
      for (const each of own) console.log(`${each.name}\tkey made ${each.made}`);
      if (!own.length) console.log('No agent has a key of its own yet. Give one: ohm agents add <name>');
      if (await readText(join(layout.home, AGENT_KEY)) !== undefined) console.log('(the shared agent key)\tagents using it name themselves; remove it with: ohm agents remove --shared');
      return;
    }
    if (action === 'add') {
      const key = await addAgent(layout.home, agent, { replace: Boolean(values['new-key']) });
      const url = `http://127.0.0.1:${port}`;
      console.log(`${agent}'s key, shown only now (your home keeps only its fingerprint):\n\n  ${key}\n`);
      console.log(`Give it to ${agent} with the bridge's MCP endpoints, ${url}/vault/mcp and ${url}/cortex/mcp, as the header Authorization: Bearer <key>. Every session it opens is ${agent}: your grants for ${agent} apply (ohm vault grant ${agent} …), and the journal says it was ${agent}.`);
      if (values['new-key']) console.log(`The key ${agent} had before no longer works.`);
      return;
    }
    if (action === 'remove') {
      if (values.shared) {
        await removeSharedAgentKey(layout.home);
        console.log('The shared agent key is gone. Agents still using it are shut out; each needs its own: ohm agents add <name>');
        return;
      }
      if (!agent) throw new Error('Say which agent: ohm agents remove <name>, or --shared for the shared agent key');
      console.log(await removeAgent(layout.home, agent) ? `${agent}'s key no longer works.` : `${agent} has no key of its own.`);
      return;
    }
    throw new Error('ohm agents [list] | add <name> [--new-key] | remove <name> | remove --shared');
  }

  const sqlite = await import('node:sqlite');
  const renew = Boolean(values['new-keys'] || values['new-token']);
  if (renew) {
    await removeSharedAgentKey(layout.home);
    await withKeysLock(layout.home, () => writeHashes(layout.home, AGENT_KEYS, 'agents', []));
  }
  const shared = renew ? null : await sharedAgentKey(layout.home);
  const paired = renew ? 0 : (await appKeys(layout.home)).length;
  const config = values.config ? resolve(values.config) : join(layout.home, SITE_CONFIG);
  const server = await listenHome(homeBridge({ layout, origins: apps, DatabaseSync: sqlite.DatabaseSync, agent: values.agent, config }), { port })
    .catch(problem => { throw new Error(problem.code === 'EADDRINUSE' ? `Port ${port} is in use. Choose another with --port.` : problem.message); });
  const at = server.address().port;
  const url = `http://127.0.0.1:${at}`;
  console.log(`Serving ${layout.home} at ${url}, to this machine only.`);
  if (shared?.fromOldToken) console.log('The key this home used for everything now opens only agents\' tools: it is the shared agent key. Pair the app again with the link below.');
  if (renew) console.log('New keys: every browser paired before, and every agent\'s key, is shut out. Give agents new keys with: ohm agents add <name>');
  if (renew || values.pair || paired === 0) await printPairing(layout, apps, url, { replace: renew });
  else console.log(`The app is paired with ${paired === 1 ? 'one browser' : `${paired} browsers`}. To pair another, run: ohm pair${at === PORT ? '' : ` --port ${at}`}. To see or forget them: ohm browsers, or Settings › Collections in the app.`);
  await printAgents(layout, at);
  const settings = await siteSettings(config).catch(problem => { console.log(`Posting blocks to your PDS is off: ${problem.message}`); return undefined; });
  if (settings === null) console.log(`Posting blocks to your PDS is off until there is a site configuration at ${config} (ohm configure). Publishing your website from the Site view does not need it.`);
  else if (settings && !process.env.ATPROTO_APP_PASSWORD) console.log('Posting blocks to your PDS is off until ohm serve is started with ATPROTO_APP_PASSWORD set. Publishing your website from the Site view does not need it.');
  else if (settings) console.log(`Publishing to ${settings.site}, as ${settings.did}, when you approve it in the app.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sqlite = await import('node:sqlite').catch(() => null);
  if (!sqlite && !['pair', 'agents', 'browsers'].includes(process.argv[2])) {
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
