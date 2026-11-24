# Friends approved like devices: agent reference

Human guide: [friends](../friends.md). Code: [service/src/friendship.mjs](../../service/src/friendship.mjs). Tests: [test/friendship.test.mjs](../../test/friendship.test.mjs), `app/test/visibility.test.ts`. Requests: [CAPABILITIES.md › Friends](../../service/CAPABILITIES.md#friends).

- **Identity:** a friend is a DID, the ohm account it is linked to (`links`). `name` and `email` come from the asker's ohm session (`/api/auth/get-session` `user.email`, passed through by `ohmUser`).
- **Scope:** `friendScope(db, owner, reader)` returns `null` (not a friend) or `{channels}`, where `channels` is `null` for every channel, or a sorted list of channel paths. `inScope(scope, paths)` is true when any path is a channel in the list or inside one. `filedIn(path, text)` gives a file's home channel plus its `channels`.
  - Used by `blocks.shared`/`readShared` (a block out of scope gives `NotFound`) and by content's `audienceOf`/`sees` (Friends entries filtered by `channel`/`channels`).
  - A friend's agents read as the friend: with the friend's PDS token (friends tools) or the friend's viewer token (sites).
- **Requests:**
  - `askFriend {owner, message?}` asks `ohm`. It needs a connected DID (`NotConnected`). It is idempotent, and always answers `{asked: true}`.
  - `listFriendRequests` asks `member`.
  - `approveFriend {id, channels?: '*' | paths}`, `declineFriend {id}` and `setFriendChannels {friend, channels}` ask `ohm`: never an agent's token.
  - `listFriends` gives `channels` (`'*'` or a list), `name` and `email`.
  - The existing `addFriend` (`ohm`, by DID) adds every channel.
- **Storage:** `friends.channels` (JSON, or NULL for every channel), `friends.name`, `friends.email`, and the `friend_requests` table. Migration [0008_friend_access.sql](../../service/migrations/0008_friend_access.sql).
- **Cockpit:** `loadFriendRequests` runs when the home and the bell open. `approveFriend(id, channels)` is refused with `DataError` for an empty list. The dialog offers Every channel or top-level channels.
- **By email:** `askFriend {email, message?}` lower-cases the email and keeps it in `friend_asks (viewer, email)` whether or not an account has it. It resolves the email through `links.email`, which `linked.remember(user)` writes from each session request, and only asks when a DID is found. It always answers `{asked: true}`. Asking your own email gives `InvalidRequest`.
- **Joining later:** when a session request finds an account's email new in `links` (`linked.remember` returns it), `friendships.deliver(did, email)` turns every earlier `friend_asks` for that email, with its message, into a request. It skips askers already let in or already answered (any `friend_requests` row), so a request is sent once.
- `listAsked` (member) gives `asks` (email, asked, state `waiting`|`friends`, `did` once friends); unknown emails and declined requests stay `waiting`. `listFriendOf` (member) gives the people who let the member in, with name and email from `links`.
- `listShared`/`getShared` now ask `member` (a PDS token, or the ohm session the cockpit uses). The same `friendScope` applies.
- Migration [0009_people.sql](../../service/migrations/0009_people.sql) adds `links.name`, `links.email` and `friend_asks`.
- **Cockpit:** the rack's **Connections** ([ConnectionsPanel.tsx](../../../app/src/workspace/ConnectionsPanel.tsx)) shows the list and graph, Make friends (`askFriend`, with the `connections.ask` tool behind a Dialog), the person card with `sharedBy`, `openShared` (view `shared`, read-only), and Stop sharing (`removeFriend`, behind a Dialog). Tests: `app/test/connections.test.ts`.
