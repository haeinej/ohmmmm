# For coding agents

The app is where ohm's **user flows** are designed and built. Every flow has two ways in: a person moving through screens built from [ohm-ui](https://design.ohmmmm.com/overview), and an agent calling the same steps as [WebMCP](https://webmachinelearning.github.io/webmcp/) tools that the page registers. Both ways go through the same code and end in the same state.

- How ohm looks: ohm-ui's `DESIGN.md` (github.com/haeinej/ohm-ui). It outranks this file on any visual question.
- Which component to use: ohm-ui's `skills/use-ohm-ui/SKILL.md`.
- The app's own design layer (radius, density, menus, tree rows): [docs/design.md](docs/design.md).
- The WebMCP API as this repo uses it: [docs/webmcp.md](docs/webmcp.md).
- Writing a new flow: copy [flows/TEMPLATE.md](flows/TEMPLATE.md).
- Every interaction path in the workspace, with its purpose, end state and tool: [flows/paths.md](flows/paths.md). When you add, change or remove a path, update it there.

## The rules

### One flow, two ways in

1. **A step is one action.** Each step in a flow has one primary action: the single forest button in that view. That action is also the step's one WebMCP tool. If a step needs two tools, split it into two steps.
2. **One handler.** The button's `onClick` and the tool's `execute` call the same function. A tool never reaches state the UI can't reach, and the UI never does something no tool can do.
3. **Same validation.** The tool's `inputSchema` describes the step's `Field`s: the same names, the same required fields, the same limits. Invalid input is rejected the same way on both paths.
4. **A tool exists only while its step is on screen.** Register it when the step mounts and pass an `AbortSignal`. Abort the signal when the step unmounts. Agents see only the tools that are on screen now, and `toolchange` keeps them up to date.

### Naming and description

5. **Names:** `<flow>.<step>`, in lower case with `-`, `_` or `.` only. Spec limit: 1–128 characters from `[A-Za-z0-9_.-]`. Example: `publish.preview`, `publish.confirm`.
6. **`title` is the button's label**, word for word. **`description`** says in one or two plain sentences what the tool does and what it returns. No marketing, no instructions to the agent, no claims the code doesn't keep.

### Annotations follow colour

7. **`readOnlyHint: true`** on anything that only reads or moves to another view.
8. **`consequentialHint: true`** on anything a person can't undo, or that other people see, such as publishing, sending, deleting, paying or sharing. It always goes on a red (`destructive`) action and on a forest action with lasting effects.
9. **`untrustedContentHint: true`** when the result includes text other people wrote (posts, comments, imported pages).
10. **`debugging: true`** only on tools for developers. Never register them in production builds.

### People decide what lasts

11. **A consequential tool never finishes without the person.** Its `execute` shows ohm-ui's `ApprovalCard` (or a `Dialog` for a destructive action) in the page and waits. If the person approves, it runs the handler. If they decline, it rejects with `NotAllowedError`. If the signal aborts, it removes the card and rejects with `AbortError`. Agents may skip annotations, so this holds whatever the agent does.
12. **Nothing is published without the owner's approval.** This matches rule 10 of ohm-content-layer: a record on a PDS is public as soon as it is written. Show the preview step before the confirm step.

### The person can see what the agent does

13. **Agent activity is visible.** On `toolactivated`, show `AgentStatus` (or a `LoadingDot` in the step) and move focus to the step. On `toolcancel`, remove it. A change an agent makes looks exactly like one the person made.
14. **Outcomes use the same states as the UI.** Success and errors use `notify()`. Empty places use `Empty`. A page loading is blank or shows a `LoadingDot`. Green means done and red means failed, and no other colours are used.

### What a tool returns

15. **Return the least that's needed.** Return a short JSON object that matches `outputSchema`: the new state, its id and the next step's tool name. Never return tokens, secrets, other people's private data or whole records the agent didn't ask for. Don't ask for more input than the step needs, because over-asking leaks data.
16. **Errors are DOMExceptions with plain messages:** `DataError` for bad input, `NotAllowedError` when the person declined, `AbortError` when cancelled, `OperationError` for anything else.

### Scope and safety

17. **Same origin by default.** Leave `exposedTo` empty. A cross-origin frame gets tools only with `allow="tools"` on its iframe and its origin listed in `exposedTo`, and both need a reason written in the flow's file.
18. **Feature-detect and degrade.** Use `document.modelContext` (the current draft) and fall back to `navigator.modelContext` (older Chrome builds). Without either, register nothing; the UI still works. Use only [src/webmcp.ts](src/webmcp.ts), never the raw API.
19. **Don't rely on the declarative form API.** The `toolname`/`tooldescription` form attributes from earlier proposals are not in the 13 November 2026 draft. Use `registerTool` only.

### Design

20. **ohm-ui only, tokens only.** Install components with `npx shadcn add @ohm/<name>`. Choose variants and don't restyle. App CSS is for layout only. Follow ohm-ui's rules: theme, don't fork; no edges; one primary per view; Coconat only for `h1` and `h2`.
21. **One radius for every surface.** Panels, menus, popovers, tooltips and sheets are `rounded-2xl` (the card token); rows are `rounded-lg`; items and small controls are `rounded-md`. Never set a radius in pixels, and never give a surface a different radius from the menus beside it. The density setting decides how round these are, in [src/theme.css](src/theme.css). See [docs/design.md](docs/design.md) for why: hand-set radii on panels are what made the menus look rounder than the panels before.
22. **Menus are compact.** Tight rows, and the highlighted row is filled forest with white contents. Restyle ohm-ui components only by slot rules in `src/theme.css`, never by editing the installed copies.

## Where the home is

The app opens one home: the folder `ohm.<handle>` on this computer, through its bridge (`ohm serve`, ../docs/serve.md), once this browser is paired. There is no sign-in, no online home and no friends or connections screen in the app; an unpaired browser sees **Open your home**. Don't add a way to a home that goes around the bridge. The vault service (vault/service) and its MCP tools are separate and stay.

## Running it

From the ohmmmm repository root:

```sh
npm ci --prefix app
npm --prefix app run dev        # http://localhost:5190
npm --prefix app run typecheck
npm --prefix app run build
```

Root `npm test` also runs the app typecheck and build. The import preserved history from ohm-ux. Verify it from the root with `git log -m --follow -- app/src/App.tsx`.

- The app is Vite + React 19 + Tailwind 4. ohm-ui's foundations are in `src/ohm/`, copied with `npm run foundations -- ../ohmmmm/app` from an ohm-ui checkout beside ohmmmm; never edit them here. Components come from `npx shadcn add @ohm/<name>` into `src/components/`.
- `yjs`, `y-protocols`, `@tiptap/y-tiptap` and `@tiptap/extension-collaboration` are there because the editor's drag handle (`@tiptap/extension-drag-handle`) imports the last two, and `@tiptap/y-tiptap` imports the first two. There is no real-time collaboration and none is planned: build nothing on them, and do not remove them while the drag handle stays.
- In development, `src/webmcp-shim.ts` stands in for `document.modelContext` when the browser has none, so the tool path can be walked from the console: `await document.modelContext.getTools()`, then `executeTool(tool, input)`. It is never in a production build.

## Each flow

The editor assigns a unique draft slug at creation. Title edits preserve it for inline links and whole-block connections. The debounce and navigation cleanup share a flush callback. It uses the block's `bodyRevision` to skip a stale buffer after a restore or revert. See the [workspace guide](README.md#the-workspace-wireframe) for the editor behavior.

A flow is a file `flows/<flow>.md` (from the template) plus its code. The file is the specification: steps, the screen for each step and its ohm-ui components, the tool for each step with its schema and annotations, where approval happens, and the end states. Write the file first, then build to it.

## Before calling a flow done

- Walk it by hand in light and dark, on a phone and a desktop.
- Walk it by tools: in the page, `document.modelContext.getTools()` lists only the current step's tools, and calling each one with `executeTool` reaches the same end state as the hand walk.
- Check that every consequential tool stops at approval, and that declining and aborting both leave nothing behind.
- Update the flow's file to match what was built.
