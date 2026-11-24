// Friends, approved like devices on a private network: someone signed in to ohm asks to see a
// member's friends layer; the member sees who (their name and email from their ohm account, and
// their DID, which is that account) and approves them for every channel or only some. An approval
// lasts until the member removes it. A friend's agents act for the friend, with the friend's access.
//
// Which channels a friend sees is settled here and nowhere else, for every way a friend reads: the
// friends tools (listShared, getShared) and a site's content reads. `channels` is null for every
// channel, or a list of channel paths, each covering the channels inside it.
//
// `db` has the shape of a Cloudflare D1 database.
import { isChannelPath, readNode } from '../../vault/node.mjs';
import { DAILY } from './mail.mjs';
import { Refused } from './store.mjs';

const DID = /^did:[a-z]+:[A-Za-z0-9._:%-]+$/;
const MESSAGE = 1000;

const channelList = value => {
  if (value === undefined || value === null || value === '*') return null;
  if (!Array.isArray(value) || value.some(path => typeof path !== 'string' || !isChannelPath(path)) || value.length > 500) {
    throw new Refused(400, 'InvalidRequest', 'Channels are `*` for every channel, or a list of channel paths');
  }
  return [...new Set(value)].sort();
};
const parse = text => (text ? JSON.parse(text) : null);
const covers = (scopes, path) => scopes.some(scope => path === scope || path.startsWith(`${scope}/`));

// What `reader` may see of `owner`'s friends layer: null when they are not a friend, otherwise the
// channels (null for every one).
export async function friendScope(db, owner, reader) {
  if (!reader || reader === owner) return null;
  const row = await db.prepare('SELECT channels FROM friends WHERE did = ?1 AND friend = ?2').bind(owner, reader).first();
  return row ? { channels: parse(row.channels) } : null;
}

// Whether a friends-only block or post, filed in `paths` (its home channel first), is within a scope.
export const inScope = (scope, paths) => Boolean(scope) && (scope.channels === null || paths.some(path => path && covers(scope.channels, path)));

// The channels a file is filed in, by its path and text.
export function filedIn(path, text) {
  const node = readNode(path, text)?.node;
  return node ? [node.home, ...(node.channels ?? [])].filter(Boolean) : [];
}

export function friendshipStore(db) {
  const row = request => ({
    id: request.id, did: request.friend, ...(request.name ? { name: request.name } : {}), ...(request.email ? { email: request.email } : {}),
    ...(request.message ? { message: request.message } : {}), asked: request.asked_at, state: request.state,
  });
  return {
    // Someone signed in to ohm, with their AT Protocol account (`viewer`, their DID) connected, asks
    // `owner` to be a friend. Asking twice keeps one request. Asking someone who is not a member, or
    // who already let you in, answers the same, so asking reveals nothing.
    async ask(owner, { viewer, name, email, message, now = new Date() }) {
      if (typeof owner !== 'string' || !DID.test(owner)) throw new Refused(400, 'InvalidRequest', 'Say whose friend with their DID');
      if (owner === viewer) throw new Refused(400, 'InvalidRequest', 'You can always read your own vault');
      if (message !== undefined && message !== null && (typeof message !== 'string' || message.length > MESSAGE)) throw new Refused(400, 'InvalidRequest', `A message is text, at most ${MESSAGE} characters`);
      if (await friendScope(db, owner, viewer)) return { asked: true };
      // One request waits for each asker (friend_requests_one_waiting): a second ask, even at the
      // same moment as the first, leaves the one already waiting.
      await db.prepare(`INSERT INTO friend_requests (did, id, friend, name, email, message, asked_at, state)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'waiting') ON CONFLICT DO NOTHING`).bind(owner, `f${crypto.randomUUID().replaceAll('-', '')}`, viewer, name || null, email || null, message || null, now.toISOString()).run();
      return { asked: true };
    },

    // Asking by email. The ask is kept for the asker whether or not the email has an ohm account, and
    // the answer is the same either way, so no one can learn which emails are on ohm.
    async askByEmail({ viewer, email, name, ownEmail, message, didByEmail, mail, now = new Date() }) {
      const typed = typeof email === 'string' ? email.trim().toLowerCase() : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed) || typed.length > 320) throw new Refused(400, 'InvalidRequest', 'Give their email address');
      if (ownEmail && typed === ownEmail.toLowerCase()) throw new Refused(400, 'InvalidRequest', 'That is your own email');
      await db.prepare('INSERT INTO friend_asks (viewer, email, message, asked_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (viewer, email) DO UPDATE SET message = excluded.message').bind(viewer, typed, message || null, now.toISOString()).run();
      const owner = await didByEmail(typed);
      if (owner && owner !== viewer) await this.ask(owner, { viewer, name, email: ownEmail, message, now });
      // One invite email per address, and at most DAILY a day for each asker. The send is claimed
      // first, in one statement that checks both, so asks at the same moment or a retry send once and
      // never past the day's limit. A send that did not go gives its claim back, to be tried again.
      if (mail) {
        const at = now.toISOString();
        const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
        const claimed = await db.prepare(`UPDATE friend_asks SET mailed_at = ?3 WHERE viewer = ?1 AND email = ?2 AND mailed_at IS NULL
          AND (SELECT COUNT(*) FROM friend_asks WHERE viewer = ?1 AND mailed_at > ?4) < ?5 RETURNING email`).bind(viewer, typed, at, since, DAILY).first();
        if (claimed) {
          let went = false;
          try {
            went = Boolean(await mail({ to: typed, asker: name, askerEmail: ownEmail, message }));
          } finally {
            if (!went) await db.prepare('UPDATE friend_asks SET mailed_at = NULL WHERE viewer = ?1 AND email = ?2 AND mailed_at = ?3').bind(viewer, typed, at).run();
          }
        }
      }
      return { asked: true };
    },

    // Someone joins ohm (or their account gains an email): everyone who asked that email before is
    // sent to them as a request now, as if they had asked today. An asker they already let in, or
    // already answered, is not asked again.
    async deliver(owner, email, { people, now = new Date() }) {
      const { results } = await db.prepare('SELECT viewer, message, asked_at FROM friend_asks WHERE email = ?1 AND viewer <> ?2').bind(email, owner).all();
      const known = await people(results.map(each => each.viewer));
      let sent = 0;
      for (const each of results) {
        if (await friendScope(db, owner, each.viewer)) continue;
        const answered = await db.prepare('SELECT 1 AS yes FROM friend_requests WHERE did = ?1 AND friend = ?2').bind(owner, each.viewer).first();
        if (answered) continue;
        await this.ask(owner, { viewer: each.viewer, name: known.get(each.viewer)?.name, email: known.get(each.viewer)?.email, message: each.message ?? undefined, now });
        sent++;
      }
      return { sent };
    },

    // What the asker asked, by the email they typed: waiting, or friends once they were let in.
    async asked(viewer, { didByEmail }) {
      const { results } = await db.prepare('SELECT email, asked_at FROM friend_asks WHERE viewer = ?1 ORDER BY asked_at DESC').bind(viewer).all();
      const asks = [];
      for (const each of results) {
        const owner = await didByEmail(each.email);
        const friends = owner ? await friendScope(db, owner, viewer) : null;
        asks.push({ email: each.email, asked: each.asked_at, state: friends ? 'friends' : 'waiting', ...(friends ? { did: owner } : {}) });
      }
      return { asks };
    },

    // The people who let `viewer` into their friends layer: whose shared blocks they read.
    async friendOf(viewer) {
      const { results } = await db.prepare('SELECT did, added_at FROM friends WHERE friend = ?1 ORDER BY added_at').bind(viewer).all();
      return results.map(each => ({ did: each.did, since: each.added_at }));
    },

    async requests(did) {
      const { results } = await db.prepare("SELECT * FROM friend_requests WHERE did = ?1 AND state = 'waiting' ORDER BY asked_at").bind(did).all();
      return { requests: results.map(row) };
    },

    // The member approves: the asker becomes a friend, for every channel or only those given. Sent
    // again with the same channels, say after the answer was lost, it answers as it did the first time.
    async approve(did, { id, channels, now = new Date() }) {
      const scope = channelList(channels);
      const held = await db.prepare('SELECT * FROM friend_requests WHERE did = ?1 AND id = ?2').bind(did, id).first();
      if (!held) throw new Refused(404, 'NotFound', 'There is no such request');
      const answer = { did: held.friend, channels: scope ?? '*' };
      if (held.state === 'waiting') {
        const at = now.toISOString();
        // Only a request still waiting is approved, and the friend is added only by the approval that
        // answered it, so a decline or another approval at the same moment is never undone.
        const [approved] = await db.batch([
          db.prepare("UPDATE friend_requests SET state = 'approved', answered_at = ?3 WHERE did = ?1 AND id = ?2 AND state = 'waiting'").bind(did, id, at),
          db.prepare(`INSERT INTO friends (did, friend, added_at, channels, name, email)
            SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE EXISTS (SELECT 1 FROM friend_requests WHERE did = ?1 AND id = ?7 AND state = 'approved' AND answered_at = ?3)
            ON CONFLICT (did, friend) DO UPDATE SET channels = excluded.channels, name = excluded.name, email = excluded.email`)
            .bind(did, held.friend, at, scope ? JSON.stringify(scope) : null, held.name, held.email, id),
        ]);
        if (approved.meta.changes) return answer;
      }
      const state = (await db.prepare('SELECT state FROM friend_requests WHERE did = ?1 AND id = ?2').bind(did, id).first())?.state;
      const friend = state === 'approved' ? await friendScope(db, did, held.friend) : null;
      if (friend && JSON.stringify(friend.channels) === JSON.stringify(scope)) return answer;
      throw new Refused(409, 'Answered', 'This request has been answered already', { state });
    },

    // Sent again, say after the answer was lost, it answers as it did the first time.
    async decline(did, { id, now = new Date() }) {
      const done = await db.prepare("UPDATE friend_requests SET state = 'declined', answered_at = ?3 WHERE did = ?1 AND id = ?2 AND state = 'waiting' RETURNING id").bind(did, id, now.toISOString()).first();
      if (done) return { id, declined: true };
      const held = await db.prepare('SELECT state FROM friend_requests WHERE did = ?1 AND id = ?2').bind(did, id).first();
      if (!held) throw new Refused(404, 'NotFound', 'There is no such request');
      if (held.state === 'declined') return { id, declined: true };
      throw new Refused(409, 'Answered', 'This request has been answered already', { state: held.state });
    },

    // Which channels one friend sees. Fewer or more: either way it is the member's, signed in to ohm.
    async setChannels(did, { friend, channels }) {
      const scope = channelList(channels);
      const done = await db.prepare('UPDATE friends SET channels = ?3 WHERE did = ?1 AND friend = ?2 RETURNING friend').bind(did, friend, scope ? JSON.stringify(scope) : null).first();
      if (!done) throw new Refused(404, 'NotFound', 'That DID is not a friend');
      return { did: friend, channels: scope ?? '*' };
    },
  };
}
