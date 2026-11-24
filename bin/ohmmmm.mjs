#!/usr/bin/env node
// The one command `npx github:haeinej/ohmmmm <command>` runs (npx picks the command named after
// the package). It keeps a person's home itself and hands everything else on:
//
//   init <handle> [parent]   make ohmmmm.<handle> in parent (default: your home folder), with vault/
//                            set up as a vault and cortex/ started for that handle
//   where [folder]           the home a folder is in, and its vault and cortex
//   serve [--port 8766] [--app <origin>]   the home's bridge on this machine, for the app and agents:
//                            the vault's and the cortex's tools over MCP, and images by CID
//                            (home/serve.mjs, docs/serve.md)
//   cortex <command> …       the cortex's command (cortex/bin/cortex.mjs)
//   anything else            the vault's command, `ohm` (vault/bin/ohm.mjs): `vault index`, `publish`…
//
// Run inside a home, the vault and the cortex find their folders by themselves (home/home.mjs).
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findHome, HomeProblem, makeHome } from '../home/home.mjs';
import { CONFIG, emptyConfig } from '../vault/vault/roots.mjs';
import { initCortex } from '../cortex/src/folder.mjs';

const TEMPLATE = fileURLToPath(new URL('../cortex/template', import.meta.url));

// Makes the home and fills it: the vault's configuration, and a cortex whose account is the handle.
// Each part is left as it is if it is already there.
export async function initHome(parent, handle) {
  const layout = await makeHome(parent, handle);
  const config = join(layout.vault, CONFIG);
  await mkdir(join(layout.vault, '.vault'), { recursive: true });
  if ((await readFile(config, 'utf8').catch(() => null)) === null) await writeFile(config, `${JSON.stringify(emptyConfig(), null, 2)}\n`, { flag: 'wx' });
  const started = await readFile(join(layout.cortex, 'agents', 'AGENTS.md'), 'utf8').then(() => true, () => false);
  if (!started) await initCortex(layout.cortex, TEMPLATE, { account: layout.handle });
  return layout;
}

const VAULT_COMMAND = fileURLToPath(new URL('../vault/bin/ohm.mjs', import.meta.url));
const CORTEX_COMMAND = fileURLToPath(new URL('../cortex/bin/cortex.mjs', import.meta.url));
const SERVE_COMMAND = fileURLToPath(new URL('../home/serve.mjs', import.meta.url));

// Which program runs a command line, and with what.
export function route(args) {
  const [command, ...rest] = args;
  if (command === 'init' || command === 'where') return { home: command, rest };
  if (command === 'cortex') return { program: CORTEX_COMMAND, args: rest };
  if (command === 'serve') return { program: SERVE_COMMAND, args: rest, flags: ['--no-warnings=ExperimentalWarning'] };
  return { program: VAULT_COMMAND, args };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const routed = route(process.argv.slice(2));
  if (routed.program) {
    const ran = spawnSync(process.execPath, [...(routed.flags ?? []), routed.program, ...routed.args], { stdio: 'inherit' });
    process.exit(ran.status ?? 1);
  }
  const rest = routed.rest;
  try {
    if (routed.home === 'init' && rest[0]) {
      const layout = await initHome(rest[1] ?? homedir(), rest[0]);
      console.log(JSON.stringify(layout, null, 2));
    } else if (routed.home === 'where') {
      const layout = findHome(rest[0] ?? process.cwd());
      if (!layout) { console.error('Not in a home. Make one with: init <handle>'); process.exitCode = 1; } else console.log(JSON.stringify(layout, null, 2));
    } else {
      console.log('init <handle> [parent] | where [folder] | serve | cortex <command> | any vault command');
      process.exitCode = 1;
    }
  } catch (problem) {
    console.error(problem instanceof HomeProblem || problem?.code ? problem.message : problem);
    process.exitCode = 1;
  }
}
