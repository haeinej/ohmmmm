import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { initCortex, openCortex } from '../src/folder.mjs';
import { cortexStatus } from '../src/status.mjs';

const template = fileURLToPath(new URL('../template', import.meta.url));
const cli = fileURLToPath(new URL('../bin/cortex.mjs', import.meta.url));
async function fresh(t) {
  const base = await mkdtemp(join(tmpdir(), 'cortex-status-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const dir = join(base, 'cortex');
  await initCortex(dir, template);
  return { base, dir, cortex: openCortex(dir) };
}
async function has(cortex, kind, expected = true) {
  const items = (await cortexStatus(cortex)).filter(item => item.kind === kind);
  assert.equal(items.length > 0, expected, kind);
  for (const item of items) assert.ok(item.what && item.clear);
  return items;
}
async function snapshot(root) {
  const files = {};
  for (const path of await readdir(root, { recursive: true })) {
    const full = join(root, path);
    const info = await stat(full);
    if (info.isFile()) files[path] = [await readFile(full, 'utf8'), info.mtimeMs];
  }
  return files;
}

test('profile proposals clear when accepted or declined', async t => {
  const { dir, cortex } = await fresh(t);
  const agent = openCortex(dir, { actor: 'codex' });
  const first = await agent.proposeProfile({ heading: 'Preferences', line: 'Short titles', quote: 'keep titles short' });
  const [item] = await has(cortex, 'profile-proposal');
  assert.match(item.what, /Preferences: Short titles \(from codex\)/);
  await cortex.acceptProfile(first.id);
  await has(cortex, 'profile-proposal', false);
  const second = await agent.proposeProfile({ heading: 'Goals', line: 'Publish weekly' });
  await cortex.declineProfile(second.id);
  await has(cortex, 'profile-proposal', false);
  await assert.rejects(agent.proposeProfile({ heading: 'Goals', line: 'publish  weekly' }), problem => problem.code === 'AlreadyDeclined');
});

test('skill and tool proposals each say how to stop waiting, and an agent\'s observations wait for nothing', async t => {
  const { dir, cortex } = await fresh(t);
  const agent = openCortex(dir, { actor: 'codex' });
  await agent.observe({ id: 'tables', text: 'Prefers tables to lists.' });
  await has(cortex, 'observations', false);
  await agent.proposeSkill({ text: '---\nname: file-receipts\ndescription: File receipts by month\n---\nBy month.' });
  await agent.proposeTool({ name: 'calendar', description: 'Reads the calendar', inputs: 'A day', outputs: 'Events' });
  const [skill] = await has(cortex, 'skill-proposal');
  assert.match(skill.clear, /cortex approve 'file-receipts'/);
  const [tool] = await has(cortex, 'tool-proposal');
  assert.match(tool.clear, /tools\//);
  await cortex.approveSkill('file-receipts');
  await has(cortex, 'skill-proposal', false);
});

test('a profile with no account says how to set one', async t => {
  const { dir, cortex } = await fresh(t);
  const [item] = await has(cortex, 'no-account');
  assert.match(item.clear, /^cortex account <did-or-handle> '/);
  execFileSync(process.execPath, [cli, 'account', 'did:plc:example0alex', dir]);
  await has(cortex, 'no-account', false);
  assert.match(await readFile(join(dir, 'profile.md'), 'utf8'), /^---\naccount: "did:plc:example0alex"\n---\n/);
});

test('an observation about a block no longer in the vault has a working remedy', async t => {
  const { base, dir, cortex } = await fresh(t);
  const vault = join(base, 'vault');
  await mkdir(join(vault, 'essays'), { recursive: true });
  await writeFile(join(vault, 'essays/on-maps.md'), '---\nid: p1\ntitle: On maps\n---\nMaps.');
  await cortex.connectVault({ kind: 'folder', path: vault });
  await cortex.observe({ id: 'map-essay', text: 'The essay they reread.', about: ['p1'] });
  await has(cortex, 'broken-pointer', false);
  await rm(join(vault, 'essays/on-maps.md'));
  const [item] = await has(cortex, 'broken-pointer');
  assert.equal(item.what, 'map-essay is about missing block p1');
  await rm(join(dir, 'observations', 'map-essay.md'));
  await has(cortex, 'broken-pointer', false);
});

test('status is read-only even when the vault changed, and the CLI returns text or JSON', async t => {
  const { base, dir, cortex } = await fresh(t);
  await cortex.setAccount('alex.example.com');
  const vault = join(base, 'vault');
  await mkdir(vault);
  await cortex.connectVault({ kind: 'folder', path: vault });
  assert.equal(execFileSync(process.execPath, [cli, 'status', dir], { encoding: 'utf8' }).trim(), 'Nothing is waiting.');
  await mkdir(join(vault, 'notes'));
  await writeFile(join(vault, 'notes/new.md'), 'A note.');
  const before = await snapshot(base);
  const items = await cortexStatus(cortex);
  assert.deepEqual(JSON.parse(execFileSync(process.execPath, [cli, 'status', '--json', dir], { encoding: 'utf8' })), items);
  assert.deepEqual(await snapshot(base), before);
});

const asRoot = process.getuid?.() === 0;
test('an unreadable observation or profile.md is a problem, and status and cortex_start still answer', { skip: asRoot && 'root reads every file' }, async t => {
  const { dir, cortex } = await fresh(t);
  const { chmod } = await import('node:fs/promises');
  await writeFile(join(dir, 'observations/locked.md'), 'not readable');
  await chmod(join(dir, 'observations/locked.md'), 0o000);
  await chmod(join(dir, 'profile.md'), 0o000);
  t.after(async () => { await chmod(join(dir, 'profile.md'), 0o644).catch(() => {}); await chmod(join(dir, 'observations/locked.md'), 0o644).catch(() => {}); });
  const problems = await has(cortex, 'problem');
  assert.deepEqual(problems.map(item => item.what).sort(), ['observations/locked.md cannot be read: EACCES', 'profile.md cannot be read: EACCES']);
  assert.ok(problems.every(item => item.clear === "Fix the file's permissions or contents"));
  assert.ok((await openCortex(dir, { actor: 'codex' }).start()).problems.includes('observations/locked.md cannot be read: EACCES'));
  await chmod(join(dir, 'profile.md'), 0o644);
  await rm(join(dir, 'observations/locked.md'));
  await has(cortex, 'problem', false);
});

test('a folder with no cortex in it is a problem, not "Nothing is waiting."', async t => {
  const base = await mkdtemp(join(tmpdir(), 'cortex-status-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const missing = join(base, 'no-such-cortex');
  const items = await cortexStatus(openCortex(missing));
  assert.deepEqual(items, [{ kind: 'problem', what: `There is no cortex at ${missing}: it has no agents/AGENTS.md and no .cortex/`, clear: `Check the path, or start one with cortex init '${missing}'` }]);
  const out = execFileSync(process.execPath, [cli, 'status', missing], { encoding: 'utf8' });
  assert.match(out, /^problem: There is no cortex at /);
  assert.deepEqual(JSON.parse(execFileSync(process.execPath, [cli, 'status', '--json', missing], { encoding: 'utf8' })), items);
});

test('pasted status remedies clear the selected cortex, including paths with shell characters', async t => {
  const { base } = await fresh(t);
  const dir = join(base, "another cortex's $HOME; folder");
  const defaultDir = join(base, 'default-cortex');
  await initCortex(dir, template);
  await initCortex(defaultDir, template);
  const cortex = openCortex(dir);
  const agent = openCortex(dir, { actor: 'codex' });
  const execute = command => execFileSync('/bin/sh', ['-c', command.replace(/^cortex /, `'${process.execPath}' '${cli}' `)], { encoding: 'utf8', env: { ...process.env, CORTEX_DIR: defaultDir } });
  const untouched = await snapshot(defaultDir);
  for (const [answer, line] of [['accept', 'Call me Alex'], ['decline', 'Call me Robin']]) {
    await agent.proposeProfile({ heading: 'Notes', line });
    const [item] = await has(cortex, 'profile-proposal');
    const [accept, decline] = item.clear.split(' or ');
    execute(answer === 'accept' ? accept : decline);
    await has(cortex, 'profile-proposal', false);
  }
  assert.deepEqual((await cortex.profile()).sections.find(section => section.heading === 'Notes').lines, ['Call me Alex']);
  await agent.proposeSkill({ text: '---\nname: reading-notes\ndescription: File reading notes\n---\nRead it.' });
  const [skill] = await has(cortex, 'skill-proposal');
  execute(skill.clear);
  await has(cortex, 'skill-proposal', false);
  assert.deepEqual(await snapshot(defaultDir), untouched);
});
