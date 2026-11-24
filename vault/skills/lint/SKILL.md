---
name: lint
description: Check a person's vault for meaning, not only structure — connections not drawn, duplicates, contradictions, gaps — and record what you find. Use when asked to tidy, check or "lint" the vault, or on a schedule.
---

# Checking a vault

The vault cannot judge meaning; you can. `vault_lint` finds candidates from the index alone, and you decide what they are.

1. **Refresh and orient.** Run `vault_index`, then `vault_where` to see the channels, the roots with the person's notes, and what you may change.
2. **Get candidates.** Run `vault_lint`. It gives reported problems, links to nothing, orphan blocks, related blocks with no link between them, and blocks with the same title.
3. **Judge each, reading both sides.** Use `vault_local_read` (and `vault_neighbors` for context). For each related pair or same title, decide one of:
   - **connected**: they belong together and nothing says so;
   - **duplicate**: the same thing twice;
   - **contradicting**: they disagree; say which is newer and what each says;
   - **unrelated**: shared words, nothing more. Drop it.
4. **Record conclusions in the cortex.** One `cortex_observe` per finding, `about` the blocks it concerns. A contradiction or a stale note says so plainly ("out of date: …"). Search with `cortex_recall` first so you do not repeat one.
5. **Fix only within the grant.** With a link grant, `vault_link` a connected pair with a one-line note. With a write grant, fix a missing link target or merge a duplicate with `vault_write` (pass `replaces`). Never resolve a contradiction yourself: ask. Outside your grant, propose in words.
6. **Say what is missing.** End with at most five questions for the person: notes the vault should hold, roots without a note.

Every change you make is journaled and its old version kept; the person can undo it with `ohm vault restore`.
