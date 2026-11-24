// One block published from the home folder, when the person chooses Everyone for it in the app
// (docs/serve.md, "Publishing"; the owner's decisions of 24 November 2026). The block becomes a post
// on the person's PDS: a standard.site document holding `com.ohmmmm.post` content (feed/standard.mjs),
// kept under the block's ID, so renaming or moving the block never moves its record. The images it
// shows go with it. Nothing else of the vault does: a link to a block that is not published becomes
// plain words, and an embedded block that is not an image becomes a link to it.
//
// Nothing here touches a disk or a network except through what the caller hands in. The bridge
// (home/serve.mjs) reads the files, signs in with the app password kept on this computer, and writes.
import { POST } from '../feed/pds.mjs';
import { bodyFacts } from '../feed/render.mjs';
import { imageSize } from '../scripts/image-size.mjs';
import { assembleRecord, blobCid, FILE_TYPES, kindOf, recordVersion, VaultProblem } from './core.mjs';
import { addressKind, outsideCode, recordBody, slugOf } from './file.mjs';
import { blockResolver, readVault } from './node.mjs';

// An attachment on the PDS is at most this large, as `ohm publish` allows.
export const MAX_FILE = 60_000_000;

const refuse = message => { throw new VaultProblem(message); };
const folderOf = path => path.split('/').slice(0, -1).join('/');
// Words that sit inside ![…] or [[…|…]]: no brackets, no bar, one line.
const plain = value => String(value ?? '').replace(/[[\]|\n]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Where a block is filed on the site when the person says nothing else: what its channel saved
 * (`site: { label, sublabel }` in its _channel.md), or else the channel's title or folder name.
 * `saved` says whether it came from the channel's file. A block at the top of the vault has none,
 * and goes under `other`.
 */
export function defaultLabel(vault, block) {
  const channel = vault.channels.find(each => each.path === block.home);
  if (channel?.site?.label) return { label: String(channel.site.label).trim(), sublabel: String(channel.site.sublabel ?? '').trim(), saved: true };
  return { label: channel?.title ?? block.home?.split('/').at(-1) ?? '', sublabel: '', saved: false };
}

/**
 * Where each published block is, by its record key, read from the journal: the last `published` of
 * each key, unless an `unpublished` came after it.
 */
export function publishedAddresses(events) {
  const at = new Map();
  for (const event of events) {
    if (event.via !== 'publish' || typeof event.key !== 'string') continue;
    if (event.op === 'published' && typeof event.address === 'string') at.set(event.key, event.address);
    else if (event.op === 'unpublished') at.delete(event.key);
  }
  return at;
}

/**
 * The post a block would be published as.
 *   files      the vault's Markdown, [{ path, text }]
 *   paths      every file in the vault folder; images are found among them
 *   path       the block's file
 *   read       (path) -> the bytes of a file in the vault. Only the images the block shows are read
 *   label, sublabel  where it is filed on the site; defaultLabel's when not given
 *   held       the record published under the block's key already, if any. It keeps its address,
 *              slug, label and date: an update never moves a post
 *   key        the record key to use when the block has no ID yet (the caller writes it into the file)
 *   addresses  publishedAddresses(journal), so a link to another published block links to its post
 *   did, site, collection  the person's account and website; without them the plan stops short of
 *              the record
 * Returns { key, slug, title, label, sublabel, labelSaved, attachments, files, notes, problems }, and
 * when it can be published, { record, form, address, confirm }. `confirm` names exactly what would be
 * written, the date aside, so a publish can insist on the plan the person saw.
 */
export async function blockPost({ files, paths, path, read, label, sublabel, held, key, addresses = new Map(), did, site, collection = POST }) {
  const vault = readVault(files);
  const block = vault.blocks.find(each => each.path === path) ?? refuse(`There is no block at ${path}.`);
  if (block.kind === 'post') refuse('This file is a post from your site. Posts are published by syncing with the vault service, not from here.');
  const find = blockResolver(vault);
  const all = new Set(paths);
  const notes = [];
  const problems = [];

  // A file the block shows, as a path in the vault: from the folder of the file that names it, then
  // from the top of the vault, then by its name alone when only one file has it.
  const fileAt = (address, from) => {
    let name;
    try { name = decodeURI(address.trim().replace(/^<|>$/g, '').split(/[?#]/)[0]); } catch { return null; }
    if (!name || /^[a-z][a-z0-9+.-]*:/i.test(name) || name.startsWith('/')) return null;
    const join = (folder, relative) => {
      const parts = [];
      for (const part of `${folder ? `${folder}/` : ''}${relative}`.split('/')) {
        if (part === '' || part === '.') continue;
        if (part === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(part);
      }
      return parts.join('/');
    };
    for (const candidate of [join(from, name), join('', name)]) if (candidate && all.has(candidate)) return candidate;
    const named = [...all].filter(each => each.split('/').at(-1) === name.split('/').at(-1));
    return named.length === 1 ? named[0] : null;
  };
  // Each file shown once, under an ID made from its name, as recordBody makes them.
  const attachments = [];
  const place = (alt, at) => {
    let held_ = attachments.find(each => each.path === at);
    if (!held_) {
      const base = slugOf(at.split('/').at(-1).replace(/\.[A-Za-z0-9]{1,5}$/, '')).slice(0, 56) || 'file';
      let id = base;
      for (let count = 2; attachments.some(each => each.id === id); count++) id = `${base}-${count}`;
      held_ = { id, path: at };
      attachments.push(held_);
    }
    return `![${plain(alt)}](media:${held_.id})`;
  };
  const missing = target => { problems.push(`It shows “${target}”, which is not a file in your home. Save it into your home first.`); return ''; };
  const ownAlt = block.kind === 'media' ? plain(block.properties.alt ?? block.title) : '';

  let body = outsideCode(block.body, part => part
    // ![[file.png]], ![[file.png|words]], and ![[another block]].
    .replace(/!\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g, (whole, target, alt) => {
      const name = target.trim();
      if (addressKind(name)) {
        const at = fileAt(name, folderOf(path));
        return at ? place(alt ?? ownAlt, at) : missing(name);
      }
      const shown = find(name);
      if (shown?.kind === 'media') {
        const file = /!\[\[([^\]|#\n]+)/.exec(shown.body)?.[1]?.trim();
        const at = file && fileAt(file, folderOf(shown.path));
        return at ? place(alt ?? shown.properties.alt ?? shown.title, at) : missing(file ?? name);
      }
      if (shown) notes.push(`It embeds “${shown.title ?? shown.slug}”, which is not an image: the post links to it instead.`);
      return whole.slice(1);
    })
    // ![words](file.png), the Markdown way, with the file named from this block's folder.
    .replace(/!\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|([^)\s]+))(?:\s+"[^"\n]*")?\s*\)/g, (whole, alt, angled, bare) => {
      const address = (angled ?? bare).trim();
      if (/^(?:media|data):/i.test(address)) return whole;
      if (/^[a-z][a-z0-9+.-]*:/i.test(address)) {
        problems.push(`It shows an image from ${address.split('/').slice(0, 3).join('/')}, which is not in your home. Save the image into your home first.`);
        return whole;
      }
      const at = fileAt(address, folderOf(path));
      return at ? place(alt, at) : missing(address);
    }));

  // Links to other blocks: to the post of one that is published, plain words otherwise.
  const linked = recordBody(body, {
    noteAddress: name => {
      const target = find(name);
      return target && target !== block && target.visibility === 'public' && target.id ? addresses.get(target.id) : undefined;
    },
  });
  body = linked.body;
  const words = [...new Set(linked.unknown)];
  if (words.length) notes.push(`${words.length === 1 ? `The link to “${words[0]}” becomes` : `${words.length} links become`} plain words: ${words.length === 1 ? 'it is' : 'they are'} not published.`);

  // The files themselves.
  const sent = new Map();
  const listed = [];
  for (const { id, path: at } of attachments) {
    const mime = FILE_TYPES[`.${at.split('.').at(-1).toLowerCase()}`];
    if (!mime) { problems.push(`${at} is not a kind of file a post can hold.`); continue; }
    const bytes = await read(at);
    if (!bytes?.length || bytes.length > MAX_FILE) { problems.push(`${at} must be a file of at most 60 MB.`); continue; }
    let size = null;
    if (mime.startsWith('image/')) { try { size = imageSize(bytes); } catch { size = null; } }
    sent.set(id, { bytes, mime, ...(size?.width && size?.height ? size : {}) });
    listed.push({ id, path: at, mime, size: bytes.length, cid: await blobCid(bytes) });
  }

  const recordKey = block.id ?? key;
  const fixed = held ? { label: held.label ?? '', sublabel: held.sublabel ?? '' } : null;
  const fallback = defaultLabel(vault, block);
  const chosen = fixed ?? {
    label: label === undefined ? fallback.label : String(label).trim(),
    sublabel: label === undefined && sublabel === undefined ? fallback.sublabel : String(sublabel ?? '').trim(),
  };
  const plan = {
    key: recordKey, slug: held?.slug ?? block.slug, ...(block.title ? { title: block.title } : {}),
    label: chosen.label, sublabel: chosen.sublabel,
    labelSaved: Boolean(fixed) || (fallback.saved && fallback.label === chosen.label && fallback.sublabel === chosen.sublabel),
    attachments: listed, files: sent, notes, problems,
  };
  if (problems.length || !did || !site) return plan;

  try {
    const { record, form } = assembleRecord({
      slug: plan.slug, body, title: block.title, label: chosen.label, sublabel: chosen.sublabel,
      ...(held?.publishedAt ? { publishedAt: held.publishedAt } : {}),
      kinds: listed.map(each => kindOf(each.mime)), facts: bodyFacts(body.trim()),
    }, { did, site, collection });
    if (held?.canonicalUrl) record.canonicalUrl = held.canonicalUrl;
    const { publishedAt: _, ...shape } = record;
    const confirm = await recordVersion({ update: Boolean(held), record: shape, files: listed.map(each => [each.id, each.cid]) });
    return { ...plan, record, form, address: record.canonicalUrl, confirm };
  } catch (problem) {
    if (!(problem instanceof VaultProblem)) throw problem;
    problems.push(...problem.message.split('\n'));
    return plan;
  }
}
