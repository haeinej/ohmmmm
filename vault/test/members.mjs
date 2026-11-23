// Members of the vault service for tests: each proves who they are with tokens from their own PDS,
// signed as a PDS signs them, and the service checks them as it does in production. Every person
// here is invented.
import { secp256k1 } from '../service/node_modules/@noble/curves/secp256k1.js';
import { createIdentity, documentAddress } from '../service/src/identity.mjs';
import { createService } from '../service/src/worker.mjs';
import { testDatabase } from './d1.mjs';

export const audience = 'did:web:vault.ohmmmm.test';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const base58 = input => {
  let value = 0n;
  for (const byte of input) value = value * 256n + BigInt(byte);
  let text = '';
  for (; value > 0n; value /= 58n) text = ALPHABET[Number(value % 58n)] + text;
  return text;
};
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function account(did) {
  const secret = secp256k1.utils.randomPrivateKey();
  const document = { id: did, verificationMethod: [{ id: `${did}#atproto`, type: 'Multikey', controller: did,
    publicKeyMultibase: `z${base58(Uint8Array.from([0xe7, 0x01, ...secp256k1.getPublicKey(secret, true)]))}` }] };
  const token = async lxm => {
    const signed = `${encode({ typ: 'JWT', alg: 'ES256K' })}.${encode({ iss: did, aud: audience, lxm, exp: Math.floor(Date.now() / 1000) + 60 })}`;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signed)));
    return `${signed}.${Buffer.from(secp256k1.sign(digest, secret, { lowS: true }).toCompactRawBytes()).toString('base64url')}`;
  };
  return { did, document, token };
}

export async function running() {
  const haein = account('did:web:pds.haein.test'), jun = account('did:web:pds.jun.test'), mina = account('did:web:pds.mina.test');
  const stranger = account('did:web:pds.stranger.test');
  const documents = Object.fromEntries([haein, jun, mina, stranger].map(each => [documentAddress(each.did), each.document]));
  const whoIs = createIdentity({ audience, members: [haein, jun, mina].map(each => each.did).join(','), get: async url => Response.json(documents[String(url)]) });
  const env = { DB: await testDatabase(), MEMBERS: '*', SERVICE_DID: audience, OHM_APP_ORIGIN: 'https://app.ohmmmm.test' };
  const service = createService({ whoIs, get: async () => Response.json(null) });
  // `raw` sends bytes as they are ({ bytes, type }), and answers the Response itself.
  const ask = async (as, name, { query = {}, body, raw } = {}) => {
    // A bare name is a vault request; `cortex.getFile` names another group.
    const method = name.includes('.') ? `com.ohmmmm.${name}` : `com.ohmmmm.vault.${name}`;
    const url = new URL(`https://vault.ohmmmm.test/xrpc/${method}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const sending = raw ?? (body === undefined ? undefined : { bytes: JSON.stringify(body), type: 'application/json' });
    const response = await service(new Request(url, {
      method: sending === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${await as.token(method)}`, ...(sending === undefined ? {} : { 'Content-Type': sending.type }) },
      ...(sending === undefined ? {} : { body: sending.bytes }),
    }), env);
    if (raw || (response.ok && !response.headers.get('Content-Type')?.startsWith('application/json'))) return response;
    return { status: response.status, ...(await response.json()) };
  };
  return { haein, jun, mina, stranger, ask, env };
}

