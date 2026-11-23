// Channels: the member's channel files, kept readable on the vault service, and the inbox actions
// that file a proposed block into one.
//
// A channel is the file `_channel.md` in its folder: its title, kind, order and description. It is
// sent as `{ path, text }`, where `path` is the channel's path (`writing`, `photographs/seoul`), and
// kept exactly as sent, so the member's folder and the service hold the same file. Like a
// friends-only block, a channel kept here can be read by the service. A private channel, and where a
// mixed channel's private blocks go in its order (the private overlay), are sealed on the member's
// device and kept with the private layer (./private.mjs), never here.
//
// Every write names the version it replaces, and the database checks it in the statement that makes
// the change. A move changes a channel, every channel inside it, and every friends-only block filed
// in or listed under them, in one batch: all of it happens or none of it does.
//
// `db` has the shape of a Cloudflare D1 database.
import { recordVersion } from '../../vault/core.mjs';
import { setProperty } from '../../vault/file.mjs';
import { CHANNEL_FILE, isChannelPath, readNode } from '../../vault/node.mjs';
import { blockStore } from './blocks.mjs';
import { Refused } from './store.mjs';

const PAGE = 1000;
const LARGEST = 200_000;
export const INBOX = 'inbox';

// A channel's version: a name for exactly its path and text.
export const channelVersion = ({ path, text }) => recordVersion({ path, text, type: 'channel' });

const under = (path, root) => path === root || path.startsWith(`${root}/`);
const moved = (path, from, to) => to + path.slice(from.length);

// The channel a file is, if it may be kept here. Refused with every reason if not.
export function channelFile(given) {
  const { path, text, ...more } = given ?? {};
  const refuse = message => { throw new Refused(400, 'InvalidChannel', message); };
  if (Object.keys(more).length) refuse(`A channel is sent as path and text, and nothing else: ${Object.keys(more).join(', ')}`);
  if (!isChannelPath(path)) refuse('Say which channel with its path: folders joined by "/", none starting with "." or "_"');
  if (typeof text !== 'string') refuse('A channel is sent with the text of its _channel.md');
  if (new TextEncoder().encode(text).length > LARGEST) throw new Refused(413, 'TooLarge', 'A channel file can be at most 200 KB');
  const read = readNode(`${path}/${CHANNEL_FILE}`, text);
  if (!read?.node || read.node.type !== 'channel') refuse(`${path} is not a channel's file`);
  const { node, problems } = read;
  if (node.properties?.visibility === 'private') refuse('A private channel is never kept readable here. Seal it on your device and keep it with the private layer');
  if (path === INBOX && node.kind && node.kind !== 'inbox') refuse('The inbox channel is of kind inbox');
  if (problems.length) refuse(problems.join('\n'));
  return { path, text, node };
}

export function channelStore(db) {
  const blocks = blockStore(db);
  const current = (did, path) => db.prepare('SELECT version, text, seq FROM channels WHERE did = ?1 AND path = ?2').bind(did, path).first();
  const next = '(SELECT COALESCE(MAX(seq), 0) + 1 FROM channels WHERE did = ?1)';
  const changed = (path, held) => new Refused(409, 'Changed', 'The channel has changed since the version this request names', { path, current: held?.version ?? null });
  const known = path => isChannelPath(path) ? path : (() => { throw new Refused(400, 'InvalidChannel', 'Say which channel with its path'); })();
  // A statement that fails its batch when `violated` (SQL) holds, by inserting a row the guard refuses.
  const guard = (violated, ...values) => db.prepare(`INSERT INTO guard (ok) SELECT 0 WHERE ${violated}`).bind(...values);
  const runBatch = async statements => {
    try {
      await db.batch(statements);
      return true;
    } catch (problem) {
      if (/CHECK constraint failed/i.test(String(problem?.message))) return false;
      throw problem;
    }
  };
  // Posts are filed by label and sublabel, and their published address comes from them.
  const postsIn = async (did, path) => {
    const { results } = await db.prepare('SELECT label, sublabel FROM posts WHERE did = ?1 AND version IS NOT NULL').bind(did).all();
    return results.filter(row => under([row.label, row.sublabel].filter(Boolean).join('/'), path)).length;
  };
  const blocksIn = async (did, path) => {
    const { results } = await db.prepare('SELECT id, version, path, text FROM blocks WHERE did = ?1 AND version IS NOT NULL').bind(did).all();
    return results.flatMap(row => {
      const node = readNode(row.path, row.text)?.node;
      const listed = (node?.channels ?? []).filter(channel => under(channel, path));
      const home = under(row.path.split('/').slice(0, -1).join('/'), path);
      return home || listed.length ? [{ ...row, home, channels: node?.channels ?? [] }] : [];
    });
  };

  return {
    // Every channel kept here, or with `since`, everything that changed after that point, removals included.
    async list(did, { since } = {}) {
      const after = since === undefined ? 0 : Number(since);
      if (!Number.isSafeInteger(after) || after < 0) throw new Refused(400, 'InvalidCursor', 'since is a value an earlier list returned');
      const { results } = await db.prepare(
        `SELECT path, version, title, kind, seq FROM channels
         WHERE did = ?1 AND seq > ?2 ${since === undefined ? 'AND version IS NOT NULL' : ''} ORDER BY seq LIMIT ${PAGE + 1}`,
      ).bind(did, after).all();
      const page = results.slice(0, PAGE);
      const latest = page.length ? page.at(-1).seq
        : since !== undefined ? after
        : (await db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM channels WHERE did = ?1').bind(did).first()).seq;
      return {
        channels: page.map(row => row.version === null ? { path: row.path, removed: true } : {
          path: row.path, version: row.version, ...(row.title ? { title: row.title } : {}), ...(row.kind ? { kind: row.kind } : {}),
        }),
        cursor: String(latest),
        ...(results.length > PAGE ? { more: true } : {}),
      };
    },

    async read(did, path) {
      const held = await current(did, known(path));
      if (!held || held.version === null) throw new Refused(404, 'NotFound', 'There is no such channel');
      return { channel: { path, text: held.text }, version: held.version };
    },

    // `replaces` is the version being replaced, and nothing for a channel that is new.
    async write(did, given, { replaces = null, now = new Date() } = {}) {
      const { path, text, node } = channelFile(given);
      const version = await channelVersion({ path, text });
      const held = await current(did, path);
      const was = held?.version ?? null;
      if (was === version) return { path, version, unchanged: true };
      if (was !== replaces) throw changed(path, held);
      const written = await db.prepare(
        `INSERT INTO channels (did, path, version, title, kind, text, seq, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ${next}, ?7, ?7)
         ON CONFLICT (did, path) DO UPDATE SET version = excluded.version, title = excluded.title, kind = excluded.kind,
           text = excluded.text, seq = excluded.seq, updated_at = excluded.updated_at
         WHERE channels.version IS ?8
         RETURNING seq`,
      ).bind(did, path, version, node.title ?? null, node.kind ?? null, text, now.toISOString(), replaces).first();
      if (!written) throw changed(path, await current(did, path));
      return { path, version };
    },

    // A channel is removed only when nothing is filed in it: its blocks and posts go somewhere first.
    async remove(did, path, { replaces = null, now = new Date() } = {}) {
      const held = await current(did, known(path));
      if (!held || held.version === null) return { path, removed: true, unchanged: true };
      if (held.version !== replaces) throw changed(path, held);
      const filed = (await blocksIn(did, path)).filter(row => row.home).length + await postsIn(did, path);
      if (filed) throw new Refused(409, 'NotEmpty', `${filed} block${filed === 1 ? ' is' : 's are'} filed in ${path}. Move ${filed === 1 ? 'it' : 'them'} first`, { path });
      const inside = await db.prepare(`SELECT 1 AS yes FROM channels WHERE did = ?1 AND path LIKE ?2 || '/%' AND version IS NOT NULL`).bind(did, path).first();
      if (inside) throw new Refused(409, 'NotEmpty', `${path} has channels inside it. Move or remove them first`, { path });
      const gone = await db.prepare(
        `UPDATE channels SET version = NULL, title = NULL, kind = NULL, text = NULL, seq = ${next}, updated_at = ?3
         WHERE did = ?1 AND path = ?2 AND version IS ?4 RETURNING seq`,
      ).bind(did, path, now.toISOString(), replaces).first();
      if (!gone) throw changed(path, await current(did, path));
      return { path, removed: true };
    },

    // Moves a channel and everything inside it to another path. `replaces` is the channel's version,
    // or nothing when it is only a folder with no _channel.md. Posts filed in it are refused: their
    // addresses come from their label and sublabel, and change only through Publish.
    async move(did, from, to, { replaces = null, now = new Date() } = {}) {
      known(from); known(to);
      if (from === to) return { from, to, unchanged: true };
      if (under(to, from)) throw new Refused(400, 'InvalidChannel', 'A channel cannot move inside itself');
      if (from === INBOX || to === INBOX) throw new Refused(400, 'InvalidChannel', 'The inbox stays where it is');
      const held = await current(did, from);
      if ((held?.version ?? null) !== replaces) throw changed(from, held);
      const posts = await postsIn(did, from);
      if (posts) throw new Refused(409, 'HasPosts', `${posts} published post${posts === 1 ? ' is' : 's are'} filed in ${from}. Their addresses come from it: change their label through Publish`, { path: from });
      const taken = await db.prepare(`SELECT path FROM channels WHERE did = ?1 AND (path = ?2 OR path LIKE ?2 || '/%') AND version IS NOT NULL`).bind(did, to).first();
      if (taken) throw new Refused(409, 'PathTaken', `There is already a channel at ${taken.path}`, { path: taken.path });

      const at = now.toISOString();
      const statements = [];
      const { results: channels } = await db.prepare(`SELECT path, version, text FROM channels WHERE did = ?1 AND (path = ?2 OR path LIKE ?2 || '/%') AND version IS NOT NULL`).bind(did, from).all();
      for (const channel of channels) {
        const path = moved(channel.path, from, to);
        const version = await channelVersion({ path, text: channel.text });
        statements.push(guard(`NOT EXISTS (SELECT 1 FROM channels WHERE did = ?1 AND path = ?2 AND version IS ?3)`, did, channel.path, channel.version));
        statements.push(db.prepare(`UPDATE channels SET version = NULL, title = NULL, kind = NULL, text = NULL, seq = ${next}, updated_at = ?3 WHERE did = ?1 AND path = ?2`).bind(did, channel.path, at));
        const node = readNode(`${path}/${CHANNEL_FILE}`, channel.text).node;
        statements.push(db.prepare(
          `INSERT INTO channels (did, path, version, title, kind, text, seq, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ${next}, ?7, ?7)
           ON CONFLICT (did, path) DO UPDATE SET version = excluded.version, title = excluded.title, kind = excluded.kind,
             text = excluded.text, seq = excluded.seq, updated_at = excluded.updated_at`,
        ).bind(did, path, version, node.title ?? null, node.kind ?? null, channel.text, at));
      }
      const filed = await blocksIn(did, from);
      for (const block of filed) {
        const path = block.home ? moved(block.path, from, to) : block.path;
        const listed = block.channels.map(channel => under(channel, from) ? moved(channel, from, to) : channel);
        const text = block.channels.some(channel => under(channel, from)) ? setProperty(block.text, 'channels', listed) : block.text;
        const version = await recordVersion({ path, text });
        statements.push(guard(`NOT EXISTS (SELECT 1 FROM blocks WHERE did = ?1 AND id = ?2 AND version IS ?3)`, did, block.id, block.version));
        statements.push(db.prepare(
          `UPDATE blocks SET version = ?3, path = ?4, text = ?5, seq = (SELECT COALESCE(MAX(seq), 0) + 1 FROM blocks WHERE did = ?1), updated_at = ?6
           WHERE did = ?1 AND id = ?2`,
        ).bind(did, block.id, version, path, text, at));
      }
      if (!await runBatch(statements)) throw new Refused(409, 'Changed', 'Something in the channel changed while it was being moved. Look again and retry', { path: from });
      return { from, to, channels: channels.length, blocks: filed.length };
    },

    // ---- The agenda ----
    // What waits for the member and their curator, counted from what the service may read: no model
    // reads anything here. The private layer and the cortex are counted on the member's device.

    async agenda(did, { now = new Date(), stale = 7 } = {}) {
      const { results: posts } = await db.prepare('SELECT label FROM posts WHERE did = ?1 AND version IS NOT NULL').bind(did).all();
      const { results: rows } = await db.prepare('SELECT path, text FROM blocks WHERE did = ?1 AND version IS NOT NULL').bind(did).all();
      const before = now.getTime() - stale * 24 * 60 * 60 * 1000;
      let proposed = 0, waiting = 0, noAlt = 0;
      for (const row of rows) {
        const node = readNode(row.path, row.text)?.node;
        if (!node) continue;
        if (node.status === 'proposed' && under(row.path.split('/').slice(0, -1).join('/'), INBOX)) {
          proposed++;
          if (Date.parse(node.created ?? '') < before) waiting++;
        }
        if (node.kind === 'media' && !String(node.properties?.alt ?? '').trim()) noAlt++;
      }
      return {
        unlabelled: posts.filter(row => !row.label || row.label === 'other').length,
        proposed, waiting, mediaWithoutAlt: noAlt,
        counted: 'public and friends-only',
      };
    },

    // ---- The inbox ----
    // An agent's capture lands in the inbox marked `status: proposed`. Keeping it files it in a
    // channel and clears the mark; declining it removes it. Private captures are sealed and are kept
    // or declined on the member's device.

    async keep(did, { id, channel, replaces = null }) {
      known(channel);
      if (channel === INBOX) throw new Refused(400, 'InvalidChannel', 'Keep it in a channel other than the inbox');
      const { block } = await proposed(did, id);
      const name = block.path.split('/').at(-1);
      const text = setProperty(block.text, 'status', undefined);
      const saved = await blocks.write(did, { id, path: `${channel}/${name}`, text }, { replaces });
      return { id, channel, version: saved.version };
    },

    async decline(did, { id, replaces = null }) {
      await proposed(did, id);
      return blocks.remove(did, id, { replaces });
    },
  };

  async function proposed(did, id) {
    const read = await blocks.read(did, id);
    const node = readNode(read.block.path, read.block.text)?.node;
    if (!under(read.block.path.split('/').slice(0, -1).join('/'), INBOX) || node?.status !== 'proposed') {
      throw new Refused(409, 'NotProposed', 'This block is not waiting in the inbox', { id });
    }
    return read;
  }
}
