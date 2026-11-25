// The site in a person's ohm (home/site.mjs): connected from their repository, served and saved
// through the bridge, every save logged and restorable, and Publish as pull, commit, push, deploy,
// going on from where it stopped. Cloudflare is a stand-in wrangler that only answers.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { initHome } from '../bin/ohmmmm.mjs';
import { homeBridge, listenHome, pairApp, addAgent } from '../home/serve.mjs';
import { connect, savesOf } from '../home/site.mjs';

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
