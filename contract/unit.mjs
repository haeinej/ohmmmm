// A unit: anything in a person's home, as every part of ohm reads it (docs/plans/units.md). Blocks,
// channels, the profile and its wallet, the agents' files and the site's content files each keep their
// own reader and rules; this turns what those readers return into one envelope, com.ohmmmm.unit
// (vault/lexicons/com/ohmmmm/unit.json), so the app, the bridge, tools and the feed read one list.
//
// Nothing here touches a disk: callers hand in the files of each part as { path, text, mtime } and get
// units back, so this runs on a machine, in a Worker and in the browser. home/units.mjs reads a home.
import { nodeKey, readVault } from '../vault/vault/node.mjs';
import { readProperties, splitFile } from '../vault/vault/file.mjs';

export const UNIT_NSID = 'com.ohmmmm.unit';
export const BLOCK_NSID = 'com.ohmmmm.vault.block';
export const CHANNEL_NSID = 'com.ohmmmm.vault.channel';
export const UNIT_TYPES = ['block', 'channel', 'profile', 'wallet', 'observation', 'skill', 'tool', 'memory', 'artifact'];
// The parts of a home, by the names people see.
export const ROOTS = ['collections', 'profile', 'agents', 'site'];

const OPENNESS = { private: 0, friends: 1, public: 2 };
const text = value => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const join = (...parts) => parts.filter(Boolean).join('/');
const isoOf = mtime => (mtime == null ? undefined : new Date(mtime).toISOString());
const compact = unit => Object.fromEntries(Object.entries(unit).filter(([, value]) => value !== undefined));
const propertiesOf = content => readProperties(splitFile(content).head).properties;

// ---- Collections: blocks and channels, read by the vault's own reader ----

function collectionUnits(folder, files) {
  const mtimes = new Map(files.map(file => [file.path, file.mtime]));
  const vault = readVault(files.map(({ path, text: content }) => ({ path, text: content })));
  const blocks = vault.blocks.map(block => compact({
    key: nodeKey(block), type: 'block', kind: block.kind, nsid: BLOCK_NSID, root: 'collections',
    path: join(folder, block.path), id: block.id, title: block.title ?? block.slug,
    visibility: block.visibility, channels: [...new Set([block.home, ...block.channels].filter(Boolean))],
    by: block.by, origin: block.origin, created: block.created,
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
    key: `profile:${file.path}`, type: 'profile', nsid: UNIT_NSID, root: 'profile', path,
    title: text(properties.name) ?? text(properties.handle) ?? 'Profile', visibility: 'public', updated,
  })];
  const wallet = text(properties.wallet);
  if (wallet) units.push({ key: `wallet:${wallet}`, type: 'wallet', nsid: UNIT_NSID, root: 'profile', path, id: wallet, title: wallet, visibility: 'public', channels: [], ...(updated ? { updated } : {}) });
  return units;
}

// ---- Agents: the cortex's files, which are always private ----

function agentUnit(folder, file) {
  const segments = file.path.split('/');
  const properties = propertiesOf(file.text);
  const base = { nsid: UNIT_NSID, root: 'agents', path: join(folder, file.path), visibility: 'private', channels: [], updated: isoOf(file.mtime) };
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
export function artifactKind(path) {
  const segments = String(path).split('/');
  if (segments.some(segment => segment.startsWith('.') || SKIPPED.has(segment))) return null;
  const extension = segments.at(-1).split('.').at(-1).toLowerCase();
  return Object.keys(ARTIFACT_KINDS).find(kind => ARTIFACT_KINDS[kind].includes(extension)) ?? null;
}

function siteUnits(folder, files) {
  return files.flatMap(file => {
    const kind = artifactKind(file.path);
    if (!kind) return [];
    const title = kind === 'page' && typeof file.text === 'string' ? text(propertiesOf(file.text).title) : undefined;
    return [compact({
      key: `site:${file.path}`, type: 'artifact', kind, nsid: UNIT_NSID, root: 'site', path: join(folder, file.path),
      title: title ?? file.path.split('/').at(-1), visibility: 'public', channels: [], updated: isoOf(file.mtime),
    })];
  });
}

/**
 * Every unit of a home, from its parts' files. Each part is { folder, files: [{ path, text, mtime }] }
 * with paths inside the part and `folder` the part's folder in the home (collections/ or, in a home made
 * before, vault/). A site file that is not a page may come without text.
 */
export function unitsOf({ collections, profile, agents, site } = {}) {
  return [
    ...(profile ? profileUnits(profile.folder, profile.files) : []),
    ...(agents ? agents.files.map(file => agentUnit(agents.folder, file)).filter(Boolean) : []),
    ...(collections ? collectionUnits(collections.folder, collections.files) : []),
    ...(site ? siteUnits(site.folder, site.files) : []),
  ];
}

/** Who sees a unit: you see everything, a friend sees public and friends units, everyone sees public ones. */
export const sees = (audience, unit) =>
  audience === 'private' || unit.visibility === 'public' || (audience === 'friends' && unit.visibility === 'friends');

/** The feed: the units an audience sees, the latest change first. Units with no time come last. */
export function feed(units, { audience = 'private', types, limit = 100, before } = {}) {
  return units
    .filter(unit => sees(audience, unit) && (!types || types.includes(unit.type)) && (!before || (unit.updated && unit.updated < before)))
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
