// Test helpers for sealed files, shared by the private layer's and the cortex's tests.
export const b64 = bytes => Buffer.from(bytes).toString('base64url');
export const opaque = () => b64(crypto.getRandomValues(new Uint8Array(16)));

// A sealed file as packages/keys makes one, with a master key per generation held only by this test.
export async function sealer(context_ = 'ohm-vault/file/v1') {
  const masters = new Map();
  const masterOf = async generation => {
    if (!masters.has(generation)) masters.set(generation, await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
    return masters.get(generation);
  };
  const context = (did, id, part) => new TextEncoder().encode(`${context_}|${did}|${id}|${part}`);
  const seal = async (key, plain, aad) => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    return { iv: b64(iv), ciphertext: b64(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plain))) };
  };
  const open = async (key, part, aad) => new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(part.iv, 'base64url'), additionalData: aad }, key, Buffer.from(part.ciphertext, 'base64url')));
  const tagged = (generation, body) => ({ v: 1, alg: 'A256GCM', ...(generation === 1 ? {} : { generation }), ...body });
  return {
    async seal(did, id, text, generation = 1) {
      const raw = crypto.getRandomValues(new Uint8Array(32));
      const fileKey = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
      return tagged(generation, { key: await seal(await masterOf(generation), raw, context(did, id, 'key')), data: await seal(fileKey, new TextEncoder().encode(text), context(did, id, 'data')) });
    },
    // The same contents with the file key re-wrapped under another generation, as rotation does.
    async rewrap(did, id, sealed, generation) {
      const raw = await open(await masterOf(sealed.generation ?? 1), sealed.key, context(did, id, 'key'));
      return tagged(generation, { key: await seal(await masterOf(generation), raw, context(did, id, 'key')), data: sealed.data });
    },
    async open(did, id, sealed) {
      const raw = await open(await masterOf(sealed.generation ?? 1), sealed.key, context(did, id, 'key'));
      return new TextDecoder().decode(await open(await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']), sealed.data, context(did, id, 'data')));
    },
  };
}
