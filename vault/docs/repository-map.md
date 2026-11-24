# Working on ohm without losing the thread

ohm lets someone keep a working copy of their posts, publish the ones they choose
to their own PDS, and show those records through the website they already have.
Keeping the working copy separate from what is published makes it possible to
change the editor or an agent tool without accidentally publishing a draft.

This guide helps contributors find the right place to change something and
recognize when the result is safe to use. For a first personal workspace, start
with the [human product guide](https://github.com/haeinej/ohm-site/blob/main/docs/quick-start.md). For exact ownership,
state transitions and checks, use the [agent repository guide](agents/repository-map.md).

## Follow the person's work

The DID identifies the person and names their PDS. The vault keeps working posts.
A browser or an authorized agent uses the same member-scoped service. Publishing
prepares a separate proposal, then the member applies approved changes at their
PDS. The feed and their site read published records.

That separation matters during an ordinary edit. Saving a private draft must not
make it public. Switching accounts must not send its attachments to another
account. Typing while a save is waiting must leave the newer text available for
the next save. Moving a website must preserve its content and appearance. These
are the outcomes the module boundaries and failure checks protect.

## Find the right home

| If you are changing… | Start here | Why it exists separately |
| --- | --- | --- |
| Commands and configuration | [bin](../bin/ohm.mjs), [scripts](../scripts/) | One command entry point finds the owner's configuration; individual commands keep their distinct write permissions. |
| Post files, versions, folder sync or publication proposals | [vault](../vault/) | Shared transformations keep file identity and record identity consistent across the browser, CLI and agents. |
| Blocks, channels, entities, sources and their connections | [vault folder format](vault-format.md), [node.mjs](../vault/node.mjs) | The vault's own format for thinking, Are.na style; posts are one kind of block, read by the post code. |
| The member API or editor | [service](../service/README.md) | Authentication and durable member storage belong at the service boundary; the editor adds draft and navigation behavior. |
| Agent tools | [mcp](../mcp/) | MCP composes the same service operations, including previews and confirmations, rather than inventing another data store. |
| Public records and post addresses | [feed](../feed/), [labels](labels.md) | Public readers resolve the owner's records and their label-derived addresses. |
| The attached notes interface | [site](../site/) | These files are mounted as Worker assets; they are reached by HTTP routes rather than JavaScript imports. |
| Who is a friend, and what they see | [friends](friends.md) | People ask, signed in to ohm; the member approves them like devices, for every channel or some; their agents read as they do. |
| What your coding agents may do | [your agents in ohm](agents-panel.md) | Each action an agent's ohm tools take waits in the Agents panel for the member's Approve; the member pauses or disconnects agents there. Mail is sent by the agent from the member's own address. |
| Who can see a block, and moving it | [visibility](visibility.md) | Only the member shows a block to more people; agents ask, or with a grant hide a block on its way to private; every move is journalled. |
| What a member's website reads, and who sees what | [content for sites](content-for-sites.md) | Sites read the vault by DID: public is what is published on the PDS, Friends only for a friend with a viewer token, never private. |
| Scheduled copying from published sources | [mirror](mirror.md) | A configured source reader has its own budget, ownership checkpoints and recovery; it is different from bringing PDS posts into a private vault. |
| A PDS deployment | [Cirrus](../cirrus/) | Its own package and build wrap the upstream PDS and its durable storage. Root CLI installation does not deploy it. |
| Public product pages | [public site map](https://github.com/haeinej/ohm-site/blob/main/home/README.md) | The live home Worker owns its pages, SEO, join flow and offline assets. |
| Public documentation | [documentation source](https://github.com/haeinej/ohm-site/blob/main/docs/build.py) | One authored source produces HTML, Markdown, the LLM reference and navigation so they agree. |
| Reusable agent methods | [skills](../skills/README.md) | Instructions guide agent behavior; they are not a runtime watcher or background service. |
| Protocol contracts | [lexicons](../lexicons/), [schema layers](schema-layers.md) | Fixed shared schemas preserve compatibility; optional owner schemas describe only the owner's extra fields. |
| Examples, tests or design rationale | [examples](../examples/), [tests](../test/), [plans](../plans/) | Examples preserve supported shapes, tests exercise failure boundaries, and plans explain intent without claiming it is implemented. |

Do not delete a file just because it has no import. Wrangler loads assets and
Workers from configuration; npm loads command and plugin entry points. Old
configuration filenames still serve existing owners.

## Get a useful local result

Use Node 22 or later. From the repository root:

```sh
npm ci
npm --prefix service ci
npm test
```

The root lock installs the CLI, Markdown tooling and local Worker tooling. The
service has a separate lock because its signature-verification library belongs
to the backend. Contributor tests need both; an owner running the packaged CLI
does not need to install the backend. If tests cannot find the service's
`@noble/curves`, run its install command instead of changing imports. Test and
package-install hooks do not download missing service dependencies for you.

When returning to an installed checkout, use the [incremental maintenance commands](../README.md#work-on-this-repository) to reuse existing dependencies while respecting both lockfiles. The [Devin blueprint](../.devin/blueprint.yaml) keeps those commands in Git for review. A new checkout still needs both installs; Cirrus remains an optional component check described below.

A small first change is a documentation correction. The public sites, ohmmmm.com and
docs.ohmmmm.com, live in their own repository, [haeinej/ohm-site](https://github.com/haeinej/ohm-site),
checked out beside this one. Edit the authored text in its `docs/build.py`, then run there:

```sh
npm run docs:build
npm test
npm run docs:dev
```

Python 3 generates the static documentation; no Python package install is needed.
The preview serves this checkout on loopback port 8791. Open it in a browser on
the machine running the command. You should see the correction, working section
links and the existing header-free reading layout. Inspect the generated diff:
the HTML, Markdown and LLM versions should tell the same story. If generation
fails partway, fix its source and rerun before keeping any output.

For public home work, use `npm run home:dev` on port 8790 in ohm-site, then
`npm run home:seo -- http://127.0.0.1:8790`. These commands are owned by that repository
and do not depend on a private editor launcher. Local tests and previews require
no member password or production deployment.

Cirrus uses its own pnpm lock: it needs pnpm, a frozen
install and a build only when you work on the PDS component.

## Understand a refusal before retrying

| What you see | What it protects | What to do next |
| --- | --- | --- |
| A changed-account or membership refusal | A stale page must not read or mutate another displayed account's work. | Reopen the workspace for the intended account. Account discovery and disconnect remain available when admission is revoked. |
| A warning about unsaved writing | Navigation would discard a local draft. | Cancel to keep editing, or save. New text typed during a pending save still needs its own save. |
| A version conflict | Someone changed the stored post after it was read. | Keep the draft, read the current version and reconcile before retrying. |
| An occupied sync path, invalid file or copied ID | Pulling must not overwrite an unrelated file or treat invalid local content as a deletion. | Preserve both copies; correct the metadata or choose another path, then preview again. An explicit choice only clears its comparison copy after the chosen save or pull succeeds. Do not discard the sync baseline to suppress the warning. |
| An incomplete repository listing | A partial list cannot safely stand for everything the person owns. | Retry after the PDS recovers, or review the configured bound; do not treat the partial result as a completed import. |
| A changed mirror summary | Counts or conversion losses changed between review and saving. | Review a new preview and confirm it. This approval covers the displayed summary, not frozen body bytes. |
| An old renderer sidecar or changed page shape | The existing template has no proven place for all the content. | Keep the old template, sidecar and output. Update a copy of the source page as needed, then explicitly adopt it again and compare the rebuilt page. |
| An ambiguous mirror checkpoint or externally edited record | An automatic copy cannot prove that it owns the existing record. | Preserve the record and checkpoint for operator review; do not clear state to force an overwrite. |

A `.from-ohm` file is a comparison copy, not another post to upload. If sync
refuses your chosen resolution, or its save fails, the copy stays for retrying.
A copy with an unknown or different post ID stays for manual review; only remove
it yourself after checking that its writing is preserved.

Keep descriptive text on document, video and audio embeds. After a successful
Publish, opening its preview again leaves these unchanged instead of sending
the files again. Changing their source address or descriptive text still appears
in the next preview.

Private writing in the editor lives in the current page until saved. Save before
closing it. A network request already sent can complete even after navigation;
the editor prevents its completion from reopening an old post or replacing newer
typing. An account switch can stop later publication steps, but cannot undo a
PDS write already sent.

Two older library boundaries remain deliberate. A failed move between visibility
stores can preserve two copies; normal vault commands then refuse the duplicate.
An operator must compare the stores and remove only the unwanted copy using its
current version. The own-KV adapter requires a single writer because its version
check is a read followed by a write, not a distributed transaction. Neither is a
promise of atomic movement across independent stores.

## Finish where the next person can continue

Run checks for the behavior you changed, regenerate references from their sources,
and use [document-work](../skills/document-work/README.md) to maintain both the
human guide and the agent contract. A useful handoff explains the result and the
remaining recovery boundary, with local checks separated from live verification.
The [status guide](https://github.com/haeinej/ohm-site/blob/main/docs/limits.md) is the product boundary: browser/cloud
folder sync and planned social flows must not be described as shipped merely because a plan or placeholder exists.
