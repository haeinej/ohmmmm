// Test helpers for posts on the wire: a fake PDS keeps posts as standard.site documents
// (feed/standard.mjs), so fixtures written as post records are wrapped on the way out and written
// documents are read back as posts to be asserted on.
import { CONTENT, DOCUMENT, fromDocument, PUBLICATION, PUBLICATION_KEY, toDocument } from '../feed/standard.mjs';

export { CONTENT, DOCUMENT, PUBLICATION, PUBLICATION_KEY, fromDocument, toDocument };

// A post record as the PDS would hold it, when asked for `collection`: a document when documents are
// asked for, and as it is otherwise.
export const served = (collection, record, { did, site }) => (collection === DOCUMENT ? toDocument(record, { did, site }) : record);

// A written value read back as the post it holds; a value that is not a document is returned as is.
export const asPost = (value, { did }) => (value?.$type === DOCUMENT ? fromDocument(value, { did }) : value);

// The answer a PDS gives for a missing record.
export const notFound = () => Response.json({ error: 'RecordNotFound', message: 'Could not locate record' }, { status: 400 });

// Whether a request is for the member's publication record.
export const isPublication = (collection, rkey) => collection === PUBLICATION && (rkey === undefined || rkey === PUBLICATION_KEY);

// A listed record `{ uri, value }` written as a post at its post address, as the PDS holds it now:
// a document at the document address. A record of any other type is left as it is.
export function onWire({ uri, value, ...rest }, { site = 'https://example.test' } = {}) {
  const post = /^at:\/\/([^/]+)\/com\.ohmmmm\.post\/([^/]+)$/.exec(uri);
  if (!post || value?.$type !== CONTENT) return { uri, value, ...rest };
  return { ...rest, uri: `at://${post[1]}/${DOCUMENT}/${post[2]}`, value: toDocument(value, { did: post[1], site }) };
}
