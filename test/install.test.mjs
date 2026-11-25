// Installing from the repository still works after the vault moved into vault/: `npx github:…`
// reads the root package.json, and the Claude plugin marketplace reads the root .claude-plugin/.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { route } from '../bin/ohmmmm.mjs';

const json = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

test('the root package runs the vault, cortex and home commands, with what the vault needs to run', () => {
  const root = json('package.json');
  for (const [name, file] of Object.entries(root.bin)) assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `${name}: ${file}`);
  // People type ohm: the home's command, which hands anything it does not keep to the vault's.
  assert.equal(root.bin.ohm, 'bin/ohmmmm.mjs');
  assert.match(route(['site', 'connect', 'x']).program, /home\/site\.mjs$/);
  assert.match(route(['site', 'scan']).program, /vault\/bin\/ohm\.mjs$/);
  assert.deepEqual(root.dependencies, json('vault/package.json').dependencies);
  assert.equal(json('cortex/package.json').dependencies, undefined);
});

test('the plugin marketplace at the root points at the vault plugin', () => {
  const [plugin] = json('.claude-plugin/marketplace.json').plugins;
  assert.equal(plugin.source, './vault');
  assert.equal(json('vault/.claude-plugin/plugin.json').name, plugin.name);
  assert.ok(existsSync(new URL('../vault/.mcp.json', import.meta.url)) && existsSync(new URL('../vault/skills', import.meta.url)));
});

test('npx runs the command named after the package, which hands each command line to the right program', () => {
  assert.equal(json('package.json').name, 'ohmmmm');
  assert.ok(json('package.json').bin.ohmmmm);
  assert.deepEqual(route(['init', 'alice.example.com']), { home: 'init', rest: ['alice.example.com'] });
  assert.match(route(['cortex', 'status']).program, /cortex\/bin\/cortex\.mjs$/);
  assert.deepEqual(route(['cortex', 'status']).args, ['status']);
  assert.match(route(['vault', 'index']).program, /vault\/bin\/ohm\.mjs$/);
  assert.deepEqual(route(['vault', 'index']).args, ['vault', 'index']);
  assert.deepEqual(route([]).args, []);
});
