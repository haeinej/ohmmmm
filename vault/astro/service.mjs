import { isRecordKey, webUrl } from '../feed/pds.mjs';
import { renderArchivePost } from '../feed/render.mjs';
import { documentUri } from '../feed/standard.mjs';
import { addressKind, outsideCode } from '../vault/file.mjs';

const DID = /^did:[a-z]+:[A-Za-z0-9._:%-]+$/;
const MEDIA_NAME = /^sha256-[0-9a-f]{64}$/;
const inChannel = (block, channel) => block.channel === channel || block.channels?.includes(channel);
const hasToken = token => typeof token === 'string' && token.trim().length > 0;

class ContentError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function publicEntry(block, { did, site, channel, paths }) {
  const { id, body, address: permalink } = block;
  if (!isRecordKey(id) || typeof permalink !== 'string' || !permalink.startsWith('/posts/')) {
    throw new Error('The ohm service returned an invalid public address');
  }
  const url = new URL(permalink, site);
  if (url.origin !== site.origin || url.pathname !== permalink || url.search || url.hash) {
    throw new Error('The ohm service returned an invalid public address');
  }
  const [label, ...rest] = block.channel.split('/');
  const { bodyHtml } = renderArchivePost({ body, media: new Map(), permalink });
  return {
    id, body,
    data: {
      channel, label, ...(rest.length ? { sublabel: rest.join('/') } : {}),
      uri: documentUri(did, id), slug: block.slug, title: block.title ?? '', subtitle: block.subtitle ?? '',
      publishedAt: block.created ?? '', ...(block.updated ? { updatedAt: block.updated } : {}),
      canonicalUrl: url.href, permalink, media: [], ...(block.tags ? { tags: block.tags } : {}),
    },
    rendered: {
      html: bodyHtml.replace(/href="at:\/\/([^/"]+)\/(?:site\.standard\.document|com\.ohmmmm\.post)\/([^/"]+)"/g,
        (attribute, owner, key) => {
          const path = owner === did && paths.get(key);
          return path ? `href="${path.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"` : attribute;
        }),
    },
  };
}

function friendsEntry(block, mediaPath) {
  const { id, body, kind, slug, channel, channels, title, subtitle, tags, created, updated } = block;
  const media = new Map();
  let renderedBody = body;
  let attachment;
  if (MEDIA_NAME.test(block.media?.name ?? '')) {
    const { name, type, alt, width, height } = block.media;
    const url = mediaPath?.(name);
    if (url !== undefined && (typeof url !== 'string' || !/^\/(?!\/)[^\\\s\x00-\x1f]*$/.test(url))) {
      throw new Error('Friends media must use a same-origin path');
    }
    attachment = { name, type, alt, width, height, url };
    if (url) {
      const [family] = (type ?? '').split('/');
      const item = { kind: ['image', 'video', 'audio'].includes(family) ? family : 'file', url, alt, caption: '', poster: null };
      media.set(name, item);
      if (kind === 'media') {
        // As in the workspace, a media block's first embed names its own file.
        let seen = false;
        renderedBody = outsideCode(body, part => part.replace(
          /(?<!\\)!\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g,
          (whole, target, description = '') => {
            if (seen) return whole;
            seen = true;
            const fileKind = addressKind(target.trim());
            if (!fileKind) return whole;
            if (!type) item.kind = fileKind;
            const label = description.trim().replace(/[\\[\]]/g, '\\$&');
            return `![${label}](media:${name})`;
          },
        ));
      }
    }
  }
  const { bodyHtml } = renderArchivePost({ body: renderedBody, media, permalink: `/${encodeURIComponent(id)}` });
  return {
    id, body, rendered: { html: bodyHtml },
    data: { layer: 'friends', kind, slug, channel, channels, title, subtitle, tags, created, updated, media: attachment },
  };
}

/** C2 reads. Only the anonymous read() method is a build-time source. */
export function serviceSource({ did, origin, site, fallback, mediaPath, get = fetch, maxPages = 200 }) {
  const endpoint = URL.canParse(origin) && new URL(origin);
  const loopback = endpoint?.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  if (!DID.test(did) || !endpoint || (!loopback && endpoint.protocol !== 'https:') || endpoint.href !== `${endpoint.origin}/`) {
    throw new Error('Set a member DID and an HTTPS ohm service origin (or loopback for local development)');
  }
  const website = webUrl(site) && new URL(site);
  if (!website || website.href !== `${website.origin}/`) throw new Error('Set the public website origin');
  if (!Number.isInteger(maxPages) || maxPages < 1) throw new Error('maxPages must be a positive integer');

  async function request(method, params, viewerToken) {
    const url = new URL(`/xrpc/com.ohmmmm.content.${method}`, endpoint);
    url.search = new URLSearchParams({ did, ...params });
    let response;
    try {
      response = await get(url, {
        headers: viewerToken ? { Authorization: `Bearer ${viewerToken}` } : {},
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ContentError('Could not reach the ohm content service', 503);
    }
    if (!response.ok) throw new ContentError(`The ohm content service returned HTTP ${response.status}`, response.status);
    return response;
  }

  async function json(method, params, viewerToken) {
    const response = await request(method, params, viewerToken);
    const result = await response.json();
    if (result?.owner !== did) throw new Error('The ohm content service returned an unexpected owner');
    return result;
  }

  async function list(channel, layer, viewerToken) {
    let cursor;
    const ids = new Set();
    const cursors = new Set();
    for (let page = 0; page < maxPages; page++) {
      const params = { channel, ...(cursor === undefined ? {} : { cursor }) };
      const { blocks, cursor: next, publicUnavailable } = await json('listBlocks', params, viewerToken);
      if (layer === 'public' && publicUnavailable) throw new ContentError('Public ohm content is unavailable', 503);
      if (!Array.isArray(blocks)) throw new Error('The ohm content service returned an invalid page');
      for (const block of blocks) {
        if (block?.layer !== layer) continue;
        if (typeof block.id !== 'string' || !block.id || !inChannel(block, channel) || ids.has(block.id)) {
          throw new Error('The ohm content service returned an invalid or duplicate entry');
        }
        ids.add(block.id);
      }
      if (next === undefined) return ids;
      if (typeof next !== 'string' || !next || cursors.has(next)) {
        throw new Error('The ohm content service returned an invalid cursor');
      }
      cursors.add(next);
      cursor = next;
    }
    throw new Error('The ohm content service exceeded the page limit');
  }

  async function detail(id, channel, layer, viewerToken) {
    const { block, publicUnavailable } = await json('getBlock', { id }, viewerToken);
    if (layer === 'public' && publicUnavailable) throw new ContentError('Public ohm content is unavailable', 503);
    if (block?.layer !== layer) return undefined;
    if (block.id !== id || typeof block.channel !== 'string' || !Array.isArray(block.channels) ||
        typeof block.slug !== 'string' || typeof block.body !== 'string') {
      throw new Error('The ohm content service returned an invalid entry');
    }
    return inChannel(block, channel) ? block : undefined;
  }

  async function friend(id, channel, viewerToken) {
    try {
      const block = await detail(id, channel, 'friends', viewerToken);
      return block && friendsEntry(block, mediaPath);
    } catch (error) {
      if (error instanceof ContentError && error.status === 404) return undefined;
      throw error;
    }
  }

  return {
    async read({ channel }) {
      let listed = false;
      try {
        const ids = await list(channel, 'public');
        listed = true;
        const blocks = [];
        for (const id of ids) {
          const block = await detail(id, channel, 'public');
          if (!block) throw new Error('The public inventory changed during the ohm read');
          blocks.push(block);
        }
        const paths = new Map(blocks.map(block => [block.id, block.address]));
        return blocks.map(block => publicEntry(block, { did, site: website, channel, paths }));
      } catch (error) {
        if (fallback && error instanceof ContentError && (error.status >= 500 || (!listed && error.status === 404))) {
          return fallback.read({ channel });
        }
        throw error;
      }
    },

    async listFriends({ channel, viewerToken }) {
      if (!hasToken(viewerToken)) return [];
      const ids = await list(channel, 'friends', viewerToken);
      const entries = [];
      for (const id of ids) {
        const entry = await friend(id, channel, viewerToken);
        if (entry) entries.push(entry);
      }
      return entries;
    },

    async getFriend({ channel, id, viewerToken }) {
      if (!hasToken(viewerToken) || typeof id !== 'string' || !id) return undefined;
      return friend(id, channel, viewerToken);
    },

    async readMedia({ name, width, viewerToken }) {
      if (!hasToken(viewerToken)) throw new ContentError('A viewer token is required', 401);
      if (!MEDIA_NAME.test(name)) throw new ContentError('Invalid media name', 400);
      const response = await request('getMedia', { name, ...(width === undefined ? {} : { width }) }, viewerToken);
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'private, no-store');
      return new Response(response.body, { status: response.status, headers });
    },
  };
}

/** A request-time Astro live loader. Pass the viewer token in each lookup. */
export function ohmLive({ source, channel }) {
  if (typeof source?.listFriends !== 'function' || typeof source?.getFriend !== 'function') {
    throw new Error('An ohm live loader needs a Friends source');
  }
  if (typeof channel !== 'string' || !channel.trim()) throw new Error('Choose a channel for this collection');
  return {
    name: 'ohm-friends',
    async loadCollection({ filter }) {
      try {
        return { entries: await source.listFriends({ channel, viewerToken: filter?.viewerToken }) };
      } catch (error) {
        return { error: liveError(error) };
      }
    },
    async loadEntry({ filter }) {
      try {
        const entry = await source.getFriend({ channel, id: filter?.id, viewerToken: filter?.viewerToken });
        // Astro includes the lookup filter in its own not-found error.
        return entry ?? { error: new ContentError('Friends entry not found', 404) };
      } catch (error) {
        return { error: liveError(error) };
      }
    },
  };
}

function liveError(error) {
  // Request filters can contain credentials. Keep service messages and causes out of Astro errors.
  return error instanceof ContentError
    ? new ContentError(error.message, error.status)
    : new ContentError('Could not load Friends content', 502);
}
