import { listRecords } from '../feed/repository.mjs';
import { CONTENT, documentUri } from '../feed/standard.mjs';
import { normalizeArchivePost, pdsConfig } from '../feed/pds.mjs';
import { renderArchivePost } from '../feed/render.mjs';

/** A public source reads a complete channel snapshot as { id, data, body, rendered } entries. */
export function pdsSource({ did, origin, channels, get = fetch, maxPages = 200 }) {
  const pds = pdsConfig({ ATPROTO_DID: did, ATPROTO_PDS_ORIGIN: origin });
  if (!channels || typeof channels !== 'object' || Array.isArray(channels)) {
    throw new Error('Map each channel to its public label and optional sublabel');
  }
  for (const selector of Object.values(channels)) {
    if (!selector || typeof selector.label !== 'string' || !selector.label.trim() ||
        (selector.sublabel !== undefined && typeof selector.sublabel !== 'string')) {
      throw new Error('Each PDS channel needs a label and an optional sublabel');
    }
  }
  if (!Number.isInteger(maxPages) || maxPages < 1) throw new Error('maxPages must be a positive integer');
  return {
    async read({ channel }) {
      if (!Object.hasOwn(channels, channel)) throw new Error(`No PDS mapping for channel "${channel}"`);
      const selector = channels[channel];
      const { records } = await listRecords({ ...pds, collection: CONTENT, get, maxPages });
      const posts = records.map(({ uri, value }) => {
        const id = uri.split('/').at(-1);
        const post = normalizeArchivePost(value, id, pds);
        if (!post) throw new Error(`Invalid ohm post ${id}`);
        return { id, value, post };
      });
      const paths = new Map(posts.map(({ id, post }) => [encodeURIComponent(id), post.permalink]));
      const entries = [];
      for (const { id, value, post } of posts) {
        if (post.label !== selector.label ||
            (selector.sublabel !== undefined && post.sublabel !== selector.sublabel)) continue;
        const { body, media, ...fields } = post;
        const rendered = renderArchivePost(post, { did, collection: CONTENT });
        entries.push({
          id,
          data: {
            ...fields,
            channel,
            uri: documentUri(did, id),
            publishedAt: post.createdAt,
            ...(value.updatedAt ? { updatedAt: value.updatedAt } : {}),
            media: [...media].map(([id, item]) => ({ id, ...item })),
          },
          body,
          rendered: {
            // The feed renderer emits short own-post links. Static sites need their full route.
            html: rendered.bodyHtml.replace(/href="\/posts\/([^/" ]+)"/g, (attribute, key) => {
              const path = paths.get(key);
              return path ? `href="${path}"` : attribute;
            }),
          },
        });
      }
      return entries;
    },
  };
}

/** Load public content at build time. Source implementations must return complete public snapshots. */
export function ohm({ source, channel }) {
  if (typeof source?.read !== 'function') throw new Error('An ohm source must implement read({ channel })');
  if (typeof channel !== 'string' || !channel.trim()) throw new Error('Choose a channel for this collection');
  return {
    name: 'ohm',
    async load({ store, parseData, generateDigest }) {
      const snapshot = await source.read({ channel });
      if (!Array.isArray(snapshot)) throw new Error('An ohm source must return a complete entry array');
      const ids = new Set();
      const entries = [];
      for (const entry of snapshot) {
        if (typeof entry?.id !== 'string' || !entry.id || ids.has(entry.id) ||
            !entry.data || typeof entry.data !== 'object' || Array.isArray(entry.data) ||
            typeof entry.body !== 'string' || typeof entry.rendered?.html !== 'string') {
          throw new Error('An ohm source returned an invalid or duplicate entry');
        }
        ids.add(entry.id);
        const data = await parseData({ id: entry.id, data: entry.data });
        entries.push({ ...entry, data, digest: generateDigest(entry) });
      }
      // Complete reading and schema validation before changing Astro's persisted collection.
      store.clear();
      for (const entry of entries) store.set(entry);
    },
  };
}
