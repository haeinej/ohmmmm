#!/usr/bin/env node
// The vault's tools for a coding agent, run on the person's own machine. They work in ohm's
// working copy of the person's vault, the same one the editor shows, by asking the vault service
// (service/CAPABILITIES.md). Each request carries a token the person's own PDS issues for it.
//
//   node mcp/server.mjs [--config PATH] [--vault URL --vault-did DID] [--agent NAME] [--home FOLDER]
//
// The site configuration is the one the commands use: named with --config or OHM_VAULT_CONFIG,
// or found in the folder the agent is working in. It says which account is the person's. The vault
// is ohm's unless the configuration (OHM_VAULT_URL, OHM_VAULT_DID) or a flag names another.
// Needs ATPROTO_APP_PASSWORD, to sign in to the person's PDS. That sign-in is also what publishes:
// the vault service works out what would change, and the tools make the changes in the person's
// own repository.
//
// --agent names the agent its requests are journalled as (agent:<name>). --home (or
// OHM_VAULT_FOLDER) is the person's vault folder: its .vault/grants.json is the one place grants are
// kept, and is read for each move. Without it the agent holds no grant, and every move is a request.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { allowed, GRANTS, readGrants } from '../vault/grants.mjs';
import { pdsConfig, webUrl } from '../feed/pds.mjs';
import { siteVars } from '../scripts/config.mjs';
import { signIn } from '../scripts/rpc.mjs';
import { vaultClient } from '../scripts/vault-client.mjs';
import { createServer, serve, INSTRUCTIONS } from './protocol.mjs';
import { createTools, OFFERED } from './tools.mjs';

const OHM = { url: 'https://vault.ohmmmm.com', did: 'did:web:vault.ohmmmm.com' };

async function localTools(values) {
  const vars = await siteVars(values.config ?? process.env.OHM_VAULT_CONFIG);
  const pds = pdsConfig(vars);
  const vault = webUrl(values.vault ?? vars.OHM_VAULT_URL ?? OHM.url);
  const audience = values['vault-did'] ?? vars.OHM_VAULT_DID ?? OHM.did;
  if (!vault) throw new Error('The vault is named by its address, such as https://vault.ohmmmm.com');
  const renew = () => signIn(pds.origin, pds.did);
  const agent = values.agent ?? 'mcp';
  if (!/^[A-Za-z0-9._-]+$/.test(agent)) throw new Error('Name the agent with letters, digits, dots, underscores or hyphens');
  const home = values.home ?? process.env.OHM_VAULT_FOLDER;
  // Read afresh for each move, so a grant the person gives or takes back counts at once.
  const grants = home ? { allowed: async (right, path) => {
    const held = await readFile(join(home, GRANTS), 'utf8').catch(() => null);
    let value;
    try { value = held === null ? undefined : JSON.parse(held); } catch { return false; }
    return Boolean(allowed(readGrants(value), agent, right, path));
  } } : null;
  return createTools({ vault: vaultClient({ pds, session: await renew(), renew, vault, audience }), by: `agent:${agent}`, grants });
}

const { values } = parseArgs({ options: { config: { type: 'string' }, vault: { type: 'string' }, 'vault-did': { type: 'string' }, agent: { type: 'string' }, home: { type: 'string' } } });
process.stdin.setEncoding('utf8');
await serve(createServer({ list: OFFERED, tools: () => localTools(values),
  instructions: INSTRUCTIONS,
}), process.stdin, process.stdout);
