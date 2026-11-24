// Content for sites: what a member's website may show to whoever is looking at it, read by the
// member's DID. This is how a site reads ohm through its content layer (an Astro loader): channels
// become collections and blocks become entries.
//
//   public   what the member has published: the standard.site documents on their own PDS, read
//            from there, so nothing is public here before the member approves Publish
//   friends  the friends layer kept on this service (friends-only blocks and posts), only for a
//            viewer the member put on their friend list
//   private  never. It is sealed on the member's devices and this file does not read it
//
// Who may see what is settled in one place, `audienceOf` and `sees`, so that a later audience (a
// few people the member names for one block) is one more rule there, not another set of requests.
//
// An entry is what a site needs and nothing more: no `origin` (it can be a path on the member's
// computer), no `by`, no journal. `db` has the shape of a Cloudflare D1 database.
import { postPath } from '../../feed/pds.mjs';
import { DOCUMENT } from '../../feed/standard.mjs';
import { CHANNEL_FILE, readNode } from '../../vault/node.mjs';
import { postFile } from '../../vault/file.mjs';
import { published } from './member.mjs';
import { Refused } from './store.mjs';

export const PAGE = 200;
const DID = /^did:[a-z]+:[A-Za-z0-9._:%-]+$/;
const KEEP_PUBLIC = 60_000;

// The layers a viewer may see of an owner's content. `viewer` is a DID proved by a viewer token, or
// null for anyone. A viewer the member has not let in sees exactly what anyone sees.
export async function audienceOf(db, owner, viewer) {
  const layers = ['public'];
  if (viewer && viewer !== owner) {
    const friend = await db.prepare('SELECT 1 AS yes FROM friends WHERE did = ?1 AND friend = ?2').bind(owner, viewer).first();
    if (friend) layers.push('friends');
  }
  return { owner, viewer: viewer ?? null, layers };
}

// Whether an audience may see one entry. Today an entry is seen by its layer; a block shown to named
// people would say so on the entry and be checked here.
export const sees = (audience, entry) => entry.layer !== 'private' && audience.layers.includes(entry.layer);

const channelOf = ({ label, sublabel }) => [label || 'other', sublabel].filter(Boolean).join('/');
const under = (path, root) => path === root || path.startsWith(`${root}/`);
const text = value => (typeof value === 'string' && value.trim() ? value : undefined);
const strings = value => (Array.isArray(value) ? value.filter(each => typeof each === 'string' && each) : []);

// A published post, as the entry a site reads.
function publicEntry(key, record) {
  return {
    id: key, layer: 'public', kind: 'post', slug: text(record.slug) ?? key, channel: channelOf(record),
    channels: [], ...(text(record.title) ? { title: record.title } : {}),
    ...(text(record.subtitle) ? { subtitle: record.subtitle } : {}),
    body: typeof record.body === 'string' ? record.body : '',
    ...(strings(record.tags).length ? { tags: strings(record.tags) } : {}),
    ...(text(record.publishedAt) ? { created: record.publishedAt } : {}),
    ...(text(record.updatedAt) ? { updated: record.updatedAt } : {}),
    address: postPath(record, text(record.slug) ?? key),
  };
}

// A friends-only block or post kept here, as the entry a site reads, or nothing if it does not read.
function friendsEntry(id, path, fileText) {
  const node = readNode(path, fileText)?.node;
  if (!node || node.type !== 'block' || node.visibility !== 'friends') return null;
  const media = node.kind === 'media' && text(node.properties?.hash) ? {
    media: Object.fromEntries(Object.entries({
      name: node.properties.hash, alt: text(node.properties.alt), width: node.properties.width, height: node.properties.height, type: text(node.properties.type),
    }).filter(([, value]) => value !== undefined && value !== null)),
  } : {};
  return {
    id, layer: 'friends', kind: node.kind, slug: node.slug, channel: node.home, channels: node.channels ?? [],
    ...(node.title ? { title: node.title } : {}), body: node.body ?? '',
    ...(node.tags?.length ? { tags: node.tags } : {}),
    ...(node.created ? { created: node.created } : {}), ...(node.updated ? { updated: node.updated } : {}),
    ...media,
  };
}

// What the member's PDS holds, read once a minute at most for each member. Kept apart for each
// `get`, so one service's reads never answer another's.
const kept = new WeakMap();
async function publicEntries(get, pds, owner, now) {
  const mine = kept.get(get) ?? kept.set(get, new Map()).get(get);
  const held = mine.get(owner);
  if (held && held.until > now) return held.entries;
  const records = await published(get, pds, owner, DOCUMENT);
  const entries = [...records].map(([key, record]) => publicEntry(key, record));
  if (mine.size > 500) mine.clear();
  mine.set(owner, { entries, until: now + KEEP_PUBLIC });
  return entries;
}
export const forgetPublished = get => kept.delete(get);

export function contentStore(db, { get, pdsFor, now = () => Date.now() }) {
  const owned = owner => {
    if (typeof owner !== 'string' || !DID.test(owner)) throw new Refused(400, 'InvalidRequest', 'Say whose content with their DID');
    return owner;
  };

  // Every entry the audience may see, in one list: published posts first by date, then Friends.
  async function entries(audience) {
    const { owner } = audience;
    const pds = await pdsFor(owner);
    if (!pds) throw new Refused(404, 'NotFound', 'There is nothing here');
    const all = [...await publicEntries(get, pds, owner, now())];
    if (audience.layers.includes('friends')) {
      const { results: blocks } = await db.prepare('SELECT id, path, text FROM blocks WHERE did = ?1 AND version IS NOT NULL AND leaving_at IS NULL ORDER BY path').bind(owner).all();
      for (const row of blocks) {
        const entry = friendsEntry(row.id, row.path, row.text);
        if (entry) all.push(entry);
      }
      const { results: posts } = await db.prepare("SELECT id, post FROM posts WHERE did = ?1 AND version IS NOT NULL AND visibility = 'friends' AND leaving_at IS NULL ORDER BY label, sublabel, slug").bind(owner).all();
      for (const row of posts) {
        const file = postFile(JSON.parse(row.post));
        const entry = friendsEntry(row.id, file.path, file.text);
        if (entry) all.push({ ...entry, kind: 'post' });
      }
    }
    // A post still on the PDS is public, whatever the vault now says: it is shown once, as published.
    const seen = new Set();
    return all.filter(entry => !seen.has(entry.id) && seen.add(entry.id) && sees(audience, entry));
  }

  // The channel files kept here, as a site may see them: title and description, and an order that
  // names only what the audience can see.
  async function channelFiles(owner) {
    const { results } = await db.prepare('SELECT path, text FROM channels WHERE did = ?1 AND version IS NOT NULL').bind(owner).all();
    return new Map(results.map(row => [row.path, readNode(`${row.path}/${CHANNEL_FILE}`, row.text)?.node]).filter(([, node]) => node?.type === 'channel'));
  }
  const inChannel = (entry, path) => entry.channel === path || entry.channels.includes(path);
  const channelView = (path, node, visible) => {
    const here = visible.filter(entry => inChannel(entry, path));
    const slugs = new Set(here.map(entry => entry.slug));
    return {
      path, ...(node?.title ? { title: node.title } : {}), ...(node?.description ? { description: node.description } : {}),
      order: (node?.order ?? []).filter(slug => slugs.has(slug)), count: here.length,
    };
  };

  return {
    audience: (owner, viewer) => audienceOf(db, owned(owner), viewer),

    // A channel is listed when the audience can see something in it, or in a channel inside it.
    async listChannels(audience) {
      const visible = await entries(audience);
      const files = await channelFiles(audience.owner);
      const paths = new Set();
      for (const entry of visible) for (const path of [entry.channel, ...entry.channels]) {
        const parts = path.split('/');
        for (let end = 1; end <= parts.length; end++) paths.add(parts.slice(0, end).join('/'));
      }
      return { owner: audience.owner, channels: [...paths].sort().map(path => channelView(path, files.get(path), visible)) };
    },

    async getChannel(audience, path) {
      const visible = await entries(audience);
      if (typeof path !== 'string' || !visible.some(entry => [entry.channel, ...entry.channels].some(each => under(each, path)))) {
        throw new Refused(404, 'NotFound', 'There is nothing here');
      }
      return { owner: audience.owner, channel: channelView(path, (await channelFiles(audience.owner)).get(path), visible) };
    },

    // Entries, a page at a time, without their bodies. In a channel, in its order first.
    async listBlocks(audience, { channel, cursor } = {}) {
      const start = cursor === undefined || cursor === null ? 0 : Number(cursor);
      if (!Number.isSafeInteger(start) || start < 0) throw new Refused(400, 'InvalidCursor', 'cursor is a value an earlier list returned');
      let visible = await entries(audience);
      if (channel !== undefined && channel !== null) {
        visible = visible.filter(entry => inChannel(entry, channel));
        const order = (await channelFiles(audience.owner)).get(channel)?.order ?? [];
        const rank = slug => (order.includes(slug) ? order.indexOf(slug) : order.length);
        visible = visible.map((entry, index) => ({ entry, index })).sort((x, y) => rank(x.entry.slug) - rank(y.entry.slug) || x.index - y.index).map(({ entry }) => entry);
      }
      const page = visible.slice(start, start + PAGE).map(({ body, ...head }) => head);
      return { owner: audience.owner, blocks: page, ...(start + PAGE < visible.length ? { cursor: String(start + PAGE) } : {}) };
    },

    async getBlock(audience, id) {
      const found = (await entries(audience)).find(entry => entry.id === id);
      if (!found) throw new Refused(404, 'NotFound', 'There is nothing here');
      return { owner: audience.owner, block: found };
    },

    // A media file the audience may see: one that a block it can see names.
    async mayShowMedia(audience, name) {
      const visible = await entries(audience);
      if (typeof name !== 'string' || !visible.some(entry => entry.media?.name === name)) throw new Refused(404, 'NotFound', 'There is nothing here');
    },
  };
}
