# Connect a site

A person with a website has their coding agent fill their vault from it. When it is done, every page, image and data file of the site is a block in the vault that says what it is and where it is kept, and the site's own files have not moved or changed.

This is a plan. The table in [What exists and what is missing](#what-exists-and-what-is-missing) says which parts are built.

- **Flow id:** `connect`. Tools are named `connect.<step>`.
- **Starts from:** the workspace straight after sign-in, with an empty vault. Later, from Settings › Vault › Sites.
- **Ends in:** **connected** (the site is a root of the vault, its blocks are filled in and in channels), **paused** (stopped at a step; resumes there), **declined** (the person said no to the map; nothing written), **failed** (the agent could not read the site; the reason is shown).

## The idea: record in place

The vault does not take the site's files. It keeps a record of each one.

| Kept in the vault | Stays where it is |
| --- | --- |
| A block per page, image, video, audio file, data file and code file | The file itself, in the site's folder or git repository |
| Where it is: the root, its path there, its `origin`, and its hash | The site's layout, templates, styles and hosting |
| What it is: kind, title, dates, alt text, size, and what the page says about it | |
| How it connects: the channel for its section, and an embed from each page to the files it shows | |

So the site keeps working exactly as before, and the vault becomes the organised view over it. Making the site read from records is a later, separate step ([migrate-site](../../vault/skills/migrate-site/SKILL.md)), and so is publishing.

The vault already works this way for folders: a **root** in `.vault/config.json` names a folder to read without owning it, and each file found there becomes a block whose `origin` is its path ([vault-format](../../vault/docs/agents/vault-format.md)). Connecting a site is adding the site's folder as a root, then having an agent fill in what a scan cannot know.

## Who does what

| The agent, in the site's folder | The person, in the workspace |
| --- | --- |
| Finds where content, media and data live | Says which site, and starts the agent |
| Proposes which section becomes which channel, and which page field fills which block property | Approves the map, once per kind of thing |
| Adds the root, runs the scan, and fills in each block's properties | Reads the result, fixes what is wrong |
| Reports what it could not read or place | Decides who each block is for; everything arrives **Only you** |

The agent asks one question per kind of thing, not per item, and writes each answer down in the site's folder so a later session does not ask again. It never changes a file of the site.

## Steps

| # | Step | Screen (ohm-ui) | Primary action (forest) | Tool | Annotations | Approval |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Start | `Empty` in the main panel, with a `Field` for the site's address or folder | Connect your site | `connect.start` | none (makes a waiting record) | none |
| 2 | Pair | `Card` with one line to paste into the coding agent, and a short code | Copy | `connect.pair` | none | The person runs the line; that is the approval |
| 3 | Survey | `AgentStatus`, then a `Card` of counts: pages, images, other media, data, by folder | Continue | `connect.survey` | `readOnlyHint` | none |
| 4 | Map | `ApprovalCard`: each section and the channel it becomes; each page field and the property it fills; what is left out | Use this map | `connect.map` | `consequentialHint` | `ApprovalCard` |
| 5 | Fill | `AgentStatus` with a count that rises; the tree fills as blocks arrive | none | `connect.fill` | none (private, and nothing of the site changes) | Covered by step 4 |
| 6 | Review | The repository tree, filtered to this site; a `Card` listing what could not be read or placed | Done | `connect.review` | `readOnlyHint` | none |

Steps 3 to 5 are the agent's. The person sees them happen and can stop them. Publishing is not part of this flow.

### What the pairing line does

One command, run in the site's folder (proposed: `npx github:haeinej/ohmmmm connect <code>`):

1. Exchanges the code for a grant from the account app, limited to this vault.
2. Makes the home if there is none, and adds the site's folder as a root with `retain: text`: text is read and indexed, every file is hashed, no bytes are copied.
3. Gives the agent the skill for this flow and the local `ohm-vault` MCP server.
4. Hands over to the agent, which starts at Survey.

### What the agent fills in for each block

A scan already gives a block for every file, with `kind`, `title` (the file name), `origin` and hash. The agent adds what only reading the site can tell:

| Property | Where the agent reads it |
| --- | --- |
| `title`, dates, description | The page's front matter, its heading, or the template data that names it |
| Alt text and caption of an image | The page that shows it. Missing alt text stays missing |
| Channel | The site's section the page is in (`photos › tokyo`); a file shown on a page goes with that page |
| Embed from page to file | The page's own markup, so the graph shows which image belongs to which page |
| Where else it is | The git remote, the path in the repository and the commit it was read at; the public address, when the site is deployed |
| Size, and width and height or duration for media | The file |

It fills the fixed properties first and puts anything the site has beyond them in the site's own optional layer, as [schema-layers](../../vault/docs/schema-layers.md) says. It does not invent properties.

## States

| Situation | What the person sees |
| --- | --- |
| Waiting for the agent | The pairing card, with "Waiting for your agent" and `LoadingDot` |
| Agent working | `AgentStatus`, and the step it is on |
| Paused | The step it stopped at, with Resume (the same line again) |
| Done | `notify()` (success) with the count of blocks, and the tree open on the site's channels |
| Declined | The map as it was; nothing written |
| Failed | `notify()` (destructive) with a plain reason, such as "the folder could not be read" |
| The file moved or changed later | The block follows a move by its hash; a change shows in History; a file that is gone is marked, not deleted |

## Keeping in step

After connecting, the site's folder stays a root. Each scan re-reads only the files whose stamp changed, follows moves, and leaves a journal entry saying who changed what. A scan runs when the agent's write hook fires, when the person opens the workspace on that device, and on `ohmmmm vault index`. The agent fills in new blocks the same way, using the map already approved; a new kind of thing asks once.

## What exists and what is missing

| Part | State |
| --- | --- |
| Roots, `retain`, `origin`, hashes, moves, the journal, `ohm vault add` and `index` | Built ([vault/vault/roots.mjs](../../vault/vault/roots.mjs), [indexer.mjs](../../vault/vault/indexer.mjs)) |
| Local MCP server: `vault_index`, `vault_local_search`, `vault_local_read`, `vault_neighbors`, `vault_capture` | Built ([vault/mcp/local.mjs](../../vault/mcp/local.mjs)) |
| A skill that tells an agent how to survey, map and fill | **Missing.** migrate-site moves content; this one records it in place |
| The `connect` command and pairing with a code | **Missing.** Grants and device linking are in the account app |
| Git and public addresses on `origin` (remote, path, commit, URL) | **Missing.** `origin` is an absolute local path today, which means nothing on another device |
| A tool for an agent to set properties on a root's block without editing the site's file | **Missing.** Properties of a root file have nowhere to be kept yet; a small file per block in the vault is the likely place |
| The workspace seeing the result | **Missing.** The index is local and a hosted page cannot reach it, so the filled-in records have to sync to the vault service, sealed, like any private block |
| A record of the site itself: address, root, map, step reached, last scan | **Missing** |
| The workspace on the service adapter instead of sample data | **Missing** |

## Order to build, for one's own site first

1. The skill, and the place a root block's properties are kept. With only these, an agent can fill a local vault from a site, checked with `ohmmmm vault inspect`.
2. Git and public addresses on `origin`.
3. Sync of those records to the service, and the workspace reading them.
4. The `connect` command and pairing, then the six screens.

## Cross-origin

None. The agent works on the person's device through the command and the local MCP server; the workspace reads the vault service same-origin.

## Checked

- [ ] By hand, in light and dark, on a phone and a desktop
- [ ] By tools: `getTools()` per step, then `executeTool` reaches the same end state
- [ ] The site's folder is byte-identical before and after
- [ ] Declining the map leaves nothing behind
