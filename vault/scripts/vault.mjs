// Work with a vault folder on this machine. Nothing here signs in, reaches the vault service or
// publishes anything; it reads the folder and its roots and keeps .vault/index.sqlite and
// .vault/journal.jsonl.
//
//   vault init   [--vault DIR]               make the folder if needed, and .vault/config.json
//   vault add SOURCE --channel C [--title T] [--by agent:NAME] [--move]
//                                            copy a file, or refer to an address, into the vault,
//                                            recording where it came from; then index
//   vault index  [--vault DIR]               bring the index into line with the folder and its roots
//   vault status [--vault DIR]               what the index holds, and when it last scanned
//   vault inspect REF [--vault DIR]          one node: what it is, its file, its edges, its history
//   vault search WORDS... [--vault DIR] [--limit N]
//   vault hook   [--vault DIR] [--agent NAME] an agent's PostToolUse hook: reads the hook's JSON on
//                                            standard input and journals a write inside the vault
//   vault mcp    [--vault DIR] [--agent NAME] serve the selected vault to a local stdio client
//   vault grants [--vault DIR]               what each agent may change (.vault/grants.json)
//   vault grant AGENT write|link SCOPE       let an agent change files under a channel (* = everywhere)
//   vault revoke AGENT [write|link [SCOPE]]  take a grant back; with no right, everything for that agent
//   vault restore PATH ADDRESS               put a file back to a version kept in .vault/history/
//   vault rename REF [TO] [--title T] [--channel C]
//                                            rename or move a channel (TO: its new path) or a block
//                                            (TO: its new slug), and rewrite what used the old name
//   vault lint   [--vault DIR] [--limit N]   candidates for a semantic check, for an agent to judge
//
// --vault defaults to OHM_VAULT_FOLDER, then the vault of the home this runs in
// (ohmmmm.<handle>/vault, ../../home/home.mjs), then the current folder. REF is a slug, a path in the vault,
// or a node key such as block:3mzocqfoc22if.
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { defaultVault } from '../../home/home.mjs';

const ACTIONS = ['init', 'add', 'index', 'status', 'inspect', 'search', 'hook', 'mcp', 'grants', 'grant', 'revoke', 'restore', 'rename', 'lint'];
const { values, positionals } = parseArgs({
  allowPositionals: true,
  strict: false,
  options: {
    vault: { type: 'string' }, limit: { type: 'string' }, channel: { type: 'string' }, title: { type: 'string' },
    by: { type: 'string' }, move: { type: 'boolean' }, agent: { type: 'string' },
  },
});
// The command line arrives with "vault" first when ohm runs this file.
const [action, ...rest] = positionals[0] === 'vault' ? positionals.slice(1) : positionals;
const expand = path => (path === '~' ? homedir() : path.startsWith('~/') ? `${homedir()}${path.slice(1)}` : path);
const selected = values.vault || process.env.OHM_VAULT_FOLDER || defaultVault();
const vault = resolve(expand(selected || '.'));
const print = value => console.log(JSON.stringify(value, null, 2));

// A hook runs after every file an agent writes, so it is quick, needs no database, and never fails
// the agent's work: anything wrong is ignored.
if (action === 'hook') {
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const { hookEvent } = await import('../vault/add.mjs');
    const { appendEvents } = await import('../vault/journal.mjs');
    const event = hookEvent(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'), { vault, agent: values.agent || 'claude-code' });
    if (event) await appendEvents(vault, [event]);
  } catch {}
  process.exit(0);
}

// Grants are the person's: changed only here, never by an agent tool. No database is needed.
if (['grants', 'grant', 'revoke'].includes(action)) {
  try {
    const { GRANTS, changeGrants, readGrants } = await import('../vault/grants.mjs');
    const file = resolve(vault, GRANTS);
    const held = await readFile(file, 'utf8').catch(problem => { if (problem.code === 'ENOENT') return null; throw problem; });
    const value = held === null ? undefined : JSON.parse(held);
    if (action === 'grants') print(readGrants(value));
    else {
      const [agent, right, scope] = rest;
      const next = changeGrants(value, { agent, right, scope, give: action === 'grant' });
      await mkdir(resolve(vault, '.vault'), { recursive: true });
      await writeFile(file, `${JSON.stringify(next, null, 2)}\n`);
      print({ grants: file, agent, ...readGrants(next).agents[agent] ? { now: readGrants(next).agents[agent] } : { now: 'nothing' } });
    }
  } catch (problem) {
    console.error(problem.message);
    process.exitCode = 1;
  }
  process.exit();
}

const sqlite = await import('node:sqlite').catch(() => null);
if (!sqlite) {
  // Node before 22.13 has SQLite only behind a flag. Run this same command again with it.
  if (process.execArgv.includes('--experimental-sqlite')) {
    console.error('This Node has no SQLite. Use Node 22.13 or newer.');
    process.exit(1);
  }
  const again = spawnSync(process.execPath, ['--experimental-sqlite', '--no-warnings=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(again.status ?? 1);
}
const { CONFIG, emptyConfig } = await import('../vault/roots.mjs');
const { inspect, openIndex, scan, search, summary } = await import('../vault/indexer.mjs');
const { addToVault } = await import('../vault/add.mjs');

try {
  if (!ACTIONS.includes(action)) throw new Error(`Say what to do: ${ACTIONS.join(', ')}`);
  const counted = report => ({
    ...report,
    // Long lists are counted; the full lists are in the index and the journal.
    ...Object.fromEntries(['added', 'changed', 'removed'].map(key => [key, report[key].length > 50 ? report[key].length : report[key]])),
  });
  if (action === 'mcp') {
    const { serveLocalVault } = await import('../mcp/local.mjs');
    await serveLocalVault({
      vault: selected && vault, agent: values.agent ?? 'mcp', DatabaseSync: sqlite.DatabaseSync,
      input: process.stdin, output: process.stdout,
    });
  } else if (action === 'init') {
    await mkdir(resolve(vault, '.vault'), { recursive: true });
    const file = resolve(vault, CONFIG);
    const held = await readFile(file, 'utf8').catch(() => null);
    if (held !== null) print({ vault, config: file, note: 'The vault already has a configuration; it was left as it is.' });
    else {
      await writeFile(file, `${JSON.stringify(emptyConfig(), null, 2)}\n`, { flag: 'wx' });
      print({ vault, config: file, note: 'Add folders the vault should read to "roots", then run: ohm vault index' });
    }
  } else {
    const db = await openIndex(vault, { DatabaseSync: sqlite.DatabaseSync });
    try {
      if (action === 'add') {
        if (rest.length !== 1) throw new Error('Say what to add: one file\'s path, or one address');
        if (!values.channel) throw new Error('Say which channel it goes into: --channel notes');
        const source = /^https?:\/\//i.test(rest[0]) ? rest[0] : resolve(expand(rest[0]));
        const added = await addToVault({
          vault, source, ...(values.channel ? { channel: values.channel } : {}), ...(values.title ? { title: values.title } : {}),
          by: values.by || 'me', move: Boolean(values.move),
        });
        const report = await scan({ vault, db });
        print({ ...added, index: { nodes: report.nodes, edges: report.edges, problems: report.problems } });
      } else if (action === 'restore') {
        const [path, address] = rest;
        if (!path || !/^b[a-z2-7]{20,}$/.test(address ?? '')) throw new Error('Say which file and which kept version: ohm vault restore notes/idea.md <address from ohm vault inspect or vault_history>');
        const { blobCid } = await import('../vault/core.mjs');
        const { appendEvents } = await import('../vault/journal.mjs');
        const { readNode } = await import('../vault/node.mjs');
        const { HISTORY } = await import('../mcp/local.mjs');
        if (path.split('/').some(part => !part || part.startsWith('.') || part === '..')) throw new Error('Give a path inside the vault.');
        const kept = await readFile(resolve(vault, HISTORY, address), 'utf8').catch(() => { throw new Error('That version is not kept in history.'); });
        const target = resolve(vault, path);
        const before = await readFile(target, 'utf8').catch(() => undefined);
        const keepIt = async text => { const at = await blobCid(Buffer.from(text)); await writeFile(resolve(vault, HISTORY, at), text, { flag: 'wx' }).catch(() => {}); return at; };
        if (before !== kept) {
          const prior = before === undefined ? {} : { before: await keepIt(before) };
          await mkdir(resolve(target, '..'), { recursive: true });
          await writeFile(target, kept);
          await appendEvents(vault, [{ at: new Date().toISOString(), op: before === undefined ? 'added' : 'changed', root: 'vault', path, by: 'me', via: 'restore', ...prior, hash: address }]);
        }
        const report = await scan({ vault, db });
        print({ path, restored: address, unchanged: before === kept, problems: readNode(path, kept)?.problems ?? [], index: { nodes: report.nodes } });
      } else if (action === 'rename') {
        const [ref, to] = rest;
        if (!ref || rest.length > 2 || (to === undefined && values.title === undefined && values.channel === undefined)) {
          throw new Error('Say what to rename and what it becomes: ohm vault rename notes journal, or ohm vault rename rain rain-walk [--title "Rain walk"] [--channel essays]');
        }
        const { blobCid } = await import('../vault/core.mjs');
        const { applyRename, planRename, readVaultFolder } = await import('../vault/rename.mjs');
        const { HISTORY, withCollectLock } = await import('../mcp/local.mjs');
        await scan({ vault, db });
        const found = inspect(db, ref);
        if (!found || found.root !== 'vault' || !['block', 'channel'].includes(found.node.type)) throw new Error(`Nothing in the vault is a block or channel called "${ref}". Run ohm vault index if it is new.`);
        const change = found.node.type === 'channel'
          ? { channel: found.node.path, to }
          : { block: found.node.path, ...(to === undefined ? {} : { slug: to }), ...(values.title === undefined ? {} : { title: values.title }), ...(values.channel === undefined ? {} : { channel: values.channel }) };
        if (found.node.type === 'channel' && (to === undefined || values.title !== undefined || values.channel !== undefined)) throw new Error('For a channel, give only its new path: ohm vault rename notes journal');
        const keep = async text => {
          const address = await blobCid(Buffer.from(text, 'utf8'));
          await mkdir(resolve(vault, HISTORY), { recursive: true });
          await writeFile(resolve(vault, HISTORY, address), text, { flag: 'wx' }).catch(problem => { if (problem.code !== 'EEXIST') throw problem; });
          return address;
        };
        const done = await withCollectLock(vault, sqlite.DatabaseSync, async () => {
          const { files, paths } = await readVaultFolder(vault);
          return applyRename({ vault, plan: planRename(files, change, { paths }), by: 'me', keep });
        });
        const report = await scan({ vault, db });
        print({ ...done, index: { nodes: report.nodes, problems: report.problems } });
      } else if (action === 'lint') {
        const { lint } = await import('../vault/lint.mjs');
        const limit = values.limit === undefined ? 30 : Number(values.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('--limit is a whole number from 1 to 100');
        await scan({ vault, db });
        print(lint(db, { limit }));
      } else if (action === 'index') print(counted(await scan({ vault, db })));
      else if (action === 'status') print(summary(db));
      else if (action === 'inspect') {
        if (!rest.length) throw new Error('Say which node: a slug, a path, or a key');
        const found = inspect(db, rest.join(' '));
        if (!found) throw new Error(`Nothing in the index is "${rest.join(' ')}". Run ohm vault index if it is new.`);
        print(found);
      } else {
        if (!rest.length) throw new Error('Say what to search for');
        const limit = values.limit === undefined ? 20 : Number(values.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('--limit is a whole number from 1 to 500');
        print(search(db, rest.join(' '), { limit }));
      }
    } finally {
      db.close();
    }
  }
} catch (problem) {
  console.error(problem.message);
  process.exitCode = 1;
}
