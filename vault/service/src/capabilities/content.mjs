// Content: what a member's website may show, read by the member's DID (../content.mjs). Public
// content is what they published on their PDS; Friends is added for a viewer they let in, proved
// by a viewer token (../viewers.mjs). Private content is never read here.
import { handBack } from '../viewers.mjs';
import { Refused } from '../store.mjs';

export default {
  name: 'Content',
  about: 'Content for sites, read by the member\'s DID: channels become collections and blocks become entries. Anyone gets what the member published to their PDS, and nothing before they publish it. A viewer the member put on their friend list, proved by a viewer token, also gets the friends layer. A viewer who is not a friend gets exactly what anyone gets. Private content is never read. Entries leave out where a file came from and who made it.',
  requests: {
    'com.ohmmmm.content.listChannels': {
      verb: 'GET', asks: 'viewer', changes: false,
      about: 'The member\'s channels that hold something the asker may see, or a channel inside one that does, each with its title, description, and an order naming only what the asker may see.',
      takes: { did: 'the member\'s DID' },
      gives: '`owner`, `channels` (path, title, description, order, count)',
      run: ({ content, audience }) => content.listChannels(audience),
    },
    'com.ohmmmm.content.getChannel': {
      verb: 'GET', asks: 'viewer', changes: false,
      about: 'One channel, as `listChannels` gives it. A channel with nothing the asker may see answers NotFound, as if it were not there.',
      takes: { did: 'the member\'s DID', path: 'the channel\'s path' },
      gives: '`owner`, `channel` (path, title, description, order, count)',
      run: ({ url, content, audience }) => content.getChannel(audience, url.searchParams.get('path')),
    },
    'com.ohmmmm.content.listBlocks': {
      verb: 'GET', asks: 'viewer', changes: false,
      about: 'What the asker may see, 200 entries at a time, without their bodies. With `channel`, only what is filed in it, in the channel\'s order first.',
      takes: { did: 'the member\'s DID', channel: 'optional: a channel\'s path', cursor: 'optional: the `cursor` of the page before' },
      gives: '`owner`, `blocks` (id, layer, kind, slug, channel, channels, title, tags, created, updated, media, and `address` for a published post), and `cursor` when there is another page',
      run: ({ url, content, audience }) => content.listBlocks(audience, { channel: url.searchParams.get('channel') ?? undefined, cursor: url.searchParams.get('cursor') ?? undefined }),
    },
    'com.ohmmmm.content.getBlock': {
      verb: 'GET', asks: 'viewer', changes: false,
      about: 'One entry with its Markdown body. Something the asker may not see answers NotFound, the same as something that is not there.',
      takes: { did: 'the member\'s DID', id: 'the entry\'s ID' },
      gives: '`owner`, `block`: as in `listBlocks`, with `body`',
      run: ({ url, content, audience }) => content.getBlock(audience, url.searchParams.get('id')),
    },
    'com.ohmmmm.content.getMedia': {
      verb: 'GET', asks: 'viewer', changes: false,
      about: 'The file behind a media entry the asker may see, or a smaller copy of a picture with `width`. It answers with the file itself, not JSON.',
      takes: { did: 'the member\'s DID', name: 'the entry\'s `media.name`', width: 'optional: 160, 480, 960 or 1600' },
      gives: 'The file, with its type',
      run: async ({ url, content, audience, media }) => {
        const name = url.searchParams.get('name');
        await content.mayShowMedia(audience, name);
        const width = url.searchParams.get('width');
        return width ? media.rendition(audience.owner, name, width) : media.get(audience.owner, name);
      },
    },
    'com.ohmmmm.content.view': {
      verb: 'GET', asks: 'nobody', changes: false,
      about: 'Where a site sends a viewer to be recognised. If they are signed in to ohm with an AT Protocol account connected, it posts a viewer token for this one member back to the return address, which must be one of the member\'s sites. Otherwise it posts back `error`. The token lasts ten minutes and proves only who the viewer is; Friends is checked against the friend list on every read.',
      takes: { owner: 'the member\'s DID', return: 'the address on one of the member\'s sites to post back to' },
      gives: 'A page that posts `viewer` (the token) and `expires`, or `error`, to the return address',
      run: async ({ url, env, sites, viewers }) => {
        const did = url.searchParams.get('owner');
        const returnTo = await sites.returnTo(did, url.searchParams.get('return'));
        const user = await viewers.signedIn();
        if (!user) return handBack(returnTo, { error: 'SignInRequired' });
        const viewer = await viewers.didOf(user.id);
        if (!viewer) return handBack(returnTo, { error: 'NotConnected' });
        const { token, expires } = await viewers.make(viewer, did);
        return handBack(returnTo, { viewer: token, expires });
      },
    },
    'com.ohmmmm.content.listSites': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'The member\'s own sites: the only addresses a viewer token is posted back to.',
      takes: {},
      gives: '`sites` (origin, added)',
      run: ({ sites, did }) => sites.list(did),
    },
    'com.ohmmmm.content.addSite': {
      verb: 'POST', asks: 'ohm', changes: true,
      about: 'Adds one of the member\'s sites, by its https origin, so viewers can be sent back to it with a viewer token. Only the member, signed in to ohm, can add one; an agent cannot.',
      takes: { origin: 'the site\'s https address' },
      gives: '`origin`, and `unchanged` when it was there already',
      run: async ({ body, sites, did }) => {
        if (!did) throw new Refused(409, 'NotConnected', 'Connect your AT Protocol account first');
        return sites.add(did, (await body()).origin);
      },
    },
    'com.ohmmmm.content.removeSite': {
      verb: 'POST', asks: 'member', changes: true,
      about: 'Stops sending viewer tokens to one of the member\'s sites. Tokens it already holds run out within ten minutes.',
      takes: { origin: 'the site\'s https address' },
      gives: '`origin`, `removed`, or `unchanged` when it was not there',
      run: async ({ body, sites, did }) => sites.remove(did, (await body()).origin),
    },
  },
};
