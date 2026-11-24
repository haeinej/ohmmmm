// Renaming through ohm (plans/renames.md, rule 4). A block or a channel takes its new name, and every
// file that used the old one is rewritten to use the new, in one journaled change, as Obsidian does:
// `channels` lists, a channel's `order`, a post's `connect`, and [[links]] and ![[embeds]] in any
// body. What is not rewritten (no grant, or changed since it was read) keeps working through the old
// name, which the journal records (names.mjs), and is listed.
//
//   planRename(files, change, { paths })   pure: what to move, write and journal
//   applyRename({ vault, plan, by, ... })   does it on this machine, then journals it in one append
//
// A channel renamed through ohm gets an `id` in its _channel.md (rule 1), made if it had none, so
// what points at it from outside the vault can hold its ID.
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { blobCid, isSlug, VaultProblem } from './core.mjs';
import { readProperties, setProperty, splitFile } from './file.mjs';
import { walk } from './indexer.mjs';
import { appendEvents } from './journal.mjs';
import { blockResolver, CHANNEL_FILE, isChannelPath, newNodeId, nodeFile, readNode, readVault, SOURCES } from './node.mjs';

const refuse = message => { throw new VaultProblem(message); };
const list = value => (Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value]).map(String);
const folderOf = path => path.split('/').slice(0, -1).join('/');
const sansMd = name => name.replace(/\.md$/i, '');
const FILE_EMBED = /\.[A-Za-z0-9]{1,5}$/;

// Each piece of a body outside fenced code and code spans, passed through `change`.
function inProse(body, change) {
  let fence = null;
  return body.split('\n').map(line => {
    const mark = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (mark && mark[0] === fence[0] && mark.length >= fence.length && !line.trim().slice(mark.length).trim()) fence = null;
      return line;
    }
    if (mark) { fence = mark; return line; }
    return line.split(/(`+[^`\n]*`+)/).map((part, index) => (index % 2 ? part : change(part))).join('');
  }).join('\n');
}

// A file's text with each link target `target` maps to something new replaced, and its `|words` or
// `#part` kept. Only the body is read for links; properties are changed by name.
function relink(text, target) {
  const { body } = splitFile(text);
  const head = text.slice(0, text.length - body.length);
  const next = inProse(body, part => part.replace(/(!?)\[\[([^\]|#\n]+)((?:[#|][^\]\n]*)?)\]\]/g, (whole, bang, written, rest) => {
    const to = target(written.trim(), Boolean(bang));
    return to === undefined || to === written.trim() ? whole : `${bang}[[${to}${rest}]]`;
  }));
  return head + next;
}

// A file's text with one list property mapped, each entry once. Unchanged when nothing maps.
function remap(text, key, map) {
  const { properties } = readProperties(splitFile(text).head);
  if (properties[key] === undefined) return text;
  const before = list(properties[key]);
  const after = [...new Set(before.map(each => map(each) ?? each))];
  return JSON.stringify(after) === JSON.stringify(before) ? text : setProperty(text, key, after);
}

/**
 * What a rename does, without touching a disk.
 *   files:  the vault's Markdown, [{ path, text }]
 *   change: { channel, to }                         a channel and its new path
 *           { block, slug?, title?, channel? }       a block's file and its new slug, title or home channel
 *   paths:  every file in the vault folder (for a channel, its other files move too); defaults to files'
 * Returns { kind, from, to, moves: [{ from, to }], folder?, writes: [{ path, before?, after }],
 * renamed: [{ path, from }], id? }. A write's path is where the file is after the moves; `before` is
 * the text read, absent for a file made new.
 */
export function planRename(files, change, { paths = files.map(file => file.path), newId = newNodeId } = {}) {
  const vault = readVault(files);
  const texts = new Map(files.map(file => [file.path, file.text]));
  const taken = new Set(paths);
  const plan = { moves: [], writes: [], renamed: [] };
  const where = path => plan.moves.find(move => move.from === path)?.to ?? path;
  // Every file's text after `edit` (called once per plan), written at its new place when it changed.
  const rewrite = edit => {
    for (const [path, before] of texts) {
      const after = edit(before, path);
      if (after !== before) plan.writes.push({ path: where(path), before, after });
    }
  };

  if (change.block === undefined) {
    const from = change.channel;
    const to = change.to;
    if (!isChannelPath(from) || !vault.channels.some(channel => channel.path === from)) refuse(`There is no channel "${from}" in this vault.`);
    if (!isChannelPath(to)) refuse(`"${to}" is not a channel's path: folders joined by "/", none starting with "." or "_".`);
    if (to === from) refuse('The channel already has that path.');
    if (to.startsWith(`${from}/`)) refuse('A channel cannot go inside itself.');
    if ([...taken].some(path => path.startsWith(`${to}/`))) refuse(`There is already a channel at "${to}". Choose another path.`);
    const moved = path => (path === from ? to : path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : undefined);
    plan.kind = 'channel';
    plan.from = from;
    plan.to = to;
    plan.folder = { from, to };
    for (const path of [...taken].sort()) if (path.startsWith(`${from}/`)) plan.moves.push({ from: path, to: moved(path) });
    // Lists and links that named the channel, or anything inside it, by path.
    rewrite(text => {
      let next = remap(text, 'channels', moved);
      // An order lists blocks by slug and channels by path: only a channel's path moves.
      next = remap(next, 'order', each => (vault.channels.some(channel => channel.path === each) ? moved(each) : undefined));
      return relink(next, written => {
        const lower = written.toLowerCase();
        if (!lower.startsWith(`${from.toLowerCase()}/`)) return undefined;
        return `${to}${written.slice(from.length)}`;
      });
    });
    // The channel keeps an ID from now on (rule 1): its _channel.md is made, or given one.
    const own = `${from}/${CHANNEL_FILE}`;
    const ownNow = `${to}/${CHANNEL_FILE}`;
    const held = plan.writes.find(write => write.path === ownNow);
    const text = held?.after ?? texts.get(own);
    const id = text === undefined ? undefined : readNode(own, text)?.node?.id;
    plan.id = id ?? newId();
    if (text === undefined) plan.writes.push({ path: ownNow, after: nodeFile({ type: 'channel', path: to, order: [], description: '', properties: {}, id: plan.id }).text });
    else if (!id) {
      if (held) held.after = setProperty(held.after, 'id', plan.id);
      else plan.writes.push({ path: ownNow, before: text, after: setProperty(text, 'id', plan.id) });
    }
    // Old paths keep working wherever a file is not rewritten: the channel and every channel in it.
    for (const channel of vault.channels) {
      const now = moved(channel.path);
      if (now) plan.renamed.push({ path: now, from: channel.path });
    }
    return plan;
  }

  const block = vault.blocks.find(each => each.path === change.block);
  if (!block) refuse(`There is no block at "${change.block}" in this vault.`);
  if (change.slug === undefined && change.title === undefined && change.channel === undefined) refuse('Say what changes: a new slug, a title or a channel.');
  const slug = change.slug ?? block.slug;
  const title = change.title === undefined ? block.title : String(change.title).trim();
  const home = change.channel ?? block.home;
  if (!isSlug(slug)) refuse(`"${slug}" is not a slug: lowercase Latin letters, digits and hyphens.`);
  if (change.title !== undefined && (!title || title.includes('\n') || title.length > 300)) refuse('A title is one line of up to 300 characters.');
  if (home && !isChannelPath(home)) refuse(`"${home}" is not a channel's path.`);
  if (slug !== block.slug && vault.blocks.some(each => each !== block && each.slug === slug)) refuse(`Another block has the slug "${slug}", so [[${slug}]] could mean either. Choose another.`);
  const stem = block.path.split('/').at(-1).replace(/\.md$/i, '');
  const name = change.slug === undefined ? stem : slug;
  const path = `${home ? `${home}/` : ''}${name}.md`;
  if (path !== block.path && taken.has(path)) refuse(`There is already a file at "${path}". Choose another name.`);
  plan.kind = 'block';
  plan.from = block.path;
  plan.to = path;
  if (path !== block.path) plan.moves.push({ from: block.path, to: path });
  const named = blockResolver(vault);
  const oldPath = sansMd(block.path).toLowerCase();
  // A link to the block, written in whichever form it was (slug, path, file name or title), gets that form's new value.
  const target = (written, embed) => {
    if (embed && FILE_EMBED.test(written) && !/\.md$/i.test(written)) return undefined;
    if (named(written) !== block) return undefined;
    const lower = sansMd(written).toLowerCase();
    const md = /\.md$/i.test(written) ? '.md' : '';
    if (lower === block.slug) return slug;
    if (lower === oldPath) return `${sansMd(path)}${md}`;
    if (lower === stem.toLowerCase()) return `${name}${md}`;
    if (block.title && lower === block.title.toLowerCase()) return title;
    return slug;
  };
  rewrite((text, at) => {
    let next = relink(text, target);
    if (slug !== block.slug) {
      next = remap(next, 'connect', each => (named(each) === block ? slug : undefined));
      if (at.endsWith(`/${CHANNEL_FILE}`)) next = remap(next, 'order', each => (each === block.slug ? slug : undefined));
    }
    if (at === block.path) {
      if (change.slug !== undefined && readProperties(splitFile(next).head).properties.slug !== undefined) next = setProperty(next, 'slug', slug === name ? undefined : slug);
      if (change.title !== undefined) next = setProperty(next, 'title', title);
    }
    return next;
  });
  // Old names keep working wherever a file is not rewritten. A move says the old path and file name.
  if (block.title && title !== block.title) plan.renamed.push({ path, from: block.title });
  if (slug !== block.slug && block.slug !== stem) plan.renamed.push({ path, from: block.slug });
  return plan;
}

/**
 * The vault folder as planRename reads it: every file's path (not .vault/ or other hidden folders),
 * and the text of every Markdown file that can hold a name (not captured sources).
 *   open(path): the absolute file to read, after any checks the caller makes; defaults to joining
 */
export async function readVaultFolder(vault, { open = path => join(vault, path) } = {}) {
  const paths = await walk(vault, () => true);
  const files = [];
  for (const path of paths) {
    if (!/\.md$/i.test(path) || path.startsWith(`${SOURCES}/`)) continue;
    files.push({ path, text: await readFile(await open(path), 'utf8') });
  }
  return { files, paths };
}

// Write a file through a temporary one beside it, only if it still holds what was read.
async function replaceText(file, before, after) {
  const now = await readFile(file, 'utf8').catch(problem => { if (problem.code !== 'ENOENT') throw problem; });
  if (now !== before) return false;
  if (before === undefined) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, after, { flag: 'wx' });
    return true;
  }
  const temp = join(dirname(file), `.rename-${randomUUID()}`);
  try {
    await writeFile(temp, after, { flag: 'wx', mode: (await lstat(file)).mode & 0o777 });
    if (await readFile(file, 'utf8') !== before) return false;
    await rename(temp, file);
    return true;
  } finally {
    await unlink(temp).catch(problem => { if (problem.code !== 'ENOENT') throw problem; });
  }
}

/**
 * Does a plan in the vault folder, then journals it in one append: `moved` for every file moved,
 * `changed` or `added` for every file written (each version kept by `keep`), and `renamed` for the
 * names no move says. Call it under the collect lock, then index.
 *   may(path): whether this file may be written; a reference in one it may not is left, and listed
 *   keep(text): keeps a version, returns its content address
 */
export async function applyRename({ vault, plan, by, via = 'rename', may = () => true, keep, now = new Date() }) {
  const at = now.toISOString();
  const events = [];
  const left = [];
  // The renamed node itself, where it is and where it goes, is all or nothing.
  const own = plan.kind === 'channel' ? [`${plan.from}/${CHANNEL_FILE}`, `${plan.to}/${CHANNEL_FILE}`] : [plan.from, plan.to];
  for (const path of [...own, ...plan.moves.flatMap(move => [move.from, move.to])]) if (!may(path)) refuse(`You may not change ${path}.`);
  if (plan.folder) {
    await mkdir(dirname(join(vault, plan.folder.to)), { recursive: true });
    await rename(join(vault, plan.folder.from), join(vault, plan.folder.to));
  } else {
    for (const move of plan.moves) {
      await mkdir(dirname(join(vault, move.to)), { recursive: true });
      await rename(join(vault, move.from), join(vault, move.to));
    }
  }
  for (const move of plan.moves) events.push({ at, op: 'moved', root: 'vault', path: move.to, from: move.from, by, via });
  const written = [];
  for (const write of plan.writes) {
    if (!may(write.path)) { left.push({ path: write.path, why: 'no grant' }); continue; }
    if (!await replaceText(join(vault, write.path), write.before, write.after)) { left.push({ path: write.path, why: 'changed since it was read' }); continue; }
    written.push(write.path);
    const kept = keep ? {
      ...(write.before === undefined ? {} : { before: await keep(write.before) }),
      hash: await keep(write.after),
    } : { hash: await blobCid(Buffer.from(write.after, 'utf8')) };
    events.push({ at, op: write.before === undefined ? 'added' : 'changed', root: 'vault', path: write.path, by, via, ...kept });
  }
  for (const each of plan.renamed) events.push({ at, op: 'renamed', root: 'vault', path: each.path, from: each.from, by, via });
  await appendEvents(vault, events);
  return {
    kind: plan.kind, from: plan.from, to: plan.to, ...(plan.id ? { id: plan.id } : {}),
    moved: plan.moves.length, written, left,
    journaled: events.length,
  };
}
