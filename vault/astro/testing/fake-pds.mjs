import { createServer } from 'node:http';
import { once } from 'node:events';
import { CONTENT, DOCUMENT, toDocument } from '../../feed/standard.mjs';

export const did = 'did:web:alice.example.com';
export const cid = 'b' + 'a'.repeat(40);
export function document(key, fields = {}) {
  return {
    uri: `at://${did}/${DOCUMENT}/${key}`,
    cid: `cid-${key}`,
    value: toDocument({
      $type: CONTENT,
      title: 'A walk',
      body: 'A **quiet** walk. ![Tree](media:tree)',
      publishedAt: '2026-01-02T03:04:05Z',
      canonicalUrl: `https://alice.example.com/posts/essays/${key}`,
      slug: key,
      label: 'essays',
      media: [{
        $type: `${CONTENT}#image`, id: 'tree', alt: 'A green tree',
        file: { $type: 'blob', ref: { $link: cid }, mimeType: 'image/png', size: 68 },
      }],
      ...fields,
    }, { did, site: 'https://alice.example.com' }),
  };
}

export async function fakePds(t, handler) {
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    requests.push({ url, method: request.method });
    const result = handler(url);
    response.writeHead(result.status ?? 200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(result.body ?? result));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return { origin: `http://127.0.0.1:${server.address().port}`, requests };
}
