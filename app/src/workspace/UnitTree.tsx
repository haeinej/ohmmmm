// The home as a tree of units (docs/plans/units.md), the same view as a channel in Collections: folders
// and what is in them, over the home's own folders. It loads a folder only when it is opened, so a large
// site or channel never holds up the panel: the row shows at once, and what is inside follows.
//
// Row ids stay the ones the rest of the panel reads: a channel's folder is `vault:<path>`, an agents'
// folder `cortex:<name>`, a block or an agent's file its document's id (`<id>/<channel>` in a channel it
// was collected into), so moving by dragging, the row menu and visibility marks work as they did.
// Anything else is `unit:<key>`.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { FileTree, type FileTreeNode } from "@/components/ui/file-tree"
import { channelRowId, type Audience } from "@/data/workspace-model"
import { inOrder, titleOf } from "@/data/workspace-data"
import { docOfUnit, folderRowId, readLevel, unitSeenBy, type Level, type Unit } from "@/data/units"
import { kept, marks, openUnit, report } from "./store"

/** The home's parts by the names people see; Agents and Collections have rows of their own. */
const PART_NAME: Record<string, string> = { profile: "Profile", site: "Site", tools: "Tools" }
type Loaded = Level | "loading" | "failed"
const LOADING = (path: string): FileTreeNode => ({ id: `loading:${path}`, name: "…" })

/**
 * The levels of the home that are open, read a folder at a time. `rev` is the workspace's change count:
 * when it moves, every folder already read is read again, so a save or a move shows in the tree.
 */
export function useUnitLevels(rev: number) {
  const [levels, setLevels] = useState<Map<string, Loaded>>(() => new Map())
  // Every folder asked for, kept apart from state, so one folder is asked for once however many
  // parts of the panel want it in the same moment; and those being read now.
  const asked = useRef(new Set<string>())
  const reading = useRef(new Set<string>())
  const load = useCallback((folder: string, again = false) => {
    if (reading.current.has(folder) || (!again && asked.current.has(folder))) return
    if (!asked.current.has(folder)) setLevels(m => new Map(m).set(folder, "loading"))
    asked.current.add(folder)
    reading.current.add(folder)
    readLevel(folder).then(
      level => setLevels(m => new Map(m).set(folder, level)),
      problem => { setLevels(m => new Map(m).set(folder, "failed")); void report(Promise.reject(problem)) },
    ).finally(() => reading.current.delete(folder))
  }, [])
  useEffect(() => { load("") }, [load])
  // A change read again everything already read; the first render has nothing to read again.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    for (const folder of asked.current) load(folder, true)
  }, [rev, load])
  return { levels, load }
}

/** What a level holds that `audience` may see and the filters keep. */
function visible(level: Level, audience: Audience) {
  const passes = (unit: Unit) => {
    if (!unitSeenBy(audience, unit)) return false
    const doc = docOfUnit(unit)
    return !doc || (kept(doc) && !marks.archived.has(doc.id))
  }
  return {
    folders: level.folders.filter(folder => !folder.unit || unitSeenBy(audience, folder.unit)),
    units: level.units.filter(passes),
  }
}

/**
 * A channel's blocks in the channel's own order (its _channel.md, through inOrder, as everywhere in the
 * app); anything that is not a loaded block follows, by title.
 */
function inChannelOrder(folder: string, units: Unit[]) {
  const [top, ...rest] = folder.split("/")
  if (!rest.length || (top !== "collections" && top !== "vault")) return units
  const docs = new Map(units.flatMap(unit => { const doc = unit.type === "block" ? docOfUnit(unit) : undefined; return doc ? [[doc, unit] as const] : [] }))
  const ordered = inOrder(rest.join("/"), [...docs.keys()]).map(doc => docs.get(doc)!)
  return [...ordered, ...units.filter(unit => !ordered.includes(unit))]
}

/** A unit's row: its document's id when it is one, placed in the channel the folder is. */
function rowOf(unit: Unit, folder: string): FileTreeNode {
  const doc = docOfUnit(unit)
  // A block or an agent's file is named as everywhere else in the app; any other unit by its own title.
  const name = doc ? `${doc.icon ? `${doc.icon} ` : ""}${titleOf(doc)}` : unit.title || unit.path.split("/").at(-1)!
  if (!doc) return { id: `unit:${unit.key}`, name }
  const channel = folder.split("/").slice(1).join("/")
  const home = unit.channels?.[0]
  return { id: unit.type === "block" && channel && home && channel !== home ? channelRowId(doc.id, channel) : doc.id, name }
}

/**
 * One part of the home (`root`, such as collections or agents) as a FileTree whose folders load when
 * opened. `expanded` is the panel's own set of open rows, so revealing a block opens the way to it.
 */
export function UnitTree({ root, only, label, levels, load, audience, expanded, onExpandedChange, selected, className }: {
  root: string; only?: string[]; label: string; levels: Map<string, Loaded>; load(folder: string): void; audience: Audience
  expanded: Set<string>; onExpandedChange(next: Set<string>): void; selected: string | null; className?: string
}) {
  // Which folder each row is, for loading it when it opens and for opening a unit by its row.
  const folders = useRef(new Map<string, string>())
  const units = useRef(new Map<string, Unit>())
  const nodes = useMemo(() => {
    folders.current = new Map()
    units.current = new Map()
    const build = (folder: string): FileTreeNode[] => {
      const level = levels.get(folder)
      if (!level || level === "loading") return [LOADING(folder)]
      if (level === "failed") return [{ id: `failed:${folder}`, name: "Could not be read" }]
      const shown = visible(level, audience)
      return [
        ...shown.folders.filter(each => folder !== root || !only || only.includes(each.path)).map(each => {
          const id = folderRowId(each.path)
          folders.current.set(id, each.path)
          return { id, name: PART_NAME[each.path] ?? each.title, children: expanded.has(id) ? build(each.path) : [] }
        }),
        ...inChannelOrder(folder, shown.units).map(unit => {
          const row = rowOf(unit, folder)
          units.current.set(row.id, unit)
          return row
        }),
      ]
    }
    return build(root)
  }, [levels, root, only, audience, expanded])

  useEffect(() => { load(root) }, [root, load])
  // A folder opened (by a click, a reveal or "expand all") is read if it has not been yet.
  useEffect(() => {
    for (const id of expanded) { const path = folders.current.get(id); if (path !== undefined) load(path) }
  }, [expanded, nodes, load])

  return (
    <FileTree aria-label={label} className={className} nodes={nodes}
      expanded={expanded} onExpandedChange={onExpandedChange} selected={selected}
      onSelect={id => { const unit = units.current.get(id); if (unit) void report(Promise.resolve().then(() => openUnit(unit))) }} />
  )
}

/** The rows of every folder read so far under `folder`, for "Expand all" and for a filter that opens what matches. */
export function loadedFolderIds(levels: Map<string, Loaded>, folder: string): string[] {
  const level = levels.get(folder)
  if (!level || typeof level !== "object") return []
  return level.folders.flatMap(each => [folderRowId(each.path), ...loadedFolderIds(levels, each.path)])
}
