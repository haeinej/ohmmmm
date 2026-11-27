import type { Kind } from "./workspace-model"
import { getSource } from "./workspace-data"
import { searchInput } from "./source"
import { docOfUnit, readUnits, unitPlace, UNIT_ID, type Unit } from "./units"

export type SearchScope = "all" | "vault" | "cortex" | "profile" | "site" | "entities" | "settings"
export type SearchInput = { query: string; scope?: SearchScope; limit?: number }
/** A unit that is not a block or an agent's file (the profile, the wallet, a site file) is kind `unit`. */
export type SearchHit = { id: string; title: string; kind: Kind | "entity" | "setting" | "unit"; location: string; excerpt: string; root?: Unit["root"] }
export type SearchProvider = (input: SearchInput, signal?: AbortSignal) => Promise<SearchHit[]>

const UNIT_SCOPES: SearchScope[] = ["all", "profile", "site"]

/**
 * The units the home's source does not search itself: the profile, the wallet and the site's files, by
 * their titles and paths. Blocks and agents' files are the source's, searched in their text.
 */
async function unitHits(input: SearchInput): Promise<SearchHit[]> {
  const scope = input.scope ?? "all"
  if (!UNIT_SCOPES.includes(scope)) return []
  const words = input.query.toLowerCase().split(/\s+/).filter(Boolean)
  const units = await readUnits().catch(() => [] as Unit[])
  return units
    .filter(unit => (scope === "all" ? unit.root === "profile" || unit.root === "site" : unit.root === scope) && !docOfUnit(unit))
    .filter(unit => { const text = `${unit.title ?? ""} ${unit.path}`.toLowerCase(); return words.every(word => text.includes(word)) })
    .map(unit => ({ id: `${UNIT_ID}${unit.key}`, title: unit.title ?? unit.path, kind: "unit" as const, location: unitPlace(unit), excerpt: unit.type === "artifact" ? unit.kind ?? "file" : unit.type, root: unit.root }))
}

/** Both the overlay and the WebMCP step call this path. */
export async function search(input: SearchInput, signal?: AbortSignal): Promise<SearchHit[]> {
  searchInput(input)
  const source = getSource()
  const scope = input.scope ?? "all"
  const [docs, units] = await Promise.all([
    source && scope !== "profile" && scope !== "site" ? source.search(input, signal) : Promise.resolve([] as SearchHit[]),
    unitHits(input),
  ])
  signal?.throwIfAborted()
  return [...docs, ...units].slice(0, input.limit ?? 30)
}
