// Filters for the home: they narrow the tree and the graph alike.
import { isBlock, type Doc, type Platform, type Visibility, type Kind } from "@/data/workspace-data"

export type PageType = Kind
export type Edited = "any" | "week" | "month" | "year"
export type Status = "unread" | "pinned"

export type Filters = {
  platform: Set<Platform>
  type: Set<PageType>
  visibility: Set<Visibility>
  edited: Edited
  status: Set<Status>
}

export const NO_FILTERS: Filters = { platform: new Set(), type: new Set(), visibility: new Set(), edited: "any", status: new Set() }

export const PLATFORMS: { id: Platform; label: string }[] = [
  { id: "own", label: "Your site" },
  { id: "bluesky", label: "Bluesky" },
  { id: "instagram", label: "Instagram" },
  { id: "x", label: "X" },
]
export const TYPES: { id: PageType; label: string; cortex?: boolean }[] = [
  { id: "text", label: "Text" },
  { id: "excerpt", label: "Excerpt" },
  { id: "link", label: "Link" },
  { id: "media", label: "Media" },
  { id: "file", label: "File" },
  { id: "code", label: "Code" },
  { id: "post", label: "Post" },
  { id: "profile", label: "Profile", cortex: true },
  { id: "observation", label: "Observation", cortex: true },
  { id: "skill", label: "Skill", cortex: true },
  { id: "tool", label: "Tool", cortex: true },
]
export const EDITED: { id: Edited; label: string; days: number }[] = [
  { id: "any", label: "Any time", days: Infinity },
  { id: "week", label: "Past week", days: 7 },
  { id: "month", label: "Past month", days: 31 },
  { id: "year", label: "Past year", days: 366 },
]

export const activeCount = (f: Filters) =>
  f.platform.size + f.type.size + f.visibility.size + f.status.size + (f.edited === "any" ? 0 : 1)

/** Whether a block passes the filters. `marks` says which blocks are unread or pinned. */
export function passes(f: Filters, d: Doc, marks: { unread: Set<string>; pinned: Set<string> }, today = new Date()) {
  if (f.platform.size && !(isBlock(d) && f.platform.has(d.platform ?? "own"))) return false
  if (f.type.size && !f.type.has(d.kind)) return false
  if (f.visibility.size && !f.visibility.has(isBlock(d) ? d.visibility : "private")) return false
  if (f.edited !== "any") {
    const days = EDITED.find(e => e.id === f.edited)!.days
    if ((today.getTime() - new Date(`${d.updated}T12:00:00`).getTime()) / 86_400_000 > days) return false
  }
  if (f.status.size && ![...f.status].some(s => (s === "unread" ? marks.unread : marks.pinned).has(d.id))) return false
  return true
}
