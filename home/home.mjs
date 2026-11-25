// A person's home: one folder that holds their parts side by side. People call it their ohm, and its
// parts Collections, Agents, Site and profile; the code keeps the older names (vault, cortex).
//
//   ohm.alice.example.com/          made by `ohm init` from now on
//   ├── profile/      profile.md (name, handle, DID, wallet, card colour; about as Markdown) and picture
//   ├── collections/  the vault: blocks and channels, .vault/ (journal, index, config): ../vault/README.md
//   ├── agents/       the cortex: profile, observations, skills, tools, .cortex/: ../cortex/README.md
//   └── site/         the person's website, a git checkout (`ohm site connect`); site/.ohm/ is ohm's own
//
//   ohmmmm.alice.example.com/       homes made before: vault/ and cortex/ in place of collections/
//   ├── vault/                      and agents/. They are read as they are; nothing moves them.
//   └── cortex/
//
// The vault is canonical; the cortex reads it only through the vault reader contract
// (../contract/vault-reader.mjs). Inside a home the cortex finds its vault by itself: the sibling
// folder, read by the vault's own reader (../vault/vault/cortex.mjs). A cortex can still name another
// vault in .cortex/vault.json, and either folder can still live on its own.
//
// Nothing here reads or writes blocks or memories. It names folders and finds them.
import { existsSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PREFIX = 'ohm.';
export const OLD_PREFIX = 'ohmmmm.';
export const VAULT = 'collections';
export const CORTEX = 'agents';
export const OLD_VAULT = 'vault';
export const OLD_CORTEX = 'cortex';
export const PROFILE = 'profile';
export const SITE = 'site';
// The reader cortex uses for the vault in the same home.
export const VAULT_READER = fileURLToPath(new URL('../vault/vault/cortex.mjs', import.meta.url));

export class HomeProblem extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// An AT Protocol handle, as a folder name allows it: lower case letters, digits and hyphens in
// dot-separated parts. A DID is not a handle; a home is named for the person, and the DID is in the
// cortex's profile.
const HANDLE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
export function homeName(handle) {
  const value = String(handle ?? '').trim().replace(/^@/, '').toLowerCase();
  if (!HANDLE.test(value)) throw new HomeProblem('InvalidHandle', `"${handle}" is not a handle. A home is named ohm.<handle>, such as ohm.alice.example.com`);
  return `${PREFIX}${value}`;
}

export const handleOf = home => {
  const name = basename(home);
  for (const prefix of [PREFIX, OLD_PREFIX]) if (name.startsWith(prefix) && name.length > prefix.length) return name.slice(prefix.length);
  return null;
};

// The folders of a home.
export function layoutOf(home) {
  const root = resolve(home);
  const handle = handleOf(root);
  if (!handle) throw new HomeProblem('NotAHome', `${root} is not a home: its name does not start with ${PREFIX}`);
  // A home made before keeps vault/ and cortex/: its name says so.
  const old = basename(root).startsWith(OLD_PREFIX);
  return {
    home: root, handle, vault: join(root, old ? OLD_VAULT : VAULT), cortex: join(root, old ? OLD_CORTEX : CORTEX),
    profile: join(root, PROFILE), site: join(root, SITE),
  };
}

const isDir = path => { try { return statSync(path).isDirectory(); } catch { return false; } };

// The home `from` is in, or null: OHMMMM_HOME when set, otherwise the nearest folder named
// ohm.<handle> (or ohmmmm.<handle>) at or above `from`.
export function findHome(from = process.cwd(), env = process.env) {
  if (env.OHMMMM_HOME) {
    const layout = layoutOf(env.OHMMMM_HOME.replace(/^~(?=$|\/)/, homedir()));
    if (!isDir(layout.home)) throw new HomeProblem('NoHome', `OHMMMM_HOME is ${layout.home}, which is not a folder`);
    return layout;
  }
  for (let at = resolve(from); ; at = dirname(at)) {
    if (handleOf(at) && isDir(at)) return layoutOf(at);
    if (dirname(at) === at) return null;
  }
}

// Where a vault or a cortex is when none is named: in the home, if there is one.
export const defaultVault = (from, env) => findHome(from, env)?.vault ?? null;
export const defaultCortex = (from, env) => findHome(from, env)?.cortex ?? null;

// What a cortex inside a home reads when .cortex/vault.json names nothing: its sibling vault, through
// the vault's reader. Null for a cortex that is not `<home>/cortex`, or a home with no vault yet.
export function homeVaultFor(cortexDir) {
  const dir = resolve(cortexDir);
  if (!handleOf(dirname(dir))) return null;
  const { vault, cortex } = layoutOf(dirname(dir));
  if (cortex !== dir) return null;
  return isDir(vault) ? { kind: 'module', module: VAULT_READER, path: vault } : null;
}

// Makes ohm.<handle> in `parent`, with profile/ and an empty collections/ and agents/ (site/ comes
// with `ohm site connect`). Filling them (vault init,
// cortex init) is each one's own job; bin/ohmmmm.mjs does both.
export async function makeHome(parent, handle) {
  const home = join(resolve(parent), homeName(handle));
  if (existsSync(home) && !isDir(home)) throw new HomeProblem('NameTaken', `${home} is a file`);
  const layout = layoutOf(home);
  await mkdir(layout.vault, { recursive: true });
  await mkdir(layout.cortex, { recursive: true });
  await mkdir(layout.profile, { recursive: true });
  return layout;
}
