// Posts on the wire, as standard.site documents (https://standard.site).
//
// Inside the vault a post keeps its own shape: title, body, label, sublabel, form, what it connects
// to, its media. In the member's repository it is a `site.standard.document`, the long-form record
// other AT Protocol applications already read. The document holds what every reader understands
// (title, dates, where it is, plain text, tags), and its `content` holds the post as ohm keeps it,
// as an object of type `com.ohmmmm.post`. So media items keep their types (`com.ohmmmm.post#image`)
// and nothing about a post is lost on the way out and back.
//
// A document belongs to a publication, the member's website: `site.standard.publication` under the
// key `self`. Links between the member's own posts are written with the document's address on the
// way out and read back on the way in; links to anyone else's records are left as they are.
import { OTHER } from './forms.mjs';

export const DOCUMENT = 'site.standard.document';
export const PUBLICATION = 'site.standard.publication';
// The content type inside a document. It was the record type of a post before posts were documents.
export const CONTENT = 'com.ohmmmm.post';
export const PUBLICATION_KEY = 'self';

const TITLE_MOST = 500;
const DESCRIPTION_MOST = 3000;
const TAG_MOST = 128;

export const publicationUri = did => `at://${did}/${PUBLICATION}/${PUBLICATION_KEY}`;
// The publication's address has no trailing slash, as standard.site asks.
export const publicationUrl = site => new URL(site).origin + new URL(site).pathname.replace(/\/+$/, '');

// Change the collection in the member's own at:// addresses, in a body or a list of addresses.
const ownAddresses = (did, from, to) => {
  const prefix = `at://${did}/${from}/`;
  const replace = text => (typeof text === 'string' ? text.replaceAll(prefix, `at://${did}/${to}/`) : text);
  return value => (Array.isArray(value) ? value.map(replace) : replace(value));
};

const cut = (text, most) => {
  const parts = [...new Intl.Segmenter().segment(text)].map(part => part.segment);
  return parts.length > most ? `${parts.slice(0, most - 1).join('').trimEnd()}…` : text;
};

// The words of a Markdown body, for readers that show plain text.
export function plainText(markdown = '') {
  return markdown
    .replace(/```[\s\S]*?```/g, block => block.replace(/```[^\n]*\n?/g, ''))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\^[^\]]+\](?!:)/g, '')
    .replace(/^\[\^[^\]]+\]:\s*/gm, '')
    .replace(/\[([^\]]*)\]\((?:<[^>]*>|[^)]*)\)/g, '$1')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/gm, '')
    .replace(/(\*\*|__|\*|_|~~|`)(?=\S)([^\n]*?\S)\1/g, '$2')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// A document needs a title. A post without one is titled by its first words, and says so, so the
// title comes back off when the post is read.
function titleOf(record) {
  if (typeof record.title === 'string' && record.title.trim()) return { title: cut(record.title.trim(), TITLE_MOST) };
  const first = plainText(record.body ?? '').split('\n').find(line => line.trim());
  return { title: cut((first ?? record.slug ?? 'Untitled').trim(), 80), untitled: true };
}

// The post a member's vault publishes, as the document written to their repository.
//   record  a post record, as vault/file.mjs postRecord makes it
//   did     the member's DID
//   site    their website's address, which their publication names
export function toDocument(record, { did, site }) {
  const { $type, title: _title, publishedAt, updatedAt, ...kept } = record;
  const own = ownAddresses(did, CONTENT, DOCUMENT);
  const { title, untitled } = titleOf(record);
  const content = { $type: CONTENT, ...kept, ...(untitled ? { untitled: true } : {}) };
  if (content.body !== undefined) content.body = own(content.body);
  if (content.connect !== undefined) content.connect = own(content.connect);
  let path;
  // The path is the post's address under the publication: the site's, or else its own origin.
  if (record.canonicalUrl && URL.canParse(record.canonicalUrl)) {
    const at = new URL(record.canonicalUrl), base = publicationUrl(site ?? at.origin);
    if (at.href.startsWith(`${base}/`)) path = at.href.slice(base.length);
  }
  const tags = [...new Set([record.label, record.sublabel].filter(tag => typeof tag === 'string' && tag.trim() && tag !== OTHER)
    .map(tag => cut(tag.trim().replace(/^#+/, ''), TAG_MOST)))];
  const text = plainText(record.body ?? '');
  return {
    $type: DOCUMENT,
    site: publicationUri(did),
    ...(path ? { path } : {}),
    title,
    ...(record.subtitle ? { description: cut(record.subtitle, DESCRIPTION_MOST) } : {}),
    ...(text ? { textContent: text } : {}),
    ...(tags.length ? { tags } : {}),
    publishedAt,
    ...(updatedAt ? { updatedAt } : {}),
    content,
  };
}

// A document from a member's repository, as the post record the vault reads. A document written by
// another application, whose content is not ohm's, is not read as a post and gives null.
export function fromDocument(document, { did }) {
  if (!document || document.$type !== DOCUMENT || document.content?.$type !== CONTENT) return null;
  const { $type, untitled, ...kept } = document.content;
  const own = ownAddresses(did, DOCUMENT, CONTENT);
  const record = { $type: CONTENT, ...(untitled ? {} : { title: document.title }), ...kept };
  if (record.body !== undefined) record.body = own(record.body);
  if (record.connect !== undefined) record.connect = own(record.connect);
  if (document.publishedAt !== undefined) record.publishedAt = document.publishedAt;
  if (document.updatedAt !== undefined) record.updatedAt = document.updatedAt;
  return record;
}

// The member's publication: their website, as standard.site names one.
export function publicationRecord({ site, name, description }) {
  const url = publicationUrl(site);
  return {
    $type: PUBLICATION,
    url,
    name: cut(String(name || new URL(url).host), TITLE_MOST),
    ...(description ? { description: cut(description, DESCRIPTION_MOST) } : {}),
  };
}

// A post's address in the repository, as a document.
export const documentUri = (did, key) => `at://${did}/${DOCUMENT}/${key}`;
// A post's address as the vault reads it, as the document it is kept as.
export const asDocumentUri = uri => (typeof uri === 'string' ? uri.replace(/^(at:\/\/[^/]+)\/com\.ohmmmm\.post\//, `$1/${DOCUMENT}/`) : uri);
