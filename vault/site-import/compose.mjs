// Making a site composable from what a vault holds (README.md): every run of repeated items becomes
// an Astro component, every region that holds runs becomes a component that draws its items from the
// vault in their order, and every page with a region becomes an Astro page whose region is that
// component and whose rest is the site's own markup, untouched. Built, the page is the site's page;
// change a block in the vault, and the page follows.
//
// Writes only into the folder it is given. Reads the site (tracked files) and the vault.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { scanSite } from './scan.mjs';

const pascal = text => text.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join('') || 'Item';
const json = value => JSON.stringify(value);

/**
 * A shape's template as Astro markup. An attribute's value becomes an attribute expression, decoded
 * so Astro writes it back as the site did; a text becomes the site's own text, set as written.
 * Literal markup that Astro would read as an expression (a brace) is written as set:html instead.
 */
export function shapeMarkup(parts) {
  const literal = parts.filter(p => typeof p === 'string').join('');
  if (/[{}]/.test(literal) || /<(?:script|style)\b/i.test(literal)) {
    const pieces = parts.map(p => (typeof p === 'string' ? json(p) : `(f[${json(p.field)}] ?? '')`)).join(' + ');
    return `<Fragment set:html={${pieces}} />`;
  }
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (typeof part === 'string') { out += part; continue; }
    const quote = /=(["'])$/.exec(out)?.[1];
    if (quote) {
      out = out.slice(0, -2) + `={decode(f[${json(part.field)}])}`;
      if (typeof parts[i + 1] === 'string' && parts[i + 1].startsWith(quote)) parts = [...parts.slice(0, i + 1), parts[i + 1].slice(1), ...parts.slice(i + 2)];
    } else out += `<Fragment set:html={f[${json(part.field)}] ?? ''} />`;
  }
  return out;
}

const DECODE = `const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\\u00a0' };
const decode = value => String(value ?? '').replace(/&(?:#(\\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (whole, dec, hex, name) =>
  dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : NAMED[name.toLowerCase()] ?? whole);`;

/** The component for one run: one branch per shape, each the site's own markup with its fields. */
function runComponent(g) {
  return `---
// Written by \`ohm site compose\` from ${g.page}, the run of ${g.signature} in ${g.region}.
// One branch for each way the site writes this item. Its fields come from the vault: a block's \`site.fields\`.
interface Props { shape: number; fields: Record<string, string> }
const { shape, fields: f } = Astro.props;
${DECODE}
---
${g.t.shapes.map((s, i) => `{shape === ${i} && (${shapeMarkup(s.parts)})}`).join('\n')}
`;
}

/** The reader the region components share: what the vault holds for one region, in order. */
const READER = (vault) => `// Written by \`ohm site compose\`. Reads a vault folder at build time: every block's \`site\` entry and
// every \`views\` entry, for one region of one page, in the order the vault says (\`at\`).
// The vault is the one \`ohm site import\` wrote; set OHM_VAULT to read another.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const VAULT = process.env.OHM_VAULT ?? ${json(vault)};
let held;
function all() {
  if (held) return held;
  held = [];
  const visit = dir => {
    for (const entry of readdirSync(join(VAULT, dir), { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const path = dir ? \`\${dir}/\${entry.name}\` : entry.name;
      if (entry.isDirectory()) { if (!entry.name.startsWith('_')) visit(path); continue; }
      if (!entry.name.endsWith('.md')) continue;
      const head = /^---\\n([\\s\\S]*?)\\n---/.exec(readFileSync(join(VAULT, path), 'utf8'))?.[1] ?? '';
      const site = /^site: (\\{.*\\})$/m.exec(head)?.[1];
      if (site) {
        const value = JSON.parse(site);
        if (value.signature && value.fields) held.push(value);
        for (const view of value.views ?? []) held.push(view);
      }
      const views = /^views:\\n((?:\\s+- .*\\n?)+)/m.exec(head)?.[1];
      if (views) for (const line of views.split('\\n')) { const m = /^\\s+- (\\{.*\\})$/.exec(line); if (m) held.push(JSON.parse(m[1])); }
    }
  };
  visit('');
  return held;
}

export function regionEntries(page, region) {
  return all().filter(e => e.page === page && e.region === region).sort((a, b) => a.at - b.at);
}
`;

/**
 * Write the components, the reader and the pages into an Astro project folder.
 *   returns { files: [path], components: [{ name, source }], pages: [path] }
 */
export async function composeSite(plan, { vault, out }) {
  const { site, described } = await scanSite(plan.site.folder, { origin: plan.site.origin ?? undefined });
  const written = [];
  const write = async (path, text) => { await mkdir(dirname(join(out, path)), { recursive: true }); await writeFile(join(out, path), text); written.push(path); };

  // Only the runs the plan brings in, and the views it keeps: what the vault can feed.
  const wanted = new Set([
    ...(plan.channels ?? []).filter(c => !c.skip && c.kind === 'list').map(c => c.source),
    ...(plan.views ?? []).filter(v => !v.skip).map(v => v.source),
  ]);
  const runs = described.filter(g => g.kind === 'list' && wanted.has(`items:${g.page}#${g.region}>${g.signature}`));
  const names = new Map();
  for (const g of runs) {
    let name = pascal(g.signature.replace('.', ' '));
    const base = name;
    for (let n = 2; [...names.values()].includes(name); n++) name = `${base}${n}`;
    names.set(g, name);
    await write(`src/components/ohm/${name}.astro`, runComponent(g));
  }
  await write('src/lib/ohm-vault.mjs', READER(vault));

  const regions = new Map();
  for (const g of runs) { const key = `${g.page}#${g.region}`; if (!regions.has(key)) regions.set(key, []); regions.get(key).push(g); }
  const pages = new Map();
  for (const [key, groups] of regions) {
    const { page, region, container } = groups[0];
    const name = pascal(`${page.replace(/\.html?$/, '').replace(/\/index$/, '') || 'home'} ${region.split('>').at(-1).replace(/^#/, '')}`);
    const imports = groups.map(g => `import ${names.get(g)} from '../${names.get(g)}.astro';`).join('\n');
    const pick = groups.map(g => `e.signature === ${json(g.signature)} ? <${names.get(g)} shape={e.shape} fields={e.fields} />`).join('\n  : ');
    await write(`src/components/ohm/regions/${name}.astro`, `---
// Written by \`ohm site compose\`: the items of ${page} in ${region}, from the vault, in their order.
${imports}
import { regionEntries } from '../../../lib/ohm-vault.mjs';
const entries = regionEntries(${json(page)}, ${json(region)});
---
{entries.map(e => (
  ${pick}
  : null
))}
`);
    if (!pages.has(page)) pages.set(page, []);
    pages.get(page).push({ name, container });
  }

  // Each page: the site's own markup, with each region's inside drawn by its component.
  for (const [page, held] of pages) {
    const html = await site.read(page);
    const cuts = held.map(h => ({ ...h, from: h.container.inner[0], to: h.container.inner[1] })).sort((a, b) => a.from - b.from);
    const shell = [];
    let at = 0;
    cuts.forEach((c, i) => { shell.push(html.slice(at, c.from)); at = c.to; });
    shell.push(html.slice(at));
    const stem = page.replace(/\.html?$/, '');
    for (const [i, piece] of shell.entries()) await write(`src/ohm/shell/${stem}.${i}.html`, piece);
    const depth = stem.split('/').length;
    const up = '../'.repeat(depth);
    await write(`src/pages/${stem}.astro`, `---
// Written by \`ohm site compose\`: ${page}, the site's own markup, with ${cuts.length === 1 ? 'its region' : 'its regions'} drawn from the vault.
${shell.map((_, i) => `import shell${i} from '${up}ohm/shell/${stem}.${i}.html?raw';`).join('\n')}
${cuts.map(c => `import ${c.name} from '${up}components/ohm/regions/${c.name}.astro';`).join('\n')}
---
${shell.map((_, i) => `<Fragment set:html={shell${i}} />${cuts[i] ? `<${cuts[i].name} />` : ''}`).join('')}
`);
  }
  return { files: written, components: [...names.values()], pages: [...pages.keys()] };
}
