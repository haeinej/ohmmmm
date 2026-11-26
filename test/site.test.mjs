// The site in a person's ohm (home/site.mjs): connected from their repository, served and saved
// through the bridge, every save logged and restorable, and Publish as pull, commit, push, deploy,
// going on from where it stopped. Cloudflare is a stand-in wrangler that only answers.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { initHome } from '../bin/ohmmmm.mjs';
import { homeBridge, listenHome, pairApp, addAgent } from '../home/serve.mjs';
import { connect, contentOf, savesOf } from '../home/site.mjs';

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x' } });

async function setUp(t) {
  const parent = await mkdtemp(join(tmpdir(), 'ohm-site-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  // The person's repository, and a copy of it elsewhere that the "remote" moves on with.
  const remote = join(parent, 'site.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  const work = join(parent, 'work');
  execFileSync('git', ['clone', '-q', remote, work]);
  await mkdir(join(work, 'writing'), { recursive: true });
  await writeFile(join(work, 'index.html'), '<html><head><title>Home</title><link rel="stylesheet" href="/style.css"></head><body><p>Hello</p></body></html>\n');
  await writeFile(join(work, 'style.css'), 'body { color: black; }\n');
  await writeFile(join(work, 'unused.png'), 'png');
  await writeFile(join(work, 'secret.txt'), 'not tracked');
  git(work, 'add', 'index.html', 'style.css', 'unused.png');
  git(work, 'commit', '-qm', 'First');
  git(work, 'push', '-q', 'origin', 'main');

  const layout = await initHome(parent, 'mira.example.com');
  process.env.GIT_AUTHOR_NAME = 'T'; process.env.GIT_AUTHOR_EMAIL = 't@x'; process.env.GIT_COMMITTER_NAME = 'T'; process.env.GIT_COMMITTER_EMAIL = 't@x';
  const settings = await connect(layout, { repo: remote, project: 'Mira Site' });
  assert.equal(settings.project, 'mira-site');
  await writeFile(join(layout.site, 'secret.txt'), 'not tracked');

  // A wrangler that is signed in and deploys anywhere, saying where.
  const wrangler = join(parent, 'wrangler');
  await writeFile(wrangler, '#!/bin/sh\ncase "$1" in whoami) echo "You are logged in";; pages) if [ "$2" = deploy ]; then echo "Deployed https://abc.mira-site.pages.dev"; else echo "│ mira-site │"; fi;; esac\n');
  await chmod(wrangler, 0o755);
  process.env.OHM_WRANGLER = wrangler;
  t.after(() => { delete process.env.OHM_WRANGLER; });

  const token = await pairApp(layout.home);
  const server = await listenHome(homeBridge({ layout, DatabaseSync }), { port: 0 });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const ask = (path, init = {}, key = token) => fetch(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${key}`, ...init.headers } });
  const post = (path, value) => ask(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  return { layout, remote, work, ask, post };
}

test('a connected site is served from its tracked files, and saved, logged and restored without a commit', async t => {
  const { layout, ask, post } = await setUp(t);
  assert.deepEqual(await (await ask('/site')).json(), { connected: true, repo: join(layout.home, '..', 'site.git'), project: 'mira-site', domain: '' });
  assert.match(await readFile(join(layout.site, '.git', 'info', 'exclude'), 'utf8'), /\/\.ohm\//);

  const page = await ask('/site/file/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Hello/);
  assert.equal((await ask('/site/file/secret.txt')).status, 404, 'what git does not track is never served');
  assert.equal((await ask('/site/file/.ohm/site.json')).status, 404);

  // A stylesheet is saved like a page: over the version read.
  const css = await ask('/site/file/style.css');
  const read = css.headers.get('etag');
  assert.equal((await ask('/site/file/style.css', { method: 'PUT', body: 'x' })).status, 428);
  assert.equal((await ask('/site/file/style.css', { method: 'PUT', headers: { 'If-Match': '"stale"' }, body: 'x' })).status, 412);
  const saved = await ask('/site/file/style.css', { method: 'PUT', headers: { 'If-Match': read }, body: 'body { color: red; }\n' });
  assert.equal(saved.status, 200);
  assert.equal(await readFile(join(layout.site, 'style.css'), 'utf8'), 'body { color: red; }\n');
  assert.equal(git(layout.site, 'log', '--oneline').trim().split('\n').length, 1, 'a save never commits');
  const [first] = await savesOf(layout.site);
  assert.equal(first.path, 'style.css');
  assert.equal(first.via, 'editor');

  const status = await (await ask('/site/status')).json();
  assert.deepEqual(status.changed, ['style.css']);

  // The tree marks what changed, and what nothing uses.
  const { files } = await (await ask('/site/tree')).json();
  assert.deepEqual(files.map(f => [f.path, f.changed, f.used]), [['index.html', false, true], ['style.css', true, true], ['unused.png', false, false]]);

  // Restore puts the version before back, as a new save.
  const restored = await post('/site/restore', { path: 'style.css', hash: first.before });
  assert.equal(restored.status, 200);
  assert.equal(await readFile(join(layout.site, 'style.css'), 'utf8'), 'body { color: black; }\n');
  assert.equal((await savesOf(layout.site)).at(-1).via, 'restore');

  // A move is a save too: git is told, nothing is committed.
  assert.equal((await post('/site/move', { from: 'unused.png', to: 'img/kept.png' })).status, 200);
  assert.ok(git(layout.site, 'ls-files').includes('img/kept.png'));
  assert.equal((await post('/site/move', { from: 'img/kept.png', to: '../out.png' })).status, 400);
  assert.equal((await post('/site/move', { from: 'index.html', to: 'style.css' })).status, 409);
});

test('Publish pulls, commits, pushes and deploys, stops at the first failure, and goes on from there', async t => {
  const { layout, remote, work, ask, post } = await setUp(t);
  const css = await ask('/site/file/style.css');
  await ask('/site/file/style.css', { method: 'PUT', headers: { 'If-Match': css.headers.get('etag') }, body: 'body { color: blue; }\n' });

  // The remote moved on with a change to the same file: pull can't fast-forward, and nothing moves.
  await writeFile(join(work, 'style.css'), 'body { color: green; }\n');
  git(work, 'commit', '-qam', 'Elsewhere');
  git(work, 'push', '-q', 'origin', 'main');
  const stuck = await (await post('/site/publish', { message: 'Blue' })).json();
  assert.equal(stuck.failed.step, 'pull');
  assert.match(stuck.failed.reason, /can't simply take in|Nothing was changed|bring them in/);
  assert.equal(await readFile(join(layout.site, 'style.css'), 'utf8'), 'body { color: blue; }\n');

  // Set right (the person takes the remote's change in), Publish goes on.
  await writeFile(join(layout.site, 'style.css'), 'body { color: black; }\n');
  git(layout.site, 'pull', '-q', '--ff-only');
  await writeFile(join(layout.site, 'style.css'), 'body { color: blue; }\n');
  const done = await (await post('/site/publish', { message: 'Blue' })).json();
  assert.equal(done.failed, undefined, JSON.stringify(done));
  assert.deepEqual(done.done.map(s => [s.step, s.did]), [['pull', false], ['commit', true], ['push', true], ['deploy', true]]);
  assert.equal(done.live.url, 'https://abc.mira-site.pages.dev');
  assert.equal(git(remote, 'log', '-1', '--format=%s').trim(), 'Blue');

  // Published again with nothing new, every step is already done.
  const again = await (await post('/site/publish', { message: '' })).json();
  assert.deepEqual(again.done.map(s => s.did), [false, false, false, false]);

  // History: saves, publishes, deploys; a publish's change can be seen, and put back live.
  const history = await (await ask('/site/history')).json();
  assert.equal(history.commits[0].subject, 'Blue');
  assert.deepEqual(history.commits[0].files, ['style.css']);
  assert.equal(history.deploys.length, 1);
  const change = await (await ask(`/site/commit?hash=${history.commits[0].hash}&path=style.css`)).json();
  assert.equal(change.after, 'body { color: blue; }\n');
  const back = await (await post('/site/deploy', { commit: history.commits[1].hash })).json();
  assert.equal(back.putBack, true);
  assert.equal(back.production, true);
});

test('an agent\'s key reaches no route of the site', async t => {
  const { layout, ask } = await setUp(t);
  const agent = await addAgent(layout.home, 'claude-code');
  for (const path of ['/site', '/site/file/', '/site/publish', '/site/deploy']) assert.equal((await ask(path, {}, agent)).status, 403, path);
});

test('a site arranged by what it holds is read as the same channels as one from before', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ohm-layout-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', dir]);
  const put = async (path, text) => { await mkdir(join(dir, path, '..'), { recursive: true }); await writeFile(join(dir, path), text); };
  const article = title => `<html><body><article><h1>${title}</h1><p>Words.</p></article></body></html>`;
  await put('writings/index.html', '<html><body>list</body></html>');
  await put('writings/elsewheren/index.html', article('elsewheren'));
  await put('writings/collisions/index.html', '<html><body>series</body></html>');
  await put('writings/collisions/episode-01/index.html', article('ep.01'));
  await put('photographs/index.html', '<figure data-loc="Berlin" class="item"><img src="/photographs/berlin/small/a.jpg"></figure>');
  await put('photographs/berlin/a.jpg', 'jpg');
  await put('photographs/berlin/small/a.jpg', 'jpg');
  await put('projects/index.html', '<details class="entry" id="ohm"><summary>ohm.</summary><p>Rebuilding.</p></details>');
  git(dir, 'add', '.');
  const { start, collections } = await contentOf(dir);
  assert.equal(start, 'photographs/index.html');
  const [writings, photographs, projects] = collections;
  assert.deepEqual(writings.items.map(i => [i.path, i.channel]), [['writings/collisions/episode-01/index.html', 'collisions'], ['writings/elsewheren/index.html', undefined]]);
  assert.deepEqual(photographs.items.map(i => [i.path, i.thumb, i.channel]), [['photographs/berlin/a.jpg', 'photographs/berlin/small/a.jpg', 'Berlin']]);
  assert.deepEqual(projects.items.map(i => i.path), ['projects/index.html#ohm']);
});

test('a new picture is added to the site as a save, and nothing else is', async () => {
  const { addFile, tracked } = await import('../home/site.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'ohm-add-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
  const added = await addFile(dir, 'photographs/new/a.jpg', Buffer.from([0xff, 0xd8, 0xff, 1]));
  assert.equal(added.path, 'photographs/new/a.jpg');
  assert.ok(tracked(dir).has('photographs/new/a.jpg'), 'told to git, so the site counts it');
  assert.equal((await savesOf(dir)).at(-1).kind, 'add');
  for (const [path, bytes, status] of [['photographs/new/a.jpg', [1], 409], ['../x.jpg', [1], 400], ['notes.txt', [1], 415], ['p/e.jpg', [], 400]])
    await assert.rejects(addFile(dir, path, Buffer.from(bytes)), { status });
  await rm(dir, { recursive: true, force: true });
});

test('a coding agent changes the site over MCP as saves of its own, and never commits', async () => {
  const { createSiteTools } = await import('../home/site-mcp.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'ohm-site-mcp-'));
  const run = (...a) => execFileSync('git', a, { cwd: dir });
  run('init', '-q');
  await writeFile(join(dir, 'index.html'), '<h1>hi</h1>\n');
  await mkdir(join(dir, 'writings'));
  await writeFile(join(dir, 'writings/a.html'), '<p>a</p>\n');
  run('add', '.'); run('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'start');
  const tools = createSiteTools({ dir, agent: 'claude-code' });
  const read = await tools.call('site_read', { path: 'index.html' });
  assert.equal(read.text, '<h1>hi</h1>\n');
  await tools.call('site_write', { path: 'index.html', text: '<h1>hello</h1>\n', version: read.version });
  assert.equal(await readFile(join(dir, 'index.html'), 'utf8'), '<h1>hello</h1>\n');
  await assert.rejects(tools.call('site_write', { path: 'index.html', text: 'x', version: read.version }), { status: 412 });
  const last = (await savesOf(dir)).at(-1);
  assert.equal(last.via, 'agent:claude-code');
  const page = await tools.call('site_history', { path: 'index.html' });
  assert.ok(page.saves.every(s => s.path === 'index.html') && page.saves.length === 1);
  assert.equal((await tools.call('site_history', { path: 'writings/' })).saves.length, 0);
  assert.equal(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: dir }).toString().trim(), '1', 'nothing committed');
  await rm(dir, { recursive: true, force: true });
});

test('a page that is not the person\'s is kept as a link beside the site, never in it', async () => {
  const { addLink, linksOf, removeLink, tracked } = await import('../home/site.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'ohm-links-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const page = '<html><head><title>Plain</title><meta property="og:title" content="A &amp; B"><meta name="description" content="About it"><meta property="og:image" content="/pic.jpg"></head></html>';
  const fetch = async () => new Response(page, { headers: { 'content-type': 'text/html' } });
  const link = await addLink(dir, 'https://www.example.com/post', { fetch });
  assert.deepEqual([link.title, link.description, link.image, link.site], ['A & B', 'About it', 'https://www.example.com/pic.jpg', 'example.com']);
  assert.equal((await addLink(dir, 'https://www.example.com/post', { fetch })).id, link.id, 'the same address is kept once');
  const offline = await addLink(dir, 'https://offline.example/x', { fetch: async () => { throw new Error('no network') } });
  assert.equal(offline.title, 'offline.example');
  await assert.rejects(addLink(dir, 'ftp://x', { fetch }), { status: 400 });
  assert.equal((await linksOf(dir)).length, 2);
  assert.equal(tracked(dir).size, 0, 'nothing joins the site');
  await removeLink(dir, link.id);
  assert.deepEqual((await linksOf(dir)).map(l => l.id), [offline.id]);
  await rm(dir, { recursive: true, force: true });
});

test('the site, live: a change in its folder, an agent\'s focus and the person\'s pick are told as they happen', async () => {
  const { siteLive } = await import('../home/site-live.mjs');
  const { createSiteTools } = await import('../home/site-mcp.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'ohm-live-'));
  const live = siteLive(dir);
  const seen = [];
  const stop = live.listen(e => seen.push(e));
  await new Promise(r => setTimeout(r, 250)); // the watcher takes a moment to start
  try {
  await writeFile(join(dir, 'index.html'), '<h1>hi</h1>');
  await new Promise(r => setTimeout(r, 400));
  assert.ok(seen.some(e => e.type === 'change' && e.path === 'index.html'), 'a change is told');
  const tools = createSiteTools({ dir, agent: 'claude-code', live });
  await tools.call('site_focus', { path: 'index.html', selector: 'h1', note: 'making it bigger' });
  assert.ok(seen.some(e => e.type === 'focus' && e.agent === 'claude-code' && e.selector === 'h1'));
  live.setPointed({ path: 'index.html', selector: 'h1', text: 'hi' });
  assert.equal((await tools.call('site_pointed', {})).pointed.text, 'hi');
  } finally { stop(); }
  await rm(dir, { recursive: true, force: true });
});

test('an agent works the canvas and the collections over MCP, as in a design tool, and the open app is told', async () => {
  const { siteLive } = await import('../home/site-live.mjs');
  const { createSiteTools } = await import('../home/site-mcp.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'ohm-board-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const live = siteLive(dir);
  const told = [];
  const stop = live.listen(e => told.push(e));
  try {
    const tools = createSiteTools({ dir, agent: 'claude-code', live });
    const note = await tools.call('canvas_add', { kind: 'note', text: 'start from the people', x: 10, y: 20 });
    assert.equal((await tools.call('canvas_cards', {})).cards.length, 1);
    assert.ok(told.some(e => e.type === 'board' && e.by === 'agent:claude-code'));
    const moved = await tools.call('canvas_update', { id: note.id, x: 300, text: 'start from people' });
    assert.deepEqual([moved.x, moved.y, moved.text], [300, 20, 'start from people']);
    live.setSelection([note.id]);
    assert.equal((await tools.call('canvas_selection', {})).cards[0].id, note.id);
    await tools.call('canvas_show', { id: note.id });
    assert.ok(told.some(e => e.type === 'view' && e.id === note.id));
    await tools.call('canvas_remove', { id: note.id });
    assert.equal((await tools.call('canvas_cards', {})).cards.length, 0);
    await tools.call('channel_create', { name: 'Reading' });
    await tools.call('channel_file', { channel: 'Reading', path: 'writings/a.html' });
    await tools.call('channel_color', { channel: 'Reading', color: 'plum' });
    const own = (await tools.call('channels_list', {})).own;
    assert.deepEqual(own, [{ name: 'Reading', blocks: 1, color: 'plum' }]);
    assert.ok((await tools.call('ohm_overview', {})).canvas);
  } finally { stop(); await rm(dir, { recursive: true, force: true }); }
});

test('a prompt written on the canvas is read by the agent it is for, and its answer lands under it', async () => {
  const { siteLive } = await import('../home/site-live.mjs');
  const { createSiteTools } = await import('../home/site-mcp.mjs');
  const { saveBoard, boardOf } = await import('../home/site-board.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'ohm-prompt-'));
  const live = siteLive(dir);
  try {
    await saveBoard(dir, [
      { id: 'p1', kind: 'prompt', text: 'make Berlin a grid', to: 'claude-code', status: 'waiting', x: 0, y: 0 },
      { id: 'p2', kind: 'prompt', text: 'not sent yet', to: 'claude-code', status: 'draft', x: 0, y: 0 },
      { id: 'p3', kind: 'prompt', text: 'for codex', to: 'codex', status: 'waiting', x: 0, y: 0 },
    ], { by: 'app' });
    const claude = createSiteTools({ dir, agent: 'claude-code', live });
    assert.deepEqual((await claude.call('prompts_waiting', {})).prompts.map(p => p.id), ['p1'], 'only what is sent, and to it');
    await claude.call('prompt_answer', { id: 'p1', status: 'working', answer: 'on it' });
    assert.deepEqual((await claude.call('prompts_waiting', {})).prompts, []);
    await claude.call('prompt_answer', { id: 'p1', status: 'done', answer: 'Berlin shows as a grid now' });
    const p1 = (await boardOf(dir)).cards.find(c => c.id === 'p1');
    assert.deepEqual([p1.status, p1.answer, p1.by], ['done', 'Berlin shows as a grid now', 'claude-code']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('an agent builds an internal tool: kept in the home, out of git, and put on the canvas once', async () => {
  const { createSiteTools } = await import('../home/site-mcp.mjs');
  const { boardOf } = await import('../home/site-board.mjs');
  const { tracked } = await import('../home/site.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'ohm-tools-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  try {
    const tools = createSiteTools({ dir, agent: 'claude-code' });
    const { toolsDir, watchTools, moveOldTools } = await import('../home/site-tools.mjs');
    const { mkdir: md, writeFile: wf } = await import('node:fs/promises');
    assert.equal(toolsDir(dir), join(dirname(dir), 'tools'));
    // A tool kept the old way moves beside the site.
    await md(join(dir, '.ohm', 'tools', 'old-one'), { recursive: true }); await wf(join(dir, '.ohm', 'tools', 'old-one', 'index.html'), '<title>Old one</title>');
    assert.deepEqual(await moveOldTools(dir), ['old-one']);
    const told = []; const watching = watchTools(dir, { announce: e => told.push(e) }); await watching.ready;
    try {
      // The agent writes a folder with its own file tools; ohm finds it, names it, and tells the app (which lists it).
      await md(join(toolsDir(dir), 'link-sorter')); await wf(join(toolsDir(dir), 'link-sorter', 'index.html'), '<title>Link sorter</title><meta name="description" content="Sorts links">');
      for (let i = 0; i < 40 && !told.some(e => e.name === 'link-sorter'); i++) await new Promise(r => setTimeout(r, 50));
      const listed = await tools.call('tools_list', {});
      assert.equal(listed.folder, toolsDir(dir));
      assert.deepEqual(listed.tools.map(t => t.name).sort(), ['link-sorter', 'old-one']);
      assert.equal(listed.tools.find(t => t.name === 'link-sorter').description, 'Sorts links');
      assert.equal((await boardOf(dir)).cards.length, 0, 'not put on the canvas: the person drags it there');
      assert.ok(told.some(e => e.type === 'tools' && e.name === 'link-sorter'));
      assert.equal(tracked(dir).size, 0, 'never in the site');
    } finally { watching.stop(); await rm(toolsDir(dir), { recursive: true, force: true }); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('arrows join cards on the canvas, and a prompt comes to its agent with what its arrows point at', async () => {
  const { createSiteTools } = await import('../home/site-mcp.mjs');
  const { saveBoard, boardOf } = await import('../home/site-board.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'ohm-arrows-'));
  try {
    await saveBoard(dir, [
      { id: 'p', kind: 'prompt', text: 'make this a grid', to: 'claude-code', status: 'waiting', x: 0, y: 0 },
      { id: 'b', kind: 'channel', name: 'Photographs/Berlin', x: 300, y: 0 },
    ], { by: 'app' });
    const tools = createSiteTools({ dir, agent: 'claude-code' });
    const line = await tools.call('canvas_connect', { from: 'p', to: 'b', text: 'this' });
    assert.deepEqual((await tools.call('canvas_cards', {})).arrows, [{ id: line.id, from: 'p', to: 'b', text: 'this' }]);
    const [prompt] = (await tools.call('prompts_waiting', {})).prompts;
    assert.deepEqual(prompt.about.map(a => a.name), ['Photographs/Berlin']);
    await assert.rejects(tools.call('canvas_connect', { from: 'p', to: 'nowhere' }));
    await tools.call('canvas_remove', { id: 'b' });
    assert.deepEqual((await boardOf(dir)).arrows, [], 'an arrow goes with the card it joined');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('an agent\'s hooks say what it is doing: its session is open, and the file it edits is known to be its change', async () => {
  const { siteLive } = await import('../home/site-live.mjs');
  const { writeFile: wf } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'ohm-activity-'));
  const live = siteLive(dir);
  const told = [];
  const stop = live.listen(e => told.push(e));
  try {
    live.activity('claude-code', { event: 'start' });
    assert.equal(live.agents().find(a => a.agent === 'claude-code').open, true);
    live.activity('claude-code', { event: 'edit', tool: 'Edit', path: join(dir, 'about.html') });
    assert.equal(live.agents().find(a => a.agent === 'claude-code').doing, 'editing about.html');
    assert.ok(told.some(e => e.type === 'activity' && e.path === 'about.html'));
    await new Promise(r => setTimeout(r, 100));
    await wf(join(dir, 'about.html'), '<p>hi</p>');
    for (let i = 0; i < 40 && !told.some(e => e.type === 'change' && e.path === 'about.html'); i++) await new Promise(r => setTimeout(r, 50));
    assert.equal(told.find(e => e.type === 'change' && e.path === 'about.html')?.by, 'claude-code');
    assert.equal(live.activity('claude-code', { event: 'edit', path: '/somewhere/else.txt' }).path, '', 'outside the site is not shown');
    // Two sessions of the same agent: one ending leaves it connected while the other is open.
    live.activity('claude-code', { event: 'start', session: 'b' });
    live.activity('claude-code', { event: 'end' });
    assert.equal(live.agents().find(a => a.agent === 'claude-code').open, true, 'the other session is still open');
    live.activity('claude-code', { event: 'end', session: 'b' });
    assert.equal(live.agents().find(a => a.agent === 'claude-code').open, false);
  } finally { stop(); await rm(dir, { recursive: true, force: true }); }
});

test('a prompt card runs with Claude Code from the canvas: working, then its answer under the card; Stop ends it', async () => {
  const { promptRuns } = await import('../home/site-runs.mjs');
  const { saveBoard, boardOf } = await import('../home/site-board.mjs');
  const { writeFile: wf, mkdir: md } = await import('node:fs/promises');
  const home = await mkdtemp(join(tmpdir(), 'ohm-runs-'));
  const dir = join(home, 'site'); await md(dir);
  // A stand-in for Claude Code: says what it was asked and where it ran, or waits to be stopped.
  const fake = join(home, 'fake-claude.mjs');
  await wf(fake, "const p = process.argv[process.argv.indexOf('-p') + 1]; if (p.includes('slow')) setTimeout(() => {}, 60_000); else console.log('did: ' + p.split('\\n')[2] + ' in ' + process.cwd() + (p.includes('the page about.html') ? ' (about.html)' : ''));");
  try {
    await saveBoard(dir, [
      { id: 'p1', kind: 'prompt', text: 'tidy the about page', to: 'claude-code', status: 'draft', x: 0, y: 0 },
      { id: 'pg', kind: 'page', path: 'about.html', x: 400, y: 0 },
      { id: 'p2', kind: 'prompt', text: 'slow job', to: 'claude-code', status: 'draft', x: 0, y: 300 },
    ], { arrows: [{ id: 'a1', from: 'p1', to: 'pg' }] });
    const runs = promptRuns({ dir, command: [process.execPath, fake] });
    const { done } = await runs.run('p1');
    assert.equal((await boardOf(dir)).cards.find(c => c.id === 'p1').status, 'working');
    await done;
    const p1 = (await boardOf(dir)).cards.find(c => c.id === 'p1');
    assert.equal(p1.status, 'done');
    assert.match(p1.answer, /did: tidy the about page in .*ohm-runs-/);
    assert.match(p1.answer, /\(about\.html\)/, 'what its arrows point at goes with it');
    const slow = await runs.run('p2');
    await assert.rejects(runs.run('p2'), /already working/);
    assert.equal(runs.stop('p2').stopped, true);
    await slow.done;
    assert.equal((await boardOf(dir)).cards.find(c => c.id === 'p2').answer, 'Stopped.');
    await assert.rejects(runs.run('nope'), /No such prompt/);
    // Without Claude Code where ohm can find it, the card says so.
    const none = await promptRuns({ dir, command: 'no-such-claude-here' }).run('p1');
    await none.done;
    assert.match((await boardOf(dir)).cards.find(c => c.id === 'p1').answer, /isn't installed/);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('the board survives many changes at once, and a board that can\'t be read is never taken for an empty one', async () => {
  const { saveBoard, changeBoard, boardOf } = await import('../home/site-board.mjs');
  const { writeFile: wf } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'ohm-board-'));
  try {
    await saveBoard(dir, [{ id: 'a', kind: 'note', text: 'keep', x: 0, y: 0 }]);
    await Promise.all(Array.from({ length: 30 }, (_, i) => changeBoard(dir, cards => [...cards, { id: `n${i}`, kind: 'note', text: String(i), x: i, y: 0 }])));
    const b = await boardOf(dir);
    assert.equal(b.cards.length, 31, 'every change kept, none lost to another');
    assert.equal(b.rev, 31);
    await wf(join(dir, '.ohm', 'board.json'), '{"cards": [');
    await assert.rejects(boardOf(dir), /can't be read/);
    await assert.rejects(changeBoard(dir, cards => cards), /can't be read/);
    assert.equal((await readFile(join(dir, '.ohm', 'board.json'), 'utf8')), '{"cards": [', 'left as it was');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
