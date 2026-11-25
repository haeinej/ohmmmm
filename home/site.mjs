// The person's website, kept in their ohm as `site/` (docs/serve.md, app/flows/site.md).
//
// `site/` is an ordinary git checkout of the person's own repository: `ohm site connect` clones it
// there. Everything ohm keeps about it is in `site/.ohm/`, which git never tracks:
//
//   site.json       the repository, the Cloudflare Pages project and its production branch
//   saves.jsonl     the save log: one line per save, with the file's content address before and after
//   kept/<sha256>   every version a save replaced or wrote, so any save can be seen and restored
//   deploys.jsonl   every deploy: the commit, where it went, when
//   channels.json   the channels the person made in the side panel
//
// Save writes a file at once and appends to the save log; it never commits. Publish is the one step
// that leaves the computer: pull (fast-forward only), commit, push, deploy, each skipped when it is
// already done, so Publish again goes on from where it stopped. Only files git tracks are served,
// written, moved or published: what was never committed is not the site's, and may be private.
//
// The bridge (home/serve.mjs) answers these routes only for an app key, after its Host, Origin and
// key checks; agents' keys never reach them, so no agent pushes or deploys.
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { appendFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';
import { decode, htmlToMarkdown } from '../vault/mirror/html-to-markdown.mjs';
import { findHome } from './home.mjs';

const run = promisify(execFile);
const LONG = { maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60 * 1000 };
export const OHM = '.ohm';
export const SETTINGS = '.ohm/site.json';
export const SAVES = '.ohm/saves.jsonl';
export const KEPT = '.ohm/kept';
export const DEPLOYS = '.ohm/deploys.jsonl';
export const CHANNELS = '.ohm/channels.json';
export const MAX_FILE = 5 * 1024 * 1024;

export class SiteProblem extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.mov': 'video/quicktime',
  '.webm': 'video/webm', '.woff': 'font/woff', '.woff2': 'font/woff2',
};
const TEXT = /\.(?:html?|css|m?js|json|xml|txt|md|svg|webmanifest|toml|ya?ml)$|(?:^|\/)(?:CNAME|_headers|_redirects)$/i;
export const isText = path => TEXT.test(path);

export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const etagOf = bytes => `"${sha(bytes)}"`;

const git = async (dir, ...args) => (await run('git', ['-C', dir, ...args], LONG)).stdout;
const told = problem => (problem?.stderr || problem?.message || String(problem)).trim().split('\n').filter(Boolean).at(-1) ?? 'git did not say why';

/** The files git tracks in the site's folder. */
export function tracked(dir) {
  const out = execFileSync('git', ['-C', dir, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return new Set(out.split('\0').filter(Boolean));
}

/** A path a site file may have: relative, no `..`, nothing hidden (so never .git or .ohm). */
export const safePath = path => typeof path === 'string' && path.length > 0 && path.length <= 1000 && !path.startsWith('/')
  && path.split('/').every(part => part && part !== '..' && !part.startsWith('.'));

/** `/writing/` and `/writing` both mean `writing/index.html`, as on a static host. */
export function fileFor(files, pathname) {
  let path;
  try { path = decodeURIComponent(pathname).replace(/^\/+/, ''); } catch { return undefined; }
  if (path.split('/').some(part => part === '..' || part.startsWith('.'))) return undefined;
  for (const candidate of [path, `${path.replace(/\/$/, '')}/index.html`.replace(/^\//, ''), `${path}.html`]) if (files.has(candidate)) return candidate;
  return undefined;
}

// ---- Settings ----

export async function settingsOf(dir) {
  const read = async path => { try { return JSON.parse(await readFile(join(dir, path), 'utf8')); } catch { return {}; } };
  // A folder deployed before site.json kept its project in deploy.json.
  return { ...(await read('.ohm/deploy.json')), ...(await read(SETTINGS)) };
}

async function writeSettings(dir, change) {
  const next = { ...(await settingsOf(dir)), ...change };
  await mkdir(join(dir, OHM), { recursive: true });
  await writeFile(join(dir, SETTINGS), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/** git never tracks .ohm/: it is named in the checkout's own exclude file, which is never committed. */
async function excludeOhm(dir) {
  const file = join(dir, '.git', 'info', 'exclude');
  const held = await readFile(file, 'utf8').catch(() => '');
  if (!held.split('\n').some(line => line.trim() === '/.ohm/' || line.trim() === '.ohm/')) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${held}${held && !held.endsWith('\n') ? '\n' : ''}/.ohm/\n`);
  }
}

// ---- Where it stands ----

/** The branch, how far ahead and behind its remote, and the tracked files changed since the last commit. */
export async function syncOf(dir) {
  const lines = (await git(dir, 'status', '--porcelain=v2', '--branch', '--untracked-files=no')).split('\n');
  const head = name => lines.find(l => l.startsWith(`# branch.${name} `))?.slice(`# branch.${name} `.length);
  const [ahead, behind] = (head('ab') ?? '+0 -0').split(' ').map(n => Math.abs(Number(n)));
  const changed = lines.filter(l => /^[12u] /.test(l)).map(l => l.startsWith('2 ') ? l.split('\t')[0].split(' ').slice(9).join(' ') : l.split(' ').slice(l.startsWith('u ') ? 10 : 8).join(' '));
  let remote = '';
  try { remote = (await git(dir, 'remote', 'get-url', 'origin')).trim().replace(/^https?:\/\/[^@/]*@/, 'https://'); } catch { /* no remote */ }
  let last = '';
  try { last = (await git(dir, 'log', '-1', '--format=%s')).trim(); } catch { /* no commit yet */ }
  return { branch: head('head') ?? '', upstream: head('upstream') ?? '', remote, ahead, behind, changed, last };
}

// ---- The save log ----

async function keep(dir, bytes) {
  const hash = sha(bytes);
  const file = join(dir, KEPT, hash);
  if (!existsSync(file)) { await mkdir(join(dir, KEPT), { recursive: true }); await writeFile(file, bytes); }
  return hash;
}

export async function keptBytes(dir, hash) {
  if (!/^[0-9a-f]{64}$/.test(hash ?? '')) return undefined;
  try { return await readFile(join(dir, KEPT, hash)); } catch { return undefined; }
}

/** Every save, oldest first. */
export async function savesOf(dir) {
  try { return (await readFile(join(dir, SAVES), 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch { return []; }
}

async function logSave(dir, entry) {
  await mkdir(join(dir, OHM), { recursive: true });
  const line = { at: new Date().toISOString(), by: 'me', ...entry };
  await appendFile(join(dir, SAVES), `${JSON.stringify(line)}\n`);
  return line;
}

/**
 * Save one tracked file: written at once, never committed. `replaces` is the ETag the app read it
 * at; a file that changed since is refused. The version before and after are kept, and the save
 * logged. `via` says what saved it: the canvas, the text editor, a restore.
 */
export async function saveFile(dir, path, bytes, { replaces, via = 'editor', from } = {}) {
  const files = tracked(dir);
  if (!safePath(path) || !files.has(path)) throw new SiteProblem(404, 'Not a file of this site');
  if (bytes.length > MAX_FILE) throw new SiteProblem(413, 'A file saved here is up to 5 MB');
  const full = join(dir, path);
  const held = await readFile(full);
  if (replaces !== undefined && replaces !== etagOf(held)) {
    // The same save tried again after its answer was lost: already there.
    if (sha(held) === sha(bytes)) return { path, etag: etagOf(held), unchanged: true };
    throw new SiteProblem(412, 'This file changed on disk since it was read');
  }
  if (sha(held) === sha(bytes)) return { path, etag: etagOf(held), unchanged: true };
  const before = await keep(dir, held);
  const after = await keep(dir, bytes);
  await writeFile(full, bytes);
  const saved = await logSave(dir, { kind: 'save', path, before, after, via, ...(from ? { from } : {}) });
  return { path, etag: etagOf(bytes), save: saved };
}

/** Move or rename a tracked file, as a save: git is told (`git mv`), nothing is committed. */
export async function moveFile(dir, from, to) {
  const files = tracked(dir);
  if (!safePath(from) || !files.has(from)) throw new SiteProblem(404, 'Not a file of this site');
  if (!safePath(to)) throw new SiteProblem(400, 'A file\'s new place is a path in the site, with nothing hidden');
  if (files.has(to) || existsSync(join(dir, to))) throw new SiteProblem(409, `${to} is already there`);
  await mkdir(dirname(join(dir, to)), { recursive: true });
  try { await git(dir, 'mv', '--', from, to); } catch (problem) { throw new SiteProblem(409, told(problem)); }
  const hash = await keep(dir, await readFile(join(dir, to)));
  return { from, to, save: await logSave(dir, { kind: 'move', path: to, from, before: hash, after: hash, via: 'files' }) };
}

/**
 * Put a version back, locally, as a new save: a save's own version (`hash`), or a file as a commit
 * held it (`commit`). Nothing goes live until the person publishes.
 */
export async function restoreFile(dir, { path, hash, commit }) {
  let bytes;
  if (hash) bytes = await keptBytes(dir, hash);
  else if (commit && /^[0-9a-f]{7,64}$/.test(commit) && safePath(path)) {
    try { bytes = (await run('git', ['-C', dir, 'show', `${commit}:${path}`], { ...LONG, encoding: 'buffer' })).stdout; } catch { bytes = undefined; }
  }
  if (!bytes) throw new SiteProblem(404, 'That version is not kept');
  return saveFile(dir, path, bytes, { via: 'restore', from: hash ? { save: hash } : { commit } });
}

// ---- Content, as the side panel shows it ----

const titleOf = html => /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1].trim() ?? '';
const IMAGE = /\.(?:jpe?g|png|webp|gif|svg)$/i, VIDEO = /\.(?:mp4|mov|webm)$/i;
const text = html => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const firstLanguage = html => html.replace(/<(\w+)([^>]*)\slang="(?!en")[^"]*"[^>]*>[\s\S]*?<\/\1>/g, '');

function articleIn(html) {
  const article = /<article[^>]*>[\s\S]*?<\/article>/i.exec(html)?.[0];
  if (!article) return undefined;
  const header = /<header[^>]*>[\s\S]*?<\/header>/i.exec(article)?.[0] ?? '';
  const title = text(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(article)?.[1] ?? '');
  const details = text(/<(?:p|div) class="(?:article-subtitle|episode-details)"[^>]*>([\s\S]*?)<\/(?:p|div)>/i.exec(article)?.[1]?.replace(/<\/span>/g, ' · </span>') ?? '').replace(/ ·$/, '');
  const body = article.replace(header, '').replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, '')
    .replace(/<(?:p|div) class="(?:article-subtitle|episode-details)"[^>]*>[\s\S]*?<\/(?:p|div)>/i, '')
    .replace(/<div class="source-note">[\s\S]*?<\/div>/i, '');
  return { title, details, body };
}

function projectsIn(html) {
  return [...html.matchAll(/<details class="entry[^"]*" id="([^"]+)">([\s\S]*?)<\/details>/g)].map(([, id, inner]) => {
    const one = firstLanguage(inner);
    return { id, title: text(/<summary>([\s\S]*?)<\/summary>/.exec(one)?.[1] ?? id), body: one.replace(/<summary>[\s\S]*?<\/summary>/, '') };
  });
}

function markdownOf(body, page) {
  const { markdown, images } = htmlToMarkdown(body, `https://site.invalid/${page}`);
  return images.reduce((md, image) => md.replaceAll(`media:${image.id}`, new URL(image.url).pathname), markdown);
}

/** The site's content as channels of blocks: Writings, Photographs and Projects, read from where this site keeps each. */
export async function contentOf(dir, files = tracked(dir)) {
  const read = path => readFile(join(dir, path), 'utf8');
  const modified = async path => (await stat(join(dir, path))).mtime.toISOString();
  const sources = new Map();
  for (const path of files) if (path.endsWith('.html')) sources.set(path, await read(path));

  const writings = [];
  for (const [path, html] of [...sources].sort()) {
    if (!path.startsWith('writing/') || path.endsWith('index.html') || path.startsWith('writing/substack/')) continue;
    const article = articleIn(html);
    const series = /^writing\/series\/([^/]+)\//.exec(path)?.[1];
    if (article) writings.push({ kind: 'article', path, title: article.title || path, excerpt: text(article.body).slice(0, 700), modified: await modified(path), usedIn: [], channel: series });
  }
  const projects = [];
  const work = sources.get('work/index.html');
  if (work) for (const project of projectsIn(work)) projects.push({ kind: 'project', path: `work/index.html#${project.id}`, title: project.title, excerpt: text(project.body).slice(0, 700), modified: await modified('work/index.html'), usedIn: [] });

  const places = new Map();
  for (const [, place, file] of (sources.get('archive/index.html') ?? '').matchAll(/<figure[^>]*data-loc="([^"]*)"[^>]*>[\s\S]*?src="[^"?]*\/([^"/?]+)(?:\?[^"]*)?"/g)) places.set(file, decode(place));
  const photographs = [];
  for (const path of [...files].sort()) {
    const kind = /^archive\/img\//.test(path) && IMAGE.test(path) ? 'image' : /^archive\/vid\//.test(path) && VIDEO.test(path) ? 'video' : undefined;
    if (!kind) continue;
    const base = path.split('/').at(-1);
    const small = `archive/${kind === 'image' ? 'thumb' : 'vidsm'}/${base}`;
    photographs.push({
      kind, path, title: base, thumb: files.has(small) ? small : kind === 'image' ? path : undefined, modified: await modified(path),
      usedIn: [...sources].filter(([, html]) => html.includes(base)).map(([page]) => page), channel: places.get(base) || undefined,
    });
  }
  let site = '';
  try { site = (await read('CNAME')).trim(); } catch { /* no domain of its own */ }
  return { site, collections: [{ name: 'Writings', items: writings }, { name: 'Photographs', items: photographs }, { name: 'Projects', items: projects }].filter(c => c.items.length) };
}

export async function articleOf(dir, files, path) {
  const [page, id] = String(path).split('#');
  if (!files.has(page) || !page.endsWith('.html')) return undefined;
  const html = await readFile(join(dir, page), 'utf8');
  if (id) {
    const project = projectsIn(html).find(p => p.id === id);
    return project && { title: project.title, details: '', markdown: markdownOf(project.body, page) };
  }
  const article = articleIn(html);
  return article && { title: article.title, details: article.details, markdown: markdownOf(article.body, page) };
}

/**
 * Every tracked file, for the Files view: whether it changed since the last commit (not published),
 * and whether anything on the site uses it. A page is used; any other file is used when a page,
 * a stylesheet or a script names it.
 */
export async function treeOf(dir) {
  const files = tracked(dir);
  const { changed } = await syncOf(dir);
  const sources = [];
  for (const path of files) if (/\.(?:html?|css|m?js|json|webmanifest|xml)$/i.test(path)) sources.push(await readFile(join(dir, path), 'utf8').catch(() => ''));
  const all = sources.join('\n');
  return {
    files: [...files].sort().map(path => {
      const base = path.split('/').at(-1);
      const used = /\.html?$/i.test(path) || /^(?:CNAME|_headers|_redirects|robots\.txt|favicon\.ico|README\.md|LICENSE.*|\.?gitignore)$/i.test(base) || all.includes(base);
      return { path, changed: changed.includes(path), used, text: isText(path) };
    }),
  };
}

// ---- Own channels and the profile ----

async function ownChannels(dir) {
  try {
    const kept = JSON.parse(await readFile(join(dir, CHANNELS), 'utf8'));
    return { channels: Array.isArray(kept.channels) ? kept.channels : [], colors: kept.colors ?? {} };
  } catch { return { channels: [], colors: {} }; }
}

const FIELDS = ['name', 'image', 'handle', 'did', 'wallet', 'color'];
const profileFile = p => `---\n${FIELDS.map(key => `${key}: ${JSON.stringify(String(p[key] ?? '').trim())}`).join('\n')}\n---\n\n${String(p.body ?? '').trim()}\n`;

/**
 * The person's profile: `profile/profile.md` in their ohm. A profile the editor wrote into the site's
 * folder before (`site/profile.md`, untracked) is read until it is saved again. Until it is first
 * saved, it is what the site already says: its domain as the handle and the name its pages give.
 */
export async function profileOf(profileDir, dir, files) {
  const profile = { name: '', image: '', handle: '', did: '', wallet: '', color: '', body: '', saved: false };
  const written = await readFile(join(profileDir, 'profile.md'), 'utf8').catch(() => readFile(join(dir, 'profile.md'), 'utf8')).catch(() => null);
  if (written !== null) {
    const parts = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(written);
    for (const line of (parts?.[1] ?? '').split('\n')) {
      const [, key, value] = /^(\w+):\s*(.*)$/.exec(line) ?? [];
      if (FIELDS.includes(key)) { try { profile[key] = String(JSON.parse(value)); } catch { profile[key] = value; } }
    }
    profile.body = (parts ? parts[2] : written).trim();
    profile.saved = true;
  } else {
    try { profile.handle = (await readFile(join(dir, 'CNAME'), 'utf8')).trim(); } catch { /* none */ }
    if (files.has('index.html')) profile.name = text(/<a class="mid"[^>]*>([\s\S]*?)<\/a>/.exec(await readFile(join(dir, 'index.html'), 'utf8'))?.[1] ?? '');
    profile.image = ['portrait-home.jpg', 'portrait.jpg'].find(f => files.has(f)) ?? '';
  }
  if (!profile.color && files.has('site-header.css')) profile.color = /--ink:\s*(#[0-9a-f]{3,8})/i.exec(await readFile(join(dir, 'site-header.css'), 'utf8'))?.[1] ?? '';
  return profile;
}

// ---- Deploying, one commit at a time ----

function wrangler(env = process.env) {
  const beside = fileURLToPath(new URL('../vault/node_modules/.bin/wrangler', import.meta.url));
  if (env.OHM_WRANGLER) return [env.OHM_WRANGLER, []];
  return existsSync(beside) ? [beside, []] : ['npx', ['--yes', 'wrangler']];
}
const cloudflare = async (...args) => {
  const [command, first] = wrangler();
  return (await run(command, [...first, ...args], { ...LONG, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', WRANGLER_SEND_METRICS: 'false' } })).stdout;
};
export const projectName = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 58);

export async function deploysOf(dir) {
  try { return (await readFile(join(dir, DEPLOYS), 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch { return []; }
}

/** Where a deploy would go and what it would carry, without changing anything. */
export async function deployStatus(dir, { whoami = true } = {}) {
  const settings = await settingsOf(dir);
  let domain = '';
  try { domain = (await readFile(join(dir, 'CNAME'), 'utf8')).trim(); } catch { /* none */ }
  const [branch, commit, subject, changedText] = await Promise.all([
    git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), git(dir, 'rev-parse', 'HEAD'), git(dir, 'log', '-1', '--format=%s'), git(dir, 'status', '--porcelain', '--untracked-files=no'),
  ].map(p => p.then(s => s.trim(), () => '')));
  let account = '', signedIn = false, projects = [], problem = '';
  if (whoami) {
    try {
      const who = await cloudflare('whoami');
      signedIn = /logged in/i.test(who);
      account = /│\s*([^│]+?)\s*│\s*[0-9a-f]{32}\s*│/.exec(who)?.[1] ?? '';
      if (signedIn) projects = [...(await cloudflare('pages', 'project', 'list')).matchAll(/^│\s*([a-z0-9-]+)\s*│/gm)].map(m => m[1]);
    } catch (e) { problem = told(e); }
  }
  const project = settings.project || projectName(domain || dir.split('/').at(-1) || 'site');
  const productionBranch = settings.productionBranch || 'main';
  const history = (await deploysOf(dir)).reverse();
  return {
    signedIn, account, problem, projects, project, exists: projects.includes(project), productionBranch,
    branch, commit, subject, changed: changedText ? changedText.split('\n').length : 0, production: branch === productionBranch,
    domain, history: history.slice(0, 12), live: history.find(d => d.production) ?? null,
  };
}

/** Deploy one commit to Cloudflare Pages: this branch's head, or an earlier commit to put it back live. */
export async function deploy(dir, input = {}) {
  const status = await deployStatus(dir);
  const project = projectName(input.project || status.project);
  if (!project) throw new SiteProblem(400, 'Give the Cloudflare project a name');
  if (!status.signedIn) throw new SiteProblem(409, 'Sign in to Cloudflare first: run `npx wrangler login` in a terminal');
  let commit;
  try { commit = (await git(dir, 'rev-parse', '--verify', `${input.commit || 'HEAD'}^{commit}`)).trim(); } catch { throw new SiteProblem(404, 'That commit is not in the site\'s history'); }
  if (!input.commit && status.changed) throw new SiteProblem(409, 'Publish your changes first: a deploy is of a commit, so what is not committed would be left behind');
  const subject = (await git(dir, 'log', '-1', '--format=%s', commit)).trim();
  const branch = input.commit ? status.productionBranch : status.branch;
  const out = await mkdtemp(join(tmpdir(), 'ohm-deploy-'));
  try {
    await run('sh', ['-c', 'git -C "$SITE" archive "$COMMIT" | tar -x -C "$OUT"'], { ...LONG, env: { ...process.env, SITE: dir, COMMIT: commit, OUT: out } });
    if (!status.projects.includes(project)) await cloudflare('pages', 'project', 'create', project, '--production-branch', status.productionBranch);
    const said = await cloudflare('pages', 'deploy', out, '--project-name', project, '--branch', branch, '--commit-hash', commit, '--commit-message', subject.slice(0, 180), '--commit-dirty=false');
    const url = [...said.matchAll(/https:\/\/[a-z0-9.-]+\.pages\.dev/g)].at(-1)?.[0];
    if (!url) throw new Error(said.trim().split('\n').at(-1) || 'Cloudflare didn\'t say where it deployed');
    const deployed = { at: new Date().toISOString(), commit, subject, branch, project, url, production: branch === status.productionBranch, ...(input.commit ? { putBack: true } : {}) };
    await writeSettings(dir, { project, productionBranch: status.productionBranch });
    await mkdir(join(dir, OHM), { recursive: true });
    await appendFile(join(dir, DEPLOYS), `${JSON.stringify(deployed)}\n`);
    return deployed;
  } catch (e) {
    if (e instanceof SiteProblem) throw e;
    throw new SiteProblem(409, told(e));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

// ---- Publish: pull, commit, push, deploy ----

export const STEPS = ['pull', 'commit', 'push', 'deploy'];

export async function pull(dir) {
  try { await git(dir, 'fetch', 'origin'); } catch (problem) { throw new SiteProblem(409, `Could not reach your repository: ${told(problem)}`); }
  if (!(await syncOf(dir)).behind) return { did: false };
  try { await git(dir, 'merge', '--ff-only', '@{u}'); } catch (problem) {
    throw new SiteProblem(409, `Your repository has changes this computer can't simply take in (${told(problem)}). Nothing was changed; bring them in with git in a terminal, then Publish again.`);
  }
  return { did: true };
}

export async function commit(dir, message) {
  const words = String(message ?? '').trim();
  if (!(await syncOf(dir)).changed.length) return { did: false };
  if (!words) throw new SiteProblem(400, 'Say what changed');
  try { await git(dir, 'add', '-u'); await git(dir, 'commit', '-m', words); } catch (problem) { throw new SiteProblem(409, told(problem)); }
  return { did: true };
}

export async function push(dir) {
  const sync = await syncOf(dir);
  if (sync.upstream && !sync.ahead) return { did: false };
  try { await git(dir, 'push', 'origin', 'HEAD'); } catch (problem) { throw new SiteProblem(409, `Your repository did not take the commit: ${told(problem)}`); }
  return { did: true };
}

/** Deploy unless the live deploy is already of this commit. */
async function deployHead(dir, project) {
  const head = (await git(dir, 'rev-parse', 'HEAD')).trim();
  const live = (await deploysOf(dir)).reverse().find(d => d.production);
  if (live?.commit === head) return { did: false, live };
  return { did: true, live: await deploy(dir, { project }) };
}

/**
 * Publish: every step in order, each skipped when it is already done, stopping at the first that
 * fails with a plain reason. Publish again goes on from there. `onStep` hears each step start.
 */
export async function publish(dir, { message, project } = {}, onStep = () => {}) {
  const done = [];
  for (const step of STEPS) {
    onStep(step);
    try {
      const result = step === 'pull' ? await pull(dir) : step === 'commit' ? await commit(dir, message) : step === 'push' ? await push(dir) : await deployHead(dir, project);
      done.push({ step, did: result.did });
      if (step === 'deploy') return { done, live: result.live ?? null, sync: await syncOf(dir) };
    } catch (problem) {
      return { done, failed: { step, reason: problem instanceof SiteProblem ? problem.message : told(problem) }, sync: await syncOf(dir).catch(() => null) };
    }
  }
  return { done };
}

// ---- History: saves, publishes and deploys ----

export async function historyOf(dir, { limit = 200 } = {}) {
  const saves = (await savesOf(dir)).slice(-limit);
  let commits = [];
  try {
    const out = await git(dir, 'log', `-n${Math.min(limit, 200)}`, '--name-only', '--format=%x1e%H%x1f%aI%x1f%an%x1f%s');
    commits = out.split('\x1e').filter(s => s.trim()).map(chunk => {
      const [head, ...rest] = chunk.trim().split('\n');
      const [hash, at, author, subject] = head.split('\x1f');
      return { hash, at, author, subject, files: rest.filter(Boolean) };
    });
  } catch { /* no commits */ }
  return { saves, commits, deploys: await deploysOf(dir) };
}

/** One file as a commit held it, and as its parent did: what that publish changed in it. */
export async function commitFile(dir, hash, path) {
  if (!/^[0-9a-f]{7,64}$/.test(hash ?? '') || !safePath(path)) throw new SiteProblem(400, 'Name a commit and a file');
  const at = async rev => { try { return (await git(dir, 'show', `${rev}:${path}`)); } catch { return null; } };
  return { path, before: await at(`${hash}^`), after: await at(hash) };
}

// ---- The bridge's routes ----

const SITE_PATH = /^\/site(?:\/|$)/;
export const isSiteRoute = pathname => SITE_PATH.test(pathname);

/**
 * The site's routes for the bridge. `send`, `said`, `body` and `json` are the bridge's own helpers.
 * Returns a handler that answers a request under /site and resolves true, or false for none.
 */
export function siteRoutes({ layout, send, said, body }) {
  const dir = layout.site;
  const connected = () => existsSync(join(dir, '.git'));
  const json = async req => { try { return JSON.parse((await body(req, 1_000_000)).toString('utf8') || '{}'); } catch { return undefined; } };
  const etag = req => req.headers['if-match'] === undefined ? undefined : String(req.headers['if-match']).replace(/^W\//, '');
  const answer = async (res, work) => {
    try { return send(res, 200, await work(), { 'Cache-Control': 'no-store' }); } catch (problem) {
      if (problem instanceof SiteProblem) return said(res, problem.status, problem.message);
      throw problem;
    }
  };

  return async function route(req, res, url) {
    const path = url.pathname;
    if (path === '/site' && req.method === 'GET') {
      if (!connected()) return send(res, 200, { connected: false, say: 'Connect your website with: ohm site connect <your repository>' }), true;
      const settings = await settingsOf(dir);
      let domain = '';
      try { domain = (await readFile(join(dir, 'CNAME'), 'utf8')).trim(); } catch { /* none */ }
      send(res, 200, { connected: true, repo: settings.repo ?? '', project: settings.project ?? '', domain }, { 'Cache-Control': 'no-store' });
      return true;
    }
    if (!connected()) return said(res, 404, 'This ohm has no site yet. Connect one with: ohm site connect <your repository>'), true;

    // A file of the site, as a page in the canvas reaches it, and saving one.
    const file = /^\/site\/file\/(.*)$/.exec(path);
    if (file) {
      const files = tracked(dir);
      const name = fileFor(files, `/${file[1]}`);
      if (!name) return said(res, 404, 'Not a file of this site'), true;
      if (req.method === 'PUT') {
        let bytes;
        try { bytes = await body(req, MAX_FILE); } catch { return said(res, 413, 'A file saved here is up to 5 MB'), true; }
        const replaces = etag(req);
        if (replaces === undefined) return said(res, 428, 'Say which version you read, with If-Match'), true;
        await answer(res, () => saveFile(dir, name, bytes, { replaces, via: url.searchParams.get('via') === 'canvas' ? 'canvas' : 'editor' }));
        return true;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, undefined, { Allow: 'GET, PUT' }), true;
      const bytes = await readFile(join(dir, name));
      res.writeHead(200, {
        'Content-Type': TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': bytes.length,
        'Cache-Control': 'no-store', ETag: etagOf(bytes), 'X-Content-Type-Options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : bytes);
      return true;
    }

    if (path === '/site/pages' && req.method === 'GET') {
      const files = tracked(dir);
      const pages = await Promise.all([...files].filter(f => f.endsWith('.html')).sort().map(async p => ({ path: p, title: titleOf(await readFile(join(dir, p), 'utf8')) })));
      return send(res, 200, { pages }, { 'Cache-Control': 'no-store' }), true;
    }
    if (path === '/site/content' && req.method === 'GET') return send(res, 200, await contentOf(dir), { 'Cache-Control': 'no-store' }), true;
    if (path === '/site/tree' && req.method === 'GET') return send(res, 200, await treeOf(dir), { 'Cache-Control': 'no-store' }), true;
    if (path === '/site/article' && req.method === 'GET') {
      const article = await articleOf(dir, tracked(dir), url.searchParams.get('path') ?? '');
      return (article ? send(res, 200, article, { 'Cache-Control': 'no-store' }) : said(res, 404, 'Not an article of this site')), true;
    }
    if (path === '/site/channels') {
      if (req.method === 'PUT') {
        const sent = await json(req);
        if (!sent) return said(res, 400, 'Send the channels as JSON'), true;
        const clean = {
          channels: (sent.channels ?? []).filter(c => typeof c?.name === 'string' && c.name.trim() && !c.name.includes('/')).slice(0, 200)
            .map(c => ({ name: c.name.trim().slice(0, 80), parent: c.parent || undefined, color: c.color || undefined, items: [...new Set((c.items ?? []).filter(i => typeof i === 'string'))] })),
          colors: Object.fromEntries(Object.entries(sent.colors ?? {}).filter(([, v]) => typeof v === 'string' && v)),
        };
        await mkdir(join(dir, OHM), { recursive: true });
        await writeFile(join(dir, CHANNELS), `${JSON.stringify(clean, null, 2)}\n`);
      } else if (req.method !== 'GET') return send(res, 405, undefined, { Allow: 'GET, PUT' }), true;
      return send(res, 200, await ownChannels(dir), { 'Cache-Control': 'no-store' }), true;
    }
    if (path === '/site/profile') {
      if (req.method === 'PUT') {
        const sent = await json(req);
        if (!sent) return said(res, 400, 'Send the profile as JSON'), true;
        await mkdir(layout.profile, { recursive: true });
        const target = join(layout.profile, 'profile.md');
        await writeFile(`${target}.tmp`, profileFile(sent));
        await rename(`${target}.tmp`, target);
      } else if (req.method !== 'GET') return send(res, 405, undefined, { Allow: 'GET, PUT' }), true;
      return send(res, 200, await profileOf(layout.profile, dir, tracked(dir)), { 'Cache-Control': 'no-store' }), true;
    }
    if (path === '/site/git' && req.method === 'GET') return send(res, 200, await syncOf(dir), { 'Cache-Control': 'no-store' }), true;
    const step = /^\/site\/git\/(pull|commit|push)$/.exec(path);
    if (step && req.method === 'POST') {
      const sent = (await json(req)) ?? {};
      await answer(res, async () => {
        if (step[1] === 'pull') await pull(dir);
        if (step[1] === 'commit') { if (!(await commit(dir, sent.message)).did) throw new SiteProblem(409, 'Nothing has changed since the last commit'); }
        if (step[1] === 'push') await push(dir);
        return syncOf(dir);
      });
      return true;
    }
    if (path === '/site/deploy') {
      if (req.method === 'GET') return send(res, 200, await deployStatus(dir), { 'Cache-Control': 'no-store' }), true;
      if (req.method !== 'POST') return send(res, 405, undefined, { Allow: 'GET, POST' }), true;
      const sent = (await json(req)) ?? {};
      await answer(res, () => deploy(dir, { project: sent.project, commit: sent.commit }));
      return true;
    }
    if (path === '/site/publish' && req.method === 'POST') {
      const sent = (await json(req)) ?? {};
      return send(res, 200, await publish(dir, { message: sent.message, project: sent.project }), { 'Cache-Control': 'no-store' }), true;
    }
    if (path === '/site/status' && req.method === 'GET') {
      // The status line: how many files are not published, and the live deploy.
      const [sync, deploys, saves] = await Promise.all([syncOf(dir), deploysOf(dir), savesOf(dir)]);
      const live = [...deploys].reverse().find(d => d.production) ?? null;
      return send(res, 200, { changed: sync.changed, ahead: sync.ahead, behind: sync.behind, branch: sync.branch, live, lastSave: saves.at(-1) ?? null }, { 'Cache-Control': 'no-store' }), true;
    }
    if (path === '/site/history' && req.method === 'GET') return send(res, 200, await historyOf(dir), { 'Cache-Control': 'no-store' }), true;
    if (path === '/site/kept' && req.method === 'GET') {
      const bytes = await keptBytes(dir, url.searchParams.get('hash'));
      return (bytes ? send(res, 200, { text: bytes.toString('utf8') }, { 'Cache-Control': 'no-store' }) : said(res, 404, 'That version is not kept')), true;
    }
    if (path === '/site/commit' && req.method === 'GET') {
      await answer(res, () => commitFile(dir, url.searchParams.get('hash'), url.searchParams.get('path')));
      return true;
    }
    if (path === '/site/restore' && req.method === 'POST') {
      const sent = (await json(req)) ?? {};
      await answer(res, () => restoreFile(dir, { path: sent.path, hash: sent.hash, commit: sent.commit }));
      return true;
    }
    if (path === '/site/move' && req.method === 'POST') {
      const sent = (await json(req)) ?? {};
      await answer(res, () => moveFile(dir, sent.from, sent.to));
      return true;
    }
    return false;
  };
}

// ---- `ohm site connect` ----

/**
 * Clone the person's repository into `<home>/site`, and record it. With `--project`, the Cloudflare
 * Pages project their site deploys to. A site already connected is left as it is.
 */
export async function connect(layout, { repo, project, branch } = {}) {
  if (!repo) throw new SiteProblem(400, 'Name your website\'s repository: ohm site connect <repository>, such as https://github.com/you/your-site.git');
  if (existsSync(join(layout.site, '.git'))) {
    const settings = await settingsOf(layout.site);
    if (settings.repo && settings.repo !== repo) throw new SiteProblem(409, `${layout.site} is connected to ${settings.repo} already`);
  } else {
    if (existsSync(layout.site) && (await stat(layout.site)).isDirectory() && spawnSync('ls', ['-A', layout.site]).stdout.toString().trim()) throw new SiteProblem(409, `${layout.site} is not empty`);
    try { await run('git', ['clone', ...(branch ? ['--branch', branch] : []), '--', repo, layout.site], LONG); } catch (problem) { throw new SiteProblem(409, `Could not clone ${repo}: ${told(problem)}`); }
  }
  await excludeOhm(layout.site);
  return writeSettings(layout.site, { repo, ...(project ? { project: projectName(project) } : {}), ...(branch ? { productionBranch: branch } : {}) });
}

async function command(args) {
  const [name, ...rest] = args;
  if (name !== 'connect') throw new SiteProblem(400, 'ohm site connect <repository> [--project <cloudflare project>] [--branch <branch>]');
  const { values, positionals } = parseArgs({ args: rest, options: { project: { type: 'string' }, branch: { type: 'string' } }, allowPositionals: true });
  const layout = findHome();
  if (!layout) throw new SiteProblem(400, 'Run ohm site connect inside your ohm (a folder named ohm.<handle>), or set OHMMMM_HOME.');
  const settings = await connect(layout, { repo: positionals[0], project: values.project, branch: values.branch });
  console.log(`Your site is in ${layout.site}, from ${settings.repo}.${settings.project ? ` It deploys to the Cloudflare project ${settings.project}.` : ''}`);
  console.log('Open ohm with ohm serve running: the Site view shows it, and Publish puts your saves live.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  command(process.argv.slice(2)).catch(problem => { console.error(problem instanceof SiteProblem ? problem.message : problem); process.exitCode = 1; });
}

export const isDir = p => { try { return statSync(p).isDirectory(); } catch { return false; } };
