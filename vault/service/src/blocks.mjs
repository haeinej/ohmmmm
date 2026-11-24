// The friends layer: what a member keeps readable on the vault service so the friends they chose
// can read it. Two kinds of thing are in it: friends-only posts, which stay in the post store, and
// every other friends-only block, kept here as the file it is in the member's folder.
//
// Only friends-only blocks are taken. A private block is never kept readable: it belongs in the
// private layer's store (./private.mjs), as ciphertext sealed on the member's device. A public block is published as a
// post. Every write and removal names the version it replaces, and the database makes that check in
// the same statement that makes the change, as the post store does.
//
// `db` has the shape of a Cloudflare D1 database.
import { recordVersion } from '../../vault/core.mjs';
import { isPostId, postFile } from '../../vault/file.mjs';
import { readNode } from '../../vault/node.mjs';
import { Refused } from './store.mjs';

const PAGE = 1000;
const LARGEST = 600_000;
const DID = /^(?:did:plc:[a-z2-7]{24}|did:web:[A-Za-z0-9.-]+(?:%3A\d{1,5})?(?::[A-Za-z0-9._-]+)*)$/;

// A block's version: a name for exactly its path and text, as the post store names a post's.
export const blockVersion = ({ path, text }) => recordVersion({ path, text });

// The block a file is, if it may be kept in the friends layer. Refused with every reason if not.
export function friendsBlock(given) {
  const { id, path, text, ...more } = given ?? {};
  const refuse = message => { throw new Refused(400, 'InvalidBlock', message); };
  if (Object.keys(more).length) refuse(`A block is sent as id, path and text, and nothing else: ${Object.keys(more).join(', ')}`);
  if (!isPostId(id)) refuse('Say which block with its ID, one this vault gave');
  if (typeof path !== 'string' || typeof text !== 'string') refuse('A block is sent with its path in the folder and its text');
  if (new TextEncoder().encode(text).length > LARGEST) throw new Refused(413, 'TooLarge', 'A block can be at most 600 KB of text');
  const read = readNode(path, text);
  if (!read?.node || read.node.type !== 'block') refuse(`${path} is not a block's file: a Markdown file, in no folder starting with "." or "_"`);
  const { node, problems } = read;
  if (node.kind === 'post') refuse('This file reads as a post: it has visibility and no kind. Keep a post with putPost, which already keeps friends-only posts in this layer; to keep it as a block, give it a kind, such as kind: text');
  if (node.visibility === 'private') refuse('A private block is never kept readable here. Seal it on your device and keep it with putPrivateBlock');
  if (node.visibility === 'public') refuse('A public block is published, as a post. Keep it here as friends-only, or publish it');
  if (node.id && node.id !== id) refuse(`The file's id property is ${node.id}, not ${id}`);
  if (problems.length) refuse(problems.join('\n'));
  return { id, path, text, node };
}

export function blockStore(db) {
  const current = (did, id) => db.prepare('SELECT version, path, text, seq FROM blocks WHERE did = ?1 AND id = ?2').bind(did, id).first();
  const next = '(SELECT COALESCE(MAX(seq), 0) + 1 FROM blocks WHERE did = ?1)';
  const changed = (id, held) => new Refused(409, 'Changed', 'The block has changed since the version this request names', { id, current: held?.version ?? null });
  const known = id => isPostId(id) ? id : (() => { throw new Refused(400, 'InvalidBlock', 'Say which block with its ID'); })();
  const friendDid = value => {
    if (typeof value !== 'string' || !DID.test(value)) throw new Refused(400, 'InvalidRequest', 'A friend is named by their DID');
    return value;
  };
  const isFriend = async (did, friend) => Boolean(await db.prepare('SELECT 1 AS yes FROM friends WHERE did = ?1 AND friend = ?2').bind(did, friend).first());
  // To someone the member has not let in, the friends layer does not exist: the same answer whether
  // or not there is anything in it, so asking reveals nothing.
  const allowed = async (owner, reader) => {
    friendDid(owner);
    if (owner === reader || !(await isFriend(owner, reader))) throw new Refused(404, 'NotFound', 'Nothing here is shared with you');
  };

  return {
    // Every block there is, or with `since`, everything that changed after that point, removals included.
    async list(did, { since } = {}) {
      const after = since === undefined ? 0 : Number(since);
      if (!Number.isSafeInteger(after) || after < 0) throw new Refused(400, 'InvalidCursor', 'since is a value an earlier list returned');
      const { results } = await db.prepare(
        `SELECT id, version, path, kind, title, seq, leaving_at FROM blocks
         WHERE did = ?1 AND seq > ?2 ${since === undefined ? 'AND version IS NOT NULL' : ''} ORDER BY seq LIMIT ${PAGE + 1}`,
      ).bind(did, after).all();
      const page = results.slice(0, PAGE);
      const latest = page.length ? page.at(-1).seq
        : since !== undefined ? after
        : (await db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM blocks WHERE did = ?1').bind(did).first()).seq;
      return {
        blocks: page.map(row => row.version === null ? { id: row.id, removed: true } : {
          id: row.id, version: row.version, path: row.path, kind: row.kind, ...(row.title ? { title: row.title } : {}),
          ...(row.leaving_at ? { leaving: row.leaving_at } : {}),
        }),
        cursor: String(latest),
        ...(results.length > PAGE ? { more: true } : {}),
      };
    },

    async read(did, id) {
      const held = await current(did, known(id));
      if (!held || held.version === null) throw new Refused(404, 'NotFound', 'There is no such block');
      return { block: { id, path: held.path, text: held.text }, version: held.version };
    },

    // `replaces` is the version being replaced, and nothing for a block that is new.
    async write(did, given, { replaces = null, now = new Date() } = {}) {
      const { id, path, text, node } = friendsBlock(given);
      const version = await blockVersion({ path, text });
      const held = await current(did, id);
      const was = held?.version ?? null;
      if (was === version) return { id, version, unchanged: true };
      if (was !== replaces) throw changed(id, held);
      let written;
      try {
        written = await db.prepare(
          `INSERT INTO blocks (did, id, version, path, kind, title, text, seq, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ${next}, ?8, ?8)
           ON CONFLICT (did, id) DO UPDATE SET version = excluded.version, path = excluded.path, kind = excluded.kind,
             title = excluded.title, text = excluded.text, seq = excluded.seq, updated_at = excluded.updated_at,
             leaving_at = CASE WHEN blocks.version IS NULL THEN NULL ELSE blocks.leaving_at END
           WHERE blocks.version IS ?9
           RETURNING seq`,
        ).bind(did, id, version, path, node.kind, node.title ?? null, text, now.toISOString(), replaces).first();
      } catch (problem) {
        if (/UNIQUE constraint failed: blocks\.did, blocks\.path|blocks_path/i.test(String(problem?.message))) {
          throw new Refused(409, 'PathTaken', `Another block is already at ${path}`, { id });
        }
        throw problem;
      }
      if (!written) throw changed(id, await current(did, id));
      return { id, version };
    },

    async remove(did, id, { replaces = null, now = new Date() } = {}) {
      const held = await current(did, known(id));
      if (!held || held.version === null) return { id, removed: true, unchanged: true };
      if (held.version !== replaces) throw changed(id, held);
      const gone = await db.prepare(
        `UPDATE blocks SET version = NULL, path = NULL, kind = NULL, title = NULL, text = NULL, seq = ${next}, updated_at = ?3
         WHERE did = ?1 AND id = ?2 AND version IS ?4 RETURNING seq`,
      ).bind(did, id, now.toISOString(), replaces).first();
      if (!gone) throw changed(id, await current(did, id));
      return { id, removed: true };
    },

    // ---- Friends ----

    async friends(did) {
      const { results } = await db.prepare('SELECT friend, added_at FROM friends WHERE did = ?1 ORDER BY added_at, friend').bind(did).all();
      return { friends: results.map(row => ({ did: row.friend, added: row.added_at })) };
    },

    async addFriend(did, friend, { now = new Date() } = {}) {
      friendDid(friend);
      if (friend === did) throw new Refused(400, 'InvalidRequest', 'You can always read your own vault; a friend is someone else');
      const added = await db.prepare('INSERT INTO friends (did, friend, added_at) VALUES (?1, ?2, ?3) ON CONFLICT (did, friend) DO NOTHING RETURNING added_at')
        .bind(did, friend, now.toISOString()).first();
      return { did: friend, ...(added ? {} : { unchanged: true }) };
    },

    async removeFriend(did, friend) {
      friendDid(friend);
      const gone = await db.prepare('DELETE FROM friends WHERE did = ?1 AND friend = ?2 RETURNING friend').bind(did, friend).first();
      return { did: friend, removed: true, ...(gone ? {} : { unchanged: true }) };
    },

    // ---- What a friend reads ----

    // Everything in `owner`'s friends layer, for `reader`, who must be on owner's friend list:
    // friends-only blocks, and friends-only posts as the files the post code writes.
    async shared(owner, reader) {
      await allowed(owner, reader);
      const { results: blocks } = await db.prepare('SELECT id, version, path, kind, title FROM blocks WHERE did = ?1 AND version IS NOT NULL AND leaving_at IS NULL ORDER BY path').bind(owner).all();
      const { results: posts } = await db.prepare("SELECT id, version, post FROM posts WHERE did = ?1 AND version IS NOT NULL AND visibility = 'friends' AND leaving_at IS NULL ORDER BY label, sublabel, slug").bind(owner).all();
      return {
        owner,
        blocks: [
          ...blocks.map(row => ({ id: row.id, version: row.version, path: row.path, kind: row.kind, ...(row.title ? { title: row.title } : {}) })),
          ...posts.map(row => {
            const post = JSON.parse(row.post);
            return { id: row.id, version: row.version, path: postFile(post).path, kind: 'post', ...(post.title ? { title: post.title } : {}) };
          }),
        ],
      };
    },

    async readShared(owner, reader, id) {
      await allowed(owner, reader);
      known(id);
      const block = await db.prepare('SELECT version, path, text FROM blocks WHERE did = ?1 AND id = ?2 AND version IS NOT NULL AND leaving_at IS NULL').bind(owner, id).first();
      if (block) return { block: { id, path: block.path, text: block.text }, version: block.version };
      const post = await db.prepare("SELECT version, post FROM posts WHERE did = ?1 AND id = ?2 AND version IS NOT NULL AND visibility = 'friends' AND leaving_at IS NULL").bind(owner, id).first();
      if (!post) throw new Refused(404, 'NotFound', 'Nothing here is shared with you');
      const file = postFile(JSON.parse(post.post));
      return { block: { id, path: file.path, text: file.text }, version: post.version };
    },
  };
}
