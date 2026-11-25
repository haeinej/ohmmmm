// Reading a site's HTML closely enough to give every piece of it back exactly. Two readings of the
// same text: a tree of elements with where each starts and ends, to find the things a page repeats;
// and a flat run of atoms, literal text and values, to find what changes from one repeated thing to
// the next. Neither is a browser's parser: they read hand-written and generated pages as they are,
// and every character of the input is accounted for.

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
// Elements whose content is not markup: it is one value, never read for tags.
const RAW = new Set(['script', 'style', 'textarea', 'title']);
const TAG = /<!--[\s\S]*?-->|<!(?:DOCTYPE|doctype)[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTR = /(\s+)([^\s=>/"']+)(?:(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', middot: '·' };
export const decode = text => String(text).replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (whole, dec, hex, name) =>
  dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : ENTITIES[name.toLowerCase()] ?? whole);
/** What some markup says, as one line of plain text. */
export const plainText = html => decode(String(html).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** The attributes of an opening tag's inside, by name. */
export function attributes(inside) {
  const found = {};
  for (const m of inside.matchAll(ATTR)) found[m[2].toLowerCase()] = m[4] ?? m[5] ?? m[6] ?? '';
  return found;
}

/**
 * A page as a tree of elements. Each element knows where it starts and ends in the page, so the
 * exact text of any one of them can be taken back out. A closing tag with no open element is let
 * be; an element never closed ends where its parent does.
 *   { name, attrs, start, end, inner: [start, end], children }
 */
export function parseTree(html) {
  const root = { name: '#root', attrs: {}, start: 0, end: html.length, inner: [0, html.length], children: [] };
  const stack = [root];
  TAG.lastIndex = 0;
  let m;
  while ((m = TAG.exec(html))) {
    if (!m[2]) continue; // a comment or a doctype
    const name = m[2].toLowerCase();
    if (m[1]) {
      const at = stack.map(el => el.name).lastIndexOf(name);
      if (at <= 0) continue;
      // The element closed here ends after its closing tag; any left open inside it end where it does.
      for (let i = stack.length - 1; i >= at; i--) {
        stack[i].end = i === at ? TAG.lastIndex : m.index;
        stack[i].inner[1] = m.index;
      }
      stack.length = at;
      continue;
    }
    const el = { name, attrs: attributes(m[3]), start: m.index, end: TAG.lastIndex, inner: [TAG.lastIndex, TAG.lastIndex], children: [] };
    stack.at(-1).children.push(el);
    if (VOID.has(name) || /\/\s*$/.test(m[3])) continue;
    if (RAW.has(name)) {
      const close = html.toLowerCase().indexOf(`</${name}`, TAG.lastIndex);
      const stop = close < 0 ? html.length : close;
      const after = close < 0 ? html.length : html.indexOf('>', close) + 1;
      el.inner = [TAG.lastIndex, stop];
      el.end = after;
      TAG.lastIndex = after;
      continue;
    }
    stack.push(el);
  }
  for (let i = stack.length - 1; i > 0; i--) { stack[i].end = html.length; stack[i].inner[1] = html.length; }
  return root;
}

/** Every element in a tree, depth first, each with the chain of elements it is inside. */
export function* walk(el, within = []) {
  for (const child of el.children) {
    yield { el: child, within };
    yield* walk(child, [...within, child]);
  }
}

export const firstClass = el => (el.attrs.class ?? '').trim().split(/\s+/)[0] ?? '';
/** How a page's own repeated things are told apart: the tag, and the first of its classes. */
export const signature = el => (firstClass(el) ? `${el.name}.${firstClass(el)}` : el.name);

/**
 * An element's markup as a run of atoms: literal text, and the values in it (every attribute value,
 * and the text between any two tags, even when that is nothing). Joined back in order, the atoms
 * are the markup, character for character. Each value is named by where it sits: `img@src` for an
 * attribute, `span.read-title#text` for the text inside an element.
 */
export function atomsOf(html) {
  const out = [];
  const stack = [];
  const lit = text => { if (!text) return; const last = out.at(-1); if (last && 'lit' in last) last.lit += text; else out.push({ lit: text }); };
  const where = () => { const top = stack.at(-1); return top ? `${top.name}${top.cls ? `.${top.cls}` : ''}#text` : '#text'; };
  TAG.lastIndex = 0;
  let at = 0, m;
  while ((m = TAG.exec(html))) {
    out.push({ val: html.slice(at, m.index), key: where() });
    at = TAG.lastIndex;
    if (!m[2]) { lit(m[0]); continue; }
    const name = m[2].toLowerCase();
    if (m[1]) {
      lit(m[0]);
      const open = stack.map(el => el.name).lastIndexOf(name);
      if (open >= 0) stack.length = open;
      continue;
    }
    // The opening tag, with each attribute's value taken out as a value of its own.
    lit(`<${m[2]}`);
    const inside = m[3];
    let read = 0;
    let cls = '';
    ATTR.lastIndex = 0;
    for (const a of inside.matchAll(ATTR)) {
      lit(inside.slice(read, a.index));
      const attr = a[2].toLowerCase();
      if (a[3] === undefined) lit(a[0]);
      else {
        const quote = a[4] !== undefined ? '"' : a[5] !== undefined ? "'" : '';
        const value = a[4] ?? a[5] ?? a[6];
        lit(`${a[1]}${a[2]}${a[3]}${quote}`);
        out.push({ val: value, key: `${name}@${attr}` });
        lit(quote);
        if (attr === 'class') cls = value.trim().split(/\s+/)[0] ?? '';
      }
      read = a.index + a[0].length;
    }
    lit(`${inside.slice(read)}>`);
    if (VOID.has(name) || /\/\s*$/.test(inside)) continue;
    if (RAW.has(name)) {
      const close = html.toLowerCase().indexOf(`</${name}`, at);
      const stop = close < 0 ? html.length : close;
      out.push({ val: html.slice(at, stop), key: `${name}#text` });
      at = stop;
      TAG.lastIndex = stop;
      continue;
    }
    stack.push({ name, cls });
  }
  out.push({ val: html.slice(at), key: where() });
  return out;
}

/** What makes two items the same shape: everything but their values, and where each value sits. */
export const shapeOf = atoms => atoms.map(a => ('lit' in a ? a.lit : `\u0000${a.key}\u0000`)).join('');

/**
 * The templates of a set of items. Items of one shape share a template: each value that is the same
 * in all of them is folded into the template, and each that changes is a field, named by where it
 * sits. Filled with an item's fields, its template gives the item back exactly.
 *   returns { shapes: [{ parts: [string | { field }], items: [index] }], fields: [{ key, distinct, samples }], items: [{ shape, fields }] }
 */
export function templatesOf(htmls) {
  const atoms = htmls.map(atomsOf);
  const byShape = new Map();
  atoms.forEach((run, index) => {
    const shape = shapeOf(run);
    if (!byShape.has(shape)) byShape.set(shape, []);
    byShape.get(shape).push(index);
  });
  const items = htmls.map(() => ({ shape: -1, fields: {} }));
  // Each shape's values, named by where they sit. Where one key appears twice in a shape, the
  // second is told apart by its place.
  const prepared = [...byShape.values()].map(members => {
    const first = atoms[members[0]];
    const seen = new Map();
    const names = first.map(a => {
      if ('lit' in a) return null;
      const n = (seen.get(a.key) ?? 0) + 1;
      seen.set(a.key, n);
      return n === 1 ? a.key : `${a.key}~${n}`;
    });
    return { members, first, names };
  });
  // A value is a field when it is not the same in every item that has it, in whatever shape: so a
  // place that only videos share is still each video's place, not part of the video's template.
  const values = new Map();
  for (const { members, first, names } of prepared) for (const m of members) first.forEach((a, i) => {
    if ('lit' in a) return;
    if (!values.has(names[i])) values.set(names[i], new Set());
    values.get(names[i]).add(atoms[m][i].val);
  });
  const isField = name => values.get(name).size > 1;
  const shapes = prepared.map(({ members, first, names }, shapeIndex) => {
    const parts = [];
    const push = part => { if (typeof part === 'string' && typeof parts.at(-1) === 'string') parts[parts.length - 1] += part; else if (part !== '') parts.push(part); };
    first.forEach((a, i) => push('lit' in a ? a.lit : isField(names[i]) ? { field: names[i] } : a.val));
    for (const m of members) {
      items[m].shape = shapeIndex;
      first.forEach((a, i) => { if ('val' in a && isField(names[i])) items[m].fields[names[i]] = atoms[m][i].val; });
    }
    return { parts, items: members };
  });
  const fields = [...values].filter(([name]) => isField(name)).map(([key, set]) => ({ key, values: set }));
  return {
    shapes, items,
    fields: fields.map(f => ({ key: f.key, distinct: f.values.size, samples: [...f.values].filter(v => v.trim()).slice(0, 3).map(v => v.trim().slice(0, 80)) })),
  };
}

/** A template filled with one item's fields. */
export const fill = (parts, fields) => parts.map(part => (typeof part === 'string' ? part : fields[part.field] ?? '')).join('');

/** Markup as it is compared: no comments, and every run of white space between or inside tags the same. */
export const normalised = html => String(html).replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
