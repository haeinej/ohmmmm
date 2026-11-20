#!/usr/bin/env node
// cortex init [dir] [--account <did-or-handle>]   start a cortex in an empty folder
// cortex mcp [dir]             serve the cortex's tools to an agent, over standard input and output
// cortex serve [dir] [--port 8765] [--host 127.0.0.1]   serve them over HTTP, at /mcp
// cortex token [dir] [--replace]   make the token an HTTP client signs in with, and print it once
// cortex approve <skill> [dir] approve a skill an agent proposed
// cortex event <text> [dir]    report something from outside, as an observation by the host (CORTEX_SOURCE)
// cortex vault connect <folder> [dir] [--module FILE]   read the vault kept in that folder (with FILE's reader)
// cortex vault [sync] [dir]         bring the cortex in step with the vault, and show how it reads it
// cortex profile [dir]              show the profile, and the lines agents proposed for it
// cortex account <did|handle> [dir] set the account the profile belongs to
// cortex accept <id> [dir]          add a line an agent proposed to the profile
// cortex decline <id> [dir]         turn one down; that line is not proposed again
// cortex observations [dir] [--about <id|channel:path>] [--json]   what agents observed, newest first
// cortex observe <text> [dir] [--about <id,…>] [--pin]   write an observation of your own
// cortex forget <id> [dir]          remove an observation; it is kept in history and can be restored
// cortex migrate [dir]              bring a cortex made before docs/model.md to profile and observations
// cortex hook <moment> [dir] --agent <name>   answer a Claude Code or Codex hook: session-start, prompt, stop, session-end
// cortex install-hooks claude-code|codex      print the hooks to add; writes nothing
// cortex history [dir] [--node <path>] [--since <seq|date>] [--actor <name>] [--json]   what changed, and who changed it
// cortex as-of <node> <save|date|seq> [dir]     a node of the cortex as it was then
// cortex save <name> <note> [dir]              name this point in history, to read the cortex as it was here; changes nothing
// cortex restore <node> <version> [dir] [--reason <why>]   bring a node back to an earlier version, as a new change
// cortex revert <change> [dir] [--reason <why>]            undo one change, an agent's or your own, as a new change
// The folder is the one named, or CORTEX_DIR, or ~/cortex.
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { Refused } from '../src/core.mjs';
import { defaultCortex } from '../../home/home.mjs';
import { runHook, SNIPPETS } from '../src/adapter.mjs';
import { agentName, initCortex, openCortex } from '../src/folder.mjs';
import { createServer, serve } from '../src/protocol.mjs';
import { cortexSessions, ENDPOINT, httpTransport, listen, makeToken, readToken } from '../src/http.mjs';
import { createTools, INSTRUCTIONS, TOOLS } from '../src/tools.mjs';
import { getPrompt, PROMPTS } from '../src/prompts.mjs';
import { createResources } from '../src/resources.mjs';
import { cortexStatus } from '../src/status.mjs';

const template = fileURLToPath(new URL('../template', import.meta.url));
const [command, ...rest] = process.argv.slice(2);
// A cortex is the one named, then CORTEX_DIR, then the cortex of the home this runs in
// (ohmmmm.<handle>/cortex), then ~/cortex.
const folder = given => resolve(given ?? process.env.CORTEX_DIR ?? defaultCortex() ?? join(homedir(), 'cortex'));
// Takes `--flag value` out of the arguments, and returns the value.
const take = flag => {
  const at = rest.indexOf(flag);
  if (at < 0) return undefined;
  const [, value] = rest.splice(at, 2);
  if (!value) throw new Refused('InvalidRequest', `Give ${flag} a value`);
  return value;
};

try {
  if (command === 'init') {
    const at = rest.indexOf('--account');
    const account = at >= 0 ? rest.splice(at, 2)[1] : undefined;
    if (at >= 0 && !account) throw new Refused('InvalidRequest', 'Give --account a DID or a handle');
    const { dir } = await initCortex(folder(rest[0]), template, { account });
    console.log(`A cortex was started in ${dir}`);
  } else if (command === 'mcp') {
    const dir = folder(rest[0]);
    // The agent is named by what connects, so each save says which agent made it.
    // An agent is named by what connects, and can never take the person's or the account's name.
    let agent = agentName(process.env.CORTEX_AGENT);
    // Made at the first call, once the agent has said its name.
    // Resources only read, so they are served the same to every agent.
    const resources = createResources(openCortex(dir, { actor: agent }));
    // The instructions only send an agent to cortex_start, which returns the playbook from the folder.
    await serve(createServer({ tools: () => createTools(openCortex(dir, { actor: agent })), list: TOOLS, resources, prompts: { list: PROMPTS, get: getPrompt }, instructions: INSTRUCTIONS, onClient: name => { agent = agentName(process.env.CORTEX_AGENT ?? name); } }), process.stdin, process.stdout);
  } else if (command === 'serve') {
    const option = (flag, fallback) => {
      const at = rest.indexOf(flag);
      if (at < 0) return fallback;
      const [, value] = rest.splice(at, 2);
      if (!value) throw new Refused('InvalidRequest', `Give ${flag} a value`);
      return value;
    };
    const host = option('--host', '127.0.0.1');
    const port = Number(option('--port', '8765'));
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Refused('InvalidRequest', 'Give --port a number from 0 to 65535');
    const dir = folder(rest[0]);
    const token = await readToken(dir);
    // Without a token anything that can reach the port could read the cortex, so it serves only this machine.
    if (!token && host !== '127.0.0.1') throw new Refused('InvalidRequest', `There is no token, so cortex serves only 127.0.0.1, this machine. To serve on ${host}, where other machines can reach it, run cortex token first: every client must then sign in with it.`);
    const server = await listen(httpTransport({ open: cortexSessions(dir, { agent: process.env.CORTEX_AGENT }), token }), { port, host }).catch(problem => {
      if (problem.code === 'EADDRINUSE') throw new Refused('InvalidRequest', `Port ${port} on ${host} is in use. Pick another with --port.`);
      throw problem;
    });
    const where = `http://${host.includes(':') ? `[${host}]` : host}:${server.address().port}${ENDPOINT}`;
    console.log(`Serving the cortex in ${dir} at ${where}`);
    console.log(token ? 'Clients sign in with the token in agents/secrets/mcp-token.' : 'There is no token: anything on this machine can connect. Run cortex token to require one.');
  } else if (command === 'token') {
    const replace = rest.includes('--replace');
    const dir = folder(rest.filter(arg => arg !== '--replace')[0]);
    const token = await makeToken(dir, { replace });
    // The one time the token is shown. It is kept in agents/secrets/mcp-token, which git never takes.
    console.log(token);
    console.error(`Saved in ${join(dir, 'agents', 'secrets', 'mcp-token')}. Give it to an HTTP client as Authorization: Bearer <token>.${replace ? ' The old token no longer works once cortex serve is restarted.' : ''}`);
  } else if (command === 'approve' && rest[0]) {
    const done = await openCortex(folder(rest[1])).approveSkill(rest[0]);
    console.log(`${done.name} is approved, and is now in skills/`);
  } else if (command === 'profile') {
    const cortex = openCortex(folder(rest[0]));
    console.log(JSON.stringify({ ...(await cortex.profile()), waiting: await cortex.profileProposals() }, null, 2));
  } else if (command === 'account' && rest[0]) {
    const done = await openCortex(folder(rest[1]), { actor: 'member' }).setAccount(rest[0]);
    console.log(`The profile belongs to ${done.account}`);
  } else if (['accept', 'decline'].includes(command) && rest[0]) {
    const cortex = openCortex(folder(rest[1]), { actor: 'member' });
    const done = command === 'accept' ? await cortex.acceptProfile(rest[0]) : await cortex.declineProfile(rest[0]);
    console.log(command === 'accept' ? `Added under ${done.heading}: ${done.line}` : `Turned down ${done.id}`);
  } else if (command === 'observations') {
    const json = rest.includes('--json');
    if (json) rest.splice(rest.indexOf('--json'), 1);
    const about = take('--about');
    const { observations } = await openCortex(folder(rest[0]), { actor: 'member' }).observations({ ...(about ? { about } : {}), limit: 500 });
    if (json) console.log(JSON.stringify(observations, null, 2));
    else console.log(observations.length ? observations.map(item => `${item.id}  ${item.at?.slice(0, 10) ?? ''}  ${item.by}${item.pin ? '  pinned' : ''}${item.about ? `  about ${item.about.join(', ')}` : ''}\n  ${item.text.replace(/\s+/g, ' ')}`).join('\n') : 'Nothing has been observed yet.');
  } else if (command === 'observe' && rest[0]) {
    const pin = rest.includes('--pin');
    if (pin) rest.splice(rest.indexOf('--pin'), 1);
    const about = take('--about');
    const done = await openCortex(folder(rest[1]), { actor: 'member' }).observe({ id: `you-${randomUUID().slice(0, 8)}`, text: rest[0], ...(about ? { about: about.split(',').map(item => item.trim()).filter(Boolean) } : {}), ...(pin ? { pin } : {}) });
    console.log(`Recorded ${done.id}`);
  } else if (command === 'forget' && rest[0]) {
    const cortex = openCortex(folder(rest[1]), { actor: 'member' });
    const { version } = await cortex.readObservation(rest[0]);
    await cortex.removeObservation(rest[0], { replaces: version });
    console.log(`Removed ${rest[0]}. It is kept in .cortex/history/ and can be restored.`);
  } else if (command === 'migrate') {
    const done = await openCortex(folder(rest[0]), { actor: 'member' }).migrate();
    console.log(JSON.stringify(done, null, 2));
  } else if (command === 'vault') {
    if (rest[0] === 'connect' && rest[1]) {
      // --module FILE: the vault is read by that file's openVault, such as ohmmmm's vault/vault/cortex.mjs.
      const given = take('--module');
      const module = given ? resolve(given) : null;
      const path = resolve(rest[1]);
      const done = await openCortex(folder(rest[2]), { actor: 'member' }).connectVault(module ? { kind: 'module', module, path } : { kind: 'folder', path });
      console.log(`Connected the vault in ${path}${module ? `, read by ${module}` : ''}: ${done.channels.length} channel${done.channels.length === 1 ? '' : 's'}`);
    } else {
      const dir = folder(rest[0] === 'sync' ? rest[1] : rest[0]);
      const done = await openCortex(dir, { actor: 'member' }).syncVault();
      console.log(JSON.stringify(done, null, 2));
      if (!done.connected) process.exitCode = 1;
    }
  } else if (command === 'event' && rest[0]) {
    const { id } = await openCortex(folder(rest[1]), { actor: agentName(process.env.CORTEX_SOURCE ?? 'host') }).observe({ id: `event-${randomUUID().slice(0, 8)}`, text: rest[0], session: 'event' });
    console.log(`Recorded ${id}`);
  } else if (command === 'status') {
    const json = rest.includes('--json');
    const items = await cortexStatus(openCortex(folder(rest.filter(arg => arg !== '--json')[0])));
    if (json) console.log(JSON.stringify(items, null, 2));
    else if (!items.length) console.log('Nothing is waiting.');
    else for (const kind of [...new Set(items.map(item => item.kind))]) {
      for (const item of items.filter(item => item.kind === kind)) console.log(`${kind}: ${item.what} — ${item.clear}`);
    }
  } else if (command === 'hook') {
    // A hook never fails the session: whatever happens, it exits 0, and writes nothing on an error.
    const at = rest.indexOf('--agent');
    const agent = at >= 0 ? rest.splice(at, 2)[1] : undefined;
    await runHook(rest[0], { dir: folder(rest[1]), agent, stdin: process.stdin, stdout: process.stdout });
    process.exit(0);
  } else if (command === 'install-hooks' && Object.hasOwn(SNIPPETS, rest[0])) {
    const { file, where } = SNIPPETS[rest[0]];
    console.error(`${where} The commands run \`cortex\` (npm link this folder) on the cortex in CORTEX_DIR, or ~/cortex. Set CORTEX_AGENT=${rest[0]} for the MCP server too, so its observations are named for it. Nothing was written.`);
    process.stdout.write(readFileSync(fileURLToPath(new URL(`../hooks/${file}`, import.meta.url)), 'utf8'));
  } else if (command === 'history') {
    const json = rest.includes('--json');
    if (json) rest.splice(rest.indexOf('--json'), 1);
    const [node, since, actor] = [take('--node'), take('--since'), take('--actor')];
    const found = await openCortex(folder(rest[0]), { actor: 'member' }).history({ node, since, actor, limit: 500 });
    if (json) console.log(JSON.stringify(found, null, 2));
    else {
      const lines = [
        ...found.changes.map(line => ({ seq: line.seq, text: `${line.seq}  ${line.at}  ${line.actor.name}${line.proposedBy ? ` (proposed by ${line.proposedBy})` : ''}  ${line.op} ${line.node}  ${line.before ?? '(none)'} -> ${line.after ?? '(none)'}${line.reason ? `  ${line.reason}` : ''}` })),
        ...found.saves.map(line => ({ seq: line.seq, text: `${line.seq}  ${line.at}  ${line.actor.name}  save ${line.name}  ${line.note}` })),
      ].sort((a, b) => a.seq - b.seq);
      console.log(lines.length ? lines.map(line => line.text).join('\n') : 'Nothing has changed.');
    }
  } else if (command === 'as-of' && rest[0] && rest[1]) {
    const found = await openCortex(folder(rest[2]), { actor: 'member' }).asOf({ node: rest[0], at: rest[1] });
    if (found.text !== undefined) process.stdout.write(found.text);
    // A skill is kept whole, as an object, and is shown as JSON.
    else if (found.content !== undefined) console.log(JSON.stringify(found.content, null, 2));
    else console.log(found.exists === false ? `${rest[0]} did not exist then.` : `${rest[0]} was version ${found.version} then, and that version was not kept.`);
  } else if (command === 'save' && rest[0] && rest[1]) {
    const done = await openCortex(folder(rest[2]), { actor: 'member' }).save({ name: rest[0], note: rest[1] });
    console.log(`Saved ${done.name} at ${done.seq}. Nothing was changed.`);
  } else if (command === 'restore' && rest[0] && rest[1]) {
    const reason = take('--reason');
    const done = await openCortex(folder(rest[2]), { actor: 'member' }).restore({ node: rest[0], version: rest[1], reason });
    console.log(done.unchanged ? `${rest[0]} is already version ${rest[1]}` : `${rest[0]} is back to ${done.restored}. What it replaced is kept.`);
  } else if (command === 'revert' && rest[0]) {
    const reason = take('--reason');
    const done = await openCortex(folder(rest[1]), { actor: 'member' }).revert({ change: rest[0], reason });
    console.log(`Change ${rest[0]} is undone: ${done.node} is back as it was. What it replaced is kept.`);
  } else {
    console.log('cortex init [dir] [--account <did>] | mcp [dir] | serve [dir] [--port 8765] [--host 127.0.0.1] | token [dir] [--replace] | vault connect <folder> [dir] [--module <file>] | vault [dir] | profile [dir] | account <did|handle> [dir] | accept <id> [dir] | decline <id> [dir] | observations [dir] [--about <id>] [--json] | observe <text> [dir] [--about <ids>] [--pin] | forget <id> [dir] | migrate [dir] | approve <skill> [dir] | event <text> [dir] | status [dir] [--json] | hook <moment> [dir] --agent <name> | install-hooks claude-code|codex | history [dir] [--node <path>] [--since <seq|date>] [--actor <name>] [--json] | as-of <node> <save|date|seq> [dir] | save <name> <note> [dir] | restore <node> <version> [dir] [--reason <why>] | revert <change> [dir] [--reason <why>]');
    process.exitCode = command ? 1 : 0;
  }
} catch (problem) {
  if (!(problem instanceof Refused)) throw problem;
  console.error(problem.message);
  process.exitCode = 1;
}
