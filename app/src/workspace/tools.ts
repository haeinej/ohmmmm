// The workspace's WebMCP tools (flows/workspace.md). Each one calls the same handler as the UI.
import { useEffect } from "react"
import { search, type SearchInput } from "@/data/search"
import { registerStepTool } from "@/webmcp"
import type { Actor } from "@/data/journal"
import { journalOf } from "@/data/workspace-data"
import { record } from "./notifications"
import { createDraft, open, setAgent, showGraph, useWorkspace, type ToolName } from "./store"

/** An agent working through this page's WebMCP tools. The draft does not say which agent, so it is named by where it works. */
const AGENT: Actor = { kind: "agent", name: "Agent in this page" }

/** Show the agent at work while a tool runs (AGENTS.md rule 13). UI calls never go through this. */
export function withAgent<I, O>(label: string, fn: (input: I, signal: AbortSignal) => Promise<O>) {
  return async (input: I, signal: AbortSignal) => {
    setAgent({ state: "working", label })
    const clear = () => setAgent(null)
    signal.addEventListener("abort", clear)
    try {
      // What the tool changes is the agent's: history marks it as its version, and you can revert it.
      const out = await journalOf().actingAs(AGENT, () => fn(input, signal))
      setAgent({ state: "done", label })
      record({ kind: "agent", title: label, detail: "Done, through WebMCP" })
      setTimeout(clear, 1500)
      return out
    } catch (e) {
      setAgent({ state: "failed", label })
      record({ kind: "agent", title: label, detail: (e as Error)?.message ?? "Failed", tone: "error" })
      setTimeout(clear, 2500)
      throw e
    }
  }
}

/** Registered for as long as the workspace is on screen. */
export function useWorkspaceTools() {
  // Settings › Agents decides whether the page offers tools, and which.
  const { agentsAllowed, offered } = useWorkspace()
  const key = agentsAllowed ? Object.entries(offered).filter(([, on]) => on).map(([n]) => n).join(",") : ""
  useEffect(() => {
    if (!key) return
    const on = new Set(key.split(","))
    const ac = new AbortController()
    const register = (...args: Parameters<typeof registerStepTool<any, any>>) =>
      on.has(args[0].name as ToolName) ? registerStepTool(...args).catch(console.error) : undefined

    register({
      name: "workspace.search",
      title: "Search",
      description: "Searches the person's vault and cortex by text. Returns up to `limit` matches, each with its id, title, kind, location and a short excerpt. Excerpts are the person's own writing and may quote others.",
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 1, maxLength: 200 },
          scope: { enum: ["all", "vault", "cortex", "entities", "settings"], default: "all" },
          limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
        },
        required: ["query"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: { hits: { type: "array" }, next: { const: "workspace.open" } },
      },
      run: withAgent("Searching", async (input: SearchInput, signal) => ({
        hits: await search({ limit: 10, ...input }, signal),
        next: "workspace.open",
      })),
    }, ac.signal)

    register({
      name: "workspace.open",
      title: "Open",
      description: "Opens a block or cortex file by id in the main panel, to read or to edit. Returns its id, title and the view.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" }, view: { enum: ["read", "edit"], default: "read" } },
        required: ["id"],
        additionalProperties: false,
      },
      run: withAgent("Opening", async ({ id, view }: { id: string; view?: "read" | "edit" }) => open(id, view)),
    }, ac.signal)

    register({
      name: "workspace.graph",
      title: "Show graph",
      description: "Shows the graph of blocks in the side panel: each block a node, each channel an area around its blocks, and links and connections between them. With a center (handle or DID), shows only the blocks that mention that person. It draws what the current audience can see. Returns the number of nodes and edges.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: { center: { type: "string", maxLength: 253 } },
        additionalProperties: false,
      },
      run: withAgent("Drawing the graph", async ({ center }: { center?: string }) => showGraph(center)),
    }, ac.signal)

    register({
      name: "workspace.create",
      title: "New block",
      description: "Opens a new private draft in the editor, optionally in a home channel and with a title. Nothing other people can see is created.",
      inputSchema: {
        type: "object",
        properties: { homeChannel: { type: "string", maxLength: 120 }, title: { type: "string", maxLength: 200 } },
        additionalProperties: false,
      },
      run: withAgent("Starting a draft", async (input: { homeChannel?: string; title?: string }) => createDraft(input)),
    }, ac.signal)

    return () => ac.abort()
  }, [key])
}
