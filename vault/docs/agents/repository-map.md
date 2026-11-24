# Repository ownership and state contracts

This is the source-checkout maintenance reference for the [human repository guide](../repository-map.md).
Use [AGENTS.md](../../AGENTS.md) for policy, [service capabilities](../../service/CAPABILITIES.md)
for exact request metadata, and the [public agent guide](https://github.com/haeinej/ohm-site/blob/main/docs/agent-guide.md)
for member-facing tool use. This map explains why paths are retained and where
state transitions live; it does not replace those contracts. The packaged CLI
intentionally excludes the backend, public-site source and Cirrus;
clone the repository to follow their source and build links.

## Data and control boundaries

```text
DID document -> named PDS -> public records -> feed / owner's renderer
member browser or MCP -> authenticated service -> DID-scoped vault posts
vault -> approved publication plan -> member-side PDS uploads / record writes
local folder <-> versioned vault sync
configured published source -> mirror Worker -> owner PDS + mirror checkpoint KV
```

A name or request argument never selects another member's private storage. Shared lexicons remain fixed. Owner-specific
fields stay in the optional owner layer. Newly imported posts file under an author
label or `other`; the label-derived path and permanent record key are separate.
Preserve legacy slug-keyed records and configuration filenames when extending
current ID-keyed paths.

## Entry points, loading and generated output

| Boundary | Entry/source | Loading reason and ownership |
| --- | --- | --- |
| Devin environment | [blueprint](../../.devin/blueprint.yaml), [contributor setup](../../README.md#work-on-this-repository) | Root-relative, incremental npm maintenance for root and service with package locks enabled. The base image supplies nvm and Node22+; optional Cirrus verification is separate. Sync the merged file in environment settings before building a snapshot from Git changes. |
| npm CLI | [bin/ohm.mjs](../../bin/ohm.mjs), [package.json](../../package.json) | npm `bin` dispatches commands into `scripts/`; package `files` is the distribution boundary. Check an extracted tarball, not only source imports. |
| MCP stdio | [mcp/server.mjs](../../mcp/server.mjs), [protocol](../../mcp/protocol.mjs), [tools](../../mcp/tools.mjs) | Serialized JSON-RPC; lazy member authentication; ten vault tools. `service/public/vault/publish.js` is intentionally shared with member-side publication and must be packed. |
| Hosted member service | [worker](../../service/src/worker.mjs), [capability registry](../../service/src/capabilities/index.mjs), [schema](../../service/schema.sql) | Registry dispatch and D1 state, with browser assets under `service/public/vault/`; service dependencies have their own lock. |
| Public feed / attached UI | [feed config](../../feed/wrangler.jsonc), [worker](../../feed/worker.mjs), [site](../../site/) | Wrangler mounts assets, cron and routes; absence of JS imports is not dead-code evidence. |
| Scheduled source mirror | [mirror config](../../mirror/wrangler.jsonc), [sync](../../mirror/sync.mjs), [readers](../../mirror/sources.mjs) | Configured sources, write credentials, budget and KV checkpoints; explicit deployment/source approval is separate from a local build. |
| Public home | [home config](https://github.com/haeinej/ohm-site/blob/main/home/wrangler.jsonc), [worker](https://github.com/haeinej/ohm-site/blob/main/home/src/worker.js), [site map](https://github.com/haeinej/ohm-site/blob/main/home/README.md) | Six canonical HTML routes plus join/static/alias handling. Home schema path resolves to the root Wrangler dependency. |
| Public docs | [build.py](https://github.com/haeinej/ohm-site/blob/main/docs/build.py), [public ownership](https://github.com/haeinej/ohm-site/blob/main/README.md) | Edit generator, then regenerate HTML/Markdown/LLM/navigation. `.assetsignore` excludes generator/config from docs assets. |
| Capability reference | [scripts/capabilities.mjs](../../scripts/capabilities.mjs) | `npm run capabilities` writes `service/CAPABILITIES.md` from executable registry/tool tables. |
| PDS wrapper | [Cirrus entry](../../cirrus/src/index.ts), [config](../../cirrus/wrangler.jsonc), [package](../../cirrus/package.json) | Upstream PDS re-export is a Vite/Wrangler entry, with independent lock and durable-object migration history. |
| Compatibility / examples / plans | [lexicons](../../lexicons/), [examples](../../examples/), [plans](../../plans/), [skills](../../skills/) | External records, namespace templates, round-trip fixtures and instruction/design consumers. Plans do not prove runtime feature completion. |

Before removal, check direct imports, dynamic command dispatch, package allowlists,
Wrangler mounts/routes/bindings, generators, tests,
external compatibility and instruction links. Regenerate a consumer when its
authored source moves. Keep runtime outputs such as `.ohm/sync.json`, temporary
replacement files and `.from-ohm` conflict copies distinct from repository source.

## Content lifecycle inventory

These are state/process families, not a claim that each is a formal FSM class.
External calls can fail between every transition. Source links identify the owner;
tests named below are local fixtures unless explicitly stated otherwise.

| Flow | States, guards and recovery | Owner / verification |
| --- | --- | --- |
| Configuration and deployment mode | Explicit config or first discovered legacy/current path -> validated owner/site -> attach or standalone mode. `posts`/`snapshot` accept `--config` or one legacy positional path, never both. Invalid input stops before work. | [config](../../scripts/config.mjs), [CLI regressions](../../test/content-cli.test.mjs) |
| DID and handle resolution | Resolve -> document/PDS validation -> verified/unverified handle. A positively mismatched PDS refuses refresh; unavailable resolution differs from a verified mismatch. | [identity](../../feed/identity.mjs), [identity tests](../../test/identity.test.mjs) |
| CLI publication | Validate -> stage attachments -> preview -> explicitly approved upload/record commit. `--publish` is the public write boundary; private import `--save`, folder `--apply` and local renderer output are distinct. Failed final writes can leave unreferenced uploaded blobs. | [publish](../../scripts/publish.mjs), [vault tests](../../test/vault.test.mjs) |
| Store versions and blobs | Absent/present -> create or expected-version replace/delete -> conflict/commit. PDS uses CID preconditions; blob identity is not record version. Own-KV uses read-before-write and requires a single writer. | [stores](../../vault/stores.mjs), [core](../../vault/core.mjs) |
| Visibility transfer | Find unique source -> copy destination -> delete source. Failed removal keeps both; normal operations refuse duplicates. Operator compares both stores and version-deletes only the unwanted copy. No cross-store rollback claim. | [vault](../../vault/vault.mjs), [safety tests](../../test/content-safety.test.mjs) |
| Friends approved like devices | askFriend (ohm) -> listFriendRequests -> approveFriend/declineFriend/setFriendChannels (ohm only); friendScope/inScope used by listShared/getShared and content reads. See [friends](friends.md). | [friendship](../../service/src/friendship.mjs), [tests](../../test/friendship.test.mjs) |
| Visibility moves | `vault/visibility.mjs` rules -> service previewMove/hideBlock/requestMove, ohm-only decline/recordMove, `moves` journal by ID -> MCP asks, cockpit `setVisibility` one handler. See [visibility](visibility.md). | [rules](../../vault/visibility.mjs), [service](../../service/src/visibility.mjs), [tests](../../test/visibility.test.mjs) |
| Content reads for sites | `content.*` by owner DID -> `audienceOf`/`sees` -> public from the PDS, friends from D1, never private; viewer tokens via `content.view` to listed `sites`. See [content for sites](content-for-sites.md). | [content](../../service/src/content.mjs), [viewers](../../service/src/viewers.mjs), [tests](../../test/content.test.mjs) |
| Vault nodes and evidence | Path -> block/channel/entity/source -> problems; nodeFile round-trips; posts delegate to file.mjs. Evidence only from content. See [vault format](vault-format.md). | [node](../../vault/node.mjs), [node tests](../../test/node.test.mjs) |
| Markdown/file identity | Parse -> validate metadata/ID/path -> post/version. Invalid occupants and copied IDs block affected sync work; they do not become absence. Reserved conflict-copy suffixes are not new posts. | [file](../../vault/file.mjs), [folder](../../scripts/folder.mjs) |
| Three-way folder sync | Compare local, vault and baseline -> push/pull/delete/conflict -> apply -> confirm settlement -> keep next baseline. Cleanup requires a recognized comparison copy whose post ID settled in this run. Occupied/reserved destinations and failed saves preserve affected baseline and comparison copies, even after an explicit choice. Unknown/orphaned comparison files require manual review. Apply is not atomic across filesystem and service. | [sync](../../vault/sync.mjs), [sync tests](../../test/sync.test.mjs), [safety tests](../../test/content-safety.test.mjs) |
| Published import | Complete inventory -> reconstruct -> report differences/losses -> optional save. Changed vault versions are preserved. An incomplete inventory cannot proceed to mutation. | [import command](../../scripts/import.mjs), [import](../../vault/import.mjs) |
| Legacy migration | Read old collection -> convert/validate -> preview -> approved fixed-type writes. Preserve legacy read paths; do not rename the shared schema. | [migrate](../../scripts/migrate.mjs) |
| Hosted publication | Plan -> prepare attachments -> displayed confirmation -> member-side upload/apply. Compare placement, source/blob address, kind and image-only alt metadata; all embed labels compare in the body. ID-only renaming is not content loss. Published PDFs/video/audio with descriptive text remain unchanged on a second plan, matching the shared serializer. Mutable bytes behind an unchanged remote URL are not previewed as a content digest. | [plan](../../vault/publish.mjs), [preparation](../../service/src/capabilities/publish.mjs), [browser apply](../../service/public/vault/publish.js), [publication tests](../../test/publish.test.mjs) |
| Profile merge | Read valid current record/CID -> merge selected fields -> stage optional blobs/links -> conditional self-record write. Only explicit RecordNotFound is absence during publication; HTTP/protocol failures stop writes. Multiple records/blobs are not one transaction. | [profile](../../scripts/profile.mjs), [CLI tests](../../test/content-cli.test.mjs) |
| CLI PDS/service authentication | Sign in -> obtain method-bound service token -> request; renew on the defined refusal path. Credentials remain private process input, never post content or docs. | [RPC](../../scripts/rpc.mjs), [vault client](../../scripts/vault-client.mjs) |
| Mirror scheduling/retries | Read source window -> per-item validation -> bounded attempts -> waiting/error/complete. Cursor rotates attempts across sources; failing expensive items consume budget. No distributed run lock or full-history guarantee. | [mirror](../../mirror/sync.mjs), [mirror tests](../../test/mirror.test.mjs) |
| Mirror ownership/checkpoints | Bind repository/origin/site/source identity -> select stable/collision-safe key -> validate ownership/version -> persist intended record -> write -> complete checkpoint. Interrupted acknowledgments reconcile canonical intended records regardless of JSON property order. Ambiguous v1/media/metadata mappings, unrecognized checkpoint variants or external edits require operator review. | [mirror](../../mirror/sync.mjs), [mirror tests](../../test/mirror.test.mjs) |
| Feed refresh/inventory/expiry | Verify config/identity -> bounded complete pages -> normalize -> snapshot. Cursor cycles/caps fail; empty advancing pages continue. Previous snapshot may remain until TTL on failure; it does not establish live slug absence. | [repository reader](../../feed/repository.mjs), [worker](../../feed/worker.mjs) |
| Public routing and aliases | Resolve live owner-scoped slug or permanent key -> normalize -> canonical redirect/render. Qualified canonical slug and bare key aliases must not hijack each other. Duplicate slug matches or incomplete required inventories fail closed. No historical slug registry is added. | [worker](../../feed/worker.mjs), [slug tests](../../test/slug.test.mjs) |
| Private/friends feed gate | Access identity -> configured permission -> scoped graph/blob response or refusal. This self-hosted surface is distinct from hosted vault cookies and planned friends delivery. | [private feed](../../feed/private.mjs) |
| Static notes view | Load graph/view hints -> filter/render -> detail or failure. Owner hints are presentation, not authorization. Server-side gates remain authoritative. | [notes UI](../../site/notes.js) |
| Renderer adoption/build | Adopt original page -> structural sidecar/template -> compare round trip -> build only compatible shape. Sidecar v2 records item/link/image shape and required tokens. Old/missing sidecars, changed cardinality or removed slots refuse before output replacement; explicit re-adoption is recovery. | [engine](../../scripts/render-engine.mjs), [command](../../scripts/render.mjs), [renderer tests](../../test/render.test.mjs) |
| Schema/site-layer binding | Select fixed/shared schema and optional owner layer -> validate -> render/publish. Example namespace files are templates, not hard-coded owner state. | [lexicon command](../../scripts/lexicon.mjs), [layers](../../scripts/layers.mjs) |
| Cirrus build/migration | Install locked package -> Vite build -> separately configured deploy/storage migration. A single upstream re-export is intentional; do not prune migrations as unused source. | [Cirrus](../../cirrus/), [config](../../cirrus/wrangler.jsonc) |

## Member workspace lifecycle inventory

| Flow | States, guards and recovery | Owner / verification |
| --- | --- | --- |
| HTTP identity/admission | Token or ohm cookie -> one request DID snapshot -> expected-DID check -> membership -> capability. Cookie and PDS paths enforce admission for private data/keyboard changes. Account discovery/connect/disconnect remain recovery paths. Reconnect never retargets an admitted mutation to the new DID. | [worker](../../service/src/worker.mjs), [identity](../../service/src/identity.mjs), [race tests](../../test/workspace-service.test.mjs) |
| Browser onboarding/session | Disconnected -> OAuth pending or visit-only password session -> connected/expired/logged out. Persistent owner ID and token-pair compare/write share an IndexedDB transaction. Late refresh/callback cannot restore logout or same-DID replacement; old stored sessions without ownership require sign-in again. | [signin](../../service/public/vault/signin.js), [signin tests](../../test/signin.test.mjs) |
| Scoped browser transport | Capture displayed DID/generation -> issue auth -> send expected-DID header -> read JSON/bytes -> recheck. Stale attachment bytes never reach later upload/apply. A PDS write already sent is not reversible. | [scope](../../service/public/vault/account-scope.js), [browser handlers](../../service/public/vault/vault.js), [handler tests](../../test/vault-browser.test.mjs) |
| Editor/tree/save | Read/selected/dirty/saving -> saved/conflicted/abandoned. Selection tickets ignore old reads and completions. Dirty navigation can be cancelled; pending save advances base version while retaining subsequent typing. Unload warning is best effort; unsaved text has no durable draft store. | [browser handlers](../../service/public/vault/vault.js), [handler tests](../../test/vault-browser.test.mjs) |
| PDS-to-vault mirror approval | Preview -> confirm displayed summary -> apply reads once, compares optional `expectedSummary`, then saves that read. Counts/caveats changes refuse before saves; clean same-summary body/ID changes are allowed. This is not exact-content approval. Completion marks only the original user/DID link mirrored. | [mirror capability](../../service/src/capabilities/mirror.mjs), [MCP tests](../../test/mcp.test.mjs) |
| MCP protocol/auth/confirmation | Parse -> serialized dispatch -> result/error -> next request. Invalid parameter shapes return controlled errors; unexpected handler errors do not poison the queue. Side effects retain their tool-specific confirmation contracts. | [protocol](../../mcp/protocol.mjs), [tools](../../mcp/tools.mjs), [MCP tests](../../test/mcp.test.mjs) |

## Public surface and instruction lifecycle inventory

| Flow | States, guards and recovery | Owner / verification |
| --- | --- | --- |
| Home canonicalization | HTTP/www/known alias -> permanent canonical redirect; known page -> metadata/assets; missing route -> real noindex404. | [home Worker](https://github.com/haeinej/ohm-site/blob/main/home/src/worker.js), [SEO tests](https://github.com/haeinej/ohm-site/blob/main/home/test/seo.test.mjs) |
| Join submission/storage | Validate origin/body -> rate limit -> idempotent persistence or refusal. POST remains network-only and is not replayed by the service worker. | [home Worker](https://github.com/haeinej/ohm-site/blob/main/home/src/worker.js), [join tests](https://github.com/haeinej/ohm-site/blob/main/home/test/join.test.mjs) |
| Join popup | Closed/open -> submitting -> success/error -> close/reopen. UI feedback is separate from server validation. | [join UI](https://github.com/haeinej/ohm-site/blob/main/home/public/join.js) |
| Service-worker ownership | Register -> install/precache -> activate -> old-cache cleanup. Added/renamed/removed assets require updating cache ownership/version; ordinary edits follow existing refresh policy. | [service worker](https://github.com/haeinej/ohm-site/blob/main/home/public/sw.js), [site instructions](https://github.com/haeinej/ohm-site/blob/main/home/README.md) |
| Navigation fetch race | Preload/network vs timeout -> cached page/root fallback. Timeout fallback is not proof of network availability. | [service worker](https://github.com/haeinej/ohm-site/blob/main/home/public/sw.js) |
| Asset cache | Cached asset -> background refresh; fonts retain immutable policy. Every precached script, including join.js, has a reachable GET route. | [service worker](https://github.com/haeinej/ohm-site/blob/main/home/public/sw.js), [cache tests](https://github.com/haeinej/ohm-site/blob/main/home/test/sw.test.mjs) |
| Responsive navigation | Desktop rail vs mobile menu checkbox -> open/closed -> selected route. Docs stay header-free with a normal-flow mobile control. | [docs source](https://github.com/haeinej/ohm-site/blob/main/docs/build.py), [docs CSS](https://github.com/haeinej/ohm-site/blob/main/docs/styles.css) |
| Docs reader | Heading click/scroll -> queued active-section update -> stable linked heading. Preserve legacy `#architecture` and generated HTML/Markdown anchors. | [reader](https://github.com/haeinej/ohm-site/blob/main/docs/reader.js), [docs tests](../../test/docs.test.mjs) |
| Landing rendering | WebGL available/unavailable -> active/paused/reduced-motion -> render or CSS fallback. Viewport and motion preference own animation work. | [landing](https://github.com/haeinej/ohm-site/blob/main/home/public/landing.js) |
| Docs generation | Authored content -> parser modes -> generated outputs -> link/ID checks. A failed run can leave partial output; rerun from fixed source and inspect the full diff before committing. A diagram needs both a `FIGURES` drawing and a `FIGURE_TEXT` (or `SEQUENCES`) entry so the Markdown copy describes it; the sidebar's Source link comes from `REPOSITORY`. | [generator](https://github.com/haeinej/ohm-site/blob/main/docs/build.py), [docs tests](../../test/docs.test.mjs) |
| Agent-led site/label workflow | Inspect original -> baseline copy -> proposed filing/migration -> owner approval -> verified change. Source is the rendering specification; no unapproved public writes. | [migration skill](../../skills/migrate-site/SKILL.md), [label skill](../../skills/suggest-labels/SKILL.md) |
| Documentation completion | Coherent implementation -> establish final truth -> human/agent canonical updates -> regenerated navigation -> handoff with evidence/limits. Instructions add no automation runtime. | [document-work](../../skills/document-work/SKILL.md) |
| Planned social/folder models | Design/proposal only for friends delivery, finding people and browser/cloud folder ownership. Keep planned states separate from implemented local CLI sync. | [network plan](../../plans/network-architecture.md), [status](https://github.com/haeinej/ohm-site/blob/main/docs/limits.md) |

## Verification and changes

From the repository root, with Node22+ and Python3:

```sh
npm ci
npm --prefix service ci
npm run capabilities
npm test
git diff --check
```

For routine maintenance, use the incremental installs in
[the blueprint](../../.devin/blueprint.yaml) instead of the clean-install commands
above. Its `maintenance` block runs during snapshot builds and is surfaced, not
automatically executed, at session start. Keep package locks enabled, inspect any
lockfile changes, and keep builds/tests out of dependency maintenance. A pushed
blueprint requires merge and sync before Git changes affect snapshot builds;
the existing saved settings remain separate until configured to use Git. See the
[sync workflow](https://docs.devin.ai/onboard-devin/environment/git-backed-blueprints).

The suite covers schema/registry parity, member isolation, CAS, queue recovery,
OAuth races, DOM-handler interleavings, pagination, mirror recovery, renderer
shape, extracted-package MCP startup, HTML/Markdown IDs and offline asset routing.
The minimal DOM and in-memory D1/IndexedDB/network fixtures are not Chrome, live
OAuth, production D1/KV or proof of deployment. Do not relabel them as browser
end-to-end evidence.

The public sites (ohmmmm.com and docs.ohmmmm.com) are in [haeinej/ohm-site](https://github.com/haeinej/ohm-site), with their own tests and deploy checks (`npm run home:check`, `npm run docs:build`). Its docs read this repository's `service/CAPABILITIES.md` and check every request and vault tool against it, so after changing either, rebuild and test there too.

For affected components, add:

```sh
npm exec -- wrangler deploy --config feed/wrangler.jsonc --dry-run
npm exec -- wrangler deploy --config mirror/wrangler.jsonc --dry-run
pnpm --dir cirrus install --frozen-lockfile
pnpm --dir cirrus run build
```

The Cirrus commands need pnpm; its lock is separate from the root npm lock.
Preserve `x-ID` keys, authored label text and old public routing compatibility.

`expectedSummary`/`summary` on PDS-to-vault mirror are additive metadata; direct
older apply calls remain valid. The guard needs a service that implements it;
updating a local client does not update the deployed backend. Keep the existing
request names, authorization modes and MCP interfaces stable. Report any additive
contract change explicitly instead of claiming byte-for-byte contract equality.

Run package checks against a fresh extracted npm artifact with locked production
dependencies. Do not load accidental source-checkout files through symlinks or
install service dependencies from a test hook. Check static asset/config paths
from their declaring directory, including deployment conventions and fragments.
No source deletion is justified by a missing literal-import edge alone.

Use [document-work](../../skills/document-work/SKILL.md) before handoff. Keep fixed
schemas, DID isolation, owner approval and original-site comparison as release
gates. Distinguish local build, fixture tests, packaged execution, live account
verification and deployment; do not use a green local suite to claim all five.
