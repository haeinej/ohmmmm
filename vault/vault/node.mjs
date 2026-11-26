// A vault as a folder: blocks, channels, entities and sources, each a file, and the evidence that
// joins them, read from the files themselves. Nothing here touches a disk or a network: callers hand
// in { path, text } pairs and write out what they get back, so this runs on a machine and in a Worker.
//
//   writing/                      a folder is a channel
//     _channel.md                 the channel's own properties; its body is the description
//     trap-of-independency.md     a block. Its folder is its home channel
//   _entities/person/ada.md       an entity
//   _sources/<id>/source.json     a source, with extracted.md and original.<ext> beside it
//
// The schemas are lexicons/com/ohmmmm/vault/*.json. A file that was a post (it has a visibility
// property) is read as a block of kind post, through vault/file.mjs, so nothing that syncs posts
// changes. Evidence is only what the content shows; a model's conclusions belong to the cortex (`cortex/`).
import { FILE_TYPES, graphemes, isSlug, kindOf as mediaKind, VaultProblem, VISIBILITIES } from './core.mjs';
import { filePost, isPostId, newPostId, postFile, postProblems, readProperties, slugOf, splitFile, writeNoteFile } from './file.mjs';

// wallet and artifact: the profile's wallet and the site's content files, read as blocks (docs/plans/units.md).
export const BLOCK_KINDS = ['text', 'excerpt', 'link', 'media', 'file', 'code', 'post', 'wallet', 'artifact'];
export const CHANNEL_KINDS = ['collection', 'concept', 'import'];
export const ENTITY_KINDS = ['person', 'work', 'place', 'org'];
export const SOURCE_KINDS = ['page', 'post', 'file', 'image', 'video', 'audio', 'thread', 'book', 'other'];
export const RETAIN = ['reference', 'text', 'full'];
export const STATUSES = ['kept', 'archived'];
// Words older vaults still hold, read as if absent: a block once `status: proposed` (the inbox's
// mark) is an ordinary block, and a channel once `kind: inbox` is a collection.
const RETIRED_STATUSES = ['proposed'];
const RETIRED_CHANNEL_KINDS = ['inbox'];
export const EDGE_KINDS = ['contains', 'links', 'embeds', 'mentions', 'from', 'quotes'];

// The properties each kind of file holds, in the order they are written. `id` is always written last.
export const BLOCK_FIELDS = ['kind', 'title', 'slug', 'channels', 'origin', 'from', 'excerpt', 'tags', 'by', 'status', 'visibility', 'created', 'updated'];
// Which layer a block is kept in, and so who can read it: public on the PDS, friends readable by the
// vault service and the friends chosen, private encrypted with keys only on the member's devices.
// A block that does not say is private. See plans/encryption.md.
export { VISIBILITIES };
export const DEFAULT_VISIBILITY = 'private';
// Properties a post file never has. A file with visibility, no kind, and none of these is a post
// file, as every post file written before blocks existed is; with any of them it is a block.
const BLOCK_ONLY = ['origin', 'from', 'excerpt', 'by', 'status', 'created', 'updated'];
const given = value => value !== undefined && value !== null && value !== '';
export const CHANNEL_FIELDS = ['title', 'kind', 'order', 'site'];
export const ENTITY_FIELDS = ['name', 'aliases', 'uri'];
export const SOURCE_FIELDS = ['kind', 'uri', 'platform', 'platformId', 'title', 'author', 'publishedAt', 'capturedAt', 'retain', 'meta'];

export const CHANNEL_FILE = '_channel.md';
export const ENTITIES = '_entities';
export const SOURCES = '_sources';
// Every node is given its ID once, the way a post is, and it sorts by when it was made.
export const newNodeId = newPostId;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const list = value => (value === undefined || value === null || value === '' ? [] : [value].flat().map(String).map(each => each.trim()).filter(Boolean));
const unique = values => [...new Set(values)];
const isDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const segmentOk = name => typeof name === 'string' && name !== '' && name === name.trim() && !/[\\\u0000-\u001f]/.test(name) && !/^[._]/.test(name);
// A channel's path: its folders from the top of the vault, joined by "/".
export const isChannelPath = path => typeof path === 'string' && path.split('/').every(segmentOk);

// Where an original lives, by how its origin is written. Google Drive counts whether it is named
// gdrive:... or by the folder Google Drive for desktop mounts.
export function originKind(origin) {
  if (typeof origin !== 'string' || !origin.trim() || origin !== origin.trim()) return null;
  if (/^gdrive:/i.test(origin) || /\/Library\/CloudStorage\/GoogleDrive-/.test(origin)) return 'drive';
  if (/^https?:\/\//i.test(origin)) return URL.canParse(origin) ? 'web' : null;
  if (/^at:\/\/[^/\s]+/.test(origin)) return 'atproto';
  if (/^(?:\/|~\/|[A-Za-z]:[\\/])/.test(origin)) return 'local';
  return null;
}

// What a block is, read from its content when its author did not say: one fenced block of code is
// code, one embedded file is media or a file, one address is a link, and anything else is text.
export function inferKind(body) {
  const content = String(body ?? '').trim();
  const fences = content.split('\n').filter(line => /^\s{0,3}(`{3,}|~{3,})/.test(line));
  if (fences.length === 2 && /^(`{3,}|~{3,})/.test(content) && /(`{3,}|~{3,})$/.test(content)) return 'code';
  const embed = /^!\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/.exec(content);
  if (embed) {
    const mime = FILE_TYPES[`.${embed[1].trim().split('.').at(-1).toLowerCase()}`];
    return mime && mediaKind(mime) !== 'file' ? 'media' : 'file';
  }
  if (/^<?https?:\/\/\S+>?$/i.test(content)) return 'link';
  return 'text';
}

// ---- Reading one file ----

function where(path) {
  const segments = String(path).split('/').filter(Boolean);
  if (!segments.length || segments.some(segment => segment.startsWith('.'))) return null;
  const file = segments.at(-1);
  if (segments[0] === SOURCES) return segments.length === 3 && file === 'source.json' ? { type: 'source', id: segments[1] } : null;
  if (segments[0] === ENTITIES) return segments.length === 3 && /\.md$/i.test(file) ? { type: 'entity', kind: segments[1], name: file.replace(/\.md$/i, '') } : null;
  const folders = segments.slice(0, -1);
  if (folders.some(segment => segment.startsWith('_'))) return null;
  if (file === CHANNEL_FILE) return folders.length ? { type: 'channel', path: folders.join('/') } : null;
  if (!/\.md$/i.test(file) || file.startsWith('_')) return null;
  return { type: 'block', home: folders.join('/'), name: file.replace(/\.md$/i, '') };
}

const rest = (properties, known) => Object.fromEntries(Object.entries(properties).filter(([key, value]) => !known.includes(key) && key !== 'id' && value !== null && value !== ''));

function readId(properties, problems) {
  if (properties.id === undefined || properties.id === null) return undefined;
  const id = String(properties.id);
  if (isPostId(id)) return id;
  problems.push('The id property is not one this vault gave. Remove it, and the file will be given a new one.');
  return undefined;
}

function readBlock(place, path, text_) {
  const { head, body } = splitFile(text_);
  const { properties, problems } = readProperties(head);
  const kindSaid = properties.kind ?? undefined;
  // A post keeps every rule a post has: the same reader, the same writer, the same version. A file
  // is a post when it says so, or when it is a post file as the post code writes one: visibility,
  // no kind, and nothing only a block has.
  const postFile = given(properties.visibility) && !BLOCK_ONLY.some(key => given(properties[key]));
  if (kindSaid === 'post' || (kindSaid === undefined && postFile)) {
    const read = filePost(path, text_);
    const channels = list(read.post.properties.channels).filter(channel => channel !== place.home);
    return {
      node: {
        type: 'block', kind: 'post', path, home: place.home, slug: read.post.slug,
        ...(read.post.id ? { id: read.post.id } : {}),
        ...(read.post.title ? { title: read.post.title } : {}),
        channels, visibility: read.post.visibility, body: read.post.body, post: read.post,
      },
      problems: [...read.problems, ...channelProblems(channels)],
    };
  }
  const slug = properties.slug === undefined || properties.slug === null ? slugOf(place.name) : String(properties.slug);
  if (!isSlug(slug)) problems.push(`"${place.name}" does not make a slug. Add a slug property in lowercase Latin letters, digits and hyphens.`);
  const id = readId(properties, problems);
  const content = body.trim();
  const kind = kindSaid === undefined || kindSaid === null ? inferKind(content) : String(kindSaid);
  const title = text(properties.title);
  if (title && graphemes(title) > 300) problems.push('A title is at most 300 characters');
  const channels = unique(list(properties.channels)).filter(channel => channel !== place.home);
  problems.push(...channelProblems(channels));
  const origin = text(properties.origin);
  if (origin && !originKind(origin)) problems.push('The origin is a local path (starting / or ~/), a Google Drive path (gdrive:...), an HTTP(S) address or an AT URI');
  const from = text(properties.from);
  if (from !== undefined && !isPostId(from)) problems.push('The from property is the ID of a source in this vault');
  const excerpt = properties.excerpt ?? undefined;
  if (excerpt !== undefined && excerpt !== null) {
    if (!isObject(excerpt) || typeof excerpt.quote !== 'string' || !excerpt.quote.trim()) problems.push('An excerpt is written {"quote": "the exact words"}, with prefix, suffix and position if known');
    else if (!from) problems.push('An excerpt says which source it is from, with the from property');
  }
  const by = text(properties.by);
  if (by && by !== 'me' && !/^agent:[A-Za-z0-9._-]+$/.test(by)) problems.push('by is me, or agent: and the agent\'s name');
  const statusSaid = text(properties.status);
  const status = RETIRED_STATUSES.includes(statusSaid) ? undefined : statusSaid;
  if (status && !STATUSES.includes(status)) problems.push(`status is one of: ${STATUSES.join(', ')}`);
  const saidVisibility = text(properties.visibility);
  const visibility = VISIBILITIES.includes(saidVisibility) ? saidVisibility : DEFAULT_VISIBILITY;
  if (saidVisibility && visibility !== saidVisibility) problems.push(`visibility is one of: ${VISIBILITIES.join(', ')}. This block is treated as private.`);
  for (const name of ['created', 'updated']) if (properties[name] != null && !isDate(String(properties[name]))) problems.push(`${name} is a date`);
  const tags = unique(list(properties.tags).map(tag => tag.replace(/^#/, '')));
  return {
    node: {
      type: 'block', kind, ...(kindSaid !== undefined && kindSaid !== null ? { kindGiven: true } : {}),
      path, home: place.home, slug, ...(id ? { id } : {}),
      ...(title ? { title } : {}),
      ...(properties.slug !== undefined && properties.slug !== null ? { slugGiven: true } : {}),
      channels,
      ...(origin ? { origin } : {}),
      ...(from ? { from } : {}),
      ...(isObject(excerpt) ? { excerpt } : {}),
      ...(tags.length ? { tags } : {}),
      ...(by ? { by } : {}), ...(status ? { status } : {}),
      visibility, ...(saidVisibility ? { visibilityGiven: true } : {}),
      ...(properties.created != null ? { created: String(properties.created) } : {}),
      ...(properties.updated != null ? { updated: String(properties.updated) } : {}),
      body: content, properties: rest(properties, BLOCK_FIELDS),
    },
    problems,
  };
}

const channelProblems = channels => channels.filter(channel => !isChannelPath(channel))
  .map(channel => `"${channel}" is not a channel's path: folders joined by "/", none starting with "." or "_"`);

function readChannel(place, text_) {
  const { head, body } = splitFile(text_);
  const { properties, problems } = readProperties(head);
  const id = readId(properties, problems);
  const kindSaid = text(properties.kind);
  const kind = RETIRED_CHANNEL_KINDS.includes(kindSaid) ? undefined : kindSaid;
  if (kind && !CHANNEL_KINDS.includes(kind)) problems.push(`A channel's kind is one of: ${CHANNEL_KINDS.join(', ')}`);
  const site = properties.site ?? undefined;
  if (site !== undefined && site !== null && !(isObject(site) && text(site.label))) problems.push('site is written {"label": "Writings"}, with a sublabel if there is one');
  return {
    node: {
      type: 'channel', path: place.path, ...(id ? { id } : {}),
      ...(text(properties.title) ? { title: text(properties.title) } : {}),
      ...(kind ? { kind } : {}),
      order: unique(list(properties.order)),
      ...(isObject(site) ? { site } : {}),
      description: body.trim(), properties: rest(properties, CHANNEL_FIELDS),
    },
    problems,
  };
}

function readEntity(place, path, text_) {
  const { head, body } = splitFile(text_);
  const { properties, problems } = readProperties(head);
  if (!ENTITY_KINDS.includes(place.kind)) problems.push(`An entity sits in ${ENTITIES}/ under one of: ${ENTITY_KINDS.join(', ')}`);
  const slug = slugOf(place.name);
  if (!isSlug(slug)) problems.push(`"${place.name}" does not make a slug`);
  const id = readId(properties, problems);
  const uri = text(properties.uri);
  return {
    node: {
      type: 'entity', kind: place.kind, path, slug, ...(id ? { id } : {}),
      name: text(properties.name) ?? place.name,
      aliases: unique(list(properties.aliases)),
      ...(uri ? { uri } : {}),
      body: body.trim(), properties: rest(properties, ENTITY_FIELDS),
    },
    problems,
  };
}

function readSource(place, path, text_) {
  const problems = [];
  let value;
  try {
    value = JSON.parse(text_);
  } catch {
    return { node: null, problems: ['source.json is not JSON'] };
  }
  if (!isObject(value)) return { node: null, problems: ['source.json holds one object'] };
  if (!isPostId(place.id)) problems.push(`A source's folder is named with its ID, one this vault gave`);
  if (!SOURCE_KINDS.includes(value.kind)) problems.push(`A source's kind is one of: ${SOURCE_KINDS.join(', ')}`);
  if (!text(value.uri)) problems.push('A source says where it lives, in uri');
  if (!isDate(value.capturedAt)) problems.push('A source says when it was captured, in capturedAt');
  if (value.retain !== undefined && !RETAIN.includes(value.retain)) problems.push(`retain is one of: ${RETAIN.join(', ')}`);
  for (const name of ['platform', 'platformId', 'title', 'author']) if (value[name] !== undefined && typeof value[name] !== 'string') problems.push(`${name} is text`);
  if (value.publishedAt !== undefined && !isDate(value.publishedAt)) problems.push('publishedAt is a date');
  const unknown = Object.keys(value).filter(key => !SOURCE_FIELDS.includes(key) && key !== 'id');
  if (unknown.length) problems.push(`Put what else the connector found under meta: ${unknown.join(', ')}`);
  if (value.id !== undefined && value.id !== place.id) problems.push('The id in source.json differs from its folder\'s name');
  return { node: { type: 'source', path, id: place.id, ...Object.fromEntries(SOURCE_FIELDS.filter(key => value[key] !== undefined).map(key => [key, value[key]])) }, problems };
}

// One file as a node of the vault, and what in it could not be read. Null for a file that is not a
// node: an attachment, a file in a folder starting with "." or "_", an editor's settings.
export function readNode(path, text_) {
  const place = where(path);
  if (!place) return null;
  if (place.type === 'block') return readBlock(place, path, text_);
  if (place.type === 'channel') return readChannel(place, text_);
  if (place.type === 'entity') return readEntity(place, path, text_);
  return readSource(place, path, text_);
}

// ---- Writing one file ----

// A node as a file: where it goes, and its text. Read back, the file is the same node.
export function nodeFile(node) {
  if (node?.type === 'block' && node.kind === 'post') {
    const segments = node.home ? node.home.split('/') : [];
    if (segments.length > 2) throw new VaultProblem('A post sits at most two folders deep: its label, and a sublabel inside it');
    const channels = unique(node.channels ?? []);
    const { channels: _, ...properties } = node.post.properties ?? {};
    const post = {
      ...node.post, label: segments[0] ?? '', sublabel: segments[1] ?? '',
      properties: { ...properties, ...(channels.length ? { channels } : {}) },
    };
    const problems = postProblems(post);
    if (problems.length) throw new VaultProblem(problems.join('\n'));
    const file = postFile(post);
    return node.path && node.path.split('/').slice(0, -1).join('/') === node.home && slugOf(node.path.split('/').at(-1).replace(/\.md$/i, '')) === post.slug
      ? { ...file, path: node.path } : file;
  }
  if (node?.type === 'block') {
    if (!isSlug(node.slug)) throw new VaultProblem('A block\'s slug is lowercase Latin letters and digits joined by single hyphens');
    if (node.home && !isChannelPath(node.home)) throw new VaultProblem(`"${node.home}" is not a channel's path`);
    const problems = channelProblems(node.channels ?? []);
    if (problems.length) throw new VaultProblem(problems.join('\n'));
    const path = node.path ?? [node.home, `${node.slug}.md`].filter(Boolean).join('/');
    const named = slugOf(path.split('/').at(-1).replace(/\.md$/i, ''));
    const visibility = node.visibility ?? DEFAULT_VISIBILITY;
    if (!VISIBILITIES.includes(visibility)) throw new VaultProblem(`visibility is one of: ${VISIBILITIES.join(', ')}`);
    const writesVisibility = node.visibilityGiven || visibility !== DEFAULT_VISIBILITY;
    // A block that writes visibility and nothing only a block has would read back as a post file,
    // so it says its kind.
    const looksLikePost = writesVisibility && !BLOCK_ONLY.some(key => given(node[key]));
    const properties = {
      ...(node.kindGiven || node.kind !== inferKind(node.body) || looksLikePost ? { kind: node.kind } : {}),
      title: node.title,
      ...(node.slugGiven || named !== node.slug ? { slug: node.slug } : {}),
      ...(node.channels?.length ? { channels: unique(node.channels).filter(channel => channel !== node.home) } : {}),
      origin: node.origin, from: node.from, excerpt: node.excerpt,
      ...(node.tags?.length ? { tags: node.tags } : {}),
      by: node.by, status: node.status, ...(writesVisibility ? { visibility } : {}), created: node.created, updated: node.updated,
      ...node.properties,
      id: node.id,
    };
    return { path, text: writeNoteFile({ properties, body: node.body ?? '' }) };
  }
  if (node?.type === 'channel') {
    if (!isChannelPath(node.path)) throw new VaultProblem(`"${node.path}" is not a channel's path`);
    const properties = {
      title: node.title, kind: node.kind,
      ...(node.order?.length ? { order: node.order } : {}),
      site: node.site, ...node.properties, id: node.id,
    };
    return { path: `${node.path}/${CHANNEL_FILE}`, text: writeNoteFile({ properties, body: node.description ?? '' }) };
  }
  if (node?.type === 'entity') {
    if (!ENTITY_KINDS.includes(node.kind) || !isSlug(node.slug)) throw new VaultProblem(`An entity has a kind (${ENTITY_KINDS.join(', ')}) and a slug`);
    const path = node.path ?? `${ENTITIES}/${node.kind}/${node.slug}.md`;
    const named = path.split('/').at(-1).replace(/\.md$/i, '');
    const properties = {
      ...(node.name !== named ? { name: node.name } : {}),
      ...(node.aliases?.length ? { aliases: node.aliases } : {}),
      uri: node.uri, ...node.properties, id: node.id,
    };
    return { path, text: writeNoteFile({ properties, body: node.body ?? '' }) };
  }
  if (node?.type === 'source') {
    if (!isPostId(node.id)) throw new VaultProblem('A source has an ID this vault gave');
    const value = { id: node.id, ...Object.fromEntries(SOURCE_FIELDS.filter(key => node[key] !== undefined).map(key => [key, node[key]])) };
    return { path: `${SOURCES}/${node.id}/source.json`, text: `${JSON.stringify(value, null, 2)}\n` };
  }
  throw new VaultProblem('A node is a block, a channel, an entity or a source');
}

// ---- The whole vault ----

// The key a node is known by in the graph: its ID, or its path until it is given one.
export const nodeKey = node => node.type === 'channel'
  ? `channel:${node.id ?? node.path}`
  : `${node.type}:${node.id ?? node.path}`;

// Every file of a vault read together: the nodes, every channel including the folders with no
// _channel.md, and what could not be read, by path.
//   files:  [{ path, text }]
//   nodes:  nodes made elsewhere, such as the blocks the indexer makes for files in a read-only root,
//           each with its own `problems` list (may be empty)
//   former: what old names name now, from the journal (formerNames in names.mjs): { channels: Map
//           old path → path, blocks: Map old name → file }. A reference that only an old name
//           explains still counts, and is listed as something to tidy, never as a break.
export function readVault(files, { nodes = [], former } = {}) {
  const blocks = [], entities = [], sources = [], problems = [];
  const channels = new Map();
  const reads = [...files.map(({ path, text: content }) => [path, readNode(path, content)]),
    ...nodes.map(({ problems: said = [], ...node }) => [node.path, { node, problems: said }])];
  for (const [path, read] of reads) {
    if (!read) continue;
    if (read.problems.length) problems.push({ path, problems: read.problems });
    if (!read.node) continue;
    if (read.node.type === 'block') blocks.push(read.node);
    else if (read.node.type === 'entity') entities.push(read.node);
    else if (read.node.type === 'source') sources.push(read.node);
    else channels.set(read.node.path, read.node);
  }
  // A folder is a channel whether or not it has a _channel.md, and so is every folder above it.
  const folder = path => {
    for (let at = 1; path && at <= path.split('/').length; at++) {
      const part = path.split('/').slice(0, at).join('/');
      if (!channels.has(part)) channels.set(part, { type: 'channel', path: part, order: [], description: '', properties: {}, implicit: true });
    }
  };
  for (const block of blocks) folder(block.home);
  for (const path of [...channels.keys()]) folder(path);
  const report = (path, problem) => {
    const held = problems.find(each => each.path === path);
    if (held) held.problems.push(problem);
    else problems.push({ path, problems: [problem] });
  };
  if (former) renamed(blocks, channels, former, report);
  const bySlug = new Map(), byId = new Map();
  for (const node of [...blocks, ...entities, ...sources, ...channels.values()]) {
    if (!node.id) continue;
    if (byId.has(node.id)) report(node.path, `It carries the same id as ${byId.get(node.id).path}. A copied file needs its id property removed.`);
    else byId.set(node.id, node);
  }
  for (const block of blocks) {
    if (bySlug.has(block.slug)) report(block.path, `Its slug "${block.slug}" is also ${bySlug.get(block.slug).path}'s, so [[${block.slug}]] could mean either`);
    else bySlug.set(block.slug, block);
    for (const channel of block.channels) if (!channels.has(channel)) report(block.path, `It names the channel "${channel}", which is not a folder in this vault`);
    if (block.from && !sources.some(source => source.id === block.from)) report(block.path, `It is from the source ${block.from}, which is not in ${SOURCES}/`);
  }
  // A channel's items, in its own order: what it lists first, then the rest newest first.
  const items = path => {
    const channel = channels.get(path);
    if (!channel) return [];
    const inside = [
      ...[...channels.values()].filter(other => other.path.split('/').slice(0, -1).join('/') === path && other.path !== path),
      ...blocks.filter(block => block.home === path || block.channels.includes(path)),
    ];
    const name = node => (node.type === 'channel' ? node.path : node.slug);
    const listed = channel.order.map(each => inside.find(node => name(node) === each)).filter(Boolean);
    const others = inside.filter(node => !listed.includes(node))
      .sort((a, b) => String(b.created ?? b.id ?? '').localeCompare(String(a.created ?? a.id ?? '')) || name(a).localeCompare(name(b)));
    return [...listed, ...others];
  };
  return { blocks, channels: [...channels.values()].sort((a, b) => a.path.localeCompare(b.path)), entities, sources, problems, items, ...(former ? { former } : {}) };
}

// A name as references match it: trimmed, without .md, in lower case.
const referenceName = name => String(name).trim().replace(/\.md$/i, '').toLowerCase();

// The block an old name names now, if any: by the name, or by the slug made from it.
function formerBlock(former, blocks, name) {
  const path = former?.blocks?.get(referenceName(name)) ?? former?.blocks?.get(slugOf(referenceName(name)));
  return path ? blocks.find(block => block.path === path) : undefined;
}

// Puts old names in `channels` lists and `order` back on what they name now, and says so.
function renamed(blocks, channels, former, report) {
  const channelNow = name => {
    const to = former.channels?.get(name);
    return to !== undefined && to !== name && channels.has(to) ? to : undefined;
  };
  for (const block of blocks) {
    const now = block.channels.map(name => {
      if (channels.has(name)) return name;
      const to = channelNow(name);
      if (to) report(block.path, `It names the channel "${name}", which is "${to}" now. It still counts there; write "${to}" to tidy it`);
      return to ?? name;
    });
    block.channels = unique(now).filter(name => name !== block.home);
  }
  const slugs = new Set(blocks.map(block => block.slug));
  for (const channel of channels.values()) {
    if (!channel.order.length) continue;
    channel.order = unique(channel.order.map(name => {
      if (slugs.has(name) || channels.has(name)) return name;
      const to = channelNow(name) ?? formerBlock(former, blocks, name)?.slug;
      if (to) report(`${channel.path}/${CHANNEL_FILE}`, `Its order names "${name}", which is "${to}" now. It still counts; write "${to}" to tidy it`);
      return to ?? name;
    }));
  }
}

// ---- Evidence ----

// The block a written name means, as a [[link]] finds it: by slug, by path with or without .md, by
// file name, or by title (the first block to claim a name keeps it), then by the slug made from the
// name. Undefined when no block answers to it now.
export function blockResolver(vault) {
  const blockBy = new Map();
  for (const block of vault.blocks) {
    for (const name of [block.slug, block.path, block.path.replace(/\.md$/i, ''), block.path.split('/').at(-1).replace(/\.md$/i, ''), block.title].filter(Boolean)) {
      if (!blockBy.has(name.toLowerCase())) blockBy.set(name.toLowerCase(), block);
    }
  }
  return target => {
    const name = String(target).trim().replace(/\.md$/i, '').toLowerCase();
    return blockBy.get(name) ?? blockBy.get(slugOf(name));
  };
}

// The lines of a body that are prose, with their numbers: fenced code and `code spans` are left out,
// so an example in code never becomes a link.
function prose(body) {
  const lines = [];
  let fence = null;
  String(body ?? '').split('\n').forEach((line, index) => {
    const mark = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (mark && mark[0] === fence[0] && mark.length >= fence.length && !line.trim().slice(mark.length).trim()) fence = null;
    } else if (mark) {
      fence = mark;
    } else {
      lines.push({ line: index + 1, text: line.replace(/`+[^`\n]*`+/g, ' ') });
    }
  });
  return lines;
}

// Every edge the content shows: a channel contains what is in it, a block links to and embeds what
// its body points at, mentions the entities it names by @handle, and is from or quotes its source.
// Each edge says where it was read: `at` is the line of the body, or the property it came from.
// A target the vault does not have is kept, as missing:<what was written>, so nothing is dropped.
// A target only an old name explains (readVault's `former`) is found, and its edge says `former`:
// the name written, to tidy.
export function evidence(vault) {
  const edges = [];
  const add = (kind, from, to, at, former) => edges.push({ kind, from, to, at, ...(former ? { former } : {}) });
  const channelKey = path => nodeKey(vault.channels.find(channel => channel.path === path) ?? { type: 'channel', path });
  for (const channel of vault.channels) {
    const parent = channel.path.split('/').slice(0, -1).join('/');
    if (parent) add('contains', channelKey(parent), nodeKey(channel), 'folder');
  }
  const blockNamed = blockResolver(vault);
  const entityBy = new Map();
  for (const entity of vault.entities) {
    for (const name of [entity.slug, entity.name, ...entity.aliases]) entityBy.set(name.replace(/^@/, '').toLowerCase(), entity);
  }
  const resolve = target => {
    const name = target.trim().replace(/\.md$/i, '').toLowerCase();
    const block = blockNamed(target);
    if (block) return nodeKey(block);
    const entity = entityBy.get(name) ?? entityBy.get(slugOf(name));
    return entity ? nodeKey(entity) : null;
  };
  // What only an old name explains, from the journal (readVault's `former`): the edge says which name.
  const named = target => {
    const key = resolve(target);
    if (key) return { key };
    const block = formerBlock(vault.former, vault.blocks, target);
    return block ? { key: nodeKey(block), former: target.trim() } : { key: `missing:${target.trim()}` };
  };
  for (const block of vault.blocks) {
    const self = nodeKey(block);
    if (block.home) add('contains', channelKey(block.home), self, 'folder');
    for (const channel of block.channels) if (vault.channels.some(each => each.path === channel)) add('contains', channelKey(channel), self, 'channels');
    if (block.from) {
      const source = vault.sources.find(each => each.id === block.from);
      const key = source ? nodeKey(source) : `missing:${block.from}`;
      add(block.excerpt ? 'quotes' : 'from', self, key, block.excerpt ? 'excerpt' : 'from');
    }
    for (const value of [block.post?.connect ?? []].flat()) {
      const { key, former } = /^https?:\/\//i.test(value) ? { key: `url:${value}` } : /^at:\/\//.test(value) ? { key: `at:${value}` } : named(value);
      add('links', self, key, 'connect', former);
    }
    for (const { line, text: content } of prose(block.body)) {
      for (const [, target] of content.matchAll(/!\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) {
        const name = target.trim();
        const { key, former } = /\.[A-Za-z0-9]{1,5}$/.test(name) && !/\.md$/i.test(name) ? { key: `file:${name}` } : named(name);
        add('embeds', self, key, line, former);
      }
      for (const [, target] of content.replace(/!\[\[[^\]]*\]\]/g, ' ').matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
        const { key, former } = named(target);
        add('links', self, key, line, former);
      }
      for (const [, address] of content.matchAll(/(?<!!)\[[^\]]*\]\(\s*<?((?:https?|at):\/\/[^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
        add('links', self, address.startsWith('at:') ? `at:${address}` : `url:${address}`, line);
      }
      for (const [, handle] of content.matchAll(/(?<![\w.@/])@([A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9])/g)) {
        const entity = entityBy.get(handle.toLowerCase());
        if (entity) add('mentions', self, nodeKey(entity), line);
      }
    }
  }
  return edges;
}
