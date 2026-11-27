// Putting a site's content into a vault, from a plan the owner has completed (README.md).
//
// Each channel the owner named becomes a channel of the vault, each of its items a block, and each
// value the site holds on an item that ohm has no field for is kept on the block, under `site`, so
// the page can be built again from the vault exactly (check.mjs). Nothing is copied from the site:
// a picture stays where it is, and its block points at its address. Every block starts private,
// whatever the site shows: putting it in front of more people is the owner's Publish, later.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, extname, join, posix } from 'node:path';
import { htmlToMarkdown } from '../mirror/html-to-markdown.mjs';
import { VaultProblem } from '../vault/core.mjs';
import { newPostId, slugOf } from '../vault/file.mjs';
import { appendEvents, keepVersion } from '../vault/journal.mjs';
import { isChannelPath, nodeFile } from '../vault/node.mjs';
import { articleOf, resolveLink, scanSite, sourceOf } from './scan.mjs';

// A number worked out from text, the same every time.
function hashOf(text) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash;
}
/**
 * The id of the block an item becomes: the same every time the same site is brought in. Many items
 * share a date (a year's photographs), so the id is spread over that day by the item's own key, and
 * `taken` keeps it apart from every id already given.
 */
export function itemId(key, when, taken = new Set()) {
  const hash = hashOf(key), spread = hashOf(`${key}\u0000day`) % 86_400_000;
  const at = (Number.isFinite(Date.parse(when)) ? Date.parse(when) : Date.parse('2000-01-01')) + spread;
  let id, micros = (hash >>> 10) % 1000;
  do id = newPostId(at, hash & 1023, micros++); while (taken.has(id));
  taken.add(id);
  return id;
}

/** A name as a channel's folder: kept as written, but never one that reads as a path or a hidden file. */
const folderName = name => String(name).trim().replace(/[\/\\\u0000-\u001f]/g, '-').replace(/^[._]+/, '') || 'untitled';

/** Why a plan can't be brought in yet. Empty when it can. */
export function planProblems(plan) {
  const problems = [];
  if (plan?.ohm !== 'site-plan' || plan.version !== 1) return ['This is not a site plan that `ohm site scan` wrote'];
  const names = new Set();
  for (const c of plan.channels ?? []) {
    if (c.skip) continue;
    if (!c.name) { problems.push(`Name the channel for ${c.asFound} (${c.count} ${c.kind === 'articles' ? 'pages' : 'items'}), or set "skip": true`); continue; }
    if (!isChannelPath(folderName(c.name)) || c.name.includes('/')) problems.push(`"${c.name}" can't be a channel's name: no "/", and not starting with "." or "_"`);
    if (names.has(c.name.toLowerCase())) problems.push(`Two channels are both called "${c.name}"`);
    names.add(c.name.toLowerCase());
  }
  return problems;
}

/** An article's or an entry's markup as Markdown, its pictures at their addresses on the site. */
function markdownOf(html, page, origin) {
  const base = `${origin || 'https://site.invalid'}/${page}`;
  const { markdown, images, simplified } = htmlToMarkdown(html, base);
  const at = url => (origin ? url : url.replace('https://site.invalid', ''));
  const placed = images.reduce((md, image) => md.replaceAll(`media:${image.id}`, at(image.url)), markdown);
  // A picture that is also a link comes out of the converter as a link around a paragraph, which
  // Markdown reads as plain brackets; it is written as one linked picture.
  const linked = placed.replace(/\[\s*\n+(!\[[^\]]*\]\([^)\s]+\))\s*\n+\]\(<?([^)>\s]+)>?\)/g, '[$1]($2)');
  return { markdown: linked.trim(), simplified };
}

/**
 * What bringing the site in would write, or writes it. Nothing is written without `apply`. A file
 * already in the vault is left as it is unless `update`, and then it is kept in the vault's history
 * by the journal first as any change is.
 *   returns { files: [{ path, text, state: 'add'|'change'|'same' }], channels, blocks, unresolved, notes, written }
 */
export async function importSite(plan, { vault, apply = false, update = false, now = new Date(), by = 'me' } = {}) {
  const problems = planProblems(plan);
  if (problems.length) throw new VaultProblem(problems.join('\n'));
  const { site, described, folders, variants, plan: current } = await scanSite(plan.site.folder, { origin: plan.site.origin ?? undefined });
  const origin = plan.site.origin ?? '';
  const url = path => (origin ? `${origin}/${path}` : `/${path}`);
  const notes = [];
  if (plan.site.commit && current.site.commit !== plan.site.commit) notes.push(`The site is at commit ${current.site.commit?.slice(0, 7)} now; the plan was made at ${plan.site.commit.slice(0, 7)}. Scan again if what it holds has changed.`);
  if (current.site.changed) notes.push(`${current.site.changed} tracked files in the site have changes not committed; they are read as they are now.`);
  const at = now.toISOString();
  const fallback = plan.site.committed ?? at;
  // When a block was made, for something brought in: when the site held it, so bringing the same
  // site in twice writes the same files.
  const made = new Date(fallback).toISOString();
  const original = new Map(variants.flatMap(v => v.copies.map(copy => [copy, v.original])));

  // Every item's place in its region, counting every run that shares the region (a gallery of
  // photographs and cards is one region), so the region can be put back together in order.
  const regionOrder = new Map();
  for (const g of described) {
    const key = `${g.page}#${g.region}`;
    if (!regionOrder.has(key)) regionOrder.set(key, []);
    regionOrder.get(key).push(...g.items.map(el => el.start));
  }
  for (const list of regionOrder.values()) list.sort((a, b) => a - b);
  const placeOf = (g, i) => regionOrder.get(`${g.page}#${g.region}`).indexOf(g.items[i].start);

  const ids = new Set();
  const channels = new Map(); // path -> node
  const blocks = [];
  const byTarget = new Map(); // `article:<page>` | `item:<page>#<id>` | `channel:<folder>` -> node
  const channelAt = (path, title, origin_) => {
    if (!channels.has(path)) channels.set(path, { type: 'channel', path, title, kind: 'collection', order: [], properties: { origin: origin_ } });
    return channels.get(path);
  };
  const slugs = new Map(); // home -> Set
  const freeSlug = (home, wanted) => {
    const used = slugs.get(home) ?? new Set();
    slugs.set(home, used);
    const base = wanted || 'item';
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    return slug;
  };
  const place = (parent, home, slug) => {
    const top = channels.get(parent);
    if (home === parent) top.order.push(slug);
    else {
      if (!top.order.includes(home)) top.order.push(home);
      channels.get(home).order.push(slug);
    }
  };

  for (const c of (plan.channels ?? []).filter(c => !c.skip)) {
    const name = folderName(c.name);
    if (c.kind === 'articles') {
      const top = c.source.slice('articles:'.length);
      const list = folders.get(top) ?? [];
      channelAt(name, c.name, url(top ? `${top}/` : ''));
      for (const page of list) {
        const html = await site.read(page.path);
        const a = articleOf(html, page.path);
        const sub = c.sub === 'folder' ? page.path.split('/').slice(1, -1).at(-1) ?? '' : '';
        const home = sub ? `${name}/${folderName(sub)}` : name;
        if (sub) { channelAt(home, sub, url(dirname(page.path) + '/')); byTarget.set(`channel:${dirname(page.path)}`, channels.get(home)); }
        const { markdown, simplified } = markdownOf(a.body, page.path, origin);
        if (simplified.length) notes.push(`${page.path}: ${simplified.join(', ')} kept as plain words`);
        const slug = freeSlug(home, slugOf(basename(page.path, extname(page.path))) || slugOf(a.title));
        const block = {
          type: 'block', kind: 'text', kindGiven: true, title: a.title, slug, home, origin: url(page.path), created: a.date && Number.isFinite(Date.parse(a.date)) ? new Date(a.date).toISOString() : made, id: itemId(`${plan.site.origin}|article|${page.path}`, a.date || fallback, ids),
          body: markdown,
          properties: { site: { page: page.path, ...(a.subtitle ? { subtitle: a.subtitle } : {}), ...(a.date ? { published: a.date } : {}), languages: a.languages } },
        };
        if (a.languages.length > 1) notes.push(`${page.path}: brought in in ${a.languages[0]}; also written in ${a.languages.slice(1).join(', ')}, which stays on the site`);
        blocks.push(block);
        byTarget.set(`article:${page.path}`, block);
        place(name, home, slug);
      }
      continue;
    }

    const g = described.find(d => sourceOf(d) === c.source);
    if (!g) { notes.push(`${c.source} is not on the site any more; its channel "${c.name}" is left out`); continue; }
    channelAt(name, c.name, url(g.page));
    for (let i = 0; i < g.html.length; i++) {
      const item = g.t.items[i];
      const entry = { page: g.page, region: g.region, signature: g.signature, at: placeOf(g, i), shape: item.shape };
      if (g.kind === 'rich') {
        const r = g.rich[i];
        const { markdown } = markdownOf(r.body, g.page, origin);
        const slug = freeSlug(name, slugOf(r.id) || slugOf(r.title));
        const block = {
          type: 'block', kind: 'text', kindGiven: true, title: r.title, slug, home: name, origin: url(`${g.page}${r.id ? `#${r.id}` : ''}`), created: made,
          id: itemId(`${plan.site.origin}|${c.source}|${r.id || i}`, fallback, ids), body: markdown,
          properties: { site: { ...entry, ...(r.id ? { anchor: r.id } : {}), languages: r.languages } },
        };
        if (r.languages.length > 1) notes.push(`${g.page}#${r.id || i}: brought in in ${r.languages[0]}; also written in ${r.languages.slice(1).join(', ')}, which stays on the site`);
        blocks.push(block);
        if (r.id) byTarget.set(`item:${g.page}#${r.id}`, block);
        place(name, name, slug);
        continue;
      }
      // A run of list items: its fields are the site's, kept whole; the ones ohm has a place for are read from them.
      const fields = item.fields;
      const mediaField = c.media && fields[c.media] !== undefined ? c.media : Object.keys(fields).find(k => /^(?:img|video|source)@(?:src|data-src)$/.test(k));
      // A picture the only one of its shape has is part of that shape's template, not a field: read it from the item.
      const src = mediaField ? fields[mediaField] : (/<(?:img|video|source)\b[^>]*\ssrc=["']([^"']+)["']/i.exec(g.html[i])?.[1] ?? '');
      const file = src ? posix.normalize(posix.join(posix.dirname(g.page), src.split('?')[0])) : '';
      const kept = original.get(file) ?? file;
      const sub = c.sub ? fields[c.sub]?.trim() : '';
      const home = sub ? `${name}/${folderName(sub)}` : name;
      if (sub) channelAt(home, sub, url(g.page));
      const title = (c.title ? fields[c.title]?.trim() : '') || (kept ? basename(kept) : `${c.name} ${i + 1}`);
      const slug = freeSlug(home, slugOf(basename(title, extname(title))) || slugOf(String(item.fields[c.date] ?? '')) || `item-${i + 1}`);
      const year = c.date ? String(fields[c.date] ?? '').trim() : '';
      const block = {
        type: 'block', kind: kept ? 'media' : 'text', kindGiven: true, title, slug, home, origin: kept ? url(kept) : url(g.page), created: made,
        id: itemId(`${plan.site.origin}|${c.source}|${kept || i}`, /^\d{4}$/.test(year) ? `${year}-01-01` : fallback, ids),
        body: kept ? `![](${url(kept)})` : '',
        properties: { site: { ...entry, fields } },
      };
      blocks.push(block);
      place(name, home, slug);
    }
  }

  // Views: what a run of cards says about content kept elsewhere is kept on that content.
  const unresolved = [];
  for (const v of (plan.views ?? []).filter(v => !v.skip)) {
    const g = described.find(d => sourceOf(d) === v.source);
    if (!g) { notes.push(`${v.source} is not on the site any more`); continue; }
    g.t.items.forEach((item, i) => {
      const href = item.fields[v.link] ?? '';
      const to = resolveLink(href, g.page, new Set(site.files), origin);
      const target = !to ? null
        : (to.hash && byTarget.get(`item:${to.path}#${to.hash}`)) || byTarget.get(`article:${to.path}`) || byTarget.get(`channel:${dirname(to.path)}`);
      const entry = { page: g.page, region: g.region, signature: g.signature, at: placeOf(g, i), shape: item.shape, fields: item.fields };
      // A card that points nowhere (one still to come) is kept with the channel whose page shows it,
      // so the page is built again whole; with no such channel, it is only named.
      if (!target) {
        const home = byTarget.get(`channel:${dirname(g.page)}`);
        if (home) (home.properties.views ??= []).push(entry);
        unresolved.push(`${g.page}: ${href || '(no address)'}${home ? `, kept with ${home.path}` : ''}`);
        return;
      }
      if (target.type === 'channel') (target.properties.views ??= []).push(entry);
      else (target.properties.site.views ??= []).push(entry);
    });
  }

  // An agent's blocks say so, as every block an agent makes does.
  if (by !== 'me') for (const block of blocks) block.by = by;

  // The files, and how each stands against what the vault holds now.
  const files = [];
  for (const node of [...channels.values(), ...blocks]) {
    const { path, text } = nodeFile(node);
    const held = await readFile(join(vault, path), 'utf8').catch(() => null);
    files.push({ path, text, held, state: held === null ? 'add' : held === text ? 'same' : 'change', origin: node.origin ?? node.properties?.origin });
  }
  const seen = new Map();
  for (const f of files) { if (seen.has(f.path)) throw new VaultProblem(`Two things would both be written to ${f.path}`); seen.set(f.path, f); }

  const written = [];
  if (apply) {
    for (const f of files.filter(f => f.state === 'add' || (update && f.state === 'change'))) {
      await mkdir(dirname(join(vault, f.path)), { recursive: true });
      // What a file said before it is changed is kept in the vault's history, as for any change.
      const before = f.state === 'change' ? await keepVersion(vault, f.held) : undefined;
      await writeFile(join(vault, f.path), f.text, f.state === 'add' ? { flag: 'wx' } : undefined);
      written.push({ ...f, before });
    }
    await appendEvents(vault, written.map(f => ({ at, op: f.state === 'add' ? 'added' : 'changed', root: 'vault', path: f.path, origin: f.origin || url(''), by, via: 'add', ...(f.before ? { before: f.before } : {}) })));
  }
  return { files: files.map(({ held, ...f }) => f), channels: channels.size, blocks: blocks.length, unresolved, notes, written: written.map(f => f.path) };
}
