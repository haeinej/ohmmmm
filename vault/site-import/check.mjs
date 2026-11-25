// Checking that what the vault now holds gives the site back (README.md).
//
// For a run of repeated items (photographs, cards), the run is built again from the blocks' own
// fields and the site's templates, in the order the blocks say, and compared with the page. For an
// article or an entry, the words of its block are compared with the words on the page. Reads only.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import MarkdownIt from 'markdown-it';
import { fill, normalised, plainText } from './html.mjs';
import { readNode } from '../vault/node.mjs';
import { articleOf, inLanguage, scanSite, sourceOf } from './scan.mjs';

const md = new MarkdownIt({ html: false, linkify: false });

/** Every block and channel file of a vault, read. */
async function vaultNodes(vault) {
  const out = [];
  const visit = async dir => {
    for (const entry of await readdir(join(vault, dir), { withFileTypes: true }).catch(() => [])) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (!entry.name.startsWith('_')) await visit(path); continue; }
      if (!/\.md$/i.test(entry.name)) continue;
      const read = readNode(path.split(sep).join('/'), await readFile(join(vault, path), 'utf8'));
      if (read?.node) out.push(read.node);
    }
  };
  await visit('');
  return out;
}

/** Where two texts first part, with a little of each around it. */
function firstDifference(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return { at: i, site: a.slice(Math.max(0, i - 30), i + 50), vault: b.slice(Math.max(0, i - 30), i + 50) };
}
const words = text => text.replace(/[“”"‘’'`*_]/g, '').replace(/\s+/g, ' ').trim();

/**
 *   returns { regions: [{ page, region, items, same, difference? }], texts: [{ page, same, difference? }], ok }
 */
export async function checkSite(plan, { vault, built }) {
  const { site, described } = await scanSite(plan.site.folder, { origin: plan.site.origin ?? undefined });
  const nodes = await vaultNodes(vault);
  const entries = [];
  for (const node of nodes) {
    const s = node.type === 'block' ? node.properties?.site : null;
    if (s?.signature && s.fields) entries.push(s);
    for (const view of (node.type === 'block' ? s?.views : node.properties?.views) ?? []) entries.push(view);
  }

  // ---- runs of items, region by region
  const regions = [];
  const byRegion = new Map();
  for (const g of described) {
    const key = `${g.page}#${g.region}`;
    if (!byRegion.has(key)) byRegion.set(key, []);
    byRegion.get(key).push(g);
  }
  for (const [key, groups] of byRegion) {
    const [page, region] = [groups[0].page, groups[0].region];
    const held = entries.filter(e => e.page === page && e.region === region).sort((a, b) => a.at - b.at);
    if (!held.length) continue;
    const html = await site.read(page);
    // The page's own items, in their order, and the same items built again from the vault.
    const own = groups.flatMap(g => g.items.map((el, i) => ({ start: el.start, html: g.html[i] }))).sort((a, b) => a.start - b.start).map(item => item.html);
    const rebuilt = held.map(e => {
      const g = groups.find(x => x.signature === e.signature);
      const shape = g?.t.shapes[e.shape];
      return shape ? fill(shape.parts, e.fields) : `<!-- no template for ${e.signature} shape ${e.shape} -->`;
    });
    const a = normalised(own.join('')), b = normalised(rebuilt.join(''));
    regions.push({ page, region, items: own.length, held: held.length, same: a === b, ...(a === b ? {} : { difference: firstDifference(a, b) }) });
    void html;
  }

  // ---- articles and entries: their words
  const texts = [];
  for (const node of nodes.filter(n => n.type === 'block' && n.properties?.site && !n.properties.site.fields)) {
    const s = node.properties.site;
    let original;
    if (s.signature) {
      const g = described.find(x => x.page === s.page && x.region === s.region && x.signature === s.signature);
      const i = g?.rich.findIndex(r => (s.anchor ? r.id === s.anchor : true));
      original = g && i >= 0 ? g.rich[i].body : null;
    } else {
      original = site.files.includes(s.page) ? articleOf(await site.read(s.page), s.page).body : null;
    }
    const label = `${s.page}${s.anchor ? `#${s.anchor}` : ''}`;
    if (original === null || original === undefined) { texts.push({ page: label, same: false, difference: { at: 0, site: '(not on the site any more)', vault: '' } }); continue; }
    const a = words(plainText(inLanguage(original, s.languages?.[0]))), b = words(plainText(md.render(node.body ?? '')));
    texts.push({ page: label, same: a === b, ...(a === b ? {} : { difference: firstDifference(a, b) }) });
  }
  // ---- pages built from the vault (`ohm site compose`, then the site's own build), against the site's
  const pages = [];
  if (built) {
    for (const page of [...new Set(regions.map(r => r.page))]) {
      const made = await readFile(join(built, page), 'utf8').catch(() => null);
      if (made === null) { pages.push({ page, same: false, difference: { at: 0, site: '', vault: `(${page} was not built)` } }); continue; }
      const a = normalised(await site.read(page)), b = normalised(made);
      pages.push({ page, same: a === b, ...(a === b ? {} : { difference: firstDifference(a, b) }) });
    }
  }
  return { regions, texts, pages, ok: regions.every(r => r.same) && texts.every(t => t.same) && pages.every(p => p.same) };
}
