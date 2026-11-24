// Friends: the member's friends layer. Their friends-only blocks other than posts (friends-only
// posts are kept with the Posts requests), who their friends are, and what a friend may read.
// The service can read everything in this layer, so it can show it to those friends; private blocks
// are never sent here; they are kept as ciphertext by the Private requests (plans/encryption.md).
import { sendInvite } from '../mail.mjs';
import { Refused } from '../store.mjs';

export default {
  name: 'Friends',
  about: 'The friends layer: friends-only blocks, kept readable so the friends a member chose can read them, and the friend list that says who they are. A friend reads friends-only posts and blocks alike. Private blocks are never kept here.',
  requests: {
    'com.ohmmmm.vault.listBlocks': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'Every friends-only block that is not a post, with the version it is at. With `since`, a point an earlier list returned, only what changed after it, removals included.',
      takes: { since: 'optional: the `cursor` of an earlier list' },
      gives: '`blocks` (id, version, path, kind, title), `cursor`, and `more` when there is another page',
      run: ({ url, blocks, did }) => blocks.list(did, { since: url.searchParams.get('since') ?? undefined }),
    },
    'com.ohmmmm.vault.getBlock': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'One friends-only block, as the file it is in the member\'s folder, and its version.',
      takes: { id: 'the block\'s ID' },
      gives: '`block` (id, path, text), `version`',
      run: ({ url, blocks, did }) => blocks.read(did, url.searchParams.get('id')),
    },
    'com.ohmmmm.vault.putBlock': {
      verb: 'POST', asks: 'member', changes: true,
      about: 'Saves one friends-only block, as its file: its path in the folder and its text, which must say `visibility: friends`. A private or public block, or a post, is refused. `replaces` is the version being replaced and is left out for a new block. Sent twice, it ends the same as sent once. From then on the friends on the list can read it.',
      takes: { block: '`id`, `path` and `text`', replaces: 'optional: the version it replaces' },
      gives: '`id`, `version`, and `unchanged` when nothing differed',
      run: async ({ body, blocks, did }) => {
        const { block, replaces = null } = await body();
        return blocks.write(did, block, { replaces });
      },
    },
    'com.ohmmmm.vault.deleteBlock': {
      verb: 'POST', asks: 'member', changes: true,
      about: 'Removes one friends-only block from this layer, for good. Friends can no longer read it.',
      takes: { id: 'the block\'s ID', replaces: 'the version being removed' },
      gives: '`id`, `removed`',
      run: async ({ body, blocks, did }) => {
        const { id, replaces = null } = await body();
        return blocks.remove(did, id, { replaces });
      },
    },
    'com.ohmmmm.vault.listFriends': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'Who may read the member\'s friends layer.',
      takes: {},
      gives: '`friends` (did, added, channels: `*` or a list, name, email)',
      run: async ({ blocks, linked, did }) => {
        // A friend added before names were kept is named from their ohm account, as it says now.
        const { friends } = await blocks.friends(did);
        const known = await linked.people(friends.filter(each => !each.name || !each.email).map(each => each.did));
        return { friends: friends.map(each => ({ ...known.get(each.did), ...each })) };
      },
    },
    'com.ohmmmm.vault.addFriend': {
      verb: 'POST', asks: 'ohm', changes: true,
      about: 'Lets one more DID read the member\'s friends layer: every friends-only post and block, now and later. Only the member, signed in to ohm, can add a friend; an agent cannot.',
      takes: { did: 'the friend\'s DID' },
      gives: '`did`, and `unchanged` when they were a friend already',
      run: async ({ body, blocks, did }) => blocks.addFriend(did, (await body()).did),
    },
    'com.ohmmmm.vault.removeFriend': {
      verb: 'POST', asks: 'member', changes: true,
      about: 'Stops one DID reading the member\'s friends layer. What they read before cannot be taken back.',
      takes: { did: 'the friend\'s DID' },
      gives: '`did`, `removed`, and `unchanged` when they were not a friend',
      run: async ({ body, blocks, did }) => blocks.removeFriend(did, (await body()).did),
    },
    'com.ohmmmm.vault.askFriend': {
      verb: 'POST', asks: 'member', changes: true,
      about: 'A member asks someone to be their friend, by the email of that person\'s ohm account or by their DID: signed in to ohm, or through their agent with a token from their own PDS, once their ohm account is connected and has signed in here. Asked by email, ohm also emails them an invite once, from its own address with the asker\'s name, replies going to the asker\'s email (at most 20 a day for each asker). The member sees the asker\'s name and email from their ohm account, and their DID, and answers in the cockpit. The answer is the same whether or not the email has an ohm account, whether asked once or again, and whether or not they already let the asker in.',
      takes: { email: 'the email of the person asked', owner: 'or: their DID', message: 'optional: a line for them' },
      gives: '`asked`',
      run: async ({ body, friendships, linked, did, user, env }) => {
        if (!did) throw new Refused(409, 'NotConnected', 'Connect your AT Protocol account first');
        // The person asked sees who is asking by their ohm account. An agent's token carries no ohm
        // session, so the name and email are the ones that account last signed in with.
        const asker = user ?? [(await linked.people([did])).get(did)].find(known => known?.email)
          ?? (() => { throw new Refused(409, 'NotConnected', 'Sign in to ohm once with this account, so the people you ask can see who you are'); })();
        const { owner, email, message } = await body();
        if (email !== undefined) {
          const link = env.OHM_APP_ORIGIN ? new URL('/', env.OHM_APP_ORIGIN).href : null;
          return friendships.askByEmail({
            viewer: did, email, name: asker.name, ownEmail: asker.email, message, didByEmail: linked.didByEmail,
            mail: link ? invite => sendInvite(env, { ...invite, link }) : null,
          });
        }
        return friendships.ask(owner, { viewer: did, name: asker.name, email: asker.email, message });
      },
    },
    'com.ohmmmm.vault.listAsked': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'Who the member asked to be friends with, by the email they typed, newest first: `waiting` until that person lets them in, then `friends`. An email with no ohm account, and a request declined, both stay waiting.',
      takes: {},
      gives: '`asks` (email, asked, state, and `did` once friends)',
      run: ({ friendships, linked, did }) => friendships.asked(did, { didByEmail: linked.didByEmail }),
    },
    'com.ohmmmm.vault.listFriendOf': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'The people who let the member into their friends layer, with their name and email from their ohm account: whose shared blocks the member reads with listShared and getShared.',
      takes: {},
      gives: '`people` (did, since, name, email)',
      run: async ({ friendships, linked, did }) => {
        const people = await friendships.friendOf(did);
        const known = await linked.people(people.map(each => each.did));
        return { people: people.map(each => ({ ...each, ...known.get(each.did) })) };
      },
    },
    'com.ohmmmm.vault.listFriendRequests': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'Who has asked to be the member\'s friend and is waiting for an answer, oldest first.',
      takes: {},
      gives: '`requests` (id, did, name, email, message, asked, state)',
      run: ({ friendships, did }) => friendships.requests(did),
    },
    'com.ohmmmm.vault.approveFriend': {
      verb: 'POST', asks: 'ohm', changes: true,
      about: 'The member lets someone who asked into their friends layer, for every channel (`*`, the default) or only the channels named, each covering the channels inside it. It lasts until the member removes them. Only the member, signed in to ohm, approves; an agent cannot. The friend\'s own agents read with the friend\'s access.',
      takes: { id: 'the request\'s ID', channels: 'optional: `*`, or a list of channel paths' },
      gives: '`did`, `channels`',
      run: async ({ body, friendships, did }) => friendships.approve(did, await body()),
    },
    'com.ohmmmm.vault.declineFriend': {
      verb: 'POST', asks: 'ohm', changes: true,
      about: 'The member declines someone who asked. They are not told.',
      takes: { id: 'the request\'s ID' },
      gives: '`id`, `declined`',
      run: async ({ body, friendships, did }) => friendships.decline(did, await body()),
    },
    'com.ohmmmm.vault.setFriendChannels': {
      verb: 'POST', asks: 'ohm', changes: true,
      about: 'Changes which channels one friend sees: `*` for every channel, or a list of channel paths. Only the member, signed in to ohm.',
      takes: { friend: 'the friend\'s DID', channels: '`*`, or a list of channel paths' },
      gives: '`did`, `channels`',
      run: async ({ body, friendships, did }) => friendships.setChannels(did, await body()),
    },
    'com.ohmmmm.vault.listShared': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'What another member shares with the asker: their friends-only blocks and posts, when the asker is on their friend list. To anyone else it answers NotFound, whether or not anything is there.',
      takes: { owner: 'the DID whose friends layer to read' },
      gives: '`owner`, `blocks` (id, version, path, kind, title)',
      run: ({ url, blocks, did }) => blocks.shared(url.searchParams.get('owner'), did),
    },
    'com.ohmmmm.vault.getShared': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'One friends-only block or post another member shares with the asker, as its file.',
      takes: { owner: 'the DID whose friends layer to read', id: 'the block\'s or post\'s ID' },
      gives: '`block` (id, path, text), `version`',
      run: ({ url, blocks, did }) => blocks.readShared(url.searchParams.get('owner'), did, url.searchParams.get('id')),
    },
  },
};
