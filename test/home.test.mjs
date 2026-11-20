// The home (ohmmmm.<handle>) and the one vault reader contract, across both parts: a home is made,
// a block is saved in its vault, and its cortex reads that vault by itself, through the vault's own
// reader, without being told where it is.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { initHome } from '../bin/ohmmmm.mjs';
import { ALL, contractProblems, OPTIONAL, REQUIRED } from '../contract/vault-reader.mjs';
import { defaultCortex, defaultVault, findHome, homeName, homeVaultFor, layoutOf, VAULT_READER } from '../home/home.mjs';
import { checkVault, OPERATIONS as CORTEX_ASKS } from '../cortex/src/vault.mjs';
import { openCortex } from '../cortex/src/folder.mjs';
import { OPERATIONS as VAULT_ANSWERS, openVault } from '../vault/vault/cortex.mjs';

const scratch = async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ohmmmm-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
};

test('a home is named for a handle, and found from anywhere inside it', async t => {
  assert.equal(homeName('@Alice.Example.com'), 'ohmmmm.alice.example.com');
  for (const bad of ['', 'did:plc:abc', 'alice/../x', 'a..b', '-alice.com']) assert.throws(() => homeName(bad), /not a handle/);
  const parent = await scratch(t);
  const layout = await initHome(parent, 'alice.example.com');
  assert.deepEqual(layout, { home: join(parent, 'ohmmmm.alice.example.com'), handle: 'alice.example.com', vault: join(parent, 'ohmmmm.alice.example.com', 'vault'), cortex: join(parent, 'ohmmmm.alice.example.com', 'cortex') });
  await mkdir(join(layout.vault, 'essays'), { recursive: true });
  assert.deepEqual(findHome(join(layout.vault, 'essays'), {}), layout);
  assert.equal(defaultVault(join(layout.cortex, 'memory'), {}), layout.vault);
  assert.equal(defaultCortex(layout.home, {}), layout.cortex);
  assert.equal(findHome(parent, {}), null);
  assert.deepEqual(findHome(parent, { OHMMMM_HOME: layout.home }), layout);
  assert.throws(() => layoutOf(parent), /not a home/);
  // Made again, nothing is replaced.
  const config = await readFile(join(layout.vault, '.vault', 'config.json'), 'utf8');
  await initHome(parent, 'alice.example.com');
  assert.equal(await readFile(join(layout.vault, '.vault', 'config.json'), 'utf8'), config);
  assert.match(await readFile(join(layout.cortex, 'profile.md'), 'utf8'), /account: "alice\.example\.com"/);
});

test('one contract: what cortex asks is what the vault reader answers', () => {
  assert.deepEqual([...CORTEX_ASKS], [...REQUIRED]);
  assert.deepEqual([...VAULT_ANSWERS], [...ALL]);
  assert.deepEqual(ALL, [...REQUIRED, ...OPTIONAL]);
  assert.deepEqual(contractProblems({}), [`A vault answers ${REQUIRED.join(', ')}. This one is missing ${REQUIRED.join(', ')}`]);
  assert.match(contractProblems({ ...Object.fromEntries(REQUIRED.map(name => [name, () => {}])), search: 'no' })[0], /search is an operation/);
  assert.throws(() => checkVault({}), error => error.code === 'InvalidVault');
});

test('a cortex in a home reads its sibling vault through the vault reader, without being told', async t => {
  const parent = await scratch(t);
  const layout = await initHome(parent, 'bob.example.com');
  assert.deepEqual(homeVaultFor(layout.cortex), { kind: 'module', module: VAULT_READER, path: layout.vault });
  assert.equal(homeVaultFor(parent), null);
  await mkdir(join(layout.vault, 'essays'), { recursive: true });
  await writeFile(join(layout.vault, 'essays', 'on-walking.md'), '---\nid: 3mzocqfoc22if\nkind: block\ntitle: On walking\nvisibility: private\n---\n\nWalking clears the head.\n');
  const vault = checkVault(openVault({ path: layout.vault }));
  assert.equal((await vault.read('3mzocqfoc22if'))?.title, 'On walking');

  const cortex = openCortex(layout.cortex, { actor: 'member' });
  const synced = await cortex.syncVault();
  assert.equal(synced.connected, true);
  assert.ok(synced.channels.some(channel => (channel.channel ?? channel) === 'essays'), JSON.stringify(synced.channels));
  // Naming another vault in .cortex/vault.json still wins over the home's.
  const elsewhere = join(parent, 'elsewhere');
  await mkdir(join(elsewhere, 'notes'), { recursive: true });
  await writeFile(join(elsewhere, 'notes', 'n.md'), '---\ntitle: N\n---\n\nn\n');
  await openCortex(layout.cortex, { actor: 'member' }).connectVault({ kind: 'folder', path: elsewhere });
  const after = await openCortex(layout.cortex, { actor: 'member' }).syncVault();
  assert.ok(after.channels.every(channel => (channel.channel ?? channel) !== 'essays'), JSON.stringify(after.channels));
});
