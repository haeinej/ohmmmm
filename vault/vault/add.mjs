// Bringing something into the vault so that where it came from is never lost: a file from elsewhere
// on this machine, or an address on the web. This is how an agent, or a person at the command
// line, adds to a vault; a file dropped in by hand is recognised later, as far as it can be, by
// indexing.
//
//   a Markdown file   copied into the channel, with origin (and, from an agent, by and visibility) set
//   any other file    copied in, with a block beside it that embeds it and says where it came from
//   an address        a source that refers to it, and a link block from that source. Nothing is fetched
//
// The original is left where it was unless `move` is asked for. Nothing that is already in the vault
// is overwritten: a name that is taken gets -2, -3 and so on.
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { VaultProblem } from './core.mjs';
import { readProperties, setProperty, slugOf, splitFile, writeNoteFile } from './file.mjs';
import { CODE_ENDINGS } from './indexer.mjs';
import { appendEvents } from './journal.mjs';
import { inferKind, isChannelPath, newNodeId, nodeFile } from './node.mjs';

const refuse = message => { throw new VaultProblem(message); };
const taken = async path => Boolean(await lstat(path).catch(() => null));

// The first free name for a file in a folder: name.ext, then name-2.ext, name-3.ext...
async function freeName(folder, name) {
  const ext = extname(name), stem = name.slice(0, name.length - ext.length);
  for (let count = 1; ; count++) {
    const candidate = count === 1 ? name : `${stem}-${count}${ext}`;
    if (!(await taken(join(folder, candidate)))) return candidate;
  }
}

// Make a channel's folder if it is not there yet.
async function channelFolder(vault, channel) {
  const folder = join(vault, ...channel.split('/'));
  await mkdir(folder, { recursive: true });
  return folder;
}

//   vault: the vault's absolute path; source: an absolute path or an HTTP(S) address
//   channel: the channel it goes into. There is no default: every addition is put somewhere
//   by: me, or agent:<name>. An agent's additions say so, and start private whatever the file said:
//   showing a block to more people is always the person's move
export async function addToVault({ vault, source, channel, by = 'me', title, move = false, now = new Date() }) {
  if (typeof channel !== 'string' || !channel) refuse('Say which channel this goes into');
  if (!isChannelPath(channel)) refuse(`"${channel}" is not a channel's path: folders joined by "/", none starting with "." or "_"`);
  if (!/^(?:me|agent:[A-Za-z0-9._-]+)$/.test(by)) refuse('by is me, or agent: and the agent\'s name');
  const at = now.toISOString();
  const agent = by !== 'me';
  const marks = { ...(agent ? { by, visibility: 'private' } : {}), created: at };
  const folder = await channelFolder(vault, channel);
  const inVault = path => relative(vault, path).split(sep).join('/');
  const written = [];

  if (/^https?:\/\//i.test(source)) {
    if (!URL.canParse(source)) refuse('That address cannot be read');
    const url = new URL(source);
    const id = newNodeId(now.valueOf());
    const sourceFile = nodeFile({ type: 'source', id, kind: 'page', uri: url.href, platform: 'website', capturedAt: at, retain: 'reference' });
    await mkdir(join(vault, ...sourceFile.path.split('/').slice(0, -1)), { recursive: true });
    await writeFile(join(vault, sourceFile.path), sourceFile.text, { flag: 'wx' });
    const name = await freeName(folder, `${slugOf(`${url.hostname} ${url.pathname}`).slice(0, 80) || 'link'}.md`);
    await writeFile(join(folder, name), writeNoteFile({ properties: { ...(title ? { title } : {}), from: id, ...marks }, body: url.href }), { flag: 'wx' });
    written.push(sourceFile.path, inVault(join(folder, name)));
    const events = written.map(path => ({ at, op: 'added', root: 'vault', path, origin: url.href, by, via: 'add' }));
    await appendEvents(vault, events);
    return { block: inVault(join(folder, name)), source: id, files: written, origin: url.href };
  }

  const from = resolve(source);
  if (from === vault || from.startsWith(`${vault}${sep}`)) refuse('That is already in the vault. Move it inside the vault instead, and indexing will follow it.');
  const info = await stat(from).catch(() => null);
  if (!info) refuse(`There is no file at ${from}`);
  if (!info.isFile()) refuse('Add one file at a time. A folder can be read where it is by naming it as a root in .vault/config.json.');
  const original = basename(from);
  // Vault metadata starts with a dot or underscore. A Markdown capture needs a block filename.
  const name = await freeName(folder, /\.md$/i.test(original)
    ? original.replace(/^[._]+/, '') || 'block.md'
    : original);
  const target = join(folder, name);
  const place = async () => {
    if (!move) return copyFile(from, target, constants.COPYFILE_EXCL);
    try {
      await rename(from, target);
    } catch (problem) {
      if (problem.code !== 'EXDEV') throw problem;
      await copyFile(from, target, constants.COPYFILE_EXCL);
      await unlink(from);
    }
  };

  let block;
  if (/\.md$/i.test(name)) {
    let text = await readFile(from, 'utf8');
    // A note that already says where it came from keeps that; this copy is recorded in the journal.
    const held = readProperties(splitFile(text).head).properties;
    if (held.origin === undefined || held.origin === null || held.origin === '') text = setProperty(text, 'origin', from);
    if (!move && held.id !== undefined) text = setProperty(text, 'id', newNodeId(now.valueOf()));
    for (const [key, value] of Object.entries({ ...(title ? { title } : {}), ...marks })) text = setProperty(text, key, value);
    await writeFile(target, text, { flag: 'wx' });
    if (move) await unlink(from);
    block = inVault(target);
    written.push(block);
  } else {
    await place();
    const end = extname(name).slice(1).toLowerCase();
    const embed = `![[${name}]]`;
    const kind = CODE_ENDINGS.has(end) ? 'code' : inferKind(embed);
    const blockName = await freeName(folder, `${slugOf(name.slice(0, name.length - extname(name).length)) || 'file'}.md`);
    await writeFile(join(folder, blockName), writeNoteFile({
      properties: { ...(kind !== inferKind(embed) ? { kind } : {}), title: title ?? name, origin: from, ...marks },
      body: embed,
    }), { flag: 'wx' });
    written.push(inVault(target));
    block = inVault(join(folder, blockName));
    written.push(block);
  }
  await appendEvents(vault, written.map(path => ({ at, op: 'added', root: 'vault', path, origin: from, by, via: 'add' })));
  return { block, files: written, origin: from, moved: move };
}

// What an agent's hook reports after it writes a file: a journal event for a file inside the vault,
// or nothing. `input` is what Claude Code sends a PostToolUse hook on standard input.
export const WRITING_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
export function hookEvent(input, { vault, agent = 'claude-code', now = new Date() }) {
  const path = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
  if (!WRITING_TOOLS.includes(input?.tool_name) || typeof path !== 'string') return null;
  const abs = resolve(typeof input.cwd === 'string' ? input.cwd : vault, path);
  if (!abs.startsWith(`${vault}${sep}`)) return null;
  const inside = relative(vault, abs).split(sep).join('/');
  if (inside.split('/').some(part => part.startsWith('.'))) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(agent)) return null;
  return {
    at: now.toISOString(), op: 'written', root: 'vault', path: inside, by: `agent:${agent}`, via: 'hook',
    ...(typeof input.session_id === 'string' && input.session_id ? { session: input.session_id.slice(0, 200) } : {}),
  };
}
