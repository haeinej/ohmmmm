// Former names: what a block or a channel was called before it was renamed or moved, so a reference
// written with an old name still finds it, as on Are.na (plans/renames.md). They are read from the
// journal, never kept only in the index: the index is made again from the files and the journal,
// and loses nothing when it is.
//
//   moved    (from: the file's old path)  a block's old path, file name and slug; a channel's old
//                                          folder when its _channel.md moved
//   renamed  (from: the old name)          a block's old slug or title (path: its file now), or a
//                                          channel's old folder (path: its folder now)
//
// The scan writes `renamed` when it sees a block with the same ID under another name, or a folder
// whose blocks all turned up in one other folder (renamesBetween). Nothing here reads a disk.
import { slugOf } from './file.mjs';
import { CHANNEL_FILE } from './node.mjs';

const folderOf = path => path.split('/').slice(0, -1).join('/');
const stemOf = path => path.split('/').at(-1).replace(/\.md$/i, '');
// A name as references are matched: trimmed, without .md, in lower case (evidence in node.mjs).
export const nameKey = name => String(name).trim().replace(/\.md$/i, '').toLowerCase();

/** The names a block file's path gives it: the path, the file's name and the slug made from it. */
export const pathNames = path => [...new Set([nameKey(path), nameKey(stemOf(path)), slugOf(stemOf(path))].filter(Boolean))];

/** Every name a block answers to now. */
const blockNames = block => new Set([block.slug, block.title, ...pathNames(block.path)].filter(Boolean).map(nameKey));

const follow = (map, start) => {
  const seen = new Set([start]);
  let at = start;
  while (map.has(at)) {
    at = map.get(at);
    if (seen.has(at)) break;
    seen.add(at);
  }
  return at;
};

/**
 * What each former name names now, from the journal's events in order (the vault's own root only):
 *   channels  Map: an old channel path → the channel's path now
 *   blocks    Map: an old block name (as nameKey has it) → the block's file now
 * A later event wins over an earlier one for the same name. A current name always wins over a
 * former one; that is for whoever resolves (readVault, evidence).
 */
export function formerNames(events) {
  const files = new Map();
  const folders = new Map();
  const blocks = new Map();
  for (const event of events) {
    if (event.root !== 'vault' || typeof event.from !== 'string' || !event.from) continue;
    if (event.op === 'moved') {
      files.set(event.from, event.path);
      if (event.path.endsWith(`/${CHANNEL_FILE}`) && event.from.endsWith(`/${CHANNEL_FILE}`)) folders.set(folderOf(event.from), folderOf(event.path));
      else if (/\.md$/i.test(event.path)) for (const name of pathNames(event.from)) blocks.set(name, event.path);
    } else if (event.op === 'renamed') {
      if (!/\.md$/i.test(event.path)) folders.set(event.from, event.path);
      else for (const name of /\.md$/i.test(event.from) ? pathNames(event.from) : [nameKey(event.from)]) blocks.set(name, event.path);
    }
  }
  return {
    channels: new Map([...folders.keys()].map(from => [from, follow(folders, from)])),
    blocks: new Map([...blocks].map(([name, path]) => [name, follow(files, path)])),
  };
}

/**
 * The `renamed` events a scan writes: what it sees renamed between the nodes the index held before
 * (`before`: [{ key, node }]) and the vault read now, beyond what a `moved` event already says.
 *   moved: the scan's moves, [{ root, from, to }]
 */
export function renamesBetween(before, vault, { moved = [], at }) {
  const was = new Map(before.map(({ key, node }) => [key, node]));
  const movedTo = new Map(moved.filter(move => move.root === 'vault').map(move => [move.from, move.to]));
  const blockAt = new Map(vault.blocks.map(block => [block.path, block]));
  const byId = new Map(vault.blocks.filter(block => block.id).map(block => [block.id, block]));
  const channels = new Map(vault.channels.map(channel => [channel.path, channel]));
  const events = [];
  const said = new Set();
  const add = (path, from) => {
    if (said.has(`${path}\u0000${from}`)) return;
    said.add(`${path}\u0000${from}`);
    events.push({ at, op: 'renamed', root: 'vault', path, from, by: 'unknown', via: 'scan' });
  };
  // Where a block the index knew is now: by its ID, or by the move of its file.
  const now = old => (old.id && byId.get(old.id)) || (movedTo.has(old.path) ? blockAt.get(movedTo.get(old.path)) : blockAt.get(old.path));

  for (const old of was.values()) {
    if (old.type !== 'block' || !old.path) continue;
    const block = now(old);
    if (!block) continue;
    const names = blockNames(block);
    const told = movedTo.get(old.path) === block.path ? new Set(pathNames(old.path)) : new Set();
    for (const name of [old.slug, old.title]) {
      if (name && !names.has(nameKey(name)) && !told.has(nameKey(name))) add(block.path, name);
    }
    if (old.path !== block.path && !told.size) add(block.path, old.path);
  }

  for (const old of was.values()) {
    if (old.type !== 'channel' || channels.has(old.path)) continue;
    // Its _channel.md moved: the move says it already.
    if (movedTo.has(`${old.path}/${CHANNEL_FILE}`)) continue;
    let to = old.id ? vault.channels.find(channel => channel.id === old.id)?.path : undefined;
    if (!to) {
      // A folder without an ID moved when every block anywhere in it turned up in one other folder,
      // each in the same place inside it: notes/2026 moved to journal when notes/2026/x went to journal/x.
      const places = new Set();
      let blocks = 0;
      for (const each of was.values()) {
        if (each.type !== 'block' || !(each.home === old.path || each.home?.startsWith(`${old.path}/`))) continue;
        blocks++;
        const inside = each.home.slice(old.path.length);
        const home = now(each)?.home;
        places.add(home !== undefined && home.endsWith(inside) ? home.slice(0, home.length - inside.length) : undefined);
      }
      if (blocks && places.size === 1) to = [...places][0];
    }
    if (to && channels.has(to)) add(to, old.path);
  }
  return events;
}
