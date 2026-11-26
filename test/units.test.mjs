// Units (docs/plans/units.md): every part of a home read as one list, and the feed over it.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { initHome } from '../bin/ohmmmm.mjs';
import { artifactKind, feed, sees, UNIT_TYPES } from '../contract/unit.mjs';
import { readFeed, readLevel, readUnits } from '../home/units.mjs';

const put = async (path, text, when) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
  if (when) await utimes(path, new Date(when), new Date(when));
};

async function home(t) {
  const parent = await mkdtemp(join(tmpdir(), 'ohm-units-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const layout = await initHome(parent, 'alice.example.com');
  await put(join(layout.profile, 'profile.md'), '---\nname: "Alice"\nhandle: "alice.example.com"\nwallet: "0xabc"\n---\n\nHello.\n', '2026-11-01T00:00:00Z');
  await put(join(layout.vault, 'essays', '_channel.md'), '---\ntitle: Essays\n---\n\nWhat I write.\n');
  await put(join(layout.vault, 'essays', 'slowness.md'), '---\ntitle: On slowness\nvisibility: public\nupdated: 2026-11-20T10:00:00Z\n---\n\nWalking.\n');
  await put(join(layout.vault, 'notes', 'draft.md'), '---\ntitle: A draft\nvisibility: friends\nupdated: 2026-11-21T10:00:00Z\n---\n\nNot yet.\n');
  await put(join(layout.vault, 'notes', 'secret.md'), '---\ntitle: Mine\nupdated: 2026-11-22T10:00:00Z\n---\n\nOnly me.\n');
  await put(join(layout.cortex, 'observations', '3m2kabcdefghi.md'), '---\nat: 2026-11-23T09:00:00Z\nby: claude-code\n---\nThe slowness essay is about a walk.\n');
  await put(join(layout.site, 'src', 'pages', 'index.astro'), '---\n---\n<h1>hi</h1>\n');
  await put(join(layout.site, 'src', 'content', 'post.md'), '---\ntitle: A post on the site\n---\n\nText.\n', '2026-11-24T00:00:00Z');
  await put(join(layout.site, 'public', 'photo.jpg'), 'not really a jpeg');
  await put(join(layout.site, 'src', 'styles', 'site.css'), 'body{}');
  await put(join(layout.site, '.ohm', 'saves.jsonl'), '');
  return layout;
}

test('every part of a home is read as units, each with its path from the top of the home', async t => {
  const layout = await home(t);
  const units = await readUnits(layout);
  for (const unit of units) {
    assert.ok(UNIT_TYPES.includes(unit.type), unit.type);
    assert.ok(unit.key && unit.nsid && unit.root && unit.path && unit.visibility, JSON.stringify(unit));
    await stat(join(layout.home, unit.path));
  }
  const by = key => units.find(unit => unit.key === key);
  const slowness = units.find(unit => unit.title === 'On slowness');
  assert.equal(slowness.type, 'block');
  assert.equal(slowness.nsid, 'com.ohmmmm.vault.block');
  assert.equal(slowness.path, 'collections/essays/slowness.md');
  assert.deepEqual(slowness.channels, ['essays']);
  assert.equal(by('wallet:0xabc').path, 'profile/profile.md');
  assert.equal(by('profile:profile.md').title, 'Alice');
  assert.equal(by('agents:observations/3m2kabcdefghi.md').type, 'observation');
  assert.equal(by('agents:observations/3m2kabcdefghi.md').visibility, 'private');
  assert.equal(by('agents:profile.md').type, 'memory');
  assert.equal(by('site:src/content/post.md').title, 'A post on the site');
  assert.equal(by('site:public/photo.jpg').kind, 'image');
  assert.equal(by('site:src/styles/site.css'), undefined);
  assert.equal(by('site:src/pages/index.astro'), undefined);
  assert.ok(!units.some(unit => unit.path.includes('/.ohm/')));
  // A channel is as open as the most open block in it; a folder with no _channel.md is still one.
  const essays = units.find(unit => unit.type === 'channel' && unit.title === 'Essays');
  assert.equal(essays.path, 'collections/essays/_channel.md');
  assert.equal(essays.visibility, 'public');
  const notes = units.find(unit => unit.type === 'channel' && unit.title === 'notes');
  assert.equal(notes.path, 'collections/notes');
  assert.equal(notes.visibility, 'friends');
});

test('the feed is what an audience sees, the latest change first', async t => {
  const layout = await home(t);
  const mine = await readFeed(layout, { types: ['block'] });
  assert.deepEqual(mine.map(unit => unit.title), ['Mine', 'A draft', 'On slowness']);
  const friend = await readFeed(layout, { audience: 'friends', types: ['block'] });
  assert.deepEqual(friend.map(unit => unit.title), ['A draft', 'On slowness']);
  const everyone = await readFeed(layout, { audience: 'public' });
  assert.ok(everyone.every(unit => unit.visibility === 'public'));
  assert.ok(everyone.some(unit => unit.type === 'artifact'));
  assert.ok(!everyone.some(unit => unit.root === 'agents'));
  assert.deepEqual(feed(mine, { limit: 1 }).map(unit => unit.title), ['Mine']);
  assert.deepEqual(feed(mine, { before: '2026-11-22T00:00:00Z' }).map(unit => unit.title), ['A draft', 'On slowness']);
  assert.equal(sees('friends', { visibility: 'private' }), false);
});

test('only content files of a site are artifacts', () => {
  assert.equal(artifactKind('src/content/a.md'), 'page');
  assert.equal(artifactKind('public/a.PNG'), 'image');
  assert.equal(artifactKind('docs/a.pdf'), 'document');
  for (const path of ['src/a.ts', 'a.css', 'node_modules/x/readme.md', 'dist/index.html', '.git/HEAD', 'a/.hidden/b.md']) assert.equal(artifactKind(path), null, path);
});

test('the tree opens one folder at a time, the way a channel shows what it holds', async t => {
  const layout = await home(t);
  await put(join(layout.vault, 'notes', 'kept.md'), '---\ntitle: Kept twice\nchannels: [essays]\n---\n\nBoth.\n');
  await put(join(layout.cortex, 'skills', 'weekly', 'SKILL.md'), '---\nname: weekly\ndescription: A week.\n---\n\nDo it.\n');
  const top = await readLevel(layout, '');
  assert.deepEqual(top.folders.map(folder => folder.path), ['collections', 'profile', 'agents', 'site']);
  assert.deepEqual(top.units, []);
  const collections = await readLevel(layout, 'collections');
  assert.deepEqual(collections.folders.map(folder => [folder.path, folder.title, folder.unit?.type]), [['collections/essays', 'Essays', 'channel'], ['collections/notes', 'notes', 'channel']]);
  assert.equal(collections.folders.find(folder => folder.title === 'notes').count, 3);
  const essays = await readLevel(layout, 'collections/essays');
  assert.deepEqual(essays.units.map(unit => unit.title), ['Kept twice', 'On slowness']);
  const profile = await readLevel(layout, 'profile');
  assert.deepEqual(profile.units.map(unit => unit.type).sort(), ['profile', 'wallet']);
  const skills = await readLevel(layout, 'agents/skills');
  assert.deepEqual(skills.units.map(unit => unit.id), ['file-a-source', 'weekly']);
  assert.deepEqual(skills.folders, []);
  const site = await readLevel(layout, 'site');
  assert.deepEqual(site.folders.map(folder => folder.title), ['public', 'src']);
});
