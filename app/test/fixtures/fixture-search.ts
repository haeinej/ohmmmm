import { isBlock, locationOf, type Doc, type Entity } from "./workspace-model"
import { SETTINGS_TABS } from "@/workspace/settings-tabs"
import { searchInput } from "./source"
import type { SearchHit, SearchProvider, SearchScope } from "./search"

const inScope = (doc: Doc, scope: SearchScope) =>
  scope === "all" || (scope === "vault" ? isBlock(doc) : scope === "cortex" ? !isBlock(doc) : false)

const excerpt = (body: string, q: string) => {
  const text = body.replace(/^#.*$/m, "").replace(/\s+/g, " ").trim()
  const at = text.toLowerCase().indexOf(q.toLowerCase())
  const start = Math.max(0, at - 30)
  return (start > 0 ? "…" : "") + text.slice(start, start + 90) + (text.length > start + 90 ? "…" : "")
}

/** In memory, over the synthetic data. */
export const createSampleSearch = (all: Doc[], entities: Entity[]): SearchProvider => async (input, signal) => {
  signal?.throwIfAborted()
  const { query, limit } = searchInput(input)
  const scope = input.scope ?? "all"
  const q = query.trim().toLowerCase()
  if (!q) return []
  const docs = all
    .filter(d => inScope(d, scope))
    .map(d => ({ d, score: (d.title.toLowerCase().includes(q) ? 2 : 0) + (d.body.toLowerCase().includes(q) ? 1 : 0) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score || b.d.updated.localeCompare(a.d.updated))
    .map(({ d }): SearchHit => ({ id: d.id, title: d.title, kind: d.kind, location: locationOf(d).replaceAll("/", " › "), excerpt: excerpt(d.body, q) }))
  const words = q.split(/\s+/).filter(Boolean)
  const who: SearchHit[] = scope === "all" || scope === "entities"
    ? entities.filter(p => words.every(w => `${p.name} ${p.handle}`.toLowerCase().includes(w)))
      .map(p => ({ id: p.did, title: p.name, kind: "entity", location: "entities", excerpt: `@${p.handle}` }))
    : []
  const settings: SearchHit[] = scope === "all" || scope === "settings"
    ? SETTINGS_TABS.filter(t => words.every(w => `${t.label} ${t.keywords}`.toLowerCase().includes(w)))
      .map(t => ({ id: `setting:${t.id}`, title: t.label, kind: "setting", location: "settings", excerpt: t.description }))
    : []
  return [...docs, ...who, ...settings].slice(0, limit)
}
