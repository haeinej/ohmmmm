# Your vault as a folder

Until now a vault held one kind of thing: posts, each filed under one label. That is enough for a website, but not for thinking. An article you saved, the passage you kept from it, a SQL query, a PDF on Google Drive and your own half-formed idea all had to be "a post", and each could sit in only one place.

The vault now reads a folder the way Are.na arranges things. A **block** is one unit of thought. A **channel** is an ordered collection, and a block can be in as many channels as you like. **Sources** keep what came in from outside as it was, and **entities** are the people, works, places and organisations many blocks are about. Your existing posts are blocks too, so nothing you already have changes.

This guide covers the file format, the other folders a vault can read, and its index. The agent tools come next; see [the plan](../plans/vault.md).

## What you need, and why

| You need | Why |
| --- | --- |
| A folder | The vault is the folder. Every block, channel and entity is a Markdown file in it, so it opens in Obsidian, any editor, or Finder, and is yours without ohm. |
| Node 22 or newer | The index is a SQLite database, which Node has built in. Before Node 22.13 the command turns it on for itself. |
| Nothing else | No account and no service are needed to write, read or index the vault. Publishing a block as a post still goes through the vault service, as before. |

## A small vault

```
Vault/
  writing/
    _channel.md                 the channel "writing": its title and order
    trap-of-independency.md     a block (here, a post you published)
    collisions/                 a channel inside "writing"
      ep-01.md
  analytics/
    churn-query.md              a block about a query
    churn.sql                   the query itself
  _entities/person/ada-lovelace.md
  _sources/<id>/source.json     an article you captured
```

A block's folder is its **home channel**. To put it in more channels, list them:

```markdown
---
kind: code
title: Q3 churn query
channels: [sql-snippets]
origin: ~/work/queries/churn.sql
---

What I used for the board review. It joins on `account_id`, not `user_id`, because of the merge.

![[churn.sql]]
```

- **kind** says what the block is: `text`, `excerpt`, `link`, `media`, `file`, `code` or `post`. You rarely write it. A block that is one fenced code block is `code`, one embedded file is `file` or `media`, one address is a `link`, and anything else is `text`. Write it when you mean something else, as above.
- **origin** is where the original lives, when it is not this file: a path on your computer (`~/…` or `/…`), a Google Drive path (`gdrive:My Drive/…`, or the folder Google Drive for desktop mounts), a web address, or an AT URI.
- **from** names the source a block was captured from, and **excerpt** holds the exact words you kept: `excerpt: {"quote": "the words"}`.
- **by** and **status** say who made a block (`me` or `agent:<name>`) and whether it is `proposed`, `kept` or `archived`.
- **visibility** says which layer the block is in, and so who can read it: `private` (the default; encrypted, readable only on your devices), `friends` (readable by ohm and the friends you choose) or `public` (published). Leave it out and the block is private. See [the plan for the three layers](../plans/encryption.md); the storage behind them is not built yet.

The file stays readable: SQL, Python or any other code goes in a fenced block with its language, and Obsidian's `[[links]]`, `![[embeds]]`, callouts, Mermaid diagrams and math all keep working. The vault never runs code.

## How things connect

The vault draws a connection only where your content shows one, and says where it found it:

| Connection | Comes from |
| --- | --- |
| A channel contains a block | the block's folder, or its `channels` list |
| A channel contains a channel | a folder inside a folder |
| A block links to something | `[[slug]]`, `[[slug|words]]`, a `[words](https://…)` link, or a post's `connect` list |
| A block embeds something | `![[file.sql]]` or `![[another-block]]` |
| A block mentions an entity | `@handle`, matched to an entity's aliases |
| A block is from, or quotes, a source | its `from` and `excerpt` |

Anything inside code is never a connection, so an example of `[[a link]]` in a code block stays an example. A link to something the vault does not have is kept as missing rather than dropped. Conclusions an agent draws about your blocks are not connections here: they belong to ohm-cortex, which points at your blocks without changing them.

## Reading other folders: Google Drive, Obsidian, a code folder

Some of what you know is not in the vault folder: papers on Google Drive, an Obsidian vault you already keep, a folder of SQL you run at work. The vault can read those folders where they are, without copying them in or ever writing to them. Each one is a **root**, and its files appear as blocks in a channel of their own.

Start a vault's configuration once, from inside the vault folder:

```sh
npx github:haeinej/ohmmmm vault init
```

Then name the folders in `.vault/config.json`:

```json
{
  "roots": [
    { "name": "research", "path": "~/Library/CloudStorage/GoogleDrive-you@example.com/My Drive/Research", "include": ["**/*.pdf", "**/*.md"] },
    { "name": "notes", "path": "~/Documents/Obsidian/Notes", "channel": "reading/notes" },
    { "name": "queries", "path": "~/work/queries", "include": ["*.sql"], "retain": "full" }
  ]
}
```

| Setting | What it changes |
| --- | --- |
| `name` | What the root is called. Lowercase letters, digits and hyphens. |
| `path` | The folder, absolute or starting `~/`. It cannot be the vault itself, or a folder inside or around it. |
| `channel` | The channel its files appear in. The root's name, unless you say otherwise. Folders inside the root become channels inside that one. |
| `include`, `exclude` | Which files to take, as patterns: `*.sql` matches by name anywhere, `docs/*.md` only in that folder, `**` any depth. Everything, unless you say otherwise. |
| `retain` | How much the vault keeps. `reference`: where the file is, its size and date, and nothing more; the file is never opened. `text`: its words too, so search finds it. `full`: a copy of its bytes in `.vault/cache` as well. |

A Google Drive folder keeps only references unless you say otherwise. Google Drive for desktop keeps many files online, and opening one makes Drive download it; a reference never opens the file.

Every file a root takes becomes a block whose `origin` is the file's own path. A Markdown file is read as the block it is, with its links and properties. A `.sql`, `.py` or other code file is a `code` block, an image or video is `media`, and anything else is a `file`. A root is read only: two-way sync with a folder like Obsidian is not built yet.

## The index

```sh
npx github:haeinej/ohmmmm vault index           # bring the index up to date
npx github:haeinej/ohmmmm vault search 서울 rain
npx github:haeinej/ohmmmm vault inspect churn-query
npx github:haeinej/ohmmmm vault status
```

`vault index` reads your vault folder and every root, and keeps what it found in `.vault/index.sqlite`: every block, channel, entity and source, every connection, the words for search, and each file's size, date and content address. The first time, it reads everything. After that it reads only files whose size or dates changed, so an unchanged vault takes as long as listing its folders. It says what was added, changed, moved and removed. A file that was renamed or moved is recognised as the same file.

`vault inspect` shows one block with everything known about it, including what is not in its file: where its original is, its size, when it last changed, its content address, whether a copy is cached, and what links to it.

`vault search` finds blocks by their words. Words in a title, name or tag count more than words in the text. Korean, Japanese and Chinese are found without spaces.

If Google Drive is not running, its root cannot be read. The index keeps what it knew about it and says so, rather than treating its files as removed. The index can always be deleted: the next `vault index` makes it again from your files.

### Renaming breaks nothing

On Are.na you can rename a channel or a block and every connection holds. The vault keeps the same promise, however you rename: in Finder, in Obsidian, with `git mv`, or by editing a title.

`vault index` notices when a block turns up under a new name (the same `id`, or the same file moved) and when a folder's blocks all turn up in another folder. It writes each rename into the journal. From then on the old name still means the same thing:

- a block that lists `channels: [notes]` is still in the channel now called `journal`;
- `[[Rain in Seoul]]` still links to the block now titled "Rain in Busan", and `[[rain]]` to the file now called `rain-walk.md`;
- a channel's `order` still places the block it named;
- `vault inspect notes` opens `journal`, and says it was found by an old name.

A rename made elsewhere rewrites nothing. Each place still using an old name is listed by `vault index` with the new name to write, so you can tidy it when you like. A name in use now always wins over an old one: make a new `notes` folder, and `notes` means the new one.

To rename and tidy in one go, rename through ohm. It moves the files and rewrites every place that used the old name, as Obsidian does: `channels` lists, a channel's order, a post's `connect`, and links and embeds in any text. Each link keeps the form you wrote it in, by slug, path or title, and links inside code are left alone:

```sh
npx github:haeinej/ohmmmm vault rename notes journal                 # a channel, and everything in it
npx github:haeinej/ohmmmm vault rename rain rain-walk                # a block's slug, and its file's name
npx github:haeinej/ohmmmm vault rename rain --title "Rain in Busan"  # its title
npx github:haeinej/ohmmmm vault rename rain --channel essays         # its home channel
```

A channel renamed this way gets an `id` in its `_channel.md`, so a site or a record that points at it can use the ID and never break. Every file changed is journaled with both versions kept, so `ohm vault restore` can undo any of it. An agent can rename too (`vault_rename`), where you granted it write. Files it may not write keep their old names, which go on working, and it says which.

Because the renames are in the journal, not only in the index, deleting the index loses none of them.

## Where things came from

Once a file has been copied into a folder, nothing in it says where it was copied from. So the vault writes down where things came from at the moment they arrive, in `.vault/journal.jsonl`: one line for each file added, changed, moved or removed, with who did it and how. Unlike the index, the journal cannot be made again from your files, so it is only ever added to, and it stays with the vault.

Each version of your notes the vault sees is kept too, in `.vault/history/`: what ohm and agents write, and what `vault index` finds you changed in another app. So the app's history can show what a note said before, and `ohm vault restore` can bring it back.

**Adding through ohm** records everything. An agent, or you, can bring in a file or an address:

```sh
npx github:haeinej/ohmmmm vault add ~/Downloads/attention.pdf --channel reading
npx github:haeinej/ohmmmm vault add ~/work/queries/churn.sql --by agent:claude-code
npx github:haeinej/ohmmmm vault add https://example.com/essays/on-rain --title "On rain"
```

- A Markdown file is copied into the channel with an `origin` property.
- Any other file is copied in, with a small block beside it that embeds it and gives its `origin`.
- An address becomes a source that refers to it and a link block from that source. Nothing is fetched.
- The original stays where it was, unless you add `--move`.
- Nothing already in the vault is overwritten.
- With no `--channel`, things go to `inbox`.

When an agent adds something with `--by agent:<name>`, the block is marked `status: proposed` for you to keep or not.

**Dropping a file in by hand** records what can be checked, and nothing more. When indexing finds a new file in the vault folder, it looks for two things:

- whether its bytes are exactly those of a file it already knows (in a root, or elsewhere in the vault), and if so records that it was copied from there;
- whether macOS kept the address it was downloaded from, as browsers and mail do, and if so records that address.

Otherwise the file is recorded as added by someone unknown. The vault does not guess.

**An agent writing straight into the folder**, such as Claude Code editing a note, looks to the vault like anyone else's edit. To have those writes recorded as the agent's, add a hook to Claude Code's settings (`.claude/settings.json` in the project, or `~/.claude/settings.json`):

```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Write|Edit|MultiEdit|NotebookEdit",
        "hooks": [{ "type": "command", "command": "npx github:haeinej/ohmmmm vault hook --vault ~/Vault --agent claude-code" }] }
    ]
  }
}
```

The hook notes each file the agent writes inside the vault, and the next `vault index` records the change as the agent's, with its session. It never fails the agent's work. Files an agent creates by running shell commands are not seen by this hook.

`vault inspect` shows a file's history from the journal, following it through its moves.

## Sharing with friends

A block marked `visibility: friends` is meant for the friends you choose. The vault service keeps those blocks readable, so it can show them to those friends on any device without anyone needing your keys. Private blocks use the encrypted store. Service-backed agent tools also exclude legacy posts marked private.

- **Your friends-only blocks** are kept on the service as the files they are in your folder: the path and the text. Your friends-only posts were already kept there, and count as part of the same layer.
- **Your friend list** says who may read them, by DID. Only you, signed in to ohm, can add a friend; an agent cannot. You or your tools can remove one.
- **A friend** reads what you share, both blocks and posts, with a token from their own PDS. Someone not on your list gets the same answer as if there were nothing there, so asking reveals nothing. A friend has to be let in to the ohm service, as every member is.
- **Removing a friend** stops them reading from then on. What they already read cannot be taken back.

Ask an agent connected to the service to list your friends-only blocks or open a block someone shared with your DID. When saving, deleting or removing access, review the preview before confirming. An existing service database needs the Friends schema for these tools to work. See the [service reference](../service/CAPABILITIES.md).

## Using the vault with a local agent

Configure a trusted MCP client to launch `ohm vault mcp --vault /path/to/vault --agent example` over stdio. Select your home vault folder so the client can read the files you intend to share with it. The process can read the local vault, including readable private files and the roots you configured. The encrypted service store uses a separate device unlock flow.

Ask the agent to run `vault_index`, then search for a block, open it with its history, or follow connections from it. Refresh the index after editing files outside the tools.

To try a capture, ask it to save `https://example.test/reading` to the Inbox. You get a proposed block and a source reference in your folder. Ask it to collect the block in `reading` to make it appear there too. The journal records both actions under the agent name you chose. If another collection is running in the same vault, try again once it finishes.

### Letting an agent change things

By default an agent can only propose: captures land in the Inbox as `proposed`. When you trust an agent with part of your vault, grant it, one channel at a time:

```sh
npx github:haeinej/ohmmmm vault grant claude-code link notes     # may link blocks in notes/ to others
npx github:haeinej/ohmmmm vault grant claude-code write projects # may also write, replace and remove there
npx github:haeinej/ohmmmm vault grants                           # what each agent may do
npx github:haeinej/ohmmmm vault revoke claude-code               # take everything back
```

Nothing is lost. Each time an agent writes, links, removes or restores, the version before and the version after are kept in `.vault/history/`, and the journal says which agent did it. To undo one, look up the version with `ohm vault inspect` or ask the agent for `vault_history`, then run `ohm vault restore notes/idea.md <address>`. An agent can't change its own grant, `.vault/`, or your captured sources, and it must show it read the latest version before replacing a file, so it never writes over an edit you just made.

An agent never changes who can see a block, even where it may write. It asks instead (`vault_request_visibility`, with its reason), and the request waits for you. With `ohmmmm serve` running, the app shows each request: approve it and the block moves, or decline it and nothing changes. The agent can see how its requests went (`vault_requests`).

### Telling agents where your data lives

Give each root a `note` in `.vault/config.json`: what is there, what to trust, how to use it ("Board queries. Join on account_id, not user_id."). Agents read it with `vault_where` before they search, together with the counts and kinds of files in each root and what you let them change. A root without a note is one an agent will ask you about.

### Checking the vault

`vault_lint` (or `ohm vault lint`) gathers what is worth a second look: links to notes that don't exist, notes nothing points to, pairs of notes about the same thing with no link between them, notes with the same title, and proposals you haven't decided on. The vault can't tell whether two notes agree; your agent can. The [lint skill](../skills/lint/SKILL.md) has it read each pair, write what it finds to your cortex, fix what you granted, and ask you about the rest.

## Using the vault from the cortex

The cortex (`cortex/` in ohmmmm) keeps what agents learn about you, and reads your vault to find what that learning rests on. It asks a vault a few questions: what channels there are, one block, whether blocks still exist, what changed since last time, and a search. Connect cortex to the vault with this vault's own reader:

```sh
cortex vault connect ~/Vault --module /path/to/ohmmmm/vault/vault/cortex.mjs
```

With it, cortex sees blocks only, not channel files, entities or sources, and it sees the blocks of the folders your vault reads too. Without it, cortex's own reader would count `_channel.md` and entity files as blocks.

**Switching loses nothing.** A block is known by its `id`, or by its path when it has none, exactly as cortex's own reader knows it, so what cortex already remembers still points to the right blocks.

**Reading for cortex changes nothing.** It doesn't write the index, the journal or the cache, and it never opens a file in a reference-only folder. It needs no database, so it works on any Node that cortex runs on.

## What happens to your files

The vault reads your files and writes them back exactly as it found them, so your folder only changes when you change something. Size, dates and content addresses are not written into your files; they are in `.vault/index.sqlite`, which can always be rebuilt. Besides the index, the vault keeps `.vault/journal.jsonl`, and `vault add` writes the files it brings in. Nothing is ever written in a root, and nothing here reaches the vault service or publishes anything.

When something cannot be read, the vault says so in a sentence and leaves the file as it is: a channel that is not a folder, two files with the same name, an origin it does not understand, a copied file that carries another file's ID.

A post stays a post. It keeps its label, its address and its visibility, and sync and publishing treat it exactly as before. Listing extra `channels` on it does not change where it is published. A file with `visibility` and no `kind` is read as a post, as it always was, unless it has something only a block has (`origin`, `from`, `excerpt`, `by`, `status`, `created` or `updated`). To make a plain note friends-only without it becoming a post, give it a `kind`, such as `kind: text`.

[The agent reference](agents/vault-format.md) has the exact contracts.
