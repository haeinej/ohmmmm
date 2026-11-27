// Bring an existing website into ohm: read it, say what it holds, put it into a vault as channels
// and blocks, and check the vault gives the site back. (site-import/README.md)
//
//   site scan  --folder DIR [--origin URL] [--plan FILE]   read the site and write the plan; changes nothing else
//   site import --plan FILE [--vault DIR] [--apply] [--update]
//                                    say what would be written; --apply writes what is new, --update also
//                                    rewrites what changed (the earlier version is kept in the vault's history)
//   site compose --plan FILE [--vault DIR] --out DIR   write each run as an Astro component fed by the vault,
//                                    and each page that holds runs as an Astro page around them
//   site check --plan FILE [--vault DIR] [--built DIR]   build the site's repeated parts again from the vault and
//                                    compare; with --built, also compare the pages an Astro build made
//
// Only what git tracks in the site folder is read. Every block starts private: nothing is published.
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { defaultVault } from '../../home/home.mjs';
import { importSite } from '../site-import/apply.mjs';
import { checkSite } from '../site-import/check.mjs';
import { composeSite } from '../site-import/compose.mjs';
import { scanSite } from '../site-import/scan.mjs';

const expand = path => (path === '~' ? homedir() : path.startsWith('~/') ? `${homedir()}${path.slice(1)}` : path);
const [action] = process.argv.splice(2, 1);
const { values } = parseArgs({
  options: {
    folder: { type: 'string' }, origin: { type: 'string' }, plan: { type: 'string' }, vault: { type: 'string' },
    apply: { type: 'boolean' }, update: { type: 'boolean' }, json: { type: 'boolean' }, out: { type: 'string' }, built: { type: 'string' },
  },
});
const planPath = resolve(expand(values.plan ?? 'site-plan.json'));
const vaultPath = () => resolve(expand(values.vault || process.env.OHM_VAULT_FOLDER || defaultVault() || '.'));
const readPlan = async () => JSON.parse(await readFile(planPath, 'utf8').catch(() => { throw new Error(`There is no plan at ${planPath}. Make one with: ohm site scan --folder <your site>`); }));
const n = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

try {
  if (action === 'scan') {
    if (!values.folder) throw new Error('Say which site: --folder <the folder your site is in>');
    const { plan } = await scanSite(resolve(expand(values.folder)), { origin: values.origin });
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, { flag: values.plan ? 'w' : 'wx' }).catch(problem => {
      if (problem.code === 'EEXIST') throw new Error(`${planPath} is there already. Name another with --plan, or remove it to scan again.`);
      throw problem;
    });
    if (values.json) { console.log(JSON.stringify(plan, null, 2)); process.exit(0); }
    const kinds = plan.pages.reduce((count, p) => ({ ...count, [p.kind]: (count[p.kind] ?? 0) + 1 }), {});
    console.log(`${plan.site.origin ?? plan.site.folder}${plan.site.commit ? ` at ${plan.site.commit.slice(0, 7)}` : ''}: ${n(plan.site.files, 'tracked file')}${plan.site.changed ? `, ${plan.site.changed} changed and not committed` : ''}`);
    console.log(`Pages: ${Object.entries(kinds).map(([k, c]) => `${c} ${k}`).join(', ')}`);
    console.log('\nWhat the site holds many of. Each needs a name, yours, before it can come in:');
    for (const c of plan.channels) {
      const subs = Object.keys(c.subs ?? {});
      console.log(`  ${c.asFound}: ${n(c.count, c.kind === 'articles' ? 'page' : 'item')}${c.kind === 'rich' ? ', each with writing of its own' : ''}${subs.length ? `, in ${n(subs.length, 'group')} by ${c.sub === 'folder' ? 'folder' : c.sub} (${subs.slice(0, 4).join(', ')}${subs.length > 4 ? '…' : ''})` : ''}${c.languages?.length > 1 ? `, written in ${c.languages.join(' and ')}` : ''}`);
    }
    if (plan.views.length) {
      console.log('\nCards that show content kept elsewhere (kept with what they show):');
      for (const v of plan.views) console.log(`  ${v.source.slice('items:'.length)}: ${n(v.count, 'card')}, ${v.resolved} point at the site's own content`);
    }
    console.log(`\nMedia: ${n(plan.media.files, 'file')}, ${n(plan.media.copies, 'smaller copy', 'smaller copies')} of ${n(plan.media.variants, 'original')}; ${n(plan.media.unreferenced.length, 'file')} no page shows${plan.media.unreferenced.length ? `: ${plan.media.unreferenced.slice(0, 5).join(', ')}${plan.media.unreferenced.length > 5 ? '…' : ''}` : ''}`);
    const copies = plan.pages.filter(p => p.kind === 'copy');
    if (copies.length) console.log(`Copies of other pages, left out: ${copies.map(p => `${p.path} (of ${p.of})`).join(', ')}`);
    const short = plan.checks.filter(c => c.reproduced !== c.items);
    console.log(short.length ? `\nSome items could not be read back exactly: ${short.map(c => `${c.source} ${c.reproduced}/${c.items}`).join(', ')}` : '\nEvery repeated item reads back exactly from its fields.');
    console.log(`\nThe plan is in ${planPath}. Fill in each channel's "name" (or set "skip": true), then: ohm site import --plan ${values.plan ?? 'site-plan.json'}`);
  } else if (action === 'import') {
    const plan = await readPlan();
    const vault = vaultPath();
    const result = await importSite(plan, { vault, apply: values.apply, update: values.update });
    const count = state => result.files.filter(f => f.state === state).length;
    console.log(`Into ${vault}: ${n(result.channels, 'channel')} and ${n(result.blocks, 'block')}, ${count('add')} new files, ${count('change')} changed, ${count('same')} the same`);
    for (const f of result.files.filter(f => f.state !== 'same').slice(0, 8)) console.log(`  ${f.state === 'add' ? '+' : '~'} ${f.path}`);
    if (result.files.filter(f => f.state !== 'same').length > 8) console.log('  …');
    for (const note of result.notes) console.log(`Note: ${note}`);
    for (const card of result.unresolved) console.log(`A card that points at nothing brought in: ${card}`);
    if (values.apply) console.log(`\nWrote ${n(result.written.length, 'file')}${count('change') && !values.update ? `; ${count('change')} changed files left as they are (add --update to rewrite them)` : ''}. Every block is private until you publish it. Next: ohm site check --plan ${values.plan ?? 'site-plan.json'}`);
    else console.log('\nNothing written. Add --apply to write the new files.');
  } else if (action === 'compose') {
    if (!values.out) throw new Error('Say where the Astro project is: --out <folder>');
    const plan = await readPlan();
    const out = resolve(expand(values.out));
    const result = await composeSite(plan, { vault: vaultPath(), out });
    console.log(`Into ${out}: ${n(result.components.length, 'component')} (${result.components.join(', ')}) and ${n(result.pages.length, 'page')} (${result.pages.join(', ')}).`);
    console.log(`Build it with Astro, then: ohm site check --plan ${values.plan ?? 'site-plan.json'} --built ${values.out}/dist`);
  } else if (action === 'check') {
    const plan = await readPlan();
    const result = await checkSite(plan, { vault: vaultPath(), built: values.built ? resolve(expand(values.built)) : undefined });
    for (const r of result.regions) console.log(`${r.same ? 'same' : 'differs'}  ${r.page} (${r.region}): ${r.held} of ${r.items} items from the vault${r.same ? '' : `\n        site:  …${r.difference.site}…\n        vault: …${r.difference.vault}…`}`);
    for (const p of result.pages) console.log(`${p.same ? 'same' : 'differs'}  ${p.page}: the page built from the vault${p.same ? '' : `\n        site:  …${p.difference.site}…\n        built: …${p.difference.vault}…`}`);
    for (const t of result.texts) console.log(`${t.same ? 'same' : 'differs'}  ${t.page}: its words${t.same ? '' : `\n        site:  …${t.difference.site}…\n        vault: …${t.difference.vault}…`}`);
    console.log(result.ok ? '\nThe vault gives the site back.' : '\nSome parts differ; each is shown above.');
    process.exitCode = result.ok ? 0 : 1;
  } else {
    console.log('ohm site scan --folder DIR [--origin URL] [--plan FILE]\nohm site import --plan FILE [--vault DIR] [--apply] [--update]\nohm site compose --plan FILE [--vault DIR] --out DIR\nohm site check --plan FILE [--vault DIR] [--built DIR]');
    process.exitCode = action ? 1 : 0;
  }
} catch (problem) {
  console.error(problem.message);
  process.exitCode = 1;
}
