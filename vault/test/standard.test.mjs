// Posts on the wire as standard.site documents: the wrapping itself, and what the website says about it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POST } from '../feed/pds.mjs';
import worker, { servePost } from '../feed/worker.mjs';
import { CONTENT, DOCUMENT, fromDocument, PUBLICATION, PUBLICATION_KEY, toDocument } from '../feed/standard.mjs';

const did = 'did:web:pds.example.test';
const other = 'did:web:other.test';
const site = 'https://example.test';

test('a post goes out as a document and comes back the same post, its own links following it', () => {
  const titled = {
    $type: POST, title: 'Trap', subtitle: 'On collisions', slug: 'trap', label: 'Writings', sublabel: 'Collisions', form: 'writing',
    body: `Words, after [the earlier one](at://${did}/${POST}/earlier) and [theirs](at://${other}/${POST}/theirs).`,
    connect: [`at://${did}/${POST}/earlier`, 'https://example.org/a', `at://${other}/${POST}/theirs`],
    canonicalUrl: `${site}/posts/writings/collisions/trap`,
    publishedAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-03-02T00:00:00.000Z',
    media: [{ $type: `${POST}#image`, id: 'a', file: { $type: 'blob', ref: { $link: 'bafkimage' }, mimeType: 'image/png', size: 7 } }],
  };
  const document = toDocument(titled, { did, site });
  // What every reader understands is on the document; the post as ohm keeps it is the content.
  assert.deepEqual({ ...document, content: undefined }, {
    $type: DOCUMENT, site: `at://${did}/${PUBLICATION}/${PUBLICATION_KEY}`, path: '/posts/writings/collisions/trap',
    title: 'Trap', description: 'On collisions', textContent: 'Words, after the earlier one and theirs.',
    tags: ['Writings', 'Collisions'], publishedAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-03-02T00:00:00.000Z', content: undefined,
  });
  assert.equal(document.content.$type, CONTENT);
  for (const field of ['title', 'publishedAt', 'updatedAt']) assert.equal(field in document.content, false, field);
  // The member's own links name the document; anyone else's are left as they are.
  assert.equal(document.content.body, `Words, after [the earlier one](at://${did}/${DOCUMENT}/earlier) and [theirs](at://${other}/${POST}/theirs).`);
  assert.deepEqual(document.content.connect, [`at://${did}/${DOCUMENT}/earlier`, 'https://example.org/a', `at://${other}/${POST}/theirs`]);
  assert.deepEqual(document.content.media, titled.media);
  assert.deepEqual(fromDocument(document, { did }), titled);

  // A post without a title is titled by its first words on the way out, and has none on the way back.
  const untitled = { $type: POST, body: '**Rain** again,\n\nand more.', canonicalUrl: `${site}/posts/other/rain`, slug: 'rain', form: 'note', publishedAt: '2026-04-01T00:00:00.000Z' };
  const quiet = toDocument(untitled, { did, site });
  assert.deepEqual([quiet.title, quiet.content.untitled, quiet.textContent, 'tags' in quiet, 'description' in quiet], ['Rain again,', true, 'Rain again,\n\nand more.', false, false]);
  assert.deepEqual(fromDocument(quiet, { did }), untitled);
  // A page outside the website has no path under its publication.
  assert.equal('path' in toDocument({ ...untitled, canonicalUrl: 'https://elsewhere.test/rain' }, { did, site }), false);

  // A document another application wrote is not a post.
  assert.equal(fromDocument({ ...document, content: { $type: 'com.example.article', text: 'Not ours.' } }, { did }), null);
  assert.equal(fromDocument({ ...document, content: undefined }, { did }), null);
  assert.equal(fromDocument({ ...titled }, { did }), null);
});

test('the website names its publication, and each post page names its document', async () => {
  const config = { ATPROTO_DID: did, ATPROTO_PDS_ORIGIN: 'https://pds.example.test' };
  const named = await worker.fetch(new Request(`${site}/.well-known/site.standard.publication`), config);
  assert.deepEqual([named.status, named.headers.get('Content-Type'), await named.text()], [200, 'text/plain', `at://${did}/${PUBLICATION}/${PUBLICATION_KEY}`]);
  // Without a DID of its own, the website names no publication.
  assert.equal((await worker.fetch(new Request(`${site}/.well-known/site.standard.publication`), {})).status, 404);

  const record = { $type: POST, title: 'Hello', slug: 'hello', label: 'Writings', form: 'writing', body: 'Words.', canonicalUrl: `${site}/posts/writings/hello`, publishedAt: '2026-01-01T00:00:00.000Z' };
  const key = '3aaaaaaaaaaaa';
  const get = async url => {
    assert.equal(url.searchParams.get('collection'), DOCUMENT);
    const held = { uri: `at://${did}/${DOCUMENT}/${key}`, value: toDocument(record, { did, site }) };
    return Response.json(url.pathname.endsWith('listRecords') ? { records: [held] } : held);
  };
  const page = await servePost(new Request(`${site}/posts/writings/hello`), config, 'hello', get);
  assert.equal(page.status, 200);
  const html = await page.text();
  const address = `at://${did}/${DOCUMENT}/${key}`.replace(/[.:/]/g, '\\$&');
  assert.match(html, new RegExp(`<link rel="alternate" href="${address}">`));
  assert.match(html, new RegExp(`<link rel="site\\.standard\\.document" href="${address}">`));
  assert.doesNotMatch(html, /com\.ohmmmm\.post\//);
});
