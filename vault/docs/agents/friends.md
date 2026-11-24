# Friends approved like devices: agent reference

Human guide: [friends](../friends.md). Code: [service/src/friendship.mjs](../../service/src/friendship.mjs). Tests: [test/friendship.test.mjs](../../test/friendship.test.mjs), `app/test/visibility.test.ts`. Requests: [CAPABILITIES.md › Friends](../../service/CAPABILITIES.md#friends).

- **Identity:** a friend is a DID, the ohm account it is linked to (`links`). `name` and `email` come from the asker's ohm session (`/api/auth/get-session` `user.email`, passed through by `ohmUser`).
- **Scope:** `friendScope(db, owner, reader)` returns `null` (not a friend) or `{channels}`, where `channels` is `null` for every channel, or a sorted list of channel paths. `inScope(scope, paths)` is true when any path is a channel in the list or inside one. `filedIn(path, text)` gives a file's home channel plus its `channels`.
  - Used by `blocks.shared`/`readShared` (a block out of scope gives `NotFound`) and by content's `audienceOf`/`sees` (Friends entries filtered by `channel`/`channels`).
  - A friend's agents read as the friend: with the friend's PDS token (friends tools) or the friend's viewer token (sites).
- **Requests:**
  - `askFriend {owner, message?}` asks `ohm`. It needs a connected DID (`NotConnected`). It is idempotent, and always answers `{asked: true}`: the partial unique index `friend_requests_one_waiting` (`did, friend` where `state = 'waiting'`) and `ON CONFLICT DO NOTHING` keep one waiting request, even for asks at the same moment.
  - `listFriendRequests` asks `member`.
  - `approveFriend {id, channels?: '*' | paths}`, `declineFriend {id}` and `setFriendChannels {friend, channels}` ask `ohm`: never an agent's token.
  - Approve and decline change only a request still `waiting` (the friend is inserted only when the approval's own `answered_at` is on the request), so a decline and an approval never both land. A retry answers as the first did: approve with the same channels (compared with `friends.channels`), decline when declined; anything else is `Answered` (409).
  - `listFriends` gives `channels` (`'*'` or a list), `name` and `email`.
  - The existing `addFriend` (`ohm`, by DID) adds every channel.
- **Storage:** `friends.channels` (JSON, or NULL for every channel), `friends.name`, `friends.email`, and the `friend_requests` table. Migration [0008_friend_access.sql](../../service/migrations/0008_friend_access.sql).
- **Cockpit:** `loadFriendRequests` runs when the home and the bell open. `approveFriend(id, channels)` is refused with `DataError` for an empty list. The dialog offers Every channel or top-level channels.
- **Not built:** the asking side's screen. A site or the cockpit has to call `askFriend`; today only the request exists.
