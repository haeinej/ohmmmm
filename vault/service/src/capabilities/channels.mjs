// Channels: the member's channel files.
export default {
  name: 'Channels',
  about: 'Channels as files: each one\'s `_channel.md`, with its title, kind, order and description, kept readable like the friends layer. Channels can be moved with everything filed in them, and removed when empty. Private channels are sealed and kept with the private layer, never here.',
  requests: {
    'com.ohmmmm.vault.listChannels': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'Every channel kept here, with the version it is at. With `since`, a point an earlier list returned, only what changed after it, removals included.',
      takes: { since: 'optional: the `cursor` of an earlier list' },
      gives: '`channels` (path, version, title, kind), `cursor`, and `more` when there is another page',
      run: ({ url, channels, did }) => channels.list(did, { since: url.searchParams.get('since') ?? undefined }),
    },
    'com.ohmmmm.vault.getChannel': {
      verb: 'GET', asks: 'member', changes: false,
      about: 'One channel, as its `_channel.md`, and its version.',
      takes: { path: 'the channel\'s path, such as `writing/collisions`' },
      gives: '`channel` (path, text), `version`',
      run: ({ url, channels, did }) => channels.read(did, url.searchParams.get('path')),
    },
    'com.ohmmmm.vault.putChannel': {
      verb: 'POST', asks: 'member', changes: true,
      about: 'Saves one channel\'s file. A channel marked `visibility: private` is refused. `replaces` is the version being replaced and is left out for a new channel. Sent twice, it ends the same as sent once.',
      takes: { channel: '`path` and `text`', replaces: 'optional: the version it replaces' },
      gives: '`path`, `version`, and `unchanged` when nothing differed',
      run: async ({ body, channels, did }) => {
        const { channel, replaces = null } = await body();
        return channels.write(did, channel, { replaces });
      },
    },
    'com.ohmmmm.vault.deleteChannel': {
      verb: 'POST', asks: 'member', changes: true,
      about: 'Removes one channel. Refused while a block or post is filed in it or a channel is inside it.',
      takes: { path: 'the channel\'s path', replaces: 'the version being removed' },
      gives: '`path`, `removed`',
      run: async ({ body, channels, did }) => {
        const { path, replaces = null } = await body();
        return channels.remove(did, path, { replaces });
      },
    },
    'com.ohmmmm.vault.moveChannel': {
      verb: 'POST', asks: 'member', changes: true,
      about: 'Moves a channel to another path, with every channel inside it and every friends-only block filed in or listed under it, all at once or not at all. Refused while a published post is filed in it, because a post\'s address comes from its label: that changes through Publish.',
      takes: { from: 'the channel\'s path', to: 'its new path', replaces: 'the channel\'s version, or nothing for a folder with no `_channel.md`' },
      gives: '`from`, `to`, and how many `channels` and `blocks` moved',
      run: async ({ body, channels, did }) => {
        const { from, to, replaces = null } = await body();
        return channels.move(did, from, to, { replaces });
      },
    },
  },
};
