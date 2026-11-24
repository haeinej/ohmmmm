// The media cache: the bytes behind a member's media records, kept in ohm's R2 bucket.
//
// A picture, video or file in a vault is a block (kind `media`) that saves where the file is and
// what it is: its `origin` (a path in a folder the vault reads, or a web address), its `hash`, size,
// dimensions, type and alt text. The record is what is kept. The bytes are a cache, sent once so the
// cockpit can show them, and can always be sent again from where the record says the file is.
//
// - Public and friends-only media is sent readable, under its content address (`sha256-<hex>`); the
//   service checks the bytes match it, and can make smaller copies (renditions) to show.
// - Private media is sealed on the member's device first and sent under an opaque ID, like a
//   private block. The service keeps it and cannot open it; the device makes its own thumbnails,
//   sealed the same way, before sending.
// - Each member's media is kept apart, under their DID: no one learns what another has by sending
//   the same bytes.
//
// `bucket` has the shape of a Cloudflare R2 bucket; `images`, when given, of the Images binding.
import { Refused } from './store.mjs';

export const LARGEST_MEDIA = 25 * 1024 * 1024;
export const WIDTHS = [160, 480, 960, 1600];
const HASH = /^sha256-[0-9a-f]{64}$/;
const SEALED = /^[A-Za-z0-9_-]{16,64}$/;
const hex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');

export async function mediaHash(bytes) {
  return `sha256-${hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))}`;
}

const nameOf = given => {
  if (typeof given === 'string' && (HASH.test(given) || SEALED.test(given))) return given;
  throw new Refused(400, 'InvalidRequest', 'Name the media by its content address (sha256-<hex>) or, sealed, by its opaque ID');
};

export function mediaStore(bucket, images) {
  const usable = () => {
    if (!bucket) throw new Refused(503, 'MediaUnavailable', 'The media cache is not set up on this service');
    return bucket;
  };
  const key = (did, name, width) => `${did}/${name}${width ? `/w${width}` : ''}`;

  return {
    // Which of these the cache already holds, so a device sends only what is missing.
    async has(did, names) {
      const list = String(names ?? '').split(',').filter(Boolean);
      if (!list.length || list.length > 100) throw new Refused(400, 'InvalidRequest', 'Ask about 1 to 100 media at a time, separated by commas');
      const present = [];
      for (const name of list.map(nameOf)) if (await usable().head(key(did, name))) present.push(name);
      return { present };
    },

    async put(did, name, bytes, { type = 'application/octet-stream' } = {}) {
      nameOf(name);
      if (!bytes.byteLength || bytes.byteLength > LARGEST_MEDIA) throw new Refused(413, 'TooLarge', 'Media is sent whole, from 1 byte to 25 MB');
      const sealed = !HASH.test(name);
      if (!sealed && await mediaHash(bytes) !== name) throw new Refused(400, 'InvalidRequest', 'The bytes sent do not match the content address they were sent under');
      if (sealed && type !== 'application/octet-stream') throw new Refused(400, 'InvalidRequest', 'Sealed media is sent as application/octet-stream: its type is inside it');
      const held = await usable().head(key(did, name));
      if (held) return { name, size: held.size, unchanged: true };
      await usable().put(key(did, name), bytes, { httpMetadata: { contentType: sealed ? 'application/octet-stream' : type }, customMetadata: { sealed: String(sealed) } });
      return { name, size: bytes.byteLength };
    },

    async get(did, name) {
      const held = await usable().get(key(did, nameOf(name)));
      if (!held) throw new Refused(404, 'NotFound', 'The media cache does not hold that. Send it again from where its record says it is');
      return file(held);
    },

    // A smaller copy to show, made once and kept. Sealed media is never rendered here: the device
    // renders it after opening it. Without an image service, the original is answered.
    async rendition(did, name, width) {
      nameOf(name);
      const size = Number(width);
      if (!WIDTHS.includes(size)) throw new Refused(400, 'InvalidRequest', `A rendition is ${WIDTHS.join(', ')} pixels wide`);
      if (!HASH.test(name)) throw new Refused(400, 'InvalidRequest', 'Sealed media is rendered on the member\'s device');
      const kept = await usable().get(key(did, name, size));
      if (kept) return file(kept);
      const original = await usable().get(key(did, name));
      if (!original) throw new Refused(404, 'NotFound', 'The media cache does not hold that. Send it again from where its record says it is');
      if (!images || !original.httpMetadata?.contentType?.startsWith('image/')) return file(original);
      const made = await images.input(original.body).transform({ width: size, fit: 'scale-down' }).output({ format: 'image/webp' });
      const bytes = await made.response().arrayBuffer();
      await usable().put(key(did, name, size), bytes, { httpMetadata: { contentType: 'image/webp' } });
      return new Response(bytes, { headers: headers('image/webp') });
    },
  };
}

// Media is served on the app's own address, so what it holds must never run there: a sandbox with
// nothing allowed, and anything that is not a plain picture is a download, never a page.
const SHOWN = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);
const headers = type => ({
  'Content-Type': type, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
  ...(SHOWN.has(type.split(';')[0].trim().toLowerCase()) ? {} : { 'Content-Disposition': 'attachment' }),
});
const file = held => new Response(held.body, { headers: headers(held.httpMetadata?.contentType ?? 'application/octet-stream') });
