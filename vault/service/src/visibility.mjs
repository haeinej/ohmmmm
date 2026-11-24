// Visibility moves on the vault service: the journal of every move, an agent's start of a move to
// the private layer, and agents' requests to show a block to more people, waiting for the member.
// What each move does and who may finish it is decided by the shared rules (../../vault/visibility.mjs),
// which the cockpit and the agent tools ask too.
//
// The service never sees inside the private layer, so it never makes a move itself. It does three
// things only:
//   hide     a friends-only block or post on its way to private stops being read by friends at once,
//            and is kept for the member's device, which seals it when next unlocked
//   request  an agent asks for a move it may not finish; it waits until the member answers
//   record   the cockpit records a move it made, and so answers a request or finishes a hide
//
// The journal names a block by its ID (opaque for a private block) and never holds its title or
// text. `db` has the shape of a Cloudflare D1 database.
import { MoveProblem, planMove, whyNot } from '../../vault/visibility.mjs';
import { readNode } from '../../vault/node.mjs';
import { postFile } from '../../vault/file.mjs';
import { Refused } from './store.mjs';

const ACTOR = /^(?:me|agent:[A-Za-z0-9._-]+)$/;
const STORES = ['block', 'post', 'sealed'];
const ID = /^[A-Za-z0-9+/=_-]{1,200}$/;
const REASON = 2000;

const refuse = message => { throw new Refused(400, 'InvalidRequest', message); };
const plan = given => {
  try { return planMove(given); } catch (problem) {
    if (problem instanceof MoveProblem) throw new Refused(400, 'InvalidMove', problem.message);
    throw problem;
  }
};
const reasonOf = value => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > REASON) refuse(`A reason is text, at most ${REASON} characters`);
  return value;
};
const actorOf = value => (typeof value === 'string' && ACTOR.test(value) ? value : refuse('Say who is asking: me, or agent: and the agent\'s name'));

export function visibilityStore(db) {
  const next = '(SELECT COALESCE(MAX(seq), 0) + 1 FROM moves WHERE did = ?1)';
  const journal = (did, { at, block, from, to, action, state, askedBy, approvedBy = null, reason = null, request = null }) => db.prepare(
    `INSERT INTO moves (did, seq, at, block, from_layer, to_layer, action, state, asked_by, approved_by, reason, request)
     VALUES (?1, ${next}, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
  ).bind(did, at, block, from, to, action, state, askedBy, approvedBy, reason, request);

  // A readable block or post: its layer, title, path and version, for a preview.
  async function readable(did, id) {
    const block = await db.prepare('SELECT version, path, text, leaving_at FROM blocks WHERE did = ?1 AND id = ?2 AND version IS NOT NULL').bind(did, id).first();
    if (block) {
      const node = readNode(block.path, block.text)?.node;
      return { store: 'block', layer: 'friends', version: block.version, path: block.path, title: node?.title, leaving: block.leaving_at };
    }
    const post = await db.prepare('SELECT version, visibility, post, leaving_at FROM posts WHERE did = ?1 AND id = ?2 AND version IS NOT NULL').bind(did, id).first();
    if (post) {
      const held = JSON.parse(post.post);
      return { store: 'post', layer: post.visibility, version: post.version, path: postFile(held).path, title: held.title, leaving: post.leaving_at };
    }
    return null;
  }

  const requestRow = row => ({
    id: row.id, block: row.block, store: row.store, from: row.from_layer, to: row.to_layer, version: row.version,
    askedBy: row.asked_by, ...(row.reason ? { reason: row.reason } : {}), asked: row.asked_at, state: row.state,
    ...(row.answered_at ? { answered: row.answered_at } : {}),
  });

  return {
    readable,

    // What a move would do, by the shared rules. A private block is named by its opaque ID and its
    // title is not known here: the device checks it.
    async preview(did, { id, from, to, actor = 'me', granted = false }) {
      if (typeof id !== 'string' || !ID.test(id)) refuse('Say which block with its ID');
      const held = from === 'private' ? null : await readable(did, id);
      if (from !== 'private' && !held) throw new Refused(404, 'NotFound', 'There is no such block or post in a readable layer');
      const move = plan({ from: held?.layer ?? 'private', to, title: held ? held.title : 'not known here' });
      const waiting = await db.prepare("SELECT * FROM move_requests WHERE did = ?1 AND block = ?2 AND state = 'waiting'").bind(did, id).all();
      return {
        id, ...move, ...(held ? { store: held.store, version: held.version, path: held.path, ...(held.leaving ? { leaving: held.leaving } : {}) } : { store: 'sealed' }),
        ...(actor === 'me' ? {} : { whyNot: whyNot(move, { actor, granted }) }),
        waiting: waiting.results.map(requestRow),
      };
    },

    // An agent with a write grant starts a move to private: friends stop reading the block at once.
    // The member's device seals it when next unlocked, and records the move as done.
    async hide(did, { id, replaces, by, reason, now = new Date() }) {
      const askedBy = actorOf(by);
      const held = typeof id === 'string' ? await readable(did, id) : null;
      if (!held) throw new Refused(404, 'NotFound', 'There is no such block or post in a readable layer');
      if (held.layer !== 'friends') throw new Refused(409, 'NotFriendsOnly', 'Only a friends-only block or post is hidden on its way to private');
      if (held.version !== replaces) throw new Refused(409, 'Changed', 'The block has changed since the version this request names', { id, current: held.version });
      if (held.leaving) return { id, hidden: held.leaving, unchanged: true };
      const at = now.toISOString();
      const table = held.store === 'post' ? 'posts' : 'blocks';
      const why = reasonOf(reason);
      const done = await db.prepare(`UPDATE ${table} SET leaving_at = ?3 WHERE did = ?1 AND id = ?2 AND version IS ?4 AND leaving_at IS NULL RETURNING id`).bind(did, id, at, replaces).first();
      if (!done) throw new Refused(409, 'Changed', 'The block changed while it was being hidden. Look again and retry', { id });
      await journal(did, { at, block: id, from: 'friends', to: 'private', action: 'seal', state: 'hidden', askedBy, approvedBy: askedBy, reason: why }).run();
      return { id, hidden: at, next: 'The person\'s device seals it into the private layer when it is next unlocked.' };
    },

    // An agent asks for a move it may not finish. One request waits per block and layer.
    async request(did, { block, store, from, to, version = null, by, reason, now = new Date() }) {
      const askedBy = actorOf(by);
      if (askedBy === 'me') refuse('The person makes a move themselves; a request is an agent\'s');
      if (typeof block !== 'string' || !ID.test(block)) refuse('Say which block with its ID');
      if (!STORES.includes(store)) refuse(`A block's store is one of: ${STORES.join(', ')}`);
      const move = plan({ from, to, title: 'checked when the person answers' });
      const held = await db.prepare("SELECT * FROM move_requests WHERE did = ?1 AND block = ?2 AND to_layer = ?3 AND state = 'waiting'").bind(did, block, to).first();
      if (held) return { request: requestRow(held), unchanged: true };
      const id = `r${crypto.randomUUID().replaceAll('-', '')}`;
      const at = now.toISOString();
      const why = reasonOf(reason);
      await db.batch([
        db.prepare(`INSERT INTO move_requests (did, id, block, store, from_layer, to_layer, version, asked_by, reason, asked_at, state)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'waiting')`).bind(did, id, block, store, from, to, version, askedBy, why, at),
        journal(did, { at, block, from, to, action: move.action, state: 'requested', askedBy, reason: why, request: id }),
      ]);
      return { request: requestRow(await db.prepare('SELECT * FROM move_requests WHERE did = ?1 AND id = ?2').bind(did, id).first()) };
    },

    async requests(did, { state = 'waiting' } = {}) {
      if (!['waiting', 'approved', 'declined'].includes(state)) refuse('A request is waiting, approved or declined');
      const { results } = await db.prepare('SELECT * FROM move_requests WHERE did = ?1 AND state = ?2 ORDER BY asked_at').bind(did, state).all();
      return { requests: results.map(requestRow) };
    },

    async decline(did, { id, reason, now = new Date() }) {
      const held = await db.prepare("SELECT * FROM move_requests WHERE did = ?1 AND id = ?2").bind(did, id).first();
      if (!held) throw new Refused(404, 'NotFound', 'There is no such request');
      if (held.state !== 'waiting') throw new Refused(409, 'Answered', 'This request has been answered already', { state: held.state });
      const at = now.toISOString();
      const why = reasonOf(reason);
      const answered = await db.prepare("UPDATE move_requests SET state = 'declined', answered_at = ?3 WHERE did = ?1 AND id = ?2 AND state = 'waiting' RETURNING id").bind(did, id, at).first();
      if (!answered) throw new Refused(409, 'Answered', 'This request has been answered already');
      await journal(did, { at, block: held.block, from: held.from_layer, to: held.to_layer, action: planMove({ from: held.from_layer, to: held.to_layer }).action, state: 'declined', askedBy: held.asked_by, approvedBy: null, reason: why, request: id }).run();
      return { id, declined: true };
    },

    // The member's cockpit records a move it made. With `request`, it answers that request; a move
    // that seals a hidden block finishes it. `cleanupPending` says the old copy is still there.
    async record(did, { block, from, to, request = null, reason, cleanupPending = false, sealedAs, now = new Date() }) {
      if (typeof block !== 'string' || !ID.test(block)) refuse('Say which block with its ID');
      const move = plan({ from, to, title: 'checked by the cockpit' });
      const at = now.toISOString();
      reasonOf(reason);
      let asked = 'me';
      if (request !== null) {
        const held = await db.prepare('SELECT * FROM move_requests WHERE did = ?1 AND id = ?2').bind(did, request).first();
        if (!held) throw new Refused(404, 'NotFound', 'There is no such request');
        if (held.state !== 'waiting') throw new Refused(409, 'Answered', 'This request has been answered already', { state: held.state });
        if (held.block !== block || held.from_layer !== from || held.to_layer !== to) throw new Refused(409, 'NotThisMove', 'The move made is not the one requested');
        asked = held.asked_by;
        const answered = await db.prepare("UPDATE move_requests SET state = 'approved', answered_at = ?3 WHERE did = ?1 AND id = ?2 AND state = 'waiting' RETURNING id").bind(did, request, at).first();
        if (!answered) throw new Refused(409, 'Answered', 'This request has been answered already');
      }
      const state = cleanupPending ? 'cleanup-pending' : move.via === 'publish' ? 'previewed' : 'done';
      await journal(did, { at, block: typeof sealedAs === 'string' && ID.test(sealedAs) ? sealedAs : block, from, to, action: move.action, state, askedBy: asked, approvedBy: 'me', reason: reasonOf(reason), request }).run();
      return { block, from, to, state, ...(request ? { request, approved: true } : {}) };
    },

    // The journal, newest first, or after `since` (a `seq`).
    async moves(did, { since, limit = 100 } = {}) {
      const after = since === undefined || since === null ? 0 : Number(since);
      if (!Number.isSafeInteger(after) || after < 0) throw new Refused(400, 'InvalidCursor', 'since is a value an earlier list returned');
      const { results } = await db.prepare('SELECT * FROM moves WHERE did = ?1 AND seq > ?2 ORDER BY seq DESC LIMIT ?3').bind(did, after, Math.min(Number(limit) || 100, 500)).all();
      return {
        moves: results.map(row => ({
          seq: row.seq, at: row.at, block: row.block, from: row.from_layer, to: row.to_layer, action: row.action, state: row.state,
          askedBy: row.asked_by, ...(row.approved_by ? { approvedBy: row.approved_by } : {}), ...(row.reason ? { reason: row.reason } : {}), ...(row.request ? { request: row.request } : {}),
        })),
      };
    },
  };
}

