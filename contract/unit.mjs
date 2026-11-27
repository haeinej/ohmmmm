// A unit: anything in a person's home, as every part of ohm reads it (docs/plans/units.md). Blocks,
// channels, the profile and its wallet, the agents' files and the site's content files each keep their
// own reader and rules; this turns what those readers return into one shape, so the app, the bridge,
// tools and the feed read one list. A unit is a contract in code, never a record: it is never written to
// a PDS and has no lexicon of its own. A block or a channel names its record's lexicon (`nsid`); a unit
// with no record of its own carries none.
//
// Nothing here touches a disk: callers hand in the files of each part as { path, text, mtime } and get
// units back, so this runs on a machine, in a Worker and in the browser. home/units.mjs reads a home.
import { nodeKey, readVault } from '../vault/vault/node.mjs';
import { readProperties, splitFile } from '../vault/vault/file.mjs';

export const BLOCK_NSID = 'com.ohmmmm.vault.block';
export const CHANNEL_NSID = 'com.ohmmmm.vault.channel';
export const UNIT_TYPES = ['block', 'channel', 'profile', 'wallet', 'observation', 'skill', 'tool', 'memory', 'artifact'];
// The parts of a home, by the names people see.
export const ROOTS = ['collections', 'profile', 'agents', 'site', 'tools'];

const OPENNESS = { private: 0, friends: 1, public: 2 };
const text = value => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const join = (...parts) => parts.filter(Boolean).join('/');
const isoOf = mtime => (mtime == null ? undefined : new Date(mtime).toISOString());
const compact = unit => Object.fromEntries(Object.entries(unit).filter(([, value]) => value !== undefined));
const propertiesOf = content => readProperties(splitFile(content).head).properties;
// A block's opening words for a post card: its text without Markdown's marks, at most 280 characters.
export const EXCERPT_LENGTH = 280;
export function excerptOf(body) {
  const plain = String(body ?? '')
    .replace(/^```[\s\S]*?^```/gm, ' ')
    .replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ').trim();
  return plain.length > EXCERPT_LENGTH ? `${plain.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…` : plain;
}

// ---- Collections: blocks and channels, read by the vault's own reader ----

// A block's cover, for its card: the first picture it shows. An embedded file (![[photo.jpg]]) is named
// `collections:<path>` beside the block, the way the vault keeps it; an address stays as it is.
const PICTURE = /\.(?:png|jpe?g|gif|webp|avif|svg)$/i;
function blockCover(block) {
  const body = String(block.body ?? '');
  const embed = /!\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/.exec(body)?.[1]?.trim();
  if (embed && PICTURE.test(embed)) return `collections:${embed.includes('/') ? embed : [block.home, embed].filter(Boolean).join('/')}`;
  const image = /!\[[^\]]*\]\(([^)\s]+)[^)]*\)/.exec(body)?.[1];
  if (image && /^https?:\/\//i.test(image)) return image;
  return undefined;
}

function collectionUnits(folder, files) {
  const mtimes = new Map(files.map(file => [file.path, file.mtime]));
  const vault = readVault(files.map(({ path, text: content }) => ({ path, text: content })));
  const blocks = vault.blocks.map(block => compact({
    key: nodeKey(block), type: 'block', kind: block.kind, nsid: BLOCK_NSID, root: 'collections',
    path: join(folder, block.path), id: block.id, title: block.title ?? block.slug,
    visibility: block.visibility, channels: [...new Set([block.home, ...block.channels].filter(Boolean))],
    by: block.by, origin: block.origin, created: block.created,
    // A short post is all its words (at most 300); any other block its opening ones.
    excerpt: (block.kind === 'short' ? String(block.body ?? '').trim() : excerptOf(block.body)) || undefined,
    cover: blockCover(block),
    updated: block.updated ?? isoOf(mtimes.get(block.path)),
  }));
  // A channel is as open as the most open block it holds, here or in a channel inside it.
  const openness = new Map();
  for (const block of blocks) {
    for (const channel of block.channels) {
      for (let at = channel; at; at = at.split('/').slice(0, -1).join('/')) {
        openness.set(at, Math.max(openness.get(at) ?? 0, OPENNESS[block.visibility] ?? 0));
      }
    }
  }
  const visibilityOf = path => Object.keys(OPENNESS).find(name => OPENNESS[name] === (openness.get(path) ?? 0));
  const channels = vault.channels.map(channel => {
    const file = join(channel.path, '_channel.md');
    const parent = channel.path.split('/').slice(0, -1).join('/');
    const latest = blocks.filter(block => block.channels.includes(channel.path)).map(block => block.updated).filter(Boolean).sort().at(-1);
    return compact({
      key: nodeKey(channel), type: 'channel', kind: channel.kind ?? 'collection', nsid: CHANNEL_NSID, root: 'collections',
      path: join(folder, mtimes.has(file) ? file : channel.path), id: channel.id,
      title: channel.title ?? channel.path.split('/').at(-1), visibility: visibilityOf(channel.path),
      channels: parent ? [parent] : [], updated: [isoOf(mtimes.get(file)), latest].filter(Boolean).sort().at(-1),
      // How many blocks it holds, here or in a channel inside it, and the newest few by title, for its tile.
      count: blocks.filter(block => block.channels.some(at => at === channel.path || at.startsWith(`${channel.path}/`))).length,
      excerpt: blocks.filter(block => block.channels.includes(channel.path)).sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''))
        .slice(0, 4).map(block => block.title).filter(Boolean).join(' · ') || undefined,
    });
  });
  return [...channels, ...blocks];
}

// ---- The profile and its wallet ----

function profileUnits(folder, files) {
  const file = files.find(each => each.path === 'profile.md');
  if (!file) return [];
  const properties = propertiesOf(file.text);
  const path = join(folder, file.path);
  const updated = isoOf(file.mtime);
  const units = [compact({
    key: `profile:${file.path}`, type: 'profile', root: 'profile', path,
    title: text(properties.name) ?? text(properties.handle) ?? 'Profile', visibility: 'public', updated,
  })];
  const wallet = text(properties.wallet);
  if (wallet) units.push({ key: `wallet:${wallet}`, type: 'wallet', root: 'profile', path, id: wallet, title: wallet, visibility: 'public', channels: [], ...(updated ? { updated } : {}) });
  return units;
}

// ---- Agents: the cortex's files, which are always private ----

function agentUnit(folder, file) {
  const segments = file.path.split('/');
  const properties = propertiesOf(file.text);
  const base = { root: 'agents', path: join(folder, file.path), visibility: 'private', channels: [], updated: isoOf(file.mtime) };
  if (file.path === 'profile.md') return compact({ ...base, key: `agents:${file.path}`, type: 'memory', title: 'What your agents know about you' });
  if (segments[0] === 'observations' && segments.length === 2 && segments[1].endsWith('.md')) {
    const id = segments[1].replace(/\.md$/, '');
    const firstLine = splitFile(file.text).body.trim().split('\n')[0];
    return compact({ ...base, key: `agents:${file.path}`, type: 'observation', id, title: text(firstLine)?.slice(0, 300) ?? id, by: text(properties.by), created: text(properties.at) });
  }
  if (segments[0] === 'skills' && segments.length === 3 && segments[2] === 'SKILL.md') {
    return compact({ ...base, key: `agents:${file.path}`, type: 'skill', id: segments[1], title: text(properties.name) ?? segments[1] });
  }
  if (segments[0] === 'tools' && segments.length === 2 && segments[1].endsWith('.md')) {
    const id = segments[1].replace(/\.md$/, '');
    return compact({ ...base, key: `agents:${file.path}`, type: 'tool', id, title: text(properties.name) ?? id });
  }
  return null;
}

// ---- Site: its content files are artifacts; layout, scripts and styles are not ----

const ARTIFACT_KINDS = {
  page: ['md', 'mdx', 'markdown', 'html', 'htm'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg'],
  video: ['mp4', 'webm', 'mov'],
  audio: ['mp3', 'wav', 'ogg', 'm4a'],
  document: ['pdf'],
};
const SKIPPED = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'vendor']);
// Files a site keeps for others, not as content: a search engine's ownership check.
const NOT_CONTENT = /^google[0-9a-f]+\.html$|^BingSiteAuth\.xml$|^yandex_[0-9a-f]+\.html$/i;
export function artifactKind(path) {
  const segments = String(path).split('/');
  if (segments.some(segment => segment.startsWith('.') || SKIPPED.has(segment))) return null;
  if (NOT_CONTENT.test(segments.at(-1))) return null;
  const extension = segments.at(-1).split('.').at(-1).toLowerCase();
  return Object.keys(ARTIFACT_KINDS).find(kind => ARTIFACT_KINDS[kind].includes(extension)) ?? null;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const unescape = value => value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, name) => name[0] === '#'
  ? String.fromCodePoint(name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1)))
  : ENTITIES[name.toLowerCase()] ?? all);
// A page's own name: a Markdown page's title property, an HTML page's <title>; else, for an index page,
// its folder's name, and for any other its file's name.
function pageTitle(path, content) {
  if (typeof content === 'string') {
    if (/\.html?$/i.test(path)) {
      const found = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(content);
      const said = found && unescape(found[1]).replace(/\s+/g, ' ').trim();
      if (said) return said;
    } else {
      const said = text(propertiesOf(content).title);
      if (said) return said;
    }
  }
  const segments = path.split('/');
  return /^index\.(html?|md|mdx|markdown)$/i.test(segments.at(-1)) && segments.length > 1 ? segments.at(-2) : segments.at(-1);
}
// What a page says about itself: an HTML page's description, a Markdown page's description property.
function pageDescription(path, content) {
  if (typeof content !== 'string') return undefined;
  const said = /\.html?$/i.test(path)
    ? (() => { const meta = /<meta[^>]+name=["']description["'][^>]*>/i.exec(content)?.[0]; return meta && /content=["']([^"']*)["']/i.exec(meta)?.[1]; })()
    : propertiesOf(content).description;
  const plain = typeof said === 'string' ? unescape(said).replace(/\s+/g, ' ').trim() : '';
  return plain ? plain.slice(0, EXCERPT_LENGTH) : undefined;
}
// The site's name its pages repeat after their own (`collisions — Haein Jung`): the ending most pages share.
function siteSuffix(titles) {
  const counts = new Map();
  for (const title of titles) {
    const found = /\s+[—–|·-]\s+([^—–|·]+)$/.exec(title);
    if (found) counts.set(found[0], (counts.get(found[0]) ?? 0) + 1);
  }
  const [best, count] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [];
  return best && count >= 2 && count >= titles.length / 3 ? best : null;
}

// A page's cover, for its card: what it says to show when it is shared (og:image, twitter:image), or else
// its first picture. An address stays as it is; a path is made one from the top of the site.
// An address on the site's own domain is its file in the checkout: shown from this computer, as saved.
function pageCover(path, content, domain) {
  if (typeof content !== 'string' || !/\.html?$/i.test(path)) return undefined;
  const meta = /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*>/i.exec(content)?.[0];
  let said = (meta && /content=["']([^"']+)["']/i.exec(meta)?.[1]) ?? /<img[^>]+src=["']([^"']+)["']/i.exec(content)?.[1];
  if (!said || said.startsWith('data:')) return undefined;
  said = unescape(said);
  if (/^https?:\/\//i.test(said)) {
    const url = URL.canParse(said) ? new URL(said) : null;
    const own = url && domain && url.hostname.replace(/^www\./, '') === String(domain).replace(/^www\./, '').toLowerCase();
    if (!own) return said;
    said = decodeURIComponent(url.pathname);
  }
  const base = said.startsWith('/') ? [] : path.split('/').slice(0, -1);
  const parts = [...base];
  for (const part of said.replace(/^\//, '').split(/[?#]/)[0].split('/')) {
    if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part);
  }
  return parts.length ? `site:${parts.join('/')}` : undefined;
}

function siteUnits(folder, files, domain) {
  const pages = files.map(file => ({ file, kind: artifactKind(file.path) })).filter(each => each.kind);
  const titles = new Map(pages.filter(each => each.kind === 'page').map(({ file }) => [file.path, pageTitle(file.path, file.text)]));
  const suffix = siteSuffix([...titles.values()]);
  return pages.map(({ file, kind }) => {
    const said = titles.get(file.path);
    const title = said && suffix && said.endsWith(suffix) && said.length > suffix.length ? said.slice(0, -suffix.length) : said;
    return compact({
      key: `site:${file.path}`, type: 'artifact', kind, root: 'site', path: join(folder, file.path),
      title: title ?? file.path.split('/').at(-1), visibility: 'public', channels: [], updated: isoOf(file.mtime),
      cover: kind === 'image' ? `site:${file.path}` : kind === 'page' ? pageCover(file.path, file.text, domain) : undefined,
      excerpt: kind === 'page' ? pageDescription(file.path, file.text) : undefined,
    });
  });
}

// ---- Kept websites and built tools: artifacts too ----

// A web page that isn't the person's, kept with their site (`site/.ohm/links.json`, the Artifacts channel):
// its address is its origin, what the page says about itself its title, words and cover. Kept for them, not
// published, so only they see it.
function linkUnits(folder, links) {
  return links.filter(link => typeof link?.url === 'string' && typeof link?.id === 'string').map(link => compact({
    key: `link:${link.id}`, type: 'artifact', kind: 'link', root: 'site', path: folder, id: link.id,
    title: text(link.title) ?? text(link.site) ?? link.url, origin: link.url, excerpt: text(link.description)?.slice(0, EXCERPT_LENGTH),
    cover: typeof link.image === 'string' && /^https?:\/\//i.test(link.image) ? link.image : undefined,
    visibility: 'private', channels: [], updated: text(link.saved),
    // Whether the page lets itself be shown in a frame, as the site's canvas shows it.
    frameable: link.frameable === true ? true : undefined,
  }));
}
// A tool the person's agent built for them, `tools/<name>/index.html` in the home: kept, and run, only here.
function toolUnits(folder, tools) {
  return tools.filter(tool => typeof tool?.name === 'string').map(tool => compact({
    key: `tools:${tool.name}`, type: 'artifact', kind: 'tool', root: 'tools', path: join(folder, tool.name, 'index.html'), id: tool.name,
    title: text(tool.title) ?? tool.name, excerpt: text(tool.description)?.slice(0, EXCERPT_LENGTH), by: text(tool.by),
    visibility: 'private', channels: [], updated: text(tool.changed),
  }));
}

/**
 * Every unit of a home, from its parts' files. Each part is { folder, files: [{ path, text, mtime }] }
 * with paths inside the part and `folder` the part's folder in the home; the site's may name its `domain`.
 * `links` is { path, links } (the kept websites and the file that keeps them) and `tools` { folder, tools } (collections/ or, in a home made
 * before, vault/). A site file that is not a page may come without text.
 */
export function unitsOf({ collections, profile, agents, site, links, tools } = {}) {
  return [
    ...(profile ? profileUnits(profile.folder, profile.files) : []),
    ...(agents ? agents.files.map(file => agentUnit(agents.folder, file)).filter(Boolean) : []),
    ...(collections ? collectionUnits(collections.folder, collections.files) : []),
    ...(site ? siteUnits(site.folder, site.files, site.domain) : []),
    ...(links ? linkUnits(links.path, links.links) : []),
    ...(tools ? toolUnits(tools.folder, tools.tools) : []),
  ];
}

/** Who sees a unit: you see everything, a friend sees public and friends units, everyone sees public ones. */
export const sees = (audience, unit) =>
  audience === 'private' || unit.visibility === 'public' || (audience === 'friends' && unit.visibility === 'friends');

// What a feed is made of unless asked for more: your blocks worth seeing. A block with words or a picture,
// your site's pages, photographs and videos, the websites you kept, the tools built for you, and every
// channel with something in it. Agents' files, channels, the profile and the wallet are
// places, not posts; an empty block has nothing to show.
export const FEED_TYPES = ['block', 'artifact', 'channel'];
const FEED_ARTIFACTS = ['page', 'image', 'video', 'link', 'tool'];
const worthSeeing = unit => unit.type === 'artifact' ? FEED_ARTIFACTS.includes(unit.kind)
  : unit.type === 'channel' ? unit.count > 0
  : Boolean(unit.excerpt || unit.cover || unit.kind === 'media');
const inFeed = (unit, types) => (types ? types.includes(unit.type) : FEED_TYPES.includes(unit.type) && worthSeeing(unit));

/**
 * The feed: the units an audience sees, the latest change first. Units with no time come last.
 * @param {object[]} units
 * @param {{ audience?: string, types?: string[], limit?: number, before?: string }} [options]
 */
export function feed(units, { audience = 'private', types, limit = 100, before } = {}) {
  return units
    .filter(unit => sees(audience, unit) && inFeed(unit, types) && (!before || (unit.updated && unit.updated < before)))
    .sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? '') || a.key.localeCompare(b.key))
    .slice(0, limit);
}

// ---- One level of the home, for a tree that opens a folder at a time ----

const parentOf = path => path.split('/').slice(0, -1).join('/');
// The folder a unit is shown in: a channel is its own folder, a skill sits in skills/ (its folder is
// the skill), and anything else in the folder its file is in.
export const folderOf = unit => unit.type === 'channel' ? unit.path.replace(/\/_channel\.md$/, '')
  : unit.type === 'skill' ? parentOf(parentOf(unit.path))
  : parentOf(unit.path);
const placeOf = unit => (unit.type === 'channel' ? parentOf(folderOf(unit)) : folderOf(unit));
const rootRank = name => { const at = ROOTS.indexOf(name); return at < 0 ? ROOTS.length : at; };

/**
 * What a tree shows when `folder` (a path from the top of the home, '' for the top) is opened: the
 * folders right inside it, each with its channel when it is one and how many units are under it, and
 * the units right in it. A block collected into another channel shows there too, as in a channel view.
 */
export function levelOf(units, folder = '') {
  const inside = path => (folder ? path.startsWith(`${folder}/`) : path !== '');
  const childFolder = path => (folder ? path.slice(folder.length + 1) : path).split('/')[0];
  const folders = new Map();
  const touch = name => {
    const path = folder ? `${folder}/${name}` : name;
    if (!folders.has(path)) folders.set(path, { path, title: name, count: 0 });
    return folders.get(path);
  };
  // What is kept in a hidden folder (the site's .ohm/, its kept websites) is not a folder of the tree.
  units = units.filter(unit => !placeOf(unit).split('/').some(part => part.startsWith('.')));
  for (const unit of units) {
    const own = unit.type === 'channel' ? folderOf(unit) : null;
    if (own && parentOf(own) === folder) Object.assign(touch(own.split('/').at(-1)), { unit, title: unit.title });
    const place = placeOf(unit);
    if (place !== folder && inside(place)) touch(childFolder(place)).count++;
  }
  // Collections' blocks collected into a channel besides their home channel.
  const collections = units.find(unit => unit.root === 'collections')?.path.split('/')[0];
  const channelHere = collections && folder.startsWith(`${collections}/`) ? folder.slice(collections.length + 1) : null;
  const here = units.filter(unit => unit.type !== 'channel' && (placeOf(unit) === folder
    || (channelHere && unit.type === 'block' && unit.channels?.includes(channelHere))));
  return {
    folder,
    folders: [...folders.values()].sort((a, b) => (folder ? 0 : rootRank(a.path) - rootRank(b.path)) || a.title.localeCompare(b.title)),
    units: [...new Map(here.map(unit => [unit.key, unit])).values()].sort((a, b) => (a.title ?? '').localeCompare(b.title ?? '')),
  };
}
