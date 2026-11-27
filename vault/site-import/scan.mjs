// Reading a site folder and saying what is in it, as a plan the owner completes (README.md).
//
// Read-only. Only what git tracks is read, so a folder's private notes and drafts are never opened.
// What comes out:
//   pages     every page, and what kind it is (an article, a redirect, a copy of another page...)
//   channels  the things the site holds many of: a folder of articles, or a run of repeated items
//             on a page (photographs, cards, entries), each with its fields; names are left empty,
//             for the owner, with the name as found beside them
//   views     runs of items that show content kept elsewhere (a gallery's cards for its articles)
//   media     the site's pictures and videos, their smaller copies, and the ones nothing shows
import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, posix } from 'node:path';
import { promisify } from 'node:util';
import { attributes, firstClass, parseTree, plainText, signature, templatesOf, fill, walk } from './html.mjs';

const run = promisify(execFile);
const MEDIA = /\.(?:jpe?g|png|webp|gif|avif|svg|mp4|mov|webm|m4v|mp3|m4a|wav|pdf)$/i;
const TEXTS = /\.(?:html?|css|js|mjs|json|xml|txt|md)$/i;
// Where a page's repeated things are never looked for: its head, its navigation, the inside of an
// article (paragraphs repeat, but they are the article), and what is not content.
const EXCLUDE = new Set(['head', 'nav', 'svg', 'script', 'style', 'article', 'select', 'template', 'noscript', 'form', 'button', 'picture', 'ul', 'ol', 'table', 'p']);
const ITEM_TAGS = new Set(['figure', 'article', 'details', 'li', 'section', 'a']);

/** The folder's files: what git tracks, or every file not hidden when it is not a repository. */
export async function readSite(folder) {
  let files, commit = null, committed = null, changed = 0;
  try {
    files = (await run('git', ['-C', folder, 'ls-files', '-z'], { maxBuffer: 64 * 1024 * 1024 })).stdout.split('\0').filter(Boolean);
    commit = (await run('git', ['-C', folder, 'rev-parse', 'HEAD'])).stdout.trim();
    committed = (await run('git', ['-C', folder, 'log', '-1', '--format=%cI'])).stdout.trim();
    changed = (await run('git', ['-C', folder, 'status', '--porcelain', '--untracked-files=no'])).stdout.split('\n').filter(Boolean).length;
  } catch {
    files = [];
    const visit = async dir => {
      for (const entry of await readdir(join(folder, dir), { withFileTypes: true })) {
        if (/^[._]/.test(entry.name) || entry.name === 'node_modules') continue;
        const path = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await visit(path); else files.push(path);
      }
    };
    await visit('');
  }
  files.sort();
  const cache = new Map();
  const read = async path => { if (!cache.has(path)) cache.set(path, await readFile(join(folder, path), 'utf8')); return cache.get(path); };
  return { folder, commit, committed, changed, files, read };
}

/** A link on a page as the path of the file it names, when it names one of the site's own. */
export function resolveLink(href, page, files, origin) {
  if (!href) return null;
  let path = href.split('#')[0].split('?')[0];
  const hash = href.includes('#') ? href.slice(href.indexOf('#') + 1) : '';
  if (/^[a-z]+:/i.test(path)) {
    if (!origin || !path.startsWith(origin)) return null;
    path = path.slice(origin.length);
  }
  if (path === '' && hash) return { path: page, hash };
  path = path.startsWith('/') ? path.slice(1) : posix.normalize(posix.join(posix.dirname(page), path));
  if (path === '.' || path === '') path = 'index.html';
  const candidates = [path, `${path.replace(/\/$/, '')}/index.html`.replace(/^\//, ''), `${path}.html`];
  const found = candidates.find(c => files.has(c));
  return found ? { path: found, hash } : null;
}

const canonicalOf = html => /<link\b[^>]*rel=["']canonical["'][^>]*>/i.exec(html)?.[0];
const metaContent = (html, name) => new RegExp(`<meta\\b[^>]*(?:name|property)=["']${name}["'][^>]*>`, 'i').exec(html)?.[0];

/** What kind of page this is. */
function classify(path, html, files, origin) {
  const title = plainText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');
  const lang = attributes(/<html\b([^>]*)>/i.exec(html)?.[1] ?? '').lang ?? '';
  const refresh = /<meta\b[^>]*http-equiv=["']refresh["'][^>]*>/i.exec(html);
  if (refresh) return { kind: 'redirect', title, lang, to: /url=([^"';]+)/i.exec(refresh[0])?.[1]?.trim() ?? '' };
  if (/^google[0-9a-f]+\.html$/.test(basename(path)) || /^yandex_[0-9a-f]+\.html$/.test(basename(path))) return { kind: 'verification', title, lang };
  if (!/<html\b/i.test(html) && !/<body\b/i.test(html)) return { kind: 'fragment', title, lang };
  const canonical = canonicalOf(html);
  if (canonical) {
    const target = resolveLink(attributes(canonical.slice(5, -1)).href, path, files, origin);
    if (target && target.path !== path) return { kind: 'copy', title, lang, of: target.path };
  }
  if (/<script\b[^>]*type=["']module["'][^>]*src=["'][^"']*assets\//i.test(html) && /<div\s+id=["'](?:root|app)["']/i.test(html)) return { kind: 'app', title, lang };
  const article = /<article\b[^>]*>[\s\S]*?<\/article>/i.exec(html)?.[0];
  if (article && /<h1\b/i.test(article)) return { kind: 'article', title, lang };
  return { kind: 'page', title, lang };
}

/** The languages a piece of markup is written in, by its lang attributes, first one first. */
export function languagesOf(html, fallback = '') {
  const found = [...html.matchAll(/\slang=["']([a-zA-Z-]+)["']/g)].map(m => m[1].toLowerCase());
  return [...new Set([...(fallback ? [fallback.toLowerCase()] : []), ...found])];
}
/** Markup with everything marked as written in another language than `keep` taken out. */
export function inLanguage(html, keep) {
  if (!keep) return html;
  let out = html, before;
  do {
    before = out;
    out = out.replace(/<(\w+)\b([^>]*)\slang=["']([a-zA-Z-]+)["']([^>]*)>(?:(?!<\1\b)[\s\S])*?<\/\1>/g, (whole, tag, a, lang) => (lang.toLowerCase() === keep ? whole : ''));
  } while (out !== before);
  return out;
}

/** An article page: its title, the line under it, its date, and the markup of its body. */
export function articleOf(html, path) {
  const lang = attributes(/<html\b([^>]*)>/i.exec(html)?.[1] ?? '').lang?.toLowerCase() ?? '';
  const whole = /<article\b[^>]*>[\s\S]*?<\/article>/i.exec(html)?.[0] ?? '';
  const languages = languagesOf(/<body\b[\s\S]*$/i.exec(html)?.[0] ?? whole, lang);
  const article = inLanguage(whole, languages[0]);
  const title = plainText(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(article)?.[1] ?? '') || basename(path, extname(path));
  const subtitleTag = /<(p|div|h2)\b[^>]*class=["'][^"']*(?:subtitle|dek|standfirst|lede|episode-details|byline)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i.exec(article);
  const date = /"datePublished"\s*:\s*"([^"]+)"/.exec(html)?.[1]
    ?? attributes(metaContent(html, 'article:published_time')?.slice(5, -1) ?? '').content
    ?? attributes(/<time\b([^>]*)>/i.exec(article)?.[1] ?? '').datetime ?? '';
  const body = article
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/i, '')
    .replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/i, '')
    .replace(subtitleTag?.[0] ?? '\u0000', '')
    .replace(/<div\b[^>]*class=["'][^"']*source-note[^"']*["'][^>]*>[\s\S]*?<\/div>/i, '');
  return { title, subtitle: subtitleTag ? plainText(subtitleTag[2]) : '', date, languages, body };
}

/** The runs of repeated things on one page, each with its items' exact markup. */
function groupsOn(path, html) {
  const tree = parseTree(html);
  const found = [];
  const visit = (el, within) => {
    if (EXCLUDE.has(el.name)) return;
    const bySignature = new Map();
    for (const child of el.children) {
      if (!firstClass(child) && !ITEM_TAGS.has(child.name)) continue;
      if (EXCLUDE.has(child.name) && child.name !== 'article') continue;
      const key = signature(child);
      if (!bySignature.has(key)) bySignature.set(key, []);
      bySignature.get(key).push(child);
    }
    const taken = new Set();
    for (const [key, items] of bySignature) {
      if (items.length < 3) continue;
      // A run is known by where it sits: its container's id, or the chain of elements down to it.
      const container = el.attrs.id || [...within, el].filter(e => e.name !== '#root' && e.name !== 'html').map(signature).join('>') || 'body';
      found.push({ page: path, region: container, signature: key, items, html: items.map(item => html.slice(item.start, item.end)), container: el });
      for (const item of items) taken.add(item);
    }
    for (const child of el.children) if (!taken.has(child)) visit(child, el.name === '#root' ? [] : [...within, el]);
  };
  visit(tree, []);
  return found;
}

/** How a run of items is named in a plan: `items:<page>#<region>><signature>`. */
export const sourceOf = g => `items:${g.page}#${g.region}>${g.signature}`;

const FIELD = {
  media: key => /^(?:img|video|source)@(?:src|data-src)$/.test(key),
  link: key => /^a@href$/.test(key),
  title: key => /(?:title|name|heading)[^@]*#text$/.test(key) || /^h[1-4][^@]*#text$/.test(key),
  date: key => /(?:year|date|time|published)/.test(key),
  sub: key => /(?:loc|place|location|city|country|category|topic|series|section|tag)/.test(key) && !/@(?:src|href|class)$/.test(key),
};

/** The fields of a run of items that mean something ohm has a place for, as far as their names say. */
function roles(fields, count) {
  const pick = test => fields.find(f => test(f.key))?.key ?? null;
  const sub = fields.find(f => FIELD.sub(f.key) && f.distinct >= 2 && f.distinct <= Math.max(2, count / 2))?.key ?? null;
  return { media: pick(FIELD.media), link: pick(FIELD.link), title: pick(FIELD.title), date: pick(FIELD.date), sub };
}

/** What a rich item (an entry with writing of its own) says: its anchor, title and body. */
export function richOf(html, lang) {
  const id = attributes(/^<\w+\b([^>]*)>/.exec(html)?.[1] ?? '').id ?? '';
  const languages = languagesOf(html, lang);
  const own = inLanguage(html, languages[0]);
  const titleTag = /<(summary|h[1-4])\b[^>]*>([\s\S]*?)<\/\1>/i.exec(own) ?? /<(\w+)\b[^>]*class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i.exec(own);
  const title = titleTag ? plainText(titleTag[2]) : plainText(own).slice(0, 80);
  const body = own.replace(/^<\w+\b[^>]*>/, '').replace(/<\/\w+>\s*$/, '').replace(titleTag?.[0] ?? '\u0000', '');
  return { id, title, body, languages };
}

/** Scan a site folder. Changes nothing. */
export async function scanSite(folder, { origin } = {}) {
  const site = await readSite(folder);
  const files = new Set(site.files);
  let cname = '';
  if (files.has('CNAME')) cname = (await site.read('CNAME')).trim();
  const root = (origin ?? (cname ? `https://${cname}` : '')).replace(/\/$/, '');

  // ---- pages
  const pages = [];
  for (const path of site.files.filter(f => /\.html?$/i.test(f))) {
    const html = await site.read(path);
    pages.push({ path, ...classify(path, html, files, root) });
  }
  const pageKind = new Map(pages.map(p => [p.path, p.kind]));

  // ---- repeated things
  const groups = [];
  for (const page of pages.filter(p => p.kind === 'page' || p.kind === 'article')) groups.push(...groupsOn(page.path, await site.read(page.path)));
  // The same run on many pages, item for item, is a shared part of the site (a footer, a menu).
  const seen = new Map();
  for (const g of groups) { const key = `${g.signature}\u0000${g.html.join('')}`; seen.set(key, (seen.get(key) ?? 0) + 1); }
  const shared = groups.filter(g => seen.get(`${g.signature}\u0000${g.html.join('')}`) > 1);
  const runs = groups.filter(g => !shared.includes(g));

  // Rich items are entries with writing of their own; they can be linked to as page#anchor.
  const described = runs.map(g => {
    const t = templatesOf(g.html);
    const reproduced = g.html.filter((h, i) => fill(t.shapes[t.items[i].shape].parts, t.items[i].fields) === h).length;
    const kind = t.shapes.length <= Math.max(3, Math.ceil(g.html.length / 5)) ? 'list' : 'rich';
    const lang = pages.find(p => p.path === g.page)?.lang ?? '';
    const rich = kind === 'rich' ? g.html.map(h => richOf(h, lang)) : [];
    return { ...g, t, reproduced, kind, rich, roles: kind === 'list' ? roles(t.fields, g.html.length) : {} };
  });
  const anchors = new Set(described.flatMap(g => g.rich.filter(r => r.id).map(r => `${g.page}#${r.id}`)));

  // ---- articles, by the folder they are kept in
  const articles = pages.filter(p => p.kind === 'article');
  const folders = new Map();
  for (const a of articles) {
    const top = a.path.includes('/') ? a.path.split('/')[0] : '';
    if (!folders.has(top)) folders.set(top, []);
    folders.get(top).push(a);
  }
  const subOfArticle = path => { const parts = path.split('/').slice(1, -1); return parts.at(-1) ?? ''; };
  const articleFolders = new Set(articles.map(a => dirname(a.path)));

  // A run of links to the site's own content is a view of it, not content of its own.
  const targetOf = (href, page) => {
    const to = resolveLink(href, page, files, root);
    if (!to) return null;
    if (to.hash && anchors.has(`${to.path}#${to.hash}`)) return { kind: 'item', ref: `${to.path}#${to.hash}` };
    if (pageKind.get(to.path) === 'article') return { kind: 'article', ref: to.path };
    if (/index\.html?$/.test(to.path) && articleFolders.has(dirname(to.path))) return { kind: 'channel', ref: dirname(to.path) };
    return null;
  };
  for (const g of described) {
    if (g.kind !== 'list' || !g.roles.link) { g.role = 'content'; continue; }
    const hrefs = g.t.items.map(item => item.fields[g.roles.link] ?? '');
    const resolved = hrefs.filter(h => targetOf(h, g.page)).length;
    g.role = resolved >= Math.ceil(hrefs.length / 2) ? 'view' : 'content';
    g.resolved = resolved;
  }

  // ---- media
  const media = site.files.filter(f => MEDIA.test(f));
  const sizes = new Map(await Promise.all(media.map(async f => [f, (await stat(join(folder, f))).size])));
  const byName = new Map();
  for (const f of media) { const name = basename(f); if (!byName.has(name)) byName.set(name, []); byName.get(name).push(f); }
  const variants = [...byName.values()].filter(list => list.length > 1).map(list => {
    const sorted = [...list].sort((a, b) => sizes.get(b) - sizes.get(a));
    return { original: sorted[0], copies: sorted.slice(1) };
  });
  const texts = await Promise.all(site.files.filter(f => TEXTS.test(f) && !MEDIA.test(f)).map(f => site.read(f)));
  const everything = texts.join('\n');
  const unreferenced = media.filter(f => !everything.includes(basename(f)) && !everything.includes(encodeURI(basename(f))));

  // ---- the plan
  const channels = [];
  for (const [top, list] of folders) {
    const subs = {};
    for (const a of list) { const s = subOfArticle(a.path); if (s) subs[s] = (subs[s] ?? 0) + 1; }
    channels.push({ name: null, asFound: top || '(top)', source: `articles:${top}`, kind: 'articles', count: list.length, sub: Object.keys(subs).length ? 'folder' : null, subs, languages: [] });
  }
  for (const g of described.filter(g => g.role === 'content')) {
    const subs = {};
    if (g.roles.sub) for (const item of g.t.items) { const v = item.fields[g.roles.sub]?.trim(); if (v) subs[v] = (subs[v] ?? 0) + 1; }
    channels.push({
      name: null, asFound: `${g.page} · ${g.signature}`, source: sourceOf(g), kind: g.kind, count: g.html.length,
      ...(g.kind === 'list' ? { title: g.roles.title, date: g.roles.date, media: g.roles.media, sub: g.roles.sub, subs, shapes: g.t.shapes.length, fields: g.t.fields }
        : { sub: null, subs: {}, anchors: g.rich.filter(r => r.id).length, languages: [...new Set(g.rich.flatMap(r => r.languages))] }),
    });
  }
  // Reading the languages of each article needs its page; done once here so the plan says it.
  for (const c of channels.filter(c => c.kind === 'articles')) {
    const list = folders.get(c.source.slice('articles:'.length));
    const langs = new Set();
    for (const a of list) for (const l of articleOf(await site.read(a.path), a.path).languages) langs.add(l);
    c.languages = [...langs];
  }
  const views = described.filter(g => g.role === 'view').map(g => ({
    source: sourceOf(g), count: g.html.length, link: g.roles.link, resolved: g.resolved, shapes: g.t.shapes.length,
  }));

  const plan = {
    ohm: 'site-plan', version: 1,
    site: { folder, origin: root || null, commit: site.commit, committed: site.committed, changed: site.changed, files: site.files.length },
    channels, views,
    pages: pages.map(p => ({ path: p.path, kind: p.kind, title: p.title, ...(p.of ? { of: p.of } : {}), ...(p.to ? { to: p.to } : {}) })),
    media: { files: media.length, variants: variants.length, copies: variants.reduce((n, v) => n + v.copies.length, 0), unreferenced },
    shared: [...new Set(shared.map(g => `${g.signature} (${g.page})`))],
    checks: described.map(g => ({ source: sourceOf(g), items: g.html.length, reproduced: g.reproduced })),
  };
  return { plan, site, described, folders, variants };
}
