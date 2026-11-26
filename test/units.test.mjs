// Units (docs/plans/units.md): every part of a home read as one list, and the feed over it.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { initHome } from '../bin/ohmmmm.mjs';
import { artifactKind, excerptOf, feed, sees, UNIT_TYPES } from '../contract/unit.mjs';
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
  await put(join(layout.vault, 'posts', 'first.md'), '---\nkind: short\nupdated: 2026-11-19T10:00:00Z\n---\n\n' + 'a'.repeat(295) + ' #tag\n');
  await put(join(layout.vault, 'notes', 'secret.md'), '---\ntitle: Mine\nupdated: 2026-11-22T10:00:00Z\n---\n\nOnly me.\n');
  await put(join(layout.cortex, 'observations', '3m2kabcdefghi.md'), '---\nat: 2026-11-23T09:00:00Z\nby: claude-code\n---\nThe slowness essay is about a walk.\n');
  await put(join(layout.site, 'src', 'pages', 'index.astro'), '---\n---\n<h1>hi</h1>\n');
  await put(join(layout.site, 'src', 'content', 'post.md'), '---\ntitle: A post on the site\n---\n\nText.\n', '2026-11-24T00:00:00Z');
  await put(join(layout.site, 'public', 'photo.jpg'), 'not really a jpeg');
  await put(join(layout.site, 'writings', 'walk', 'index.html'), '<html><head><title>A walk &amp; a talk — Alice</title></head></html>');
  await put(join(layout.site, 'writings', 'quiet', 'index.html'), '<html><head><title>Quiet — Alice</title><meta property="og:image" content="https://www.alice.example.com/writings/quiet/cover%20one.webp"></head></html>');
  await put(join(layout.site, 'writings', 'untitled', 'index.html'), '<html><body>no title<img src="../media/a.png"></body></html>');
  await put(join(layout.site, 'CNAME'), 'alice.example.com\n');
  await put(join(layout.site, 'writings', 'far', 'index.html'), '<html><head><title>Far</title><meta name="twitter:image" content="https://elsewhere.example.org/x.png"></head></html>');
  await put(join(layout.site, 'google1a2b3c.html'), 'google-site-verification: google1a2b3c.html');
  await put(join(layout.site, 'src', 'styles', 'site.css'), 'body{}');
  await put(join(layout.site, '.ohm', 'saves.jsonl'), '');
  await put(join(layout.site, '.ohm', 'links.json'), JSON.stringify({ links: [{ id: 'abc123def456', url: 'https://kept.example.org/', title: 'A kept page', description: 'Somewhere else.', image: 'https://kept.example.org/card.png', saved: '2026-11-25T10:00:00Z' }] }));
  await put(join(layout.home, 'tools', 'counts', 'index.html'), '<html><head><title>Counts</title></head></html>');
  await put(join(layout.home, 'tools', 'counts', 'tool.json'), JSON.stringify({ title: 'Photographs by place', description: 'How many from each place.', by: 'agent:claude-code', changed: '2026-11-26T10:00:00Z' }));
  // The site is a git checkout: its tracked files are what it holds. An untracked file is not an artifact.
  execFileSync('git', ['-C', layout.site, 'init', '-q']);
  execFileSync('git', ['-C', layout.site, 'add', 'src', 'public', 'writings', 'google1a2b3c.html']);
  await put(join(layout.site, 'src', 'content', 'scratch.md'), 'not tracked');
  return layout;
}

test('every part of a home is read as units, each with its path from the top of the home', async t => {
  const layout = await home(t);
  const units = await readUnits(layout);
  for (const unit of units) {
    assert.ok(UNIT_TYPES.includes(unit.type), unit.type);
    assert.ok(unit.key && unit.root && unit.path && unit.visibility, JSON.stringify(unit));
    // Only a unit with a record of its own names a lexicon; a unit is never a record (no com.ohmmmm.unit).
    assert.equal(unit.nsid, { block: 'com.ohmmmm.vault.block', channel: 'com.ohmmmm.vault.channel' }[unit.type], JSON.stringify(unit));
    await stat(join(layout.home, unit.path));
  }
  const by = key => units.find(unit => unit.key === key);
  const slowness = units.find(unit => unit.title === 'On slowness');
  assert.equal(slowness.type, 'block');
  assert.equal(slowness.nsid, 'com.ohmmmm.vault.block');
  assert.equal(slowness.path, 'collections/essays/slowness.md');
  assert.deepEqual(slowness.channels, ['essays']);
  assert.equal(slowness.excerpt, 'Walking.');
  // A short post keeps all its words, past an excerpt's 280.
  const short = units.find(unit => unit.kind === 'short');
  assert.equal(short.excerpt, 'a'.repeat(295) + ' #tag');
  assert.equal(by('wallet:0xabc').path, 'profile/profile.md');
  assert.equal(by('profile:profile.md').title, 'Alice');
  assert.equal(by('agents:observations/3m2kabcdefghi.md').type, 'observation');
  assert.equal(by('agents:observations/3m2kabcdefghi.md').visibility, 'private');
  assert.equal(by('agents:profile.md').type, 'memory');
  assert.equal(by('site:src/content/post.md').title, 'A post on the site');
  assert.equal(by('site:public/photo.jpg').kind, 'image');
  assert.equal(by('site:src/styles/site.css'), undefined);
  assert.equal(by('site:src/content/scratch.md'), undefined);
  // A page is named by its <title>, without the site's name every page repeats; an index page with none by its folder.
  assert.equal(by('site:writings/walk/index.html').title, 'A walk & a talk');
  assert.equal(by('site:writings/quiet/index.html').title, 'Quiet');
  assert.equal(by('site:writings/untitled/index.html').title, 'untitled');
  assert.equal(by('site:google1a2b3c.html'), undefined);
  // A card's cover: what a page says to show when shared, else its first picture; a picture is its own.
  // An address on the site's own domain is its file here; another site's stays an address.
  assert.equal(by('site:writings/quiet/index.html').cover, 'site:writings/quiet/cover one.webp');
  assert.equal(by('site:writings/far/index.html').cover, 'https://elsewhere.example.org/x.png');
  assert.equal(by('site:writings/untitled/index.html').cover, 'site:writings/media/a.png');
  assert.equal(by('site:public/photo.jpg').cover, 'site:public/photo.jpg');
  assert.equal(by('site:src/pages/index.astro'), undefined);
  // Nothing of the site's own .ohm/ is a unit, but the websites it keeps.
  assert.ok(!units.some(unit => unit.path.includes('/.ohm/') && unit.kind !== 'link'));
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
  assert.deepEqual(mine.map(unit => unit.title), ['Mine', 'A draft', 'On slowness', 'first']);
  // Unasked, the feed is your blocks worth seeing: no agents' files, channels, profile or wallet, no empty block.
  await put(join(layout.vault, 'notes', 'empty.md'), '---\ntitle: Nothing yet\n---\n');
  const yours = await readFeed(layout);
  assert.ok(yours.every(unit => unit.type === 'block' || unit.type === 'artifact'), JSON.stringify(yours.map(unit => unit.type)));
  assert.ok(!yours.some(unit => unit.title === 'Nothing yet'));
  assert.ok(yours.some(unit => unit.kind === 'image'));
  const friend = await readFeed(layout, { audience: 'friends', types: ['block'] });
  assert.deepEqual(friend.map(unit => unit.title), ['A draft', 'On slowness']);
  const everyone = await readFeed(layout, { audience: 'public' });
  assert.ok(everyone.every(unit => unit.visibility === 'public'));
  assert.ok(everyone.some(unit => unit.type === 'artifact'));
  // A site's photographs are posts of their own; its styles and scripts never are.
  assert.ok(everyone.some(unit => unit.kind === 'image'));
  assert.ok(!everyone.some(unit => unit.root === 'agents'));
  assert.ok(!(await readFeed(layout)).some(unit => unit.root === 'agents'));
  assert.deepEqual(feed(mine, { limit: 1 }).map(unit => unit.title), ['Mine']);
  assert.deepEqual(feed(mine, { before: '2026-11-22T00:00:00Z' }).map(unit => unit.title), ['A draft', 'On slowness', 'first']);
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
  assert.deepEqual(top.folders.map(folder => folder.path), ['collections', 'profile', 'agents', 'site', 'tools']);
  assert.deepEqual(top.units, []);
  const collections = await readLevel(layout, 'collections');
  assert.deepEqual(collections.folders.map(folder => [folder.path, folder.title, folder.unit?.type]), [['collections/essays', 'Essays', 'channel'], ['collections/notes', 'notes', 'channel'], ['collections/posts', 'posts', 'channel']]);
  assert.equal(collections.folders.find(folder => folder.title === 'notes').count, 3);
  const essays = await readLevel(layout, 'collections/essays');
  assert.deepEqual(essays.units.map(unit => unit.title), ['Kept twice', 'On slowness']);
  const profile = await readLevel(layout, 'profile');
  assert.deepEqual(profile.units.map(unit => unit.type).sort(), ['profile', 'wallet']);
  const skills = await readLevel(layout, 'agents/skills');
  assert.deepEqual(skills.units.map(unit => unit.id), ['file-a-source', 'weekly']);
  assert.deepEqual(skills.folders, []);
  const site = await readLevel(layout, 'site');
  assert.deepEqual(site.folders.map(folder => folder.title), ['public', 'src', 'writings']);
});

test('a post card shows a block\'s opening words, without Markdown\'s marks', () => {
  assert.equal(excerptOf('# A walk\n\nWe went to **Yanaka**, see [[lanterns|the lanterns]] and [a map](https://x.example).\n\n![[photo.jpg]]'), 'A walk We went to Yanaka, see the lanterns and a map.');
  assert.equal(excerptOf('```js\nlet a = 1\n```\nAfter the code.'), 'After the code.');
  const long = excerptOf('word '.repeat(200));
  assert.ok(long.length <= 280 && long.endsWith('…'));
  assert.equal(excerptOf(''), '');
});

test('kept websites and built tools are artifacts: in the feed, out of the tree\'s hidden folders', async t => {
  const layout = await home(t);
  const units = await readUnits(layout);
  const link = units.find(unit => unit.key === 'link:abc123def456');
  assert.deepEqual([link.type, link.kind, link.title, link.origin, link.cover, link.visibility, link.excerpt],
    ['artifact', 'link', 'A kept page', 'https://kept.example.org/', 'https://kept.example.org/card.png', 'private', 'Somewhere else.']);
  const tool = units.find(unit => unit.key === 'tools:counts');
  assert.deepEqual([tool.type, tool.kind, tool.root, tool.path, tool.title, tool.by], ['artifact', 'tool', 'tools', 'tools/counts/index.html', 'Photographs by place', 'agent:claude-code']);
  const yours = await readFeed(layout);
  assert.ok(yours.some(unit => unit.kind === 'link') && yours.some(unit => unit.kind === 'tool'));
  // Kept for you, so no one else's feed has them.
  assert.ok(!(await readFeed(layout, { audience: 'public' })).some(unit => unit.kind === 'link' || unit.kind === 'tool'));
  assert.deepEqual((await readLevel(layout, 'tools')).folders.map(folder => folder.title), ['counts']);
  assert.ok(!(await readLevel(layout, 'site')).folders.some(folder => folder.title.startsWith('.')));
});
