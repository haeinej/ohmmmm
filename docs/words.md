# Words

One list for the vault, the cortex and the account app. When a part needs a word, it uses the one here; when two parts named one thing differently, the name kept is the one here.

## Words for people, words for code

People see one product, **ohm** (never "ohmmmm"), and four folders in their ohm: **Collections** (the vault), **Agents** (the cortex), **Site** (their website) and **profile**. App copy, the human guides and the commands' messages to people use those words. Code, commands (`ohm vault …`), MCP tool names (`vault_*`), agent docs, and the runtime names that stay `ohm-vault` (the Worker, D1, the MCP server, crypto contexts, IndexedDB) keep vault and cortex. The command people type is `ohm`; `ohmmmm` stays as another name for it.

## The home

- **Home** (people say **your ohm**): a person's folder `ohm.<handle>`, holding `profile/`, `collections/` (the vault), `agents/` (the cortex) and `site/` ([home/home.mjs](../home/home.mjs)). A home made before, `ohmmmm.<handle>` with `vault/` and `cortex/`, is read as it is; nothing moves it.
- **Profile:** `profile/profile.md`, the person's identity as properties (name, handle, DID, wallet, card colour) with what they say about themselves as Markdown under them, and its picture beside it. The person writes it; no agent tool does.
- **Site:** `site/`, the person's website as a git checkout of their own repository (`ohm site connect`). `site/.ohm/` is ohm's own and never tracked: `site.json` (the repository and the Cloudflare project), the **save log** (`saves.jsonl`, every save with the file before it) and `deploys.jsonl`. **Save** writes a file at once and never commits; **Publish** pulls, commits, pushes and deploys.
- **Handle:** the person's AT Protocol handle, which names the home. The DID is in the cortex's identity, not in folder names.
- **Bridge:** `ohm serve`, the home's server on the person's own machine, which lets the app and local agents reach the home folder. A browser is **paired** with it once, through the link it (or `ohm pair`) prints, which holds that browser's **app key**. Each agent has its own **agent key** (`ohm agents add <name>`), which reaches only the MCP endpoints and makes every session it opens that agent ([docs/serve.md](serve.md)).

## In the vault

- **Block:** one unit of thought, a file `{ path, text }` whose ID is its `id` property, a 13-character TID. A published block is a **post**: a standard.site document (`site.standard.document`) in the member's repository, with the post itself inside as `com.ohmmmm.post` content. The member's website is its **publication** (`site.standard.publication`).
- **Media block:** a block of kind `media` that holds one image: its file sits beside it in the home folder, and its `hash` is the bytes' CID. Another block shows it with an **embed**, `![[slug]]`. Outside the home folder its bytes are in the **media cache** (the browser's `ohm-media` today), with **sizes**: smaller copies made on the device ([vault/plans/media.md](../vault/plans/media.md)).
- **Channel:** an ordered collection of blocks; a block can be in many. Named by its path, such as `essays` or `notes/reading`.
- **Former name:** a path, slug or title a block or channel had before it was renamed or moved. Old names keep working: the journal records them (`renamed`, `moved`), and a reference that uses one is listed to tidy, never broken ([vault/plans/renames.md](../vault/plans/renames.md)).
- **Entity**, **source:** a person, place or thing a block is about; where a block came from.
- **Connection:** a link the content shows: a channel contains a block, a block links to, embeds or mentions something, a block is from a source. Cortex calls the same thing **evidence** when it reads it; the vault draws it, a model never does.
- **Node:** any file the vault reads as a thing: a block, a channel, an entity or a source (node keys such as `block:<id>`).
- **Visibility:** `public`, `friends` or `private`, on each block; it chooses the **layer**, and so the store.
- **Publish:** making a block a post, only by the person after they see its **plan** (address, label, images). From the home folder the bridge does it with the person's **app password**, which stays on their computer. **Take down** removes the post first, then moves the block. The **label** and **sublabel** place a post on the site (`/posts/<label>/<sublabel>/<slug>`); a channel keeps its own as `site` ([docs/serve.md](serve.md)).
- **Friends layer**, **private layer:** blocks readable by the vault service and shared with chosen DIDs; blocks the service stores only as ciphertext.
- **Journal** (`.vault/journal.jsonl`), **index** (`.vault/index.sqlite`), **roots** (`.vault/config.json`).
- **Version** and **rev:** a kept state of a block. `version` names its exact ciphertext (for compare-and-swap); `rev` names the kept version and never changes, so history points at it.
- **Private overlay:** a private file holding where a mixed channel's private blocks go in its order; the channel's own file lists only what its layer may show.
- **Autosave:** each day's state of every page, kept by the vault for blocks and channels, by cortex for its own pages.

## In the cortex

- **Identity**, **memory**, **skill**, **tool**, **playbook**, **working** memory: the cortex's own files.
- **Observation:** what an agent saw, waiting to be settled into a memory or dropped (`cortex_observe`). Formerly "note", which clashed with notes in a vault.
- **Inference:** what the cortex concludes, kept as cortex nodes pointing at what they were drawn from. Never a connection in the vault.
- **Node:** any block, and any file of the cortex.
- **Journal** (`.cortex/journal.jsonl`): the cortex's own, apart from the vault's.

## Between them

- **Vault reader contract:** `shape`, `read`, `exists`, `changes`, `profile`, and optionally `search` ([contract/vault-reader.mjs](../contract/vault-reader.mjs)). The vault's own reader is `vault/vault/cortex.mjs`.

## In the graph

- **Node:** a block. Channels are not nodes; they colour the blocks filed in them. People a block mentions may be drawn beside the blocks, but they are entities, not blocks.
- **Edge:** a **connect**: a block links to, embeds, mentions or is connected whole to another (`links`, `embeds`, `mentions`, a whole-block `connect`). The vault's `contains` and `from` stay evidence but are not drawn. An edge an agent only observed is drawn apart from the ones the person made.

## Boundaries

- **PDS boundary:** the member's own PDS (for example Cirrus on their Cloudflare account). It holds only public posts (each a `site.standard.document` with `com.ohmmmm.post` content), their publication and their blobs, written only by the member when they publish.
- **Personal boundary:** everything else: Friends blocks, sealed private blocks, the sealed cortex, the media cache, and the folders a vault reads. Nothing crosses to the PDS except through Publish.
- **Content reads:** what a member's site reads by their DID (`com.ohmmmm.content.*`). An **entry** is a block as a site sees it. The **audience** is who is looking: anyone sees what is published on the PDS, a friend also sees Friends, and no one sees private.
- **Friend:** a DID (an ohm account) the member approved, like a device on a private network, for every channel or some. A friend's agents read with the friend's access. Someone **asks**; the member sees their name and email and **approves** or declines.
- **Connections:** the rack's panel of the people around you: friends you let in, people who let you in, and who you asked. **Make friends** asks by email; the member's agent may ask too (`vault_friends_ask`), never approve. Mail itself stays in the member's own mailbox and their agent's mail tools; ohm sends only the one invite.
- **Agents panel:** the rack's panel of the coding agents using ohm's tools. An agent's two-step action is an **approval** waiting there; only the member **approves** or declines it, in ohm, never in the agent's chat. The member may **pause**, **resume**, **disconnect** or **allow again** an agent. Talking to an agent stays in its own chat.
- **Visibility move:** moving a block between layers, by one set of rules (`vault/vault/visibility.mjs`). Only the member shows a block to more people. An agent **asks** (a **move request**, waiting in the cockpit) or, with a grant, **hides** a friends-only block on its way to private. Every move is in the **move journal**, by ID.
- **Viewer token:** ohm's ten-minute proof of who a viewer is, for one member's content, posted back only to one of that member's listed **sites**. It is never a session.
- **Media record:** a block for a file that is kept where it is. The record saves its path and metadata (origin, hash, size, dimensions, kind, alt); the bytes sit in ohm's media cache, sealed when private, and can always be sent again.

## Keys (account app)

- **Master key**, **file key**, **wrapped copy**, **recovery code**, **unlock passkey** (not the PDS passkey, which only signs in), **device link**, **rotation**, **generation**, **history**. See ohm-onboarding `docs/keys.md`.
