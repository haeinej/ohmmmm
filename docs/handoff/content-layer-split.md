# Handoff: the content layer, split between Claude and Devin

Written 24 November 2026. The plan is [vault/plans/content-layer.md](../../vault/plans/content-layer.md); read it first. Every session works in the cloud on `haeinej/ohmmmm` (or `haeinej/haeinjung.com` where said), starts from GitHub, and ends in a PR. Nothing lives only on someone's machine.

## Who does what

- **Claude (Claude Code cloud sessions): core work the owner watches.** Anything that decides the model, the service's API, what is public, or what an agent may do. These sessions ask the owner when a decision is theirs.
- **Devin: fixed, long-running work.** Work whose shape is already decided here: build to the spec, test, document, keep branches green.

Two writers never touch the same files:

| Owner | Files |
| --- | --- |
| Claude | `vault/service/`, `vault/vault/`, `vault/mcp/`, `vault/lexicons/`, `app/`, `contract/`, `docs/words.md`, `vault/plans/`, `vault/AGENTS.md` |
| Devin | `vault/astro/` (new), the `haeinej/haeinjung.com` repo, and conflict-only merges of `main` into PRs #34 and #35 |

If a Devin task needs something in a Claude-owned file (a service request, a word), it says so in its PR description and does not make the change.

## Merge order (the owner merges; no one merges their own PR)

1. #36 (standard.site plan), then #37 (posts as standard.site documents).
2. The content-layer plan PR (this file).
3. #33 (production wiring), after Claude's **C1** removes the inbox from it.
4. #34 (curator) and #35 (host your PDS), after Devin's **D3** brings them up to date with `main`.

## The work

| ID | Who | What | Starts when | Branch |
| --- | --- | --- | --- | --- |
| C1 | Claude | Remove the inbox (plan › Remove the inbox), on #33 | Now | `home/production-wiring` |
| C2 | Claude | Content reads for sites: public channels and blocks by DID, and Friends reads with a viewer's ohm session | After #33 merges | `vault/content-reads` |
| C3 | Claude | Visibility moves, publishing as one of them (standard.site plan › step 2) | After C2 merges | `home/visibility` |
| D1 | Devin | The `ohm` Astro loader, public content from the member's PDS | After #37 merges | `vault/astro-loader` |
| D2 | Devin | haeinjung.com reads its content through the loader | After D1 merges | in `haeinej/haeinjung.com` |
| D3 | Devin | Bring #34 and #35 up to date with `main` | After #33 merges | their own branches |
| D4 | Devin | Friends content in the loader, through Astro live collections and C2's reads | After C2 and D1 merge | `vault/astro-friends` |

### Why D1 reads the PDS first

The vault service has no reads for anyone but the member yet (every Posts and Friends request needs a session or the member's token). Public posts are already readable on the member's PDS as `site.standard.document`s after #37. So D1 builds the loader behind a small source interface and ships with the PDS as its public source; C2 adds the service reads; D4 adds Friends through them. The plan's "one content API" holds once C2 lands: the loader then reads public content from the service too, and the PDS source stays for sites with no ohm account.

## Rules for every session

- Read `AGENTS.md`, `vault/AGENTS.md`, `docs/words.md`, and the plan. The rules in [devin-ohmmmm-app.md](devin-ohmmmm-app.md) › "Rules that bind every WP" apply to everyone: never rename the `ohm-vault` runtime names, no deploys, no remote D1, no migrations applied anywhere real, no merging your own PRs, never print or commit secrets.
- Node 22.19 or newer (`node:sqlite`). Run `npm test` at the root before every PR.
- Synthetic people and data in tests and docs. Never commit anything from `allnotes/` or `photo archive/` in haeinjung.com: they are private and are not in its repository.
- Nothing is written to a real PDS. Publishing anything needs the owner.
- Finish each PR with documentation, as `vault/skills/document-work/SKILL.md` says.
- End commits with the co-author line your tool uses, and say in the PR which task ID it is.
