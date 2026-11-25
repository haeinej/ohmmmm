import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createLocalTools } from '../mcp/local.mjs';
import { atomsOf, fill, parseTree, templatesOf } from '../site-import/html.mjs';
import { importSite, planProblems } from '../site-import/apply.mjs';
import { checkSite } from '../site-import/check.mjs';
import { scanSite } from '../site-import/scan.mjs';

// A small, made-up site: a gallery of photographs with cards among them, a folder of articles with
// a series inside it, a page of entries with writing of their own, a copy of an article, a
// verification file, and a note that is not committed and must never be read.
const page = (body, { lang = 'en', head = '' } = {}) => `<!DOCTYPE html>\n<html lang="${lang}">\n<head><meta charset="utf-8"><title>Example</title>${head}</head>\n<body>\n${body}\n</body>\n</html>\n`;
const figure = (year, loc, cls, media, caption) => `<figure data-year="${year}" data-loc="${loc}" class="item ${cls}"><span class="frame">${media}</span><figcaption>${caption}</figcaption></figure>`;
const img = (name, w, h) => `<img src="thumb/${name}?v=2" width="${w}" height="${h}" alt="" loading="lazy">`;
const card = (href, title, words) => `<a class="card" data-kind="read" href="${href}">\n    <span class="card-title">${title}</span>\n    <span class="card-words">${words}</span>\n  </a>`;
const SITE = {
  'CNAME': 'example.test\n',
  'index.html': page('<main><h1>Example</h1><p>Hello.</p></main>'),
  'gallery/index.html': page(`<nav><a href="/">Home</a><a href="/writing/">Writing</a><a href="/work/">Work</a></nav>
<main class="grid" id="grid">
  <!-- CARDS -->
  ${card('/writing/one.html', 'One', 'The first one.')}
  ${figure('2025', 'Lisboa', 'sp-a', img('a.jpg', 600, 800), '001')}
  ${figure('2025', 'Lisboa', 'sp-b', img('b.jpg', 800, 600), '')}
  ${card('/writing/series/walks/', 'Walks', 'A series.')}
  ${figure('2026', 'Seoul', 'sp-a', img('c.jpg', 600, 800), '')}
  ${figure('2026', 'Seoul', 'sp-c', '<video src="vidsm/d.mp4" width="720" height="1280" muted loop playsinline></video>', '004')}
  ${card('/work/#tea', 'Tea', 'An entry.')}
</main>`),
  'writing/one.html': page(`<main><div lang="en"><article><header><h1>One</h1><p class="subtitle">The first</p></header><p>A <strong>first</strong> walk, with <a href="https://example.org/">a link</a>.</p><p>Second paragraph.</p></article></div>
<div lang="ko"><article><header><h1>하나</h1></header><p>첫 번째 산책.</p></article></div></main>`, { head: '<script type="application/ld+json">{"datePublished": "2026-03-02"}</script>' }),
  'writing/two.html': page('<main><article><h1>Two</h1><p>Another walk.</p><figure><img src="/writing/media/two.jpg" alt="A road"></figure><p>The end.</p></article></main>'),
  'writing/series/walks/three.html': page('<main><article><h1>Three</h1><p>The third walk.</p></article></main>'),
  'writing/series/walks/index.html': page('<main><h1>Walks</h1></main>'),
  'writing/copy.html': page('<main><article><h1>One</h1><p>A first walk.</p></article></main>', { head: '<link rel="canonical" href="https://example.test/writing/one.html">' }),
  'work/index.html': page(`<main><section class="entries" id="work">
<details class="entry" id="tea"><summary>Tea</summary><p>Brewing.</p></details>
<details class="entry" id="bread"><summary>Bread</summary><p>Baking.</p><p>Slowly.</p></details>
<details class="entry" id="soup"><summary>Soup</summary><div class="links"><a href="https://example.org/soup">Recipe</a></div></details>
<details class="entry" id="rice"><summary>Rice</summary><p lang="en">Steaming.</p><p lang="ko">찌기.</p><p lang="en">Resting.</p></details>
<details class="entry" id="jam"><summary>Jam</summary><ul><li>Plums</li><li>Sugar</li></ul></details>
</section></main>`),
  'google0123abcdef.html': 'google-site-verification: google0123abcdef.html\n',
  'gallery/img/a.jpg': 'a'.repeat(400), 'gallery/thumb/a.jpg': 'a'.repeat(100),
  'gallery/img/b.jpg': 'b'.repeat(400), 'gallery/thumb/b.jpg': 'b'.repeat(100),
  'gallery/img/c.jpg': 'c'.repeat(400), 'gallery/thumb/c.jpg': 'c'.repeat(100),
  'gallery/vid/d.mp4': 'd'.repeat(400), 'gallery/vidsm/d.mp4': 'd'.repeat(100),
  'writing/media/two.jpg': 'e'.repeat(50),
  'writing/media/unused.jpg': 'f'.repeat(50),
};

async function makeSite() {
  const folder = await mkdtemp(join(tmpdir(), 'ohm-site-'));
  for (const [path, text] of Object.entries(SITE)) {
    await mkdir(join(folder, path, '..'), { recursive: true });
    await writeFile(join(folder, path), text);
  }
  const git = (...args) => execFileSync('git', ['-C', folder, ...args], { stdio: 'pipe' });
  git('init', '-q');
  git('-c', 'user.email=site@example.test', '-c', 'user.name=Example', 'add', '.');
  git('-c', 'user.email=site@example.test', '-c', 'user.name=Example', 'commit', '-q', '-m', 'Site');
  // Never committed: a scan must not read it.
  await mkdir(join(folder, 'notes'));
  await writeFile(join(folder, 'notes', 'private.md'), 'A private note.\n');
  return folder;
}
const named = plan => ({
  ...plan,
  channels: plan.channels.map(c => ({ ...c, name: { 'articles:writing': 'Writings', 'items:gallery/index.html#grid>figure.item': 'Photographs', 'items:work/index.html#work>details.entry': 'Entries' }[c.source] ?? null })),
});
async function files(dir) {
  const out = [];
  const visit = async at => { for (const e of await readdir(join(dir, at), { withFileTypes: true })) { if (e.name.startsWith('.')) continue; const p = at ? `${at}/${e.name}` : e.name; if (e.isDirectory()) await visit(p); else out.push(p); } };
  await visit('');
  return out.sort();
}

test('a run of items gives every item back exactly from its template and fields', () => {
  const items = [
    figure('2025', 'Lisboa', 'sp-a', img('a.jpg', 600, 800), '001'),
    figure('2025', 'Lisboa', 'sp-b', img('b.jpg', 800, 600), ''),
    figure('2026', 'Seoul', 'sp-c', '<video src="vidsm/d.mp4" width="720"></video>', '004'),
  ];
  for (const html of items) assert.equal(atomsOf(html).map(a => a.lit ?? a.val).join(''), html);
  const t = templatesOf(items);
  assert.equal(t.shapes.length, 2, 'a picture and a video are two shapes');
  items.forEach((html, i) => assert.equal(fill(t.shapes[t.items[i].shape].parts, t.items[i].fields), html));
  assert.deepEqual(t.items[1].fields, { 'figure@data-loc': 'Lisboa', 'figure@data-year': '2025', 'figure@class': 'item sp-b', 'img@src': 'thumb/b.jpg?v=2', 'img@width': '800', 'img@height': '600', 'figcaption#text': '' });
  const tree = parseTree('<main id="m"><p>a<br>b</p><img src="x"></main>');
  assert.deepEqual(tree.children[0].children.map(c => c.name), ['p', 'img']);
});

test('a scan says what the site holds, reads only what git tracks, and changes nothing', async () => {
  const folder = await makeSite();
  try {
    const before = await files(folder);
    const { plan } = await scanSite(folder);
    assert.deepEqual(await files(folder), before);
    assert.equal(plan.site.origin, 'https://example.test');
    assert.equal(plan.site.files, Object.keys(SITE).length, 'the note that is not committed is not among them');
    const kinds = Object.fromEntries(plan.pages.map(p => [p.path, p.kind]));
    assert.equal(kinds['writing/copy.html'], 'copy');
    assert.equal(kinds['google0123abcdef.html'], 'verification');
    assert.equal(kinds['writing/one.html'], 'article');
    const by = Object.fromEntries(plan.channels.map(c => [c.source, c]));
    assert.deepEqual(by['articles:writing'].subs, { walks: 1 });
    assert.equal(by['articles:writing'].count, 3, 'the copy is not an article of its own');
    assert.deepEqual(by['articles:writing'].languages, ['en', 'ko']);
    const photos = by['items:gallery/index.html#grid>figure.item'];
    assert.equal(photos.kind, 'list');
    assert.equal(photos.sub, 'figure@data-loc');
    assert.deepEqual(photos.subs, { Lisboa: 2, Seoul: 2 });
    assert.equal(by['items:work/index.html#work>details.entry'].kind, 'rich');
    assert.equal(plan.channels.every(c => c.name === null), true, 'names are the owner\'s');
    assert.deepEqual(plan.views.map(v => [v.source, v.resolved]), [['items:gallery/index.html#grid>a.card', 3]]);
    assert.equal(plan.media.copies, 4);
    assert.deepEqual(plan.media.unreferenced, ['writing/media/unused.jpg']);
    assert.ok(plan.checks.every(c => c.reproduced === c.items));
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('bringing a site in needs a name for every channel, writes only with apply, and twice writes nothing new', async () => {
  const folder = await makeSite();
  const vault = await mkdtemp(join(tmpdir(), 'ohm-vault-'));
  try {
    const { plan } = await scanSite(folder);
    assert.equal(planProblems(plan).length, 3);
    await assert.rejects(importSite(plan, { vault }), /Name the channel for writing/);
    const ready = named(plan);
    const preview = await importSite(ready, { vault });
    assert.deepEqual(await files(vault), [], 'a preview writes nothing');
    assert.ok(preview.files.every(f => f.state === 'add'));
    const done = await importSite(ready, { vault, apply: true });
    assert.equal(done.blocks, 3 + 4 + 5);
    const written = await files(vault);
    for (const path of ['Writings/_channel.md', 'Writings/walks/_channel.md', 'Writings/one.md', 'Writings/walks/three.md', 'Photographs/Lisboa/a.md', 'Photographs/Seoul/d.md', 'Entries/tea.md']) assert.ok(written.includes(path), path);
    const photo = await readFile(join(vault, 'Photographs/Lisboa/a.md'), 'utf8');
    assert.match(photo, /^origin: "https:\/\/example\.test\/gallery\/img\/a\.jpg"$/m, 'the original, not its smaller copy, and nothing copied');
    assert.doesNotMatch(photo, /visibility/, 'it starts private');
    const one = await readFile(join(vault, 'Writings/one.md'), 'utf8');
    assert.match(one, /A \*\*first\*\* walk, with \[a link\]\(<?https:\/\/example\.org\/>?\)\./);
    assert.doesNotMatch(one, /하나|산책/, 'the first language only');
    assert.match(one, /"views":\[\{"page":"gallery\/index\.html"/, 'its card in the gallery is kept with it');
    assert.match(await readFile(join(vault, 'Writings/walks/_channel.md'), 'utf8'), /^views:$/m, 'a card for a series is kept with the series');
    const ids = [];
    for (const path of written.filter(p => p.endsWith('.md') && !p.endsWith('_channel.md'))) ids.push(/^id: (\S+)$/m.exec(await readFile(join(vault, path), 'utf8'))[1]);
    assert.equal(new Set(ids).size, ids.length, 'every block has an id of its own');
    const journal = (await readFile(join(vault, '.vault/journal.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(journal.length, written.length);
    const again = await importSite(ready, { vault });
    assert.ok(again.files.every(f => f.state === 'same'), 'the same site brought in twice writes the same files');
  } finally { await rm(folder, { recursive: true, force: true }); await rm(vault, { recursive: true, force: true }); }
});

test('a check builds the site\'s repeated parts again from the vault, and says where they differ', async () => {
  const folder = await makeSite();
  const vault = await mkdtemp(join(tmpdir(), 'ohm-vault-'));
  try {
    const { plan } = await scanSite(folder);
    const ready = named(plan);
    await importSite(ready, { vault, apply: true });
    const ok = await checkSite(ready, { vault });
    assert.equal(ok.ok, true, JSON.stringify(ok, null, 1));
    assert.deepEqual(ok.regions.map(r => [r.page, r.held, r.items, r.same]), [['gallery/index.html', 7, 7, true]]);
    assert.equal(ok.texts.length, 3 + 5);
    // A caption changed in the vault: the page built from the vault is not the page any more.
    const path = join(vault, 'Photographs/Lisboa/a.md');
    await writeFile(path, (await readFile(path, 'utf8')).replace('"figcaption#text":"001"', '"figcaption#text":"999"'));
    const changed = await checkSite(ready, { vault });
    assert.equal(changed.ok, false);
    assert.match(changed.regions[0].difference.vault, /999/);
  } finally { await rm(folder, { recursive: true, force: true }); await rm(vault, { recursive: true, force: true }); }
});

test('the curator brings a site in through its tools: read, ask, then write only where it was granted', async () => {
  const folder = await makeSite();
  const vault = await mkdtemp(join(tmpdir(), 'ohm-vault-'));
  try {
    await mkdir(join(vault, '.vault'), { recursive: true });
    await writeFile(join(vault, '.vault/grants.json'), JSON.stringify({ agents: { curator: { write: ['Writings', 'Photographs'] } } }));
    const tools = createLocalTools({ vault, by: 'agent:curator', DatabaseSync });
    const { plan } = await tools.call('vault_site_scan', { folder });
    assert.ok(plan.channels.every(c => c.name === null));
    await tools.call('vault_index');
    await assert.rejects(tools.call('vault_site_import', { plan }), /Name the channel/);
    const ready = named(plan);
    const preview = await tools.call('vault_site_import', { plan: ready });
    assert.equal(preview.written.length, 0);
    assert.deepEqual(await files(vault), [], 'a preview writes nothing');
    // Entries were not granted: nothing is written at all.
    await assert.rejects(tools.call('vault_site_import', { plan: ready, apply: true }), /no write grant on Entries/);
    assert.deepEqual(await files(vault), []);
    const granted = { ...ready, channels: ready.channels.map(c => (c.name === 'Entries' ? { ...c, skip: true } : c)) };
    const done = await tools.call('vault_site_import', { plan: granted, apply: true });
    assert.equal(done.written.length, done.add);
    const photo = await readFile(join(vault, 'Photographs/Lisboa/a.md'), 'utf8');
    assert.match(photo, /^by: "agent:curator"$/m);
    assert.doesNotMatch(photo, /^visibility:/m);
    const again = await tools.call('vault_site_import', { plan: granted });
    assert.equal(again.add, 0);
    assert.equal(again.change, 0, 'what the curator wrote reads back the same');
    // Entries were skipped, so the gallery's card for one of them has nothing to be kept with, and the check says so.
    const checked = await tools.call('vault_site_check', { plan: granted });
    assert.deepEqual(checked.regions.map(r => [r.held, r.items, r.same]), [[6, 7, false]]);
    assert.ok(done.unresolved.some(u => u.includes('/work/#tea')));
  } finally { await rm(folder, { recursive: true, force: true }); await rm(vault, { recursive: true, force: true }); }
});
