# Handoff: Claude's track (C1–C3 and after), as of 24 November 2026

Where the work stands, for a fresh session on your own machine. The plan is [vault/plans/content-layer.md](../../vault/plans/content-layer.md); the split is [content-layer-split.md](content-layer-split.md).

## The pull requests: one stack, merged in this order (restacked 24 November, evening)

Every open PR was merged into the one above it and its conflicts resolved, so each merges cleanly in this order. The root `npm test` passes on every branch tip. Merge in order; when a base merges, retarget the next PR to `main`.

| Order | PR | Branch | What it is |
| --- | --- | --- | --- |
| 1 | [#39](https://github.com/haeinej/ohmmmm/pull/39) | `vault/astro-loader` | D1: the `ohm` Astro loader (public posts from the PDS) |
| 2 | [#34](https://github.com/haeinej/ohmmmm/pull/34) | `home/curator` | The curator, `design-home`, the home report |
| 3 | [#40](https://github.com/haeinej/ohmmmm/pull/40) | `vault/move-to-astro` | D2: `move-to-astro` (on #34) |
| 4 | [#35](https://github.com/haeinej/ohmmmm/pull/35) | `vault/host-pds` | Host your own PDS (Cirrus) |
| 5 | [#33](https://github.com/haeinej/ohmmmm/pull/33) | `home/production-wiring` | Production wiring, no inbox (C1). Contains 1–4, so merge those first |
| 6 | [#41](https://github.com/haeinej/ohmmmm/pull/41) | `vault/content-reads` | C2: content reads for sites |
| 7 | [#42](https://github.com/haeinej/ohmmmm/pull/42) | `home/visibility` | C3: visibility moves |
| 8 | [#44](https://github.com/haeinej/ohmmmm/pull/44) | `claude/wonderful-feynman-de22rc` | Images as media blocks, renames, `ohmmmm serve`: now on #42 |
| 9 | [#47](https://github.com/haeinej/ohmmmm/pull/47) | `claude/cortex-in-app` | The real cortex in the paired app |
| 10 | [#43](https://github.com/haeinej/ohmmmm/pull/43) | `home/friend-access` | Friends approved like devices: now on #47 |
| 11 | [#45](https://github.com/haeinej/ohmmmm/pull/45) | `home/connections` | Connections, agents in ohm, the Agents panel |

What the restack decided (with the owner):

- **One app, the vault service first.** #33 had rebuilt the app's data layer for the vault service, #44 for the home on this computer. The app now has one `HomeSource`; `app/src/data/local-source.ts` answers it through the bridge (channels as `_channel.md` files, `moveVisibility` rewriting the file's layer, `moves` as `.vault/requests.json`, the cortex through its own routes, history from both journals). Publishing on this computer stays its own dialog. See `app/docs/agents/home-source.md`.
- **Connections are built, tested and off screen for the first release:** `app/src/features.ts` (`connections: false`). Their store handlers, the service's requests and the MCP tools stay. The Agents panel stays on screen.
- **Retries are answered, not repeated.** Publishing, renames, visibility moves and their journal, friend answers, invite emails (claimed before sending), agents' approvals (a used approval answers a retry for 15 minutes) and cortex writes (one lock across processes) were made idempotent, with partial unique indexes in the unapplied migrations 0007, 0008 and 0010.
- **Known gap:** an unfinished move to private (sealed, but the friends copy not yet removed) is remembered in the page only; a reload before it is finished can seal a second copy if the move is repeated.

## Before deploying (all yours)

- Migrations `0006_sites`, `0007_visibility`, `0008_friend_access`, `0009_people`, `0010_agents`, in order. None has been applied anywhere.
- `wrangler secret put VIEWER_TOKEN_SECRET` (at least 32 random characters), for Friends on sites.
- For invite emails: a Cloudflare Email Service binding `MAIL` and `MAIL_FROM` on ohm's verified domain. Without them nothing is sent.

## Decided with the owner (see each PR, and the plans)

- New agent blocks start private. Showing a block to more people is the member's alone; publishing itself may be done by the member or an agent, but only for what the member marked public.
- Grants live in `.vault/grants.json`. The service MCP server reads them with `--home`.
- Content requests are named `content.*`: one set, where the caller decides the layer; a channel is listed if it holds anything visible.
- Friends: identified by their DID / ohm account and shown by email; rights per channel; the graph shows people only; no feed.
- Mail goes through each member's own coding agent and its own mail tools, from their own address. ohm keeps no mailbox and no provider tokens.
- An agent's actions are confirmed on screen in ohm, in one Agents panel, never in the agent's chat. Talking to an agent stays in its chat.

## Open questions

- Confirm the defaults in #43: a new friend starts with every channel; a block is visible if any channel it is filed in is allowed; earlier friends keep every channel; a declined person isn't told.
- A cortex timing test, "no moment takes longer than 200 ms on a cortex with 300 observations", failed CI once on #45 at 201 ms, on a docs-only commit (`faf21e4`). It passed before and since. Should its budget leave room for slow CI machines, or stay strict?
- Confirm the extra request names in #41: `content.view`, `addSite`, `listSites`, `removeSite`.
- `design-home` on #34 still says "capture into the Inbox": who updates it, Devin's D3 or Claude?
- Agents' PDS tokens look the same to the service as the command line's, so "agents only ask" is enforced in the tools and the cockpit, not in `putPost`/`putBlock`. The Agents panel's approvals, pause and disconnect have the same limit. Closing it needs a key per agent that the member can take back.

## Mail: through the member's own agent, not in ohm (decided 24 November)

There is no mail client in the cockpit. The owner decided that people send mail through their own coding agent, using its own mail tools (a Gmail or Outlook connector, a mail MCP server), from their own address. ohm holds no mailbox, no Gmail or Outlook tokens and no copy of anyone's mail, and ohm-onboarding stays as it is, with no Google sign-in and no provider tokens. agentic-twitter's Gmail client was read and isn't ported.

What exists instead, on `home/connections`:

- **`askFriend` now asks `member`**, so an agent with the member's PDS token can ask by email. The asker is named from `links`, and the request is refused `NotConnected` until that account has signed in to ohm once. Approving, declining and setting a friend's channels are still `ohm` only.
- **The MCP tools:**
  - `vault_connections` (friends, friendOf, asked).
  - `vault_friends_ask` (waits in the Agents panel, then `confirm`).
  - `vault_mail_ask` (a draft waits in the Agents panel; once approved, the agent sends exactly that).
- **The [connections skill](../../vault/skills/connections/SKILL.md):**
  - Bringing people in from the inbox: the agent reads mail with its own tools, the member picks, and only the picked addresses go to `vault_friends_ask`.
  - Writing to a friend: draft it, get it approved in ohm with `vault_mail_ask`, then send exactly that from the member's own address.
- **#45's invite email is unchanged.** It is still the one email ohm sends.

## Agents panel: approvals in ohm (decided 24 November, also on `home/connections`)

The owner asked for agents' actions to be confirmed on screen, with control over the coding agents that use ohm's tools. Talking to an agent stays in its own chat, not in ohm.

- **What the member sees.** **Agents** in the rack shows a dot while anything waits. The panel lists each agent that used ohm's tools:
  - its state, its last tool and its recent calls;
  - a card for each waiting action. A card is closed to a title, one line and when it was asked; clicking it opens ohm-ui's `ApprovalCard` (`@ohm/elements-approval-card`) with the whole action, **Approve** and Decline, then a receipt. Approve is forest, like every primary button, and red for actions that remove something for good. `app/src/theme.css` sets the card's radius, keeps a message's line breaks and makes Approve forest, all by slot rules, so the installed copy is unchanged. One card is open at a time;
  - **Pause**, **Resume**, **Disconnect** (behind a dialog; it also declines what the agent waited for) and **Allow again**.
- **How the tools use it** (`vault/mcp/tools.mjs`):
  - Every call first runs `agentCheckIn`, which is refused when the agent is paused or disconnected.
  - A two-step tool's first call runs `askApproval` and returns its ID as `confirm`. The second call waits up to 25 s for the answer, then runs `useApproval`, which works once and only for exactly the plan approved.
  - A move request (`vault_set_visibility` widening a block) already waits in the bell, so it keeps its local confirm and isn't asked twice.
  - New tool: `vault_mail_ask`.
- **Service:** `vault/service/src/agents.mjs` and `capabilities/agents.mjs`, with migration `0010_agents` (`agents`, `agent_approvals`, `agent_activity`). `answerApproval` and `setAgentState` ask `ohm`, so an agent can't call them.
- **Cockpit:**
  - `app/src/workspace/AgentsPanel.tsx`, with `describe()` and `summaryOf()` for each tool's card;
  - `store.ts` `loadAgents`, `answerAgent` and `setAgentState`;
  - the `agents.answer` WebMCP tool, behind a dialog;
  - flow `app/flows/agents.md`, and paths A1–A5 in `app/flows/paths.md`.
- **Docs:** `vault/docs/agents-panel.md` (people) and `vault/docs/agents/agents-panel.md` (agents), the vault and connections skills, the MCP server's instructions, and `docs/words.md`.
- **Checked:**
  - tests: `vault/test/mcp.test.mjs` covers waiting, using an approval once, decline, pause and disconnect; `app/test/agents.test.ts` covers the panel;
  - by hand against the test fixture, in light and dark, on desktop and on a phone (375 px), including the `ApprovalCard` and its forest and red Approve. It has not been checked against a live service.
- **Limit:** enforced in ohm's tools, as in Open questions.

## Rules for the next session

Read `AGENTS.md`, `vault/AGENTS.md`, `app/AGENTS.md` and `docs/words.md`. Run `npm test` at the root before every PR, never merge your own PR, deploy nothing, and finish each chunk with documentation (`vault/skills/document-work/SKILL.md`).

Working notes from the Agents panel session:

- The root tests need Node 22.13 or later, for `node:sqlite`. The default `node` here is 22.12, so run them as `PATH=/opt/homebrew/bin:$PATH npm test`.
- Port 5190 is often taken by the sibling `ohm-ux` dev server. Start this app with the `ohmmmm-app` launch config, on port 5191.
- To see the Agents panel without a live service, load the fixture from the page's console:
  1. `await import('/test/fixtures/fixture-source.ts')`;
  2. call `agentAsks(...)` to make waiting actions;
  3. `(await import('/src/workspace/store.ts')).setSource(fixture)`.
