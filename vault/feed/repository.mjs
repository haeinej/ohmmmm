// Checked public repository reads shared by Node commands and edge Workers. A full inventory
// ends only when the server omits its cursor; a bound or broken cursor is never partial success.
import { isRecordKey } from './pds.mjs';
import { CONTENT, DOCUMENT, fromDocument } from './standard.mjs';

// Posts are kept in a repository as standard.site documents. Asked for posts (`com.ohmmmm.post`),
// these read documents and give each as the post the vault reads, at the post's own address, so
// everything that reads posts reads them the same way it always has. A document another
// application wrote, whose content is not a post, is passed over.
const wire = collection => (collection === CONTENT ? DOCUMENT : collection);
const readPost = (record, did, collection) => {
  if (collection !== CONTENT) return record;
  const value = fromDocument(record.value, { did });
  return value && { ...record, uri: record.uri.replace(`at://${did}/${DOCUMENT}/`, `at://${did}/${CONTENT}/`), value };
};

// `raw` lists exactly the collection named, records as they are: for reading posts kept under
// `com.ohmmmm.post` itself, from before posts were documents.
export async function listRecords({ did, origin, collection, get = fetch, maxPages = 200, onResponse, raw = false }) {
  const stored = raw ? collection : wire(collection);
  const read = record => (raw ? record : readPost(record, did, collection));
  const url = new URL('/xrpc/com.atproto.repo.listRecords', origin);
  url.search = new URLSearchParams({ repo: did, collection: stored, limit: '100' });
  const records = new Map();
  const cursors = new Set();
  const prefix = `at://${did}/${stored}/`;
  for (let page = 0; page < maxPages; page++) {
    const response = await get(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
    await onResponse?.(response);
    if (!response.ok) throw new Error(`Listing ${collection} failed (HTTP ${response.status})`);
    const data = await response.json();
    if (!Array.isArray(data.records)) throw new Error('PDS returned an invalid record list');
    for (const record of data.records) {
      if (typeof record?.uri !== 'string' || !record.uri.startsWith(prefix)) continue;
      const key = record.uri.slice(prefix.length);
      const kept = isRecordKey(key) && read(record);
      if (kept) records.set(kept.uri, kept);
    }
    if (data.cursor === undefined || data.cursor === null) return { records: [...records.values()], pages: page + 1 };
    if (typeof data.cursor !== 'string' || !data.cursor || cursors.has(data.cursor)) throw new Error('PDS returned an invalid cursor');
    cursors.add(data.cursor);
    url.searchParams.set('cursor', data.cursor);
  }
  throw new Error(`${collection} exceeds the ${maxPages}-page read limit; inventory is incomplete`);
}

export async function recordByKey(pds, key, get = fetch) {
  const url = new URL('/xrpc/com.atproto.repo.getRecord', pds.origin);
  url.search = new URLSearchParams({ repo: pds.did, collection: wire(pds.collection), rkey: key });
  const response = await get(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  const data = response.status === 404 ? {} : await response.json();
  if (response.status === 404 || (response.status === 400 && data.error === 'RecordNotFound')) return null;
  if (!response.ok) throw new Error(`Reading the post failed (HTTP ${response.status})`);
  if (data.uri !== `at://${pds.did}/${wire(pds.collection)}/${key}` || !data.value || typeof data.value !== 'object' || Array.isArray(data.value)) throw new Error('PDS returned an invalid post');
  const read = readPost(data, pds.did, pds.collection);
  return read ? { ...read, key } : null;
}

// A slug is mutable and is not a repository key. Search a complete bounded owner/collection
// inventory, refusing ambiguity and incompleteness rather than using a stale snapshot as proof.
export async function recordBySlug(pds, slug, get = fetch) {
  const { records } = await listRecords({ ...pds, get, maxPages: 48 });
  const matches = records.filter(({ uri, value }) => value?.$type === pds.collection &&
    (value.slug ?? uri.split('/').at(-1)) === slug);
  if (matches.length > 1) throw new Error(`More than one post uses the slug "${slug}"; resolve the duplicate before continuing`);
  const match = matches[0];
  return match ? { ...match, key: match.uri.split('/').at(-1) } : null;
}
