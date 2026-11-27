// Search, after agentic-twitter's lookup: a sheet centred over the dimmed workspace, category
// filters on top, an input shaped like a composer, and matches grouped by kind below. It searches
// through `search`, the same path as the workspace.search WebMCP tool.
import { isBlockKind } from "@/data/block-kind"
import { useEffect, useRef, useState } from "react"
import type { LucideIcon } from "lucide-react"
import { ArrowUpIcon, BrainIcon, ChevronRightIcon, CircleUserIcon, FileTextIcon, GlobeIcon, SettingsIcon, UserIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { notify } from "@/components/ui/notice"
import { search, type SearchHit, type SearchScope } from "@/data/search"
import { cn } from "@/lib/cn"
import type { SettingsTab } from "./settings-tabs"
import { open, openSettings, setSearchOpen, showGraph, useWorkspace } from "./store"

type Category = { scope: Exclude<SearchScope, "all">; label: string; icon: LucideIcon; has: (h: SearchHit) => boolean }
const CATEGORIES: Category[] = [
  { scope: "vault", label: "Collections", icon: FileTextIcon, has: h => isBlockKind(h.kind) },
  { scope: "cortex", label: "Agents", icon: BrainIcon, has: h => !isBlockKind(h.kind) && h.kind !== "entity" && h.kind !== "setting" && h.kind !== "unit" },
  { scope: "profile", label: "Profile", icon: CircleUserIcon, has: h => h.kind === "unit" && h.root === "profile" },
  { scope: "site", label: "Site", icon: GlobeIcon, has: h => h.kind === "unit" && h.root === "site" },
  { scope: "entities", label: "Entities", icon: UserIcon, has: h => h.kind === "entity" },
  { scope: "settings", label: "Settings", icon: SettingsIcon, has: h => h.kind === "setting" },
]

function go(hit: SearchHit) {
  if (hit.kind === "setting") return openSettings(hit.id.slice("setting:".length) as SettingsTab)
  if (hit.kind === "entity") return showGraph(hit.excerpt.slice(1))
  open(hit.id)
}

export function SearchOverlay() {
  const { searchOpen } = useWorkspace()
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState("")
  const [scope, setScope] = useState<SearchScope>("all")
  const [hits, setHits] = useState<SearchHit[]>([])
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState(0)
  const [navigated, setNavigated] = useState(false)

  useEffect(() => {
    const d = dialog.current!
    if (searchOpen && !d.open) { d.showModal(); input.current?.focus() }
    if (!searchOpen && d.open) d.close()
  }, [searchOpen])

  const term = query.trim()
  useEffect(() => {
    setHits([]); setBusy(Boolean(term))
    if (!term) return
    const ac = new AbortController()
    const t = setTimeout(() => {
      search({ query: term, scope, limit: 30 }, ac.signal)
        .then(h => !ac.signal.aborted && setHits(h)).catch(() => {})
        .finally(() => !ac.signal.aborted && setBusy(false))
    }, 120)
    return () => { clearTimeout(t); ac.abort() }
  }, [term, scope])

  const groups = CATEGORIES.map(c => ({ ...c, rows: hits.filter(c.has) })).filter(g => g.rows.length)
  const visible = groups.flatMap(g => g.rows)
  const active = Math.min(selected, Math.max(0, visible.length - 1))
  const move = (dir: number) => {
    if (!visible.length) return
    const next = (active + dir + visible.length) % visible.length
    setSelected(next); setNavigated(true)
    dialog.current?.querySelector(`#search-hit-${next}`)?.scrollIntoView({ block: "nearest" })
  }
  const filterBy = (s: SearchScope) => { setScope(s); setSelected(0); input.current?.focus() }
  const submit = () => {
    if (!term) return
    if (visible[navigated ? active : 0] && (navigated || visible.length === 1)) return go(visible[navigated ? active : 0])
    notify({ message: "Asking an agent arrives once one is connected through WebMCP", tone: "info" })
  }

  const filter = "flex-none text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
  return (
    <dialog
      ref={dialog}
      aria-label="Search"
      onCancel={e => { e.preventDefault(); setSearchOpen(false) }}
      onClose={() => setSearchOpen(false)}
      onClick={e => { if (e.target === e.currentTarget) setSearchOpen(false) }}
      className={cn(
        "fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none border-0 bg-transparent p-5 text-foreground open:flex open:flex-col open:justify-center",
        "backdrop:bg-(--ohm-overlay) max-sm:p-2.5",
      )}
    >
      <div className="mx-auto flex max-h-full min-h-0 w-[min(640px,100%)] flex-col rounded-2xl bg-popover p-2.5 shade-5 backdrop-blur-xl"
        onClick={e => e.stopPropagation()}>
        <div role="group" aria-label="Search categories" className="flex flex-none gap-1 overflow-x-auto px-1 pt-0.5 pb-2.5">
          <Button size="sm" variant="ghost" className={filter} aria-pressed={scope === "all"} onClick={() => filterBy("all")}>All</Button>
          {CATEGORIES.map(c => (
            <Button key={c.scope} size="sm" variant="ghost" className={filter} aria-pressed={scope === c.scope} onClick={() => filterBy(c.scope)}>{c.label}</Button>
          ))}
        </div>
        <form className="flex flex-none items-center gap-2.5 rounded-xl bg-muted py-1.5 ps-3 pe-1.5" onSubmit={e => { e.preventDefault(); submit() }}>
          <span className="flex size-icon flex-none items-center justify-center" aria-hidden>
            <span className="size-icon rounded-full bg-primary dark:bg-foreground" />
          </span>
          <input
            ref={input}
            role="combobox"
            aria-expanded={Boolean(term)}
            aria-controls="search-hits"
            aria-autocomplete="list"
            aria-activedescendant={navigated && visible.length ? `search-hit-${active}` : undefined}
            aria-label="Search, or ask an agent"
            placeholder="Search anything, or ask an agent…"
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelected(0); setNavigated(false) }}
            onKeyDown={e => {
              if (e.nativeEvent.isComposing) return
              if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); move(e.key === "ArrowDown" ? 1 : -1) }
            }}
            className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          <Button type="submit" size="icon" className="flex-none rounded-full" aria-label="Ask" disabled={!term}>
            <Icon icon={ArrowUpIcon} size="sm" />
          </Button>
        </form>
        {term && (
          <div className="flex min-h-0 max-h-[min(46vh,420px)] flex-col overflow-y-auto overscroll-contain px-2 pb-2">
            <p aria-live="polite" className="mx-3 my-1.5 text-small text-muted-foreground">
              {busy ? "Searching…" : visible.length ? `${visible.length} ${visible.length === 1 ? "match" : "matches"} · Send to ask an agent` : "No matches. Send to ask an agent."}
            </p>
            <div id="search-hits" role="listbox" aria-label="Matches">
              {!busy && groups.map(g => (
                <section key={g.scope} role="group" aria-label={g.label}>
                  <h2 className="px-3 pt-2.5 pb-1 text-small text-muted-foreground">{g.label}</h2>
                  <ul>
                    {g.rows.map(h => {
                      const i = visible.indexOf(h)
                      return (
                        <li key={h.id}>
                          <button type="button" role="option" id={`search-hit-${i}`} aria-selected={navigated && active === i}
                            onPointerMove={() => setSelected(i)} onClick={() => go(h)}
                            className="ux-menu-row flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted">
                            <Icon icon={g.icon} size="sm" className="text-muted-foreground" />
                            <span className="min-w-0 flex-1">
                              <strong className="block truncate text-body font-medium">{h.title}</strong>
                              <small className="mt-1 block truncate text-small text-muted-foreground">{h.location} · {h.excerpt}</small>
                            </span>
                            <Icon icon={ChevronRightIcon} size="sm" className="text-muted-foreground" />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        )}
        <p className="px-3 pt-2 text-small text-muted-foreground">Searches through <code>workspace.search</code></p>
      </div>
    </dialog>
  )
}
