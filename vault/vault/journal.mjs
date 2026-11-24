// The vault's journal: `.vault/journal.jsonl`, one line for each thing that happened to a file, with
// who did it and how. Unlike the index, the journal cannot be made again from the files: once a
// file has been copied in, nothing in it says where it came from. So it is only ever added to,
// never rewritten, and it is kept and synced with the vault.
//
//   { at, op, root, path, from?, origin?, by, via, session?, hash? }
//
//   op     added, changed, moved (from: the old path), removed, written (an agent wrote the file,
//          reported by its hook), copied-from (origin: the file it has the same bytes as),
//          downloaded-from (origin: the address macOS recorded when it was downloaded), renamed
//          (from: the name it had; path: the block's file, or the channel's folder, now). Renames
//          are what keep old names working (names.mjs)
//   by     me, agent:<name>, or unknown: the vault says who only when it was told
//   via    add (ohm vault add or vault_capture), collect (vault_collect), hook (an agent's hook),
//          scan (found by indexing), editor, sync, write (vault_write or vault_remove), link
//          (vault_link), restore (vault_restore or ohm vault restore)
//   before the content address of the file as it was, kept in .vault/history/ (agent writes only)
//   hash   the content address of the file as it is now
import { execFile, spawn } from 'node:child_process';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

export const JOURNAL = '.vault/journal.jsonl';
export const OPS = ['added', 'changed', 'moved', 'removed', 'written', 'copied-from', 'downloaded-from', 'renamed'];
export const VIAS = ['add', 'collect', 'hook', 'scan', 'editor', 'sync', 'write', 'link', 'restore'];
const BY = /^(?:me|unknown|agent:[A-Za-z0-9._-]+)$/;

// Why an event cannot go in the journal. Empty when it can.
export function eventProblems(event) {
  const problems = [];
  if (!event || typeof event !== 'object') return ['An event is an object'];
  if (!OPS.includes(event.op)) problems.push(`op is one of: ${OPS.join(', ')}`);
  if (!VIAS.includes(event.via)) problems.push(`via is one of: ${VIAS.join(', ')}`);
  if (!BY.test(event.by ?? '')) problems.push('by is me, unknown, or agent: and a name');
  if (typeof event.root !== 'string' || !event.root) problems.push('root names the root the file is in');
  if (typeof event.path !== 'string' || !event.path || event.path.startsWith('/') || event.path.split('/').includes('..')) problems.push('path is the file\'s path inside its root');
  if (event.op === 'moved' && typeof event.from !== 'string') problems.push('A move says where from');
  if (event.op === 'renamed' && (typeof event.from !== 'string' || !event.from.trim())) problems.push('A rename says the name it had');
  if (['copied-from', 'downloaded-from'].includes(event.op) && typeof event.origin !== 'string') problems.push('It says the origin');
  if (!Number.isFinite(Date.parse(event.at))) problems.push('at is a time');
  for (const key of ['before', 'hash']) if (event[key] !== undefined && event[key] !== null && !/^b[a-z2-7]{20,}$/.test(event[key])) problems.push(`${key} is a content address`);
  return problems;
}

// Add events to the end of the journal. Each is checked first; none is written if one is wrong.
export async function appendEvents(vault, events) {
  if (!events.length) return;
  for (const event of events) {
    const problems = eventProblems(event);
    if (problems.length) throw new Error(`A journal event cannot be written: ${problems.join('; ')}`);
  }
  const file = join(vault, JOURNAL);
  await mkdir(dirname(file), { recursive: true });
  // One write for the batch, each event on its own line, so a reader never sees half of one.
  await appendFile(file, events.map(event => `${JSON.stringify(event)}\n`).join(''));
}

// Every event, oldest first. A line that cannot be read, such as one cut off by a crash, is counted
// and skipped rather than stopping the rest.
export async function readEvents(vault) {
  let text;
  try {
    text = await readFile(join(vault, JOURNAL), 'utf8');
  } catch (problem) {
    if (problem.code === 'ENOENT') return { events: [], unreadable: 0 };
    throw problem;
  }
  const events = [];
  let unreadable = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (eventProblems(event).length) unreadable++;
      else events.push(event);
    } catch {
      unreadable++;
    }
  }
  return { events, unreadable };
}

// Where macOS says a file was downloaded from: the addresses it keeps in the file's
// kMDItemWhereFroms attribute, written by browsers and mail. Empty anywhere else, and for a file
// that was copied rather than downloaded, because a copy carries no such record.
export async function downloadedFrom(abs, { platform = process.platform } = {}) {
  if (platform !== 'darwin') return [];
  try {
    const { stdout } = await promisify(execFile)('xattr', ['-px', 'com.apple.metadata:kMDItemWhereFroms', abs]);
    const bytes = Buffer.from(stdout.replace(/\s+/g, ''), 'hex');
    const json = await new Promise((resolve, reject) => {
      const child = spawn('plutil', ['-convert', 'json', '-o', '-', '-'], { stdio: ['pipe', 'pipe', 'ignore'] });
      let out = '';
      child.stdout.on('data', chunk => { out += chunk; });
      child.on('error', reject);
      child.on('close', code => (code === 0 ? resolve(out) : reject(new Error('plutil'))));
      child.stdin.end(bytes);
    });
    const value = JSON.parse(json);
    return (Array.isArray(value) ? value : [value]).filter(each => typeof each === 'string' && /^(?:https?|ftp|file|mailto|message):/i.test(each));
  } catch {
    return [];
  }
}
