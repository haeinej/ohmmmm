# One record, three places: standard.site and spaces

**Status:** proposed, 23 November 2026. Changes vault rule 2 (`com.ohmmmm.post` for everyone) once agreed.

## Why

A block and a post are the same thing at different visibilities. Today the public record is `com.ohmmmm.post`, which no other application reads. [standard.site](https://standard.site) is the shared long-form record on AT Protocol: Leaflet, pckt and Offprint write it, and several readers and search indexes read it. Using it makes what someone publishes readable across the network without asking anyone to learn our type.

standard.site has no private pages: a document is a public record, checked against a public page. AT Protocol's answer for data that is not public is **spaces** ([proposal 0016](https://github.com/bluesky-social/proposals/tree/main/0016-permissioned-data)), in alpha since August 2026. A space holds ordinary records, so the same document can live in one. Spaces give **access control, not confidentiality**: the PDS and every app allowed to sync a space read its plaintext. Cirrus already runs the alpha; two November alphas broke compatibility.

## The model

The record is the same everywhere. Where it is kept decides who can read it.

| Layer | Where it lives | Encrypted? | Who can read it |
| --- | --- | --- | --- |
| Public | The member's PDS repo, as `site.standard.document` | No | Everyone |
| Friends | A members-only space on the member's PDS, friends as members, the same record | No | Their friends, their PDS, and apps they let sync it, ohm's service included, so it can search and show it |
| Private | A personal space on the member's PDS, or ohm's sealed store until spaces are stable | Yes, sealed on the member's device | Only their devices. The PDS and ohm's service hold ciphertext |

- Only the private layer needs keys. Friends uses spaces as designed, with no key work, so search and indexing keep working.
- **The cortex follows the private rule: always sealed.** It never becomes a document and never goes public.
- **A private space holds the sealed envelope** (`com.ohmmmm.sealed`, under an opaque key), and the `site.standard.document` sits inside it. Otherwise its required `title`, `publishedAt` and `site` would be readable.

## The record

Every block is a `site.standard.document`:

| Field | From |
| --- | --- |
| `site` | The member's `site.standard.publication` (one per website, verified with `/.well-known/site.standard.publication`) |
| `path` | Public only: `/posts/<label>/<sublabel>/<slug>`, so labels still decide addresses |
| `title` | The block's title. Untitled notes and photos need a rule the owner agrees, such as the set's name |
| `publishedAt` | When it was published; for a block that never was, when it was made |
| `content` | `com.ohmmmm.content.markdown`: Markdown, `connect`, `media`, `form` |
| `textContent` | The plain text, for every other reader |
| `tags`, `coverImage`, `description`, `updatedAt` | As standard.site defines them |

- **Labels** stay the owner's words: the first segments of `path`, and optionally tags.
- **Channels** have no standard.site type, so they stay ours: `com.ohmmmm.channel`, kept by the same rule (readable channels in the repo or a Friends space, private ones sealed).
- **Media** is a document whose content is `com.ohmmmm.content.media`: path, hash and metadata. The bytes stay in the media cache, and a blob goes to the PDS only on publish.
- Rendered pages carry `<link rel="site.standard.document" href="at://…">`. The feed Worker adds it.

## Changing visibility, from the cockpit and through agents

A visibility change is a move between places, never an edit of a field. One handler serves both ways in: the cockpit's button and the agent's tool call the same code (app rule 2), and every move shows what it does before doing it.

| Move | What happens | Undoable? | Who may finish it |
| --- | --- | --- | --- |
| Private → Friends | The device opens the envelope and writes the document to the Friends space, then removes the sealed copy | No: friends and syncing apps may keep copies | The person, on approval |
| Friends → Private | The device seals it into the private place, then removes it from the Friends space | Earlier copies may remain with friends or apps | The person; an agent with a grant for that channel |
| Friends or Private → Public | Goes through Publish: the plan shows what will be created; the person signs at their own PDS | No: public the moment it is written | The person, always |
| Public → Friends or Private | Publish takes the record down, then it is kept in the new place | Copies others made are not recalled | The person, always |

- **In the cockpit:** a block's visibility control shows the three places, the warning for the move (`visibilityMove` in `app/src/data/source.ts` already words them), and an `ApprovalCard` before anything is written. The WebMCP tools are `visibility.preview` (read-only) and `visibility.move` (consequential), registered only while the control is on screen.
- **Through coding agents:** `vault_set_visibility` keeps its two calls, the first describing the move and the second carrying the confirm value. A move that discloses (towards Friends or Public) is finished by the person in the cockpit or through Publish, never by the agent alone. ~~Moving towards private may be granted to an agent per channel, because it only narrows who can read.~~ The owner decided (24 November 2026) that agents may ask for any move, wider or narrower, and each one waits for the person's approval in the app.
- **What no agent can do:** publish, change the cortex's visibility, or add a friend.
- Every move is written to the journal with who asked, who approved and why. A copy-then-remove that is interrupted leaves both copies and says so (`cleanupPending`), never neither.

## Visibility moves: decided (24 November 2026)

- **One set of rules** (`vault/vault/visibility.mjs`), used by the cockpit, the service and the agent tools. The service handles the readable side and the journal; the device does the sealing.
- **Only the member shows a block to more people.** An agent with a write grant on the channel may start Friends → Private: the block is hidden from friends at once and sealed on the device when it is next unlocked. Public → anything is always the member's.
- An agent's other moves are **requests in the cockpit's notifications**. Each waits until the member answers it, pinned to the version the agent read.
- Grants are checked in the **local `.vault/grants.json`**, which the agent tools read with `--home`.
- **To public:** the post is marked, and the Publish page previews that one post (`?publish=<id>`). A block without a title waits for one. **Every block is a post** once public: one that is not yet is made one at its channel's address. Publishing itself may be done by the member or by an agent (`vault_publish`, preview first), and only publishes what the member marked public.
- **Agents never create friends-only blocks:** a new block starts private, and sharing it is a move.
- **Friends reads do not depend on the PDS:** when it is down, the last public copy is served, marked stale.
- **The journal** is a service table that names blocks by ID only (opaque IDs for private ones). It records who asked, who approved, why and the move's state.

## Order

1. **Now.** Make `site.standard.document` the public record and add the publication record and page tags. Migrate haeinjung.com's 2 records straight to it from `com.haeinjung.post`, skipping `com.ohmmmm.post`. Friends stays in ohm's service and private stays sealed in ohm's store, with a standard document inside each seal. Update `vault/AGENTS.md` rule 2, `docs/labels.md`, `docs/schema-layers.md` and the post store, mirror and Publish.
2. **Visibility controls** in the cockpit and agent tools, as above, over today's three stores. **Built for the home folder** (owner's decisions, 24 November 2026; [docs/serve.md](../../docs/serve.md)): a move between Only you and Friends rewrites the block's `visibility` once the person approves, and is journaled `via: visibility` with who asked and why (`vault/vault/visibility.mjs`). Nothing leaves the computer until syncing with the vault service is built, so the app says "not shared yet". Agents ask: `visibility.move` in the page and `vault_request_visibility` on the computer, and every move waits for the person; `vault_write` and `vault_restore` refuse to change a block's layer. Public, either way, is Publish: **built for the home folder** too (owner's decisions, 24 November 2026). Choosing Everyone on a block shows that block's plan, and once the person approves, `ohmmmm serve` publishes it with the app password kept on their computer (never in the browser), under the block's `id`, and marks the file public. The label defaults to the channel's name, is editable in the dialog, and is saved on the channel (`site: { label, sublabel }`). Taking a public block back first takes the record down, then moves it. No agent publishes (`vault/vault/publish-block.mjs`, [docs/serve.md](../../docs/serve.md)).
3. **When spaces are stable:** move Friends into members-only spaces on members' own PDSes, with ohm's service syncing them as an app. Offer personal spaces for the sealed private layer to people who host their own PDS.

## Open

- The title and date rules for untitled and never-published blocks: the owner's call.
- Whether a site keeps reading old `com.ohmmmm.post` records for a while, or the migration converts everything at once.
- Whether `site.standard.document` validators accept our `content` type unchanged. Test against the standard.site validator before step 1 ships.
- Spaces' stable release date and final API. Track proposal 0016 and Cirrus's `packages/spaces`.
