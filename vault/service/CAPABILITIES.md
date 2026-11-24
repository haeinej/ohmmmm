# What the vault can do

<!-- Written by scripts/capabilities.mjs from service/src/capabilities/ and mcp/tools.mjs. Change those, then run `node scripts/capabilities.mjs --write`. -->

The vault service does a small number of things, and each is kept apart from the others. A **capability** is one of those things: a few requests that belong together, in one file. A **request** is one question or one change. A **tool** is something an agent can decide to do, and every tool is made of requests and nothing else.

This page is the whole list. It is written from the same tables the service and the tools run on, so it cannot say anything they do not do.

## The capabilities

| Capability | What it is for | Requests | Where |
| --- | --- | --- | --- |
| **Posts** | Read and change the posts in a vault, one at a time. Every change names the version it replaces, so two edits never overwrite each other unseen. | `listPosts`, `getPost`, `putPost`, `deletePost` | [posts.mjs](src/capabilities/posts.mjs) |
| **Friends** | The friends layer: friends-only blocks, kept readable so the friends a member chose can read them, and the friend list that says who they are. A friend reads friends-only posts and blocks alike. Private blocks are never kept here. | `listBlocks`, `getBlock`, `putBlock`, `deleteBlock`, `listFriends`, `addFriend`, `removeFriend`, `askFriend`, `listAsked`, `listFriendOf`, `listFriendRequests`, `approveFriend`, `declineFriend`, `setFriendChannels`, `listShared`, `getShared` | [friends.mjs](src/capabilities/friends.mjs) |
| **Private** | The private layer: private blocks, kept only as ciphertext sealed on the member's devices. The service stores and syncs them and cannot read them; no friend or agent can be given their contents by the service. Each is `{ id, ciphertext, version }`, with an opaque ID and compare-and-swap on the version. Several change together or not at all; every version is kept for restoring; the journal is sealed too; and a key rotation re-wraps every kept version and journal entry. | `listPrivateBlocks`, `getPrivateBlock`, `putPrivateBlock`, `putPrivateBlocks`, `listPrivateVersions`, `getPrivateVersion`, `listPrivateJournal`, `beginPrivateRotation`, `getPrivateRotation`, `listPrivateBelow`, `rewrapPrivate`, `finishPrivateRotation`, `deletePrivateBlock` | [private.mjs](src/capabilities/private.mjs) |
| **Visibility** | Moves between the public, friends and private layers, by one set of rules the cockpit and the agent tools share. Every move is previewed first and journalled with who asked, who approved and why; the journal names a block by its ID only. Showing a block to more people is the member's move: an agent asks, and its request waits in the cockpit until the member answers. An agent with a write grant may start a move to private, which hides the block from friends at once; the member's device seals it when next unlocked. Public is reached only through Publish. | `previewMove`, `hideBlock`, `requestMove`, `listMoveRequests`, `declineMoveRequest`, `recordMove`, `listMoves` | [visibility.mjs](src/capabilities/visibility.mjs) |
| **Channels** | Channels as files: each one's `_channel.md`, with its title, kind, order and description, kept readable like the friends layer. Channels can be moved with everything filed in them, and removed when empty. Private channels are sealed and kept with the private layer, never here. | `listChannels`, `getChannel`, `putChannel`, `deleteChannel`, `moveChannel` | [channels.mjs](src/capabilities/channels.mjs) |
| **Cortex** | The cortex: what the member's agents know about them and can do, as files sealed on the member's devices. The service keeps and syncs them and cannot read them. Each is `{ id, ciphertext, version }` with an opaque ID; several change together or not at all; every version is kept; the journal of who changed what, and why, is sealed too. Agents reach the cortex through the member's device, never through the service. | `listFiles`, `getFile`, `putFile`, `putFiles`, `deleteFile`, `listVersions`, `getVersion`, `listJournal`, `listBelow`, `rewrap` | [cortex.mjs](src/capabilities/cortex.mjs) |
| **Media** | The media cache. A picture or file in a vault is a block that saves where the file is and what it is; its bytes are sent here once, so the cockpit can show them, and can always be sent again. Public and friends-only media is sent readable under its content address and can be shown smaller; private media is sealed on the member's device first and never rendered here. Nothing here is published: publishing sends a copy to the member's PDS. | `hasMedia`, `putMedia`, `getMedia`, `getRendition` | [media.mjs](src/capabilities/media.mjs) |
| **Structure** | The shape of a vault: its labels, the sublabels inside them, and a line for each post. Enough to draw it or decide where something belongs, without reading any post in full. | `getTree`, `getAgenda` | [structure.mjs](src/capabilities/structure.mjs) |
| **Search** | Find posts by the words in them, at every visibility. A title counts for more than a label, and a label for more than the body. | `searchPosts` | [search.mjs](src/capabilities/search.mjs) |
| **Mirror** | Bring what the member has already published on their PDS into the vault. It only reads the PDS, and it never changes a post the member has since changed in the vault. | `importPublished` | [mirror.mjs](src/capabilities/mirror.mjs) |
| **Publish** | Work out what would have to change in the member's own repository for what is published to match their vault. The service changes nothing there and holds no permission to: the member, signed in at their own PDS, makes the changes from the list. Only standard.site documents holding an ohm post are touched, with the member's publication made the first time; a record the vault knows nothing about is never removed. | `getPublishPlan`, `getAttachment` | [publish.mjs](src/capabilities/publish.mjs) |
| **Export** | The whole vault written out as files a person can keep: each post as Markdown, where it sits in a folder. The same files open in Obsidian, and read back as the same posts. | `exportFiles` | [export.mjs](src/capabilities/export.mjs) |
| **Content** | Content for sites, read by the member's DID: channels become collections and blocks become entries. Anyone gets what the member published to their PDS, and nothing before they publish it. A viewer the member put on their friend list, proved by a viewer token, also gets the friends layer. A viewer who is not a friend gets exactly what anyone gets. Private content is never read. Entries leave out where a file came from and who made it. When the member's PDS cannot be reached, Friends is still served, with the last public copy and `publicStale` (when it was read), or with `publicUnavailable` when there is none. | `listChannels`, `getChannel`, `listBlocks`, `getBlock`, `getMedia`, `view`, `listSites`, `addSite`, `removeSite` | [content.mjs](src/capabilities/content.mjs) |
| **Account** | For a member signed in to ohm: who they are, and which AT Protocol account their vault is. One ohm account works in one AT Protocol account, and the other way round. These ride on the ohm session only; a token from a PDS does not reach them. | `get`, `connect`, `disconnect` | [account.mjs](src/capabilities/account.mjs) |
| **Identity** | The first steps of signing in: finding an account from its handle, and saying who a token from a PDS names. Neither touches a vault. | `findAccount`, `whoAmI` | [identity.mjs](src/capabilities/identity.mjs) |

The service never writes to anyone's repository. Saving a post, whatever it says about who may see it, changes only the vault's own copy. Publishing is worked out here and carried out by the member, signed in at their own PDS ([public/vault/publish.js](public/vault/publish.js)).

## Asking

A request is sent to `/xrpc/` and its full name, such as `/xrpc/com.ohmmmm.vault.getTree`, at the service's own address or under `/vault` on the app's. One that only reads is a `GET` with what it takes in the address. One that changes something is a `POST` with what it takes as JSON. Every answer is JSON.

Who may ask is one of four things, and each request says which:

| Who | How they are known |
| --- | --- |
| Anyone | Nothing is checked. Everything such a request answers with is already public |
| Whoever holds a token from a PDS | A token the PDS issued for this one request and no other, signed with the key the account's own DID document names |
| The member | Such a token from their own PDS, as the command line and an agent's tools send; or their ohm session, as the editor sends, which is worth exactly the one account it was connected to |
| The member, signed in to ohm | Their ohm session only. A request that changes something must also come from ohm's own pages |
| Anyone, about the member `did` names | Nothing is needed for what the member published. A viewer token (`Authorization: Bearer`, from `content.view`) says who is looking; if the member put them on their friend list, the answer also holds the friends layer. Never the private layer |

A member's posts and blocks are served to that member. Their friends-only posts and blocks are also served to the DIDs on their friend list, and to nobody else. Who is asking is settled before any store is looked at. Private blocks are never kept by the service in readable form.

The editor sends `X-Ohm-Did` for the member it displays. If the authenticated account differs, the service refuses with `409 AccountChanged` before running the request. This optional precondition binds stale tabs to their displayed member; it cannot select an account or replace authentication.

## Posts

Read and change the posts in a vault, one at a time. Every change names the version it replaces, so two edits never overwrite each other unseen.

### `com.ohmmmm.vault.listPosts`

Every post with the version it is at. With `since`, a point an earlier list returned, only what changed after it, removals included.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | `since`: optional: the `cursor` of an earlier list |
| Gives | `posts` (id, version, slug, label, sublabel, visibility, title), `cursor`, and `more` when there is another page |

### `com.ohmmmm.vault.getPost`

One post in full, and its version.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | `id`: the post's ID |
| Gives | `post`, `version` |

### `com.ohmmmm.vault.putPost`

Saves one post. `replaces` is the version being replaced and is left out for a new post. Sent twice, it ends the same as sent once. Whatever the post says about who may see it, only this copy changes.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member |
| Takes | `post`: the whole post<br>`replaces`: optional: the version it replaces |
| Gives | `id`, `version`, and `unchanged` when nothing differed |

### `com.ohmmmm.vault.deletePost`

Removes one post, for good.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member |
| Takes | `id`: the post's ID<br>`replaces`: the version being removed |
| Gives | `id`, `removed` |

## Friends

The friends layer: friends-only blocks, kept readable so the friends a member chose can read them, and the friend list that says who they are. A friend reads friends-only posts and blocks alike. Private blocks are never kept here.

### `com.ohmmmm.vault.listBlocks`

Every friends-only block that is not a post, with the version it is at. With `since`, a point an earlier list returned, only what changed after it, removals included.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | `since`: optional: the `cursor` of an earlier list |
| Gives | `blocks` (id, version, path, kind, title), `cursor`, and `more` when there is another page |

### `com.ohmmmm.vault.getBlock`

One friends-only block, as the file it is in the member's folder, and its version.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | `id`: the block's ID |
| Gives | `block` (id, path, text), `version` |

### `com.ohmmmm.vault.putBlock`

Saves one friends-only block, as its file: its path in the folder and its text, which must say `visibility: friends`. A private or public block, or a post, is refused. `replaces` is the version being replaced and is left out for a new block. Sent twice, it ends the same as sent once. From then on the friends on the list can read it.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member |
| Takes | `block`: `id`, `path` and `text`<br>`replaces`: optional: the version it replaces |
| Gives | `id`, `version`, and `unchanged` when nothing differed |

### `com.ohmmmm.vault.deleteBlock`

Removes one friends-only block from this layer, for good. Friends can no longer read it.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member |
| Takes | `id`: the block's ID<br>`replaces`: the version being removed |
| Gives | `id`, `removed` |

### `com.ohmmmm.vault.listFriends`

Who may read the member's friends layer.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | Nothing |
| Gives | `friends` (did, added, channels: `*` or a list, name, email) |

### `com.ohmmmm.vault.addFriend`

Lets one more DID read the member's friends layer: every friends-only post and block, now and later. Only the member, signed in to ohm, can add a friend; an agent cannot.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member, signed in to ohm |
| Takes | `did`: the friend's DID |
| Gives | `did`, and `unchanged` when they were a friend already |

### `com.ohmmmm.vault.removeFriend`

Stops one DID reading the member's friends layer. What they read before cannot be taken back.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member |
| Takes | `did`: the friend's DID |
| Gives | `did`, `removed`, and `unchanged` when they were not a friend |

### `com.ohmmmm.vault.askFriend`

Someone signed in to ohm, with their AT Protocol account connected, asks a member to be their friend, by the email of the member's ohm account or by their DID. The member sees the asker's name and email from their ohm account, and their DID, and answers in the cockpit. The answer is the same whether or not the email has an ohm account, whether asked once or again, and whether or not they already let the asker in.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member, signed in to ohm |
| Takes | `email`: the email of the person asked<br>`owner`: or: their DID<br>`message`: optional: a line for them |
| Gives | `asked` |

### `com.ohmmmm.vault.listAsked`

Who the member asked to be friends with, by the email they typed, newest first: `waiting` until that person lets them in, then `friends`. An email with no ohm account, and a request declined, both stay waiting.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | Nothing |
| Gives | `asks` (email, asked, state, and `did` once friends) |

### `com.ohmmmm.vault.listFriendOf`

The people who let the member into their friends layer, with their name and email from their ohm account: whose shared blocks the member reads with listShared and getShared.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | Nothing |
| Gives | `people` (did, since, name, email) |

### `com.ohmmmm.vault.listFriendRequests`

Who has asked to be the member's friend and is waiting for an answer, oldest first.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | Nothing |
| Gives | `requests` (id, did, name, email, message, asked, state) |

### `com.ohmmmm.vault.approveFriend`

The member lets someone who asked into their friends layer, for every channel (`*`, the default) or only the channels named, each covering the channels inside it. It lasts until the member removes them. Only the member, signed in to ohm, approves; an agent cannot. The friend's own agents read with the friend's access.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member, signed in to ohm |
| Takes | `id`: the request's ID<br>`channels`: optional: `*`, or a list of channel paths |
| Gives | `did`, `channels` |

### `com.ohmmmm.vault.declineFriend`

The member declines someone who asked. They are not told.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member, signed in to ohm |
| Takes | `id`: the request's ID |
| Gives | `id`, `declined` |

### `com.ohmmmm.vault.setFriendChannels`

Changes which channels one friend sees: `*` for every channel, or a list of channel paths. Only the member, signed in to ohm.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member, signed in to ohm |
| Takes | `friend`: the friend's DID<br>`channels`: `*`, or a list of channel paths |
| Gives | `did`, `channels` |

### `com.ohmmmm.vault.listShared`

What another member shares with the asker: their friends-only blocks and posts, when the asker is on their friend list. To anyone else it answers NotFound, whether or not anything is there.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | `owner`: the DID whose friends layer to read |
| Gives | `owner`, `blocks` (id, version, path, kind, title) |

### `com.ohmmmm.vault.getShared`

One friends-only block or post another member shares with the asker, as its file.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | `owner`: the DID whose friends layer to read<br>`id`: the block's or post's ID |
| Gives | `block` (id, path, text), `version` |

## Private

The private layer: private blocks, kept only as ciphertext sealed on the member's devices. The service stores and syncs them and cannot read them; no friend or agent can be given their contents by the service. Each is `{ id, ciphertext, version }`, with an opaque ID and compare-and-swap on the version. Several change together or not at all; every version is kept for restoring; the journal is sealed too; and a key rotation re-wraps every kept version and journal entry.

### `com.ohmmmm.vault.listPrivateBlocks`

Every private block, by opaque ID, with its version, size and the generation of the master key that wraps its key. With `since`, only what changed after an earlier list, removals included. With `below`, only blocks wrapped by an older generation than that, for finishing a key rotation.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | `since`: optional: the `cursor` of an earlier list<br>`below`: optional: a generation |
| Gives | `blocks` (id, version, generation, size), `cursor`, and `more` when there is another page |

### `com.ohmmmm.vault.getPrivateBlock`

One private block's ciphertext and version. Only the member's devices can open it.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | `id`: the block's opaque ID |
| Gives | `id`, `ciphertext`, `version` |

### `com.ohmmmm.vault.putPrivateBlock`

Saves one private block's ciphertext. Anything that is not a sealed file is refused, so readable text is never kept, and so is a block sealed under an older master key than a rotation started. `replaces` is the version being replaced and is left out for a new block. Sent twice, it ends the same as sent once.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member |
| Takes | `block`: `id` and `ciphertext` (the sealed file)<br>`replaces`: optional: the version it replaces<br>`journal`: optional: a sealed journal entry describing the change |
| Gives | `id`, `version`, `rev` (the kept version it made), and `unchanged` when nothing differed |

### `com.ohmmmm.vault.putPrivateBlocks`

Changes several private blocks together, all or none, as moving a block between channels changes the block and two channel files. Each change is a write (`id`, `ciphertext`, `replaces`) or a removal (`id`, `remove: true`, `replaces`); one stale version, or one block sealed under a key older than a rotation started, refuses them all. `batchId` makes it safe to send again: a repeat answers what the first did and changes nothing.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member |
| Takes | `changes`: the changes, 1 to 100<br>`batchId`: a key the device makes for this batch<br>`journal`: optional: a sealed journal entry describing them |
| Gives | `blocks` (id, version and rev, or removed), and `replayed` for a repeat |

### `com.ohmmmm.vault.listPrivateVersions`

A private block's kept versions, newest first, each by a `rev` that never changes. The device opens one to show or restore it; restoring is a new change.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | `id`: the block's opaque ID |
| Gives | `id`, `versions` (rev, version, generation, size, created) |

### `com.ohmmmm.vault.getPrivateVersion`

One kept version of a private block, as ciphertext.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | `id`: the block's opaque ID<br>`rev`: the version's rev |
| Gives | `id`, `rev`, `version`, `ciphertext` |

### `com.ohmmmm.vault.listPrivateJournal`

The private layer's journal: sealed entries, oldest first, after `since`. Only the member's devices can read what each says.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | `since`: optional: the `cursor` of an earlier list |
| Gives | `entries` (seq, entry, created), `cursor`, and `more` when there is another page |

### `com.ohmmmm.vault.beginPrivateRotation`

Starts a rotation of the member's master key to generation `target`, as the private store sees it: from now on a block sealed under an older generation is refused. The re-wrap happens on the member's device. The same target again changes nothing.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member |
| Takes | `target`: the generation being rotated to |
| Gives | `target`, `state`, `remaining` (blocks still below it), and `unchanged` when it was already started |

### `com.ohmmmm.vault.getPrivateRotation`

The member's latest key rotation, and how many private blocks are still below its target, so any device can resume it.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | Nothing |
| Gives | `rotation` (target, state, remaining, started, finished) or null |

### `com.ohmmmm.vault.listPrivateBelow`

What a rotation to `target` still has to re-wrap: every kept version (by block and rev) and journal entry (by seq) sealed under an older key.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | `target`: the generation being rotated to |
| Gives | `target`, `versions` (id, rev, generation), `journal` (seq, generation), and `more` when there is more |

### `com.ohmmmm.vault.rewrapPrivate`

Re-wrapped copies of kept versions and journal entries, for a rotation under way to `target`. Each must keep exactly the contents it replaces, with only its file key re-wrapped; a version that is its block's latest moves the block with it. All are kept or none. Safe to send again.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member |
| Takes | `target`: the generation being rotated to<br>`versions`: `id`, `rev`, `ciphertext` for each<br>`journal`: `seq`, `entry` for each |
| Gives | `target`, `remaining` |

### `com.ohmmmm.vault.finishPrivateRotation`

Finishes the rotation to `target`, only if no kept version or journal entry is still below it, checked in the same statement. The account deletes the old key's copies only after this.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member |
| Takes | `target`: the generation being rotated to |
| Gives | `target`, `state`, and `unchanged` when it was already finished |

### `com.ohmmmm.vault.deletePrivateBlock`

Removes one private block. Its kept versions stay, so it can be restored.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member |
| Takes | `id`: the block's opaque ID<br>`replaces`: the version being removed<br>`journal`: optional: a sealed journal entry |
| Gives | `id`, `removed` |

## Visibility

Moves between the public, friends and private layers, by one set of rules the cockpit and the agent tools share. Every move is previewed first and journalled with who asked, who approved and why; the journal names a block by its ID only. Showing a block to more people is the member's move: an agent asks, and its request waits in the cockpit until the member answers. An agent with a write grant may start a move to private, which hides the block from friends at once; the member's device seals it when next unlocked. Public is reached only through Publish.

### `com.ohmmmm.vault.previewMove`

What moving one block to another layer would do: the action, whether it shows the block to more people, the warning, who may finish it, what it still needs (a title, to be published), and any request already waiting. A private block is named by its opaque ID with `from=private`.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | `id`: the block's or post's ID<br>`to`: public, friends or private<br>`from`: optional: `private` for a sealed block |
| Gives | `id`, `from`, `to`, `action`, `widens`, `warning`, `finishes`, `via`, `needs`, `store`, `version`, `leaving`, `waiting` |

### `com.ohmmmm.vault.hideBlock`

Starts a move to private for a friends-only block or post: from now on no friend and no site reads it, and the member's device seals it into the private layer when next unlocked. The agent tools call it only with the agent's write grant on the block's channel. Sent twice, it changes nothing more.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member |
| Takes | `id`: the block's or post's ID<br>`replaces`: the version read<br>`by`: me, or agent:<name><br>`reason`: optional: why |
| Gives | `id`, `hidden` (when), and `unchanged` when it was hidden already |

### `com.ohmmmm.vault.requestMove`

An agent asks the member for a move it may not finish, such as showing a block to more people. The request waits in the cockpit until the member approves or declines it; nothing moves until then. One request waits per block and layer.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member |
| Takes | `block`: the block's ID (opaque for a private block)<br>`store`: block, post or sealed<br>`from`: its layer now<br>`to`: the layer asked for<br>`version`: optional: the version read<br>`by`: agent:<name><br>`reason`: optional: why, shown to the member |
| Gives | `request` (id, block, store, from, to, version, askedBy, reason, asked, state), and `unchanged` when one was waiting already |

### `com.ohmmmm.vault.listMoveRequests`

Agents' requests for moves, oldest first: those waiting, or those approved or declined.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | `state`: optional: waiting (the default), approved or declined |
| Gives | `requests` |

### `com.ohmmmm.vault.declineMoveRequest`

The member declines an agent's request. Nothing moves. Only the member, signed in to ohm, answers a request.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member, signed in to ohm |
| Takes | `id`: the request's ID<br>`reason`: optional: why |
| Gives | `id`, `declined` |

### `com.ohmmmm.vault.recordMove`

The member's cockpit records a move it made, after the member approved it: a request it answers, a hidden block it sealed, or a move to or from public it handed to Publish. Only the member, signed in to ohm, records a move.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member, signed in to ohm |
| Takes | `block`: the block's ID before the move<br>`from`: its layer before<br>`to`: its layer after<br>`request`: optional: the request this answers<br>`sealedAs`: optional: its opaque ID in the private layer<br>`cleanupPending`: optional: true when the old copy could not be removed<br>`reason`: optional: why |
| Gives | `block`, `from`, `to`, `state` (done, cleanup-pending, or previewed for Publish), and `approved` with the request |

### `com.ohmmmm.vault.listMoves`

The journal of visibility moves, newest first: each block by its ID, from and to which layer, the action, how it stands, who asked, who approved and why. No titles or text.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | `since`: optional: a `seq`, for only what came after it<br>`limit`: optional: up to 500 |
| Gives | `moves` (seq, at, block, from, to, action, state, askedBy, approvedBy, reason, request) |

## Channels

Channels as files: each one's `_channel.md`, with its title, kind, order and description, kept readable like the friends layer. Channels can be moved with everything filed in them, and removed when empty. Private channels are sealed and kept with the private layer, never here.

### `com.ohmmmm.vault.listChannels`

Every channel kept here, with the version it is at. With `since`, a point an earlier list returned, only what changed after it, removals included.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | `since`: optional: the `cursor` of an earlier list |
| Gives | `channels` (path, version, title, kind), `cursor`, and `more` when there is another page |

### `com.ohmmmm.vault.getChannel`

One channel, as its `_channel.md`, and its version.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | `path`: the channel's path, such as `writing/collisions` |
| Gives | `channel` (path, text), `version` |

### `com.ohmmmm.vault.putChannel`

Saves one channel's file. A channel marked `visibility: private` is refused. `replaces` is the version being replaced and is left out for a new channel. Sent twice, it ends the same as sent once.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member |
| Takes | `channel`: `path` and `text`<br>`replaces`: optional: the version it replaces |
| Gives | `path`, `version`, and `unchanged` when nothing differed |

### `com.ohmmmm.vault.deleteChannel`

Removes one channel. Refused while a block or post is filed in it or a channel is inside it.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member |
| Takes | `path`: the channel's path<br>`replaces`: the version being removed |
| Gives | `path`, `removed` |

### `com.ohmmmm.vault.moveChannel`

Moves a channel to another path, with every channel inside it and every friends-only block filed in or listed under it, all at once or not at all. Refused while a published post is filed in it, because a post's address comes from its label: that changes through Publish.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member |
| Takes | `from`: the channel's path<br>`to`: its new path<br>`replaces`: the channel's version, or nothing for a folder with no `_channel.md` |
| Gives | `from`, `to`, and how many `channels` and `blocks` moved |

## Cortex

The cortex: what the member's agents know about them and can do, as files sealed on the member's devices. The service keeps and syncs them and cannot read them. Each is `{ id, ciphertext, version }` with an opaque ID; several change together or not at all; every version is kept; the journal of who changed what, and why, is sealed too. Agents reach the cortex through the member's device, never through the service.

### `com.ohmmmm.cortex.listFiles`

Every cortex file, by opaque ID, with its version, size and key generation. With `since`, only what changed after an earlier list, removals included. With `below`, only files wrapped by an older generation.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | `since`: optional: the `cursor` of an earlier list<br>`below`: optional: a generation |
| Gives | `blocks` (id, version, rev, generation, size), `cursor`, and `more` when there is another page |

### `com.ohmmmm.cortex.getFile`

One cortex file's ciphertext and version.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | `id`: the file's opaque ID |
| Gives | `id`, `ciphertext`, `version`, `rev` |

### `com.ohmmmm.cortex.putFile`

Saves one cortex file's ciphertext, with compare-and-swap on its version. Readable text, or a file sealed under a key older than a rotation started, is refused. The journal entry says, sealed, who made the change and why.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member |
| Takes | `file`: `id` and `ciphertext` (the sealed file)<br>`replaces`: optional: the version it replaces<br>`journal`: optional: a sealed journal entry |
| Gives | `id`, `version`, `rev`, and `unchanged` when nothing differed |

### `com.ohmmmm.cortex.putFiles`

Changes several cortex files together, all or none: each a write (`id`, `ciphertext`, `replaces`) or a removal (`id`, `remove: true`, `replaces`). `batchId` makes it safe to send again.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member |
| Takes | `changes`: the changes, 1 to 100<br>`batchId`: a key the device makes for this batch<br>`journal`: optional: a sealed journal entry |
| Gives | `blocks` (id, version and rev, or removed), and `replayed` for a repeat |

### `com.ohmmmm.cortex.deleteFile`

Removes one cortex file. Its kept versions stay, for restoring.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member |
| Takes | `id`: the file's opaque ID<br>`replaces`: the version being removed<br>`journal`: optional: a sealed journal entry |
| Gives | `id`, `removed` |

### `com.ohmmmm.cortex.listVersions`

A cortex file's kept versions, newest first, each by a `rev` that never changes.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | `id`: the file's opaque ID |
| Gives | `id`, `versions` (rev, version, generation, size, created) |

### `com.ohmmmm.cortex.getVersion`

One kept version of a cortex file, as ciphertext.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | `id`: the file's opaque ID<br>`rev`: the version's rev |
| Gives | `id`, `rev`, `version`, `ciphertext` |

### `com.ohmmmm.cortex.listJournal`

The cortex journal's sealed entries after `since`, oldest first: who changed what, and why, readable only on the member's devices.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | `since`: optional: the `cursor` of an earlier list |
| Gives | `entries` (seq, entry, created), `cursor`, and `more` |

### `com.ohmmmm.cortex.listBelow`

What the member's key rotation to `target` still has to re-wrap in the cortex: kept versions and journal entries.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | `target`: the generation being rotated to |
| Gives | `target`, `versions` (id, rev, generation), `journal` (seq, generation), and `more` |

### `com.ohmmmm.cortex.rewrap`

Re-wrapped copies of cortex versions and journal entries for the rotation under way. Each keeps exactly its contents; only the file key is re-wrapped. All are kept or none.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member |
| Takes | `target`: the generation being rotated to<br>`versions`: (id, rev, ciphertext)<br>`journal`: (seq, entry) |
| Gives | `target`, `remaining` across the private layer and the cortex |

## Media

The media cache. A picture or file in a vault is a block that saves where the file is and what it is; its bytes are sent here once, so the cockpit can show them, and can always be sent again. Public and friends-only media is sent readable under its content address and can be shown smaller; private media is sealed on the member's device first and never rendered here. Nothing here is published: publishing sends a copy to the member's PDS.

### `com.ohmmmm.media.hasMedia`

Which of the named media the cache already holds, so a device sends only what is missing.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | `names`: up to 100 content addresses or sealed IDs, separated by commas |
| Gives | `present`, the names held |

### `com.ohmmmm.media.putMedia`

Sends one file's bytes, whole, as the request body (not JSON), up to 25 MB. Readable media is named by its content address, which the bytes must match; sealed media by its opaque ID, as `application/octet-stream`. Sent again, it changes nothing.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member |
| Takes | `name`: in the address: its content address (sha256-<hex>) or sealed ID<br>`body`: the bytes, with their type as Content-Type |
| Gives | `name`, `size`, and `unchanged` when it was held already |

### `com.ohmmmm.media.getMedia`

One file's bytes, as they were sent. It answers with the file itself, not JSON.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | `name`: its content address or sealed ID |
| Gives | The file, with its type |

### `com.ohmmmm.media.getRendition`

A smaller copy of a readable picture to show, 160, 480, 960 or 1600 pixels wide, made once and kept. Sealed media is refused: the device renders it.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | `name`: its content address<br>`width`: 160, 480, 960 or 1600 |
| Gives | The picture, with its type |

## Structure

The shape of a vault: its labels, the sublabels inside them, and a line for each post. Enough to draw it or decide where something belongs, without reading any post in full.

### `com.ohmmmm.vault.getTree`

Labels, sublabels, and each post with who may see it, what kind of thing it is, the platform it first appeared on if that was somewhere else, and why it cannot be published, if it cannot.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | Nothing |
| Gives | `posts`, `public`, `friends`, `private` (counts), and `labels`, each with its `posts` and `sublabels` |

### `com.ohmmmm.vault.getAgenda`

What waits for the member and their curator, as counts: posts with no label of their own (`other`) and media with no alt text. Counted from the public and friends-only layers only, without reading anything with a model; the private layer and the cortex are counted on the member's device.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | Nothing |
| Gives | `unlabelled`, `mediaWithoutAlt`, and `counted`, the layers counted |

## Search

Find posts by the words in them, at every visibility. A title counts for more than a label, and a label for more than the body.

### `com.ohmmmm.vault.searchPosts`

The posts that mention every word of `q`, best first, each with a passage that shows where.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | `q`: the words to look for<br>`visibility`: optional: only posts at this visibility<br>`excludePrivate`: optional: pass 1 to search public and friends posts only<br>`limit`: optional: how many, 10 unless said, 50 at most |
| Gives | `found`, `posts` (id, slug, title, label, sublabel, visibility, date, passage), and `visibilityScope: shared` when private posts were excluded |

## Mirror

Bring what the member has already published on their PDS into the vault. It only reads the PDS, and it never changes a post the member has since changed in the vault.

### `com.ohmmmm.vault.importPublished`

Reads the member's repository and says what it holds as posts: how many, which would differ from what is published, and what could not be kept. With `apply`, saves them. Without it, changes nothing.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member |
| Takes | `apply`: optional: save the posts<br>`site`: optional: the member's website, when it is not the one their handle names<br>`from`: optional: one older post type to read, when it should not be found<br>`expectedSummary`: optional: the preview summary to require before saving; changed counts or caveats refuse the whole apply |
| Gives | `site`, `types`, `records`, `posts`, `sameAsPublished`, `differs`, `lost`, `cannotBePublishedYet`, `skipped`, `summary`, `applied`; and with `apply`, `saved`, `unchanged`, `changedThere`, `refused` |

## Publish

Work out what would have to change in the member's own repository for what is published to match their vault. The service changes nothing there and holds no permission to: the member, signed in at their own PDS, makes the changes from the list. Only standard.site documents holding an ohm post are touched, with the member's publication made the first time; a record the vault knows nothing about is never removed.

### `com.ohmmmm.vault.getPublishPlan`

What publishing would do: the posts it would publish for the first time, replace and take down, the ones that cannot be published and why, and the published records the vault knows nothing about. With `prepare`, also the changes themselves, ready to be made.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | `prepare`: optional: `1` to include `writes`, the changes to make<br>`only`: optional: one post's ID, for a preview of that post alone, as a visibility move to or from public shows it |
| Gives | `repository`, `pds`, `collection` (`site.standard.document`), `contentType` (`com.ohmmmm.post`), `publication` when it is to be made, `create`, `replace`, `remove`, `unchanged`, `cannot`, `notInVault`, `changes` (how many); and with `prepare`, `writes` and `plan`, a name for exactly these changes |

### `com.ohmmmm.vault.getAttachment`

One file that one of the member's posts places, fetched from where the post says it is. It answers with the file itself, not JSON. It is for publishing, which sends a copy of each such file to the member's PDS.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | `id`: the post's ID<br>`attachment`: the name the post's record places the file under |
| Gives | The file, with its type |

## Export

The whole vault written out as files a person can keep: each post as Markdown, where it sits in a folder. The same files open in Obsidian, and read back as the same posts.

### `com.ohmmmm.vault.exportFiles`

Every post as a file: its path in a folder, and its text.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | Nothing |
| Gives | `files` (path, text) |

## Content

Content for sites, read by the member's DID: channels become collections and blocks become entries. Anyone gets what the member published to their PDS, and nothing before they publish it. A viewer the member put on their friend list, proved by a viewer token, also gets the friends layer. A viewer who is not a friend gets exactly what anyone gets. Private content is never read. Entries leave out where a file came from and who made it. When the member's PDS cannot be reached, Friends is still served, with the last public copy and `publicStale` (when it was read), or with `publicUnavailable` when there is none.

### `com.ohmmmm.content.listChannels`

The member's channels that hold something the asker may see, or a channel inside one that does, each with its title, description, and an order naming only what the asker may see.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | Anyone, about the member `did` names |
| Takes | `did`: the member's DID |
| Gives | `owner`, `channels` (path, title, description, order, count) |

### `com.ohmmmm.content.getChannel`

One channel, as `listChannels` gives it. A channel with nothing the asker may see answers NotFound, as if it were not there.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | Anyone, about the member `did` names |
| Takes | `did`: the member's DID<br>`path`: the channel's path |
| Gives | `owner`, `channel` (path, title, description, order, count) |

### `com.ohmmmm.content.listBlocks`

What the asker may see, 200 entries at a time, without their bodies. With `channel`, only what is filed in it, in the channel's order first.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | Anyone, about the member `did` names |
| Takes | `did`: the member's DID<br>`channel`: optional: a channel's path<br>`cursor`: optional: the `cursor` of the page before |
| Gives | `owner`, `blocks` (id, layer, kind, slug, channel, channels, title, tags, created, updated, media, and `address` for a published post), and `cursor` when there is another page |

### `com.ohmmmm.content.getBlock`

One entry with its Markdown body. Something the asker may not see answers NotFound, the same as something that is not there.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | Anyone, about the member `did` names |
| Takes | `did`: the member's DID<br>`id`: the entry's ID |
| Gives | `owner`, `block`: as in `listBlocks`, with `body` |

### `com.ohmmmm.content.getMedia`

The file behind a media entry the asker may see, or a smaller copy of a picture with `width`. It answers with the file itself, not JSON.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | Anyone, about the member `did` names |
| Takes | `did`: the member's DID<br>`name`: the entry's `media.name`<br>`width`: optional: 160, 480, 960 or 1600 |
| Gives | The file, with its type |

### `com.ohmmmm.content.view`

Where a site sends a viewer to be recognised. If they are signed in to ohm with an AT Protocol account connected, it posts a viewer token for this one member back to the return address, which must be one of the member's sites. Otherwise it posts back `error`. The token lasts ten minutes and proves only who the viewer is; Friends is checked against the friend list on every read.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | Anyone |
| Takes | `owner`: the member's DID<br>`return`: the address on one of the member's sites to post back to |
| Gives | A page that posts `viewer` (the token) and `expires`, or `error`, to the return address |

### `com.ohmmmm.content.listSites`

The member's own sites: the only addresses a viewer token is posted back to.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member |
| Takes | Nothing |
| Gives | `sites` (origin, added) |

### `com.ohmmmm.content.addSite`

Adds one of the member's sites, by its https origin, so viewers can be sent back to it with a viewer token. Only the member, signed in to ohm, can add one; an agent cannot.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member, signed in to ohm |
| Takes | `origin`: the site's https address |
| Gives | `origin`, and `unchanged` when it was there already |

### `com.ohmmmm.content.removeSite`

Stops sending viewer tokens to one of the member's sites. Tokens it already holds run out within ten minutes.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member |
| Takes | `origin`: the site's https address |
| Gives | `origin`, `removed`, or `unchanged` when it was not there |

## Account

For a member signed in to ohm: who they are, and which AT Protocol account their vault is. One ohm account works in one AT Protocol account, and the other way round. These ride on the ohm session only; a token from a PDS does not reach them.

### `com.ohmmmm.account.get`

Who is signed in, the AT Protocol account they connected if they have, and whether what it had published has been brought in.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | The member, signed in to ohm |
| Takes | Nothing |
| Gives | `user` (name), `did`, `mirrored`, and `service`: who a PDS has to address its token to when the member connects |

### `com.ohmmmm.account.connect`

Ties an AT Protocol account to the ohm account. `token` is one the account's PDS issued for this request and nothing else.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member, signed in to ohm |
| Takes | `token`: a token from the account's PDS, issued for this request |
| Gives | `did`, and `already` when it was connected before |

### `com.ohmmmm.account.disconnect`

Unties the AT Protocol account. The vault is kept, and opens again when the account is connected.

| | |
| --- | --- |
| Reads or changes | Changes (`POST`) |
| Who may ask | The member, signed in to ohm |
| Takes | Nothing |
| Gives | `did`, now empty |

## Identity

The first steps of signing in: finding an account from its handle, and saying who a token from a PDS names. Neither touches a vault.

### `com.ohmmmm.identity.findAccount`

Finds an account from what a person types to sign in: their handle, or their DID. Needs no sign-in, and answers only with what is public.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | Anyone |
| Takes | `account`: a handle, such as example.com, or a DID |
| Gives | `did`, `handle`, `pds`, and `service`: this service's own DID |

### `com.ohmmmm.identity.whoAmI`

Says who a token from a PDS names. The token has to be issued for this request and nothing else, so only its holder can ask.

| | |
| --- | --- |
| Reads or changes | Reads only (`GET`) |
| Who may ask | Whoever holds a token from a PDS |
| Takes | Nothing |
| Gives | `did`, and `handle` when the handle points back to the account |

## When the answer is no

A refusal is JSON with an `error`, which is one of the names below, and a `message` in plain words. The message is written to be shown to a person as it is.

| Error | Status | When |
| --- | --- | --- |
| `SignInRequired` | 401 | The request rides on an ohm session, and there is none |
| `AccountChanged` | 409 | The authenticated DID differs from X-Ohm-Did, the member displayed by the editor. Reopen before reading or changing content |
| `AuthRequired` | 401 | The token is missing, cannot be read, was issued for another request or service, has run out, or its signature does not match |
| `NotAMember` | 403 | The account has not been let in yet |
| `WrongOrigin` | 403 | A request that changes something came with a session but not from ohm's own pages |
| `NotConnected` | 409 | The ohm account has no AT Protocol account connected yet |
| `AlreadyConnected` | 409 | The ohm account already works in another AT Protocol account |
| `ConnectedElsewhere` | 409 | The AT Protocol account is already connected to another ohm account |
| `SignInUnavailable` | 503 | ohm's sign-in could not be reached to check a session |
| `MethodNotFound` | 404 | There is no such request |
| `WrongMethod` | 405 | The request is the other of GET and POST |
| `InvalidRequest` | 400 | The request is not JSON, or something it says is not what that request takes |
| `InvalidPost` | 400 | The post is not one the vault can hold. The message lists every reason |
| `InvalidBlock` | 400 | The block is not one the layer can hold: for the friends layer, it is private or public, a post, or its file has problems; for the private layer, it is not a sealed file under an opaque ID. The message says why |
| `InvalidChannel` | 400 | The channel is not one the service can hold: its path is not a channel's path, it is private, or its file has problems. The message says why |
| `InvalidCursor` | 400 | `since` is not a value an earlier list returned |
| `NotFound` | 404 | There is no such post, block or saved version, or nothing there is shared with the asker |
| `Changed` | 409 | The post, block, channel or private block has changed since the version the request names. The answer carries the current version |
| `SlugTaken` | 409 | Another post in the vault already has that slug |
| `PathTaken` | 409 | Another block in the friends layer, or another channel, is already at that path |
| `NotEmpty` | 409 | A block or post is filed in the channel, or a channel is inside it. Move them first |
| `HasPosts` | 409 | Published posts are filed in the channel. Their addresses come from their label, which changes through Publish |
| `OlderKey` | 409 | The private block is sealed under an older master key than the member is rotating, or rotated, to |
| `NoRotation` | 409 | No rotation to that generation is under way |
| `RotationAhead` | 409 | The member already rotated to a later master key than the one asked for |
| `RotationRemaining` | 409 | A rotation cannot finish while some kept versions or journal entries are still sealed under the older key. The answer says how many |
| `TooLarge` | 413 | The post or block is more than 600 KB of text, a channel file is more than 200 KB, media is empty or more than 25 MB, a sealed private block is more than 1 MB, or a file it places is empty or larger than 25 MB |
| `FileUnreachable` | 502 | A file a post places could not be fetched from where the post says it is |
| `AccountNotFound` | 404 | No AT Protocol account answers to that handle or DID |
| `NoRepository` | 400 | The account's DID document does not say where its repository is kept |
| `RepositoryUnreachable` | 502 | The account's PDS would not answer |
| `MediaUnavailable` | 503 | The media cache is not set up on this service |
| `ViewerTokenInvalid` | 401 | The viewer token is not one this service made, is for another member, or has run out |
| `ViewersUnavailable` | 503 | Viewer tokens, and so Friends reads for sites, are not set up on this service |
| `NotFriendsOnly` | 409 | Only a friends-only block or post is hidden on its way to private |
| `Answered` | 409 | The move request has been approved or declined already |
| `NotThisMove` | 409 | The move recorded is not the one the request asked for |
| `InvalidMove` | 400 | The layer named is not public, friends or private, or the block is in it already |
| `NotTheirSite` | 400 | The return address is not on one of the member's sites |
| `InternalError` | 500 | Something went wrong in the service itself |

## The tools an agent has

The tools are in [../mcp/tools.mjs](../mcp/tools.mjs), and reach the service as the person, with a token from the person's own PDS for each request ([../scripts/vault-client.mjs](../scripts/vault-client.mjs)). A tool adds no ability of its own: it is a way of asking for the requests beside it.

| Tool | Reads or changes | Made of | What it does |
| --- | --- | --- | --- |
| `vault_tree` | Reads only | `getTree` | The structure of the person's vault: its labels, the sublabels inside them, and each post with who can see it. Start here to learn what the vault holds. |
| `vault_list` | Reads only | `getTree` | List posts, newest first, optionally only those under a label or sublabel, at one visibility, or from one platform. |
| `vault_read` | Reads only | `getTree`, `getPost` | Read one post in full, with its version. The version is needed to save changes to it. |
| `vault_search` | Reads only | `searchPosts` | Search the person's public and friends-only posts. Returns the best matches with a passage from each. |
| `vault_save` | Changes | `getTree`, `getPost`, `putPost` | Change an existing public or friends-only post. Pass the version vault_read gave. Fields left out stay as they are. Takes two calls. Use vault_capture to add a private block on the device. |
| `vault_set_visibility` | Changes | `getTree`, `getPost`, `getBlock`, `previewMove`, `hideBlock`, `requestMove` | Move a post or friends-only block to another layer: public, friends or private. Takes two calls; the first says what the move does and who may finish it. Showing it to more people, or taking a published post down, is the person's move: the second call sends them a request, which waits in their cockpit. With a write grant on its channel, a move to private hides it from friends at once, and the person's device seals it. |
| `vault_status` | Reads only | `getPublishPlan` | What publishing would change, without changing anything: the posts that would be published for the first time, replaced or taken down, the ones that cannot be published and why, and published records the vault knows nothing about. Use it to answer "what is not published yet?". |
| `vault_publish` | Changes | `getPublishPlan`, `getAttachment` | Publish: make what is published in the person's own repository match their vault. Posts marked public are published or replaced, and published posts that are no longer public are taken down. Always takes two calls: the first says exactly what would change; the second, with the confirm value, changes it. Publishing is public the moment it is done, and taking a post down does not recall copies others already made. |
| `vault_mirror` | Changes | `importPublished` | Bring what the person has already published on their PDS into the vault. Always takes two calls: the first only looks, and says what is there, what would differ from what is published, and what could not be kept; the second, with the confirm value, brings the posts in. It only reads the PDS, never publishes, and never changes a post the person has since changed in the vault. Posts that come with no label land under "other" and want filing. |
| `vault_delete` | Changes | `getTree`, `getPost`, `deletePost` | Remove a post for good. Always takes two calls. |
| `vault_friends_list` | Reads only | `listBlocks` | List your friends-only blocks. Pass the previous cursor as since to continue or read changes and removals. |
| `vault_friends_read` | Reads only | `getBlock` | Read your friends-only block as a Markdown file with its version. |
| `vault_friends_save` | Changes | `putBlock` | Change a friends-only block that is already shared, as a Markdown file with visibility: friends, from the version read. Friends read the change as soon as it is saved. It never makes a new block: a new block starts private, and vault_set_visibility asks the person to share it. Preview, then confirm the exact file and version. |
| `vault_friends_delete` | Changes | `deleteBlock` | Remove a friends-only block for good. Preview, then confirm with the version being removed. |
| `vault_friends_who` | Reads only | `listFriends` | List the DIDs that can read your friends layer. |
| `vault_friends_remove` | Changes | `listFriends`, `removeFriend` | Take away a DID’s access to your friends layer. Preview and confirm. Copies they already made remain with them. |
| `vault_shared_list` | Reads only | `listShared` | List the friends-only blocks and posts an owner shares with your signed-in DID. |
| `vault_shared_read` | Reads only | `getShared` | Read a friends-only block or post an owner shares with your signed-in DID. |

Three rules hold for every tool that changes something:

1. Create private blocks on the person's device. Service-backed tools expose only the public and friends layers.
2. Changing a post, publishing, bringing posts in from the PDS, saving or removing a friends block, and removing a friend each take two calls. The first gives a preview and a `confirm` value for the second call.
3. A post or friends block is changed from the version that was read. If it has changed since, the tool refuses the write.

### Requests with no tool

These requests have no MCP tool. They serve the editor, command line, adapters or sign-in.

| Request | Capability | Why it has no tool |
| --- | --- | --- |
| `listPosts` | Posts | It is for keeping a copy in step: every post's version, and what changed since. The tools read the structure instead |
| `addFriend` | Friends | Only the member can widen who can read the friends layer, through their ohm session |
| `askFriend` | Friends | A person asks, signed in to ohm, from the cockpit or a member's site |
| `listAsked` | Friends | The cockpit's Connections panel shows it |
| `listFriendOf` | Friends | The cockpit's Connections panel shows it. An agent reads shared blocks with vault_shared_list |
| `listFriendRequests` | Friends | The member answers requests in the cockpit. An agent never lets anyone in |
| `approveFriend` | Friends | Only the member can widen who can read the friends layer, through their ohm session |
| `declineFriend` | Friends | The member answers requests in the cockpit |
| `setFriendChannels` | Friends | Only the member changes what a friend sees, through their ohm session |
| `listPrivateBlocks` | Private | Private contents never reach the service readable. Agents read them only on the person's device, after unlock |
| `getPrivateBlock` | Private | Private contents never reach the service readable. Agents read them only on the person's device, after unlock |
| `putPrivateBlock` | Private | Private contents never reach the service readable. Agents read them only on the person's device, after unlock |
| `putPrivateBlocks` | Private | Private contents never reach the service readable. Agents read them only on the person's device, after unlock |
| `listPrivateVersions` | Private | Private contents never reach the service readable. Agents read them only on the person's device, after unlock |
| `getPrivateVersion` | Private | Private contents never reach the service readable. Agents read them only on the person's device, after unlock |
| `listPrivateJournal` | Private | Private contents never reach the service readable. Agents read them only on the person's device, after unlock |
| `beginPrivateRotation` | Private | Private contents never reach the service readable. Agents read them only on the person's device, after unlock |
| `getPrivateRotation` | Private | Private contents never reach the service readable. Agents read them only on the person's device, after unlock |
| `listPrivateBelow` | Private | Private contents never reach the service readable. Agents read them only on the person's device, after unlock |
| `rewrapPrivate` | Private | Private contents never reach the service readable. Agents read them only on the person's device, after unlock |
| `finishPrivateRotation` | Private | Private contents never reach the service readable. Agents read them only on the person's device, after unlock |
| `deletePrivateBlock` | Private | Private contents never reach the service readable. Agents read them only on the person's device, after unlock |
| `listMoveRequests` | Visibility | Answering a request and recording a move are the member's, in the cockpit, signed in to ohm. An agent asks with vault_set_visibility |
| `declineMoveRequest` | Visibility | Answering a request and recording a move are the member's, in the cockpit, signed in to ohm. An agent asks with vault_set_visibility |
| `recordMove` | Visibility | Answering a request and recording a move are the member's, in the cockpit, signed in to ohm. An agent asks with vault_set_visibility |
| `listMoves` | Visibility | Answering a request and recording a move are the member's, in the cockpit, signed in to ohm. An agent asks with vault_set_visibility |
| `listChannels` | Channels | The cockpit arranges channels. An agent files and orders blocks in the local vault, with vault_collect and vault_write |
| `getChannel` | Channels | The cockpit arranges channels. An agent files and orders blocks in the local vault, with vault_collect and vault_write |
| `putChannel` | Channels | The cockpit arranges channels. An agent files and orders blocks in the local vault, with vault_collect and vault_write |
| `deleteChannel` | Channels | The cockpit arranges channels. An agent files and orders blocks in the local vault, with vault_collect and vault_write |
| `moveChannel` | Channels | The cockpit arranges channels. An agent files and orders blocks in the local vault, with vault_collect and vault_write |
| `listFiles` | Cortex | The cortex is sealed. An agent reads and writes it on the person's device, through the cortex's own tools |
| `getFile` | Cortex | The cortex is sealed. An agent reads and writes it on the person's device, through the cortex's own tools |
| `putFile` | Cortex | The cortex is sealed. An agent reads and writes it on the person's device, through the cortex's own tools |
| `putFiles` | Cortex | The cortex is sealed. An agent reads and writes it on the person's device, through the cortex's own tools |
| `deleteFile` | Cortex | The cortex is sealed. An agent reads and writes it on the person's device, through the cortex's own tools |
| `listVersions` | Cortex | The cortex is sealed. An agent reads and writes it on the person's device, through the cortex's own tools |
| `getVersion` | Cortex | The cortex is sealed. An agent reads and writes it on the person's device, through the cortex's own tools |
| `listJournal` | Cortex | The cortex is sealed. An agent reads and writes it on the person's device, through the cortex's own tools |
| `listBelow` | Cortex | The cortex is sealed. An agent reads and writes it on the person's device, through the cortex's own tools |
| `rewrap` | Cortex | The cortex is sealed. An agent reads and writes it on the person's device, through the cortex's own tools |
| `hasMedia` | Media | The cockpit sends and shows media. An agent works with the media blocks in the local vault |
| `putMedia` | Media | The cockpit sends and shows media. An agent works with the media blocks in the local vault |
| `getMedia` | Media | The cockpit sends and shows media. An agent works with the media blocks in the local vault |
| `getRendition` | Media | The cockpit sends and shows media. An agent works with the media blocks in the local vault |
| `getAgenda` | Structure | The cockpit shows it. An agent counts the same things in the local vault with vault_lint |
| `exportFiles` | Export | The command line and the editor write the vault out. An agent reads posts one at a time |
| `listChannels` | Content | It is for sites: a site's content loader reads it, for whoever is looking at the site. The member's own agent reads their vault through the other tools |
| `getChannel` | Content | It is for sites: a site's content loader reads it, for whoever is looking at the site. The member's own agent reads their vault through the other tools |
| `listBlocks` | Content | It is for sites: a site's content loader reads it, for whoever is looking at the site. The member's own agent reads their vault through the other tools |
| `getBlock` | Content | It is for sites: a site's content loader reads it, for whoever is looking at the site. The member's own agent reads their vault through the other tools |
| `getMedia` | Content | It is for sites: a site's content loader reads it, for whoever is looking at the site. The member's own agent reads their vault through the other tools |
| `view` | Content | It is for sites: a site's content loader reads it, for whoever is looking at the site. The member's own agent reads their vault through the other tools |
| `listSites` | Content | It is for sites: a site's content loader reads it, for whoever is looking at the site. The member's own agent reads their vault through the other tools |
| `addSite` | Content | It is for sites: a site's content loader reads it, for whoever is looking at the site. The member's own agent reads their vault through the other tools |
| `removeSite` | Content | It is for sites: a site's content loader reads it, for whoever is looking at the site. The member's own agent reads their vault through the other tools |
| `get` | Account | It rides on an ohm session, which an agent does not have |
| `connect` | Account | It rides on an ohm session, which an agent does not have |
| `disconnect` | Account | It rides on an ohm session, which an agent does not have |
| `findAccount` | Identity | It is part of signing in |
| `whoAmI` | Identity | It is part of signing in |

## Not here yet

Attachments held by the vault, earlier versions of a post and bringing a removed one back, and a key a person can give an agent and take away again. Until there is such a key, an agent signs in with an app password from the person's PDS.
