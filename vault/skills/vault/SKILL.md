---
name: vault
description: How to work in a person's vault with the ohm-vault MCP tools. Use for local captures, vault search, Friends sharing, editing existing posts and publishing.
---

# Working in a vault

A vault holds blocks in channels. The service-backed `ohm-vault` tools use a PDS token to work with public and friends-only posts and the Friends layer. Run `ohm vault mcp` in a home for a separate stdio connection to the local vault. See the [local tool reference](../../docs/agents/vault-format.md#mcp-entry-points).

## Who a post is for

| Visibility | Who it is for |
| --- | --- |
| `public` | Everyone |
| `friends` | The DIDs the member added through their signed-in ohm session |
| `private` | Only the person |

The post is the same post at every visibility. Changing visibility marks it; it does not rewrite it.

**Saving never publishes.** A post marked `public` is in the vault, meant for everyone. It reaches the person's own repository, and from there their website and other applications, only when they publish. Do not tell the person something is live because it is marked public: `vault_status` says what is and is not published.

## The rules

1. **Private reading is device-local.** Use the local tools in a vault the person selected. Never include private content in a post, message or commit unless the person approves the disclosure.
2. **Capture new work locally.** `vault_capture` adds an HTTP(S) reference or an eligible configured-root file as a block in a channel you were granted (`vault_where` lists them). It is marked as yours and starts private; only the person shows it to more people. `vault_save` edits existing public and friends-only posts.
3. **Show the preview before the write.** `vault_set_visibility`, `vault_publish`, `vault_delete`, `vault_mirror`, `vault_save`, `vault_friends_save`, `vault_friends_delete` and `vault_friends_remove` use two calls when they change something. Show the answer and call with `confirm` only when the person agrees.
4. **Read before you change.** `vault_read` gives a post's version, and `vault_save` needs it to change the post. If the save is refused because the post changed, read it again and redo the change on the new text; do not retry with the old text.
5. **Use the person's own labels.** Look at `vault_tree` before filing a new post, and file it under a label they already use. Ask before inventing a new label.
6. **Never choose a form.** What kind of thing a post is, is identified from its content.

## A post

A post is named by its slug, which is the last part of its address, or by its ID. The ID never changes; the slug is an ordinary field, and `vault_save` with `slug` gives a post a new one. A picture or a file is placed in the body by its address, `![description](https://…)`: the vault holds no files of its own.

A post that first appeared somewhere else says where, as its `platform`. `vault_list` with `platform` lists those, and with `platform: "own"` the ones that first appeared nowhere else.

## Publishing

`vault_status` says what publishing would change and changes nothing: use it for "what is not published yet?". `vault_publish` makes the changes, in the person's own repository, signed in as them.

1. Call `vault_publish`. Tell the person, in plain words, each post that would be published for the first time, replaced, and taken down, and anything under `cannot` with its reason.
2. Call again with the `confirm` value only when they agree to that list. If the vault or the repository changed in between, the list is shown again.

Three things to say when they apply:

- **Publishing is public at once and for good.** Other services copy a post the moment it is written. Taking one down removes it from the person's repository, not from every copy.
- **A post that cannot be published stays as it is.** Fix what its reason names, usually with `vault_save`, and publish again.
- **`notInVault` is not a problem.** Those are records something else published. They are never removed. `vault_mirror` brings them in if the person wants to work on them here.

Marking a post `public` and publishing are two steps, and each is the person's decision. Do not publish because a post was marked public; publish when they ask.

## Bringing in what is already published

`vault_mirror` reads the person's own PDS and brings what they have published there into the vault. The first call only looks: tell the person how many posts it found, and anything under `couldNotBeKept` or `skipped`, in plain words. Call again with the `confirm` value when they agree.

It only reads the PDS, and never changes a post the person has since changed in the vault, so it is safe to run again. It cannot see anything that is not already a record on the PDS: pages of their website that were never published there are not found.

A mirror copies each post as it was published. It does not file, and it does not tidy. Afterwards:

1. Look at `vault_tree`. Posts that came with no label are under `other`. Ask the person where each belongs, then file it with `vault_save`.
2. Leave the text of a post alone unless the person asks. A published post is theirs as they wrote it.

## Common requests

| The person says | Do |
| --- | --- |
| "What have I written about X?" | Use `vault_search` and `vault_read` for shared posts, or `vault_local_search` and `vault_local_read` in the selected local vault |
| "Save this address or file" | Use `vault_capture` into the channel you are working in, and tell them where the block landed |
| "Change that post" | `vault_read`, then `vault_save` with the version and only the fields that change |
| "File this under Y" | `vault_read`, then `vault_save` with the version and the new `label` or `sublabel` |
| "Make it public" | `vault_set_visibility` to `public`: show what it answers, then confirm. It sends the person a request, which they approve in their cockpit and finish on the Publish page. Say it is not public yet |
| "Publish" | `vault_publish`: say what would change, then confirm |
| "What is not published yet?" | `vault_status` |
| "Take that down" | Ask who should still have access. `vault_set_visibility` sends the person a request; they take it down through Publish. For a friends-only block, a move to `private` with your write grant hides it from friends at once, and their device seals it |
| "Bring in my posts" / "sync from my site" | `vault_mirror`: say what it found, then confirm. Then file what landed under `other` |

## Setting up

The tools use the same site configuration as the commands, found in the folder you are working in (`ohm.jsonc`), and need `ATPROTO_APP_PASSWORD` set, to sign in to the person's PDS. What each tool asks the vault service for is listed in `service/CAPABILITIES.md`.
