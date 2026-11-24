// Where a member's things are: the PDS their own DID document names, and their website.
import { isRecordKey, webUrl } from '../../feed/pds.mjs';
import { DOCUMENT, fromDocument } from '../../feed/standard.mjs';
import { findAccount } from './identity.mjs';
import { Refused } from './store.mjs';

// Nothing has to be told: the website is the one the member's handle names. `site` says it
// outright, when it is somewhere else.
export async function whereabouts({ get, identify, did }, { site } = {}) {
  const pds = await identify.pdsFor?.(did);
  if (!pds) throw new Refused(400, 'NoRepository', 'Your DID document does not say where your repository is kept');
  const handle = site === undefined ? (await findAccount(did, { get }).catch(() => null))?.handle : null;
  const origin = webUrl(site ?? (handle ? `https://${handle}` : pds));
  if (!origin || !origin.startsWith('https://')) throw new Refused(400, 'InvalidRequest', 'Say where your website is, as an https address');
  return { pds, site: origin };
}

// Every record of one type in a member's repository, by its key. A repository's records are
// public, so reading them needs no credential. Posts are kept as standard.site documents: asked
// for documents, this gives each as the post inside it, passing over documents another
// application wrote. Any other type, `com.ohmmmm.post` from before included, is given as it is.
export async function published(get, pds, did, collection) {
  const posts = collection === DOCUMENT;
  const records = new Map();
  const prefix = `at://${did}/${collection}/`;
  let cursor;
  const cursors = new Set();
  const incomplete = () => { throw new Refused(502, 'RepositoryUnreachable', 'Your PDS did not return a complete, valid repository listing'); };
  for (let page = 0; page < 50; page++) {
    const url = new URL('/xrpc/com.atproto.repo.listRecords', pds);
    url.search = new URLSearchParams({ repo: did, collection, limit: '100', ...(cursor ? { cursor } : {}) });
    // A redirect is not followed: the answer has to come from the address that was asked.
    const response = await get(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Refused(502, 'RepositoryUnreachable', `Your PDS would not list ${collection} (HTTP ${response.status})`);
    const data = await response.json().catch(incomplete);
    if (!data || !Array.isArray(data.records)) incomplete();
    for (const record of data.records) {
      if (!record || typeof record.uri !== 'string' || !record.uri.startsWith(prefix) || !isRecordKey(record.uri.slice(prefix.length)) || !record.value || typeof record.value !== 'object' || Array.isArray(record.value)) incomplete();
      const key = record.uri.slice(prefix.length);
      if (records.has(key)) incomplete();
      const value = posts ? fromDocument(record.value, { did }) : record.value;
      if (value) records.set(key, value);
    }
    if (data.cursor === undefined || data.cursor === null || data.cursor === '') return records;
    if (typeof data.cursor !== 'string' || cursors.has(data.cursor) || page === 49) incomplete();
    cursors.add(data.cursor);
    cursor = data.cursor;
  }
  return records;
}
