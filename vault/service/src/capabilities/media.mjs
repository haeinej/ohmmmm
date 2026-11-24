// Media: the bytes behind media records, cached for the cockpit (../media.mjs). The record, a block
// of kind `media` with its path and metadata, is kept with the blocks of its layer; only the bytes
// are here.
import { LARGEST_MEDIA } from '../media.mjs';
import { Refused } from '../store.mjs';

export default {
  name: 'Media',
  about: 'The media cache. A picture or file in a vault is a block that saves where the file is and what it is; its bytes are sent here once, so the cockpit can show them, and can always be sent again. Public and friends-only media is sent readable under its content address and can be shown smaller; private media is sealed on the member\'s device first and never rendered here. Nothing here is published: publishing sends a copy to the member\'s PDS.',
  requests: {
    'com.ohmmmm.media.hasMedia': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'Which of the named media the cache already holds, so a device sends only what is missing.',
      takes: { names: 'up to 100 content addresses or sealed IDs, separated by commas' },
      gives: '`present`, the names held',
      run: ({ url, media, did }) => media.has(did, url.searchParams.get('names')),
    },
    'com.ohmmmm.media.putMedia': {
      verb: 'POST', asks: 'member', changes: true,
      about: 'Sends one file\'s bytes, whole, as the request body (not JSON), up to 25 MB. Readable media is named by its content address, which the bytes must match; sealed media by its opaque ID, as `application/octet-stream`. Sent again, it changes nothing.',
      takes: { name: 'in the address: its content address (sha256-<hex>) or sealed ID', body: 'the bytes, with their type as Content-Type' },
      gives: '`name`, `size`, and `unchanged` when it was held already',
      run: async ({ url, request, media, did }) => {
        const length = Number(request.headers.get('Content-Length') ?? 0);
        if (length > LARGEST_MEDIA) throw new Refused(413, 'TooLarge', 'Media is sent whole, from 1 byte to 25 MB');
        const type = (request.headers.get('Content-Type') ?? 'application/octet-stream').split(';')[0].trim();
        return media.put(did, url.searchParams.get('name'), await request.arrayBuffer(), { type });
      },
    },
    'com.ohmmmm.media.getMedia': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'One file\'s bytes, as they were sent. It answers with the file itself, not JSON.',
      takes: { name: 'its content address or sealed ID' },
      gives: 'The file, with its type',
      run: ({ url, media, did }) => media.get(did, url.searchParams.get('name')),
    },
    'com.ohmmmm.media.getRendition': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'A smaller copy of a readable picture to show, 160, 480, 960 or 1600 pixels wide, made once and kept. Sealed media is refused: the device renders it.',
      takes: { name: 'its content address', width: '160, 480, 960 or 1600' },
      gives: 'The picture, with its type',
      run: ({ url, media, did }) => media.rendition(did, url.searchParams.get('name'), url.searchParams.get('width')),
    },
  },
};
